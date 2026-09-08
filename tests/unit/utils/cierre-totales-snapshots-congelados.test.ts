import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import {
  derivarPagos,
  sumarSnapshotsCongelados,
} from "@/lib/utils/cierre-totales";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

// 💰 FICHA 398 (T2.2, design §2.2) — SUMAR LOS SNAPSHOTS CONGELADOS **NO** ES RE-DERIVAR.
//
// EL PORQUE, y es dinero ajeno: al corregir el resultado de UNA gestion de un cierre ya
// solicitado hay que rehacer `total_pago_mensajero` y `total_ingreso_bodega_rechazos`. El cierre
// congela `destino_zona_id` pero NO la fila de `tarifa_zona_mensajero` que uso, asi que
// re-derivar con `derivarPagos` reescribiria, con la tarifa de HOY, el pago congelado de las
// OTRAS gestiones del cierre —gestiones que nadie corrigio—.
//
// Este archivo no describe la funcion: la CONTRASTA con la que NO hay que usar, sobre el mismo
// conjunto, y enseña el numero distinto que cada una produce. Si alguien sustituyera una por otra
// en el repositorio, el test de integracion se pone rojo; este dice POR QUE.

const d = (v: string) => new Prisma.Decimal(v);

describe("398 — `sumarSnapshotsCongelados` suma lo escrito, y nada mas", () => {
  it("suma con `Prisma.Decimal` y devuelve STRING de escala 2", () => {
    expect(sumarSnapshotsCongelados([d("1500.00"), d("900.00"), d("0.00")])).toBe("2400.00");
  });

  it("un conjunto vacio es `0.00`, no `undefined` ni `NaN`", () => {
    expect(sumarSnapshotsCongelados([])).toBe("0.00");
  });

  it("`null` cuenta como cero (gestion sin snapshot escrito), sin lanzar", () => {
    expect(sumarSnapshotsCongelados([d("1000.00"), null, d("700.00")])).toBe("1700.00");
    expect(sumarSnapshotsCongelados([null, null])).toBe("0.00");
  });

  it("💰 la suma es EXACTA: los centimos que la coma flotante pierde, aqui no se pierden", () => {
    // `0.1 + 0.2 !== 0.3` en coma flotante. Con `Decimal` si. Este numero decide cuanto se le
    // paga a una persona.
    expect(sumarSnapshotsCongelados([d("0.10"), d("0.20")])).toBe("0.30");
    // Diez veces 1.115 en `number` da 11.149999999999999.
    expect(sumarSnapshotsCongelados(Array.from({ length: 10 }, () => d("1.11")))).toBe("11.10");
    expect(sumarSnapshotsCongelados([d("9999999.99"), d("0.01")])).toBe("10000000.00");
  });

  it("no redondea de menos: un valor con dos decimales sobrevive entero", () => {
    expect(sumarSnapshotsCongelados([d("17700.55")])).toBe("17700.55");
  });
});

// ---------------------------------------------------------------------------------------------
// ⭑ EL CONTRASTE. Es el corazon de T2.2.
// ---------------------------------------------------------------------------------------------

describe("💰 398 — sumar snapshots frente a re-derivar con la tarifa VIVA", () => {
  /** Dos gestiones del mismo cierre, con pagos congelados con tarifas DISTINTAS. */
  const GESTIONES = [
    // La que se acaba de corregir: su snapshot ya es 0.00 (`rechazada` no paga).
    { gestionId: "g-corregida", resultado: "rechazada" as const, pagoMensajero: d("0.00") },
    // La OTRA del cierre, congelada cuando la tarifa era 900. Nadie la corrigio.
    { gestionId: "g-ajena", resultado: "entregada" as const, pagoMensajero: d("900.00") },
  ];

  it("sumar los snapshots da 900.00: la gestion ajena conserva SU pago congelado", () => {
    expect(sumarSnapshotsCongelados(GESTIONES.map((g) => g.pagoMensajero))).toBe("900.00");
  });

  it("⭑ re-derivar con la tarifa de HOY daria 1500.00: 600 colones de dinero AJENO movido", () => {
    // `derivarPagos` NO mira el snapshot: recalcula con la tarifa que se le pase. Sobre el mismo
    // conjunto y con la tarifa viva (1500) devuelve otro numero, y ese numero incluye una gestion
    // que nadie toco.
    const filas = GESTIONES.map((g) => ({
      gestionId: g.gestionId,
      resultado: g.resultado,
    })) as unknown as CierreGestionPendienteRow[];
    const { total } = derivarPagos(filas, {
      cobroEntregado: "1500.00",
      cobroRechazado: "1000.00",
    });
    expect(total).toBe("1500.00");
    // Y la diferencia es exactamente lo que se le habria movido a la gestion ajena.
    expect(new Prisma.Decimal(total).minus("900.00").toFixed(2)).toBe("600.00");
  });

  it("las dos funciones NO son intercambiables, y este caso lo deja escrito", () => {
    const filas = GESTIONES.map((g) => ({
      gestionId: g.gestionId,
      resultado: g.resultado,
    })) as unknown as CierreGestionPendienteRow[];
    const reDerivado = derivarPagos(filas, {
      cobroEntregado: "1500.00",
      cobroRechazado: "1000.00",
    }).total;
    const sumado = sumarSnapshotsCongelados(GESTIONES.map((g) => g.pagoMensajero));
    expect(reDerivado).not.toBe(sumado);
  });
});
