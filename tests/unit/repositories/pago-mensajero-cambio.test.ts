import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import {
  cambioElPagoAlMensajero,
  type PagoComparable,
} from "@/lib/repositories/_shared/pago-mensajero-cambio";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 380 / T4 (R3/R4) — EL PREDICADO DEL CAMBIO, EJERCIDO EXHAUSTIVAMENTE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO EXISTE Y NO BASTA CON EL DE INTEGRACION. `cambioElPagoAlMensajero` es una
// funcion PURA: no habla con Prisma, asi que un doble no puede engañarla y las siete formas del
// cambio se pueden recorrer en milisegundos. Lo que un doble SI falsearia —que filas se borran y
// cuales se recrean— vive en `tests/integration/db/zona-pago-mensajero-rastro.test.ts`, contra
// Postgres real.
//
// Se usan `Prisma.Decimal` REALES, no numeros ni strings: la comparacion depende de `toFixed(2)`
// del propio `Decimal` (R4), y con un doble del importe se estaria midiendo otra cosa.

const VEHICULO_A = "veh-aaaaaaaa";
const VEHICULO_B = "veh-bbbbbbbb";

function pago(vehiculoId: string | null, entregado: string, rechazado: string): PagoComparable {
  return {
    vehiculoId,
    cobroEntregado: new Prisma.Decimal(entregado),
    cobroRechazado: new Prisma.Decimal(rechazado),
  };
}

describe("380/R3 — el conjunto de pagos cambio si y solo si cambia el conjunto o un importe", () => {
  it("CONTROL POSITIVO: el mismo conjunto, en el MISMO orden, NO es un cambio", () => {
    // Sin este caso, todos los `toBe(true)` de abajo podrian estar pasando porque la funcion
    // devuelve `true` siempre — que es exactamente la mutacion que T4 exige probar.
    const antes = [pago(VEHICULO_A, "1500.00", "700.00"), pago(VEHICULO_B, "2000.00", "900.00")];
    const despues = [pago(VEHICULO_A, "1500.00", "700.00"), pago(VEHICULO_B, "2000.00", "900.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(false);
  });

  it("⭑ el MISMO conjunto EN OTRO ORDEN no es un cambio: el orden no participa", () => {
    // `createMany` no garantiza el orden de lectura posterior. Si el orden participara, cualquier
    // guardado repetido escribiria una fila de historial falsa.
    const antes = [pago(VEHICULO_A, "1500.00", "700.00"), pago(VEHICULO_B, "2000.00", "900.00")];
    const despues = [pago(VEHICULO_B, "2000.00", "900.00"), pago(VEHICULO_A, "1500.00", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(false);
  });

  it("⭑ `1500` frente a `1500.00` NO es un cambio (R4: misma escala, misma huella)", () => {
    // Postgres normaliza a `Decimal(12,2)` al releer. Si la comparacion fuera textual cruda, el
    // primer guardado tras un `createMany` diria «cambio» sin que nadie hubiera tocado nada.
    const antes = [pago(null, "1500", "700")];
    const despues = [pago(null, "1500.00", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(false);
  });

  it("vacio contra vacio no es un cambio", () => {
    expect(cambioElPagoAlMensajero([], [])).toBe(false);
  });

  it("⭑ ALTA: aparece un vehiculo que no estaba", () => {
    const antes = [pago(VEHICULO_A, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1500.00", "700.00"), pago(VEHICULO_B, "2000.00", "900.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("⭑ ALTA desde el vacio: la zona no tenia pagos y ahora tiene uno", () => {
    expect(cambioElPagoAlMensajero([], [pago(null, "1000.00", "500.00")])).toBe(true);
  });

  it("⭑ BAJA: desaparece un vehiculo que estaba", () => {
    const antes = [pago(VEHICULO_A, "1500.00", "700.00"), pago(VEHICULO_B, "2000.00", "900.00")];
    const despues = [pago(VEHICULO_A, "1500.00", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("⭑ BAJA hasta el vacio: se quitaron todos los pagos", () => {
    expect(cambioElPagoAlMensajero([pago(null, "1000.00", "500.00")], [])).toBe(true);
  });

  it("⭑ cambia UNO de los dos importes (el de entrega)", () => {
    const antes = [pago(VEHICULO_A, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1600.00", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("⭑ cambia el OTRO importe (el del rechazo), que es el que mas facil se olvida", () => {
    const antes = [pago(VEHICULO_A, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1500.00", "750.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("cambian LOS DOS importes", () => {
    const antes = [pago(VEHICULO_A, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1600.00", "750.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("⭑ un centimo basta: `1500.00` frente a `1500.01`", () => {
    // El fallo que un comparador con coma flotante dejaria pasar en silencio.
    const antes = [pago(VEHICULO_A, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1500.01", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
  });

  it("⭑ el pago POR DEFECTO (`vehiculoId: null`) no se confunde con el de un vehiculo", () => {
    // `@@unique([zonaId, vehiculoId])` con NULLS NOT DISTINCT deja a lo sumo UN pago por defecto
    // por zona. Pasar de «por defecto» a «por vehiculo» con los mismos importes ES un cambio: el
    // mensajero cobra distinto segun con que llegue.
    const antes = [pago(null, "1500.00", "700.00")];
    const despues = [pago(VEHICULO_A, "1500.00", "700.00")];
    expect(cambioElPagoAlMensajero(antes, despues)).toBe(true);
    expect(cambioElPagoAlMensajero(despues, antes)).toBe(true);
  });

  it("⭑ y el pago por defecto contra SI MISMO no es un cambio", () => {
    // La otra mitad del caso anterior: sin esto, «null se compara aparte» podria estar
    // implementado como «null siempre cambia».
    expect(
      cambioElPagoAlMensajero([pago(null, "1500.00", "700.00")], [pago(null, "1500.00", "700.00")]),
    ).toBe(false);
  });

  it("⭑ R3: el `id` NO PARTICIPA — el tipo ni siquiera lo declara", () => {
    // El guardado REGENERA los `id` en cada reemplazo (`deleteMany` + `createMany`). Si entraran
    // en la comparacion, TODOS los guardados dirian «cambio» y la fila dejaria de significar nada.
    //
    // Se afirma sobre la FORMA de lo que la funcion acepta: un objeto con `id` de mas no puede
    // cambiar el veredicto porque `PagoComparable` no lo tiene y el comparador no lo lee.
    const conIdViejo = { ...pago(VEHICULO_A, "1500.00", "700.00"), id: "tzm-viejo" };
    const conIdNuevo = { ...pago(VEHICULO_A, "1500.00", "700.00"), id: "tzm-nuevo" };
    expect(cambioElPagoAlMensajero([conIdViejo], [conIdNuevo])).toBe(false);
  });
});
