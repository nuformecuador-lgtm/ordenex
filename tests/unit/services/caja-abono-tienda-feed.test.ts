import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import { CajaAbonoTiendaFeedService } from "@/lib/services/CajaAbonoTiendaFeedService";
import { rutaDeComprobante } from "@/lib/utils/comprobante";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

/**
 * FICHA 457 / T3.2 y T2.4 (R17, R22, R27, R31) — el PUERTO DE CAJA del pago de una tienda a Ordenex y
 * la carpeta de su comprobante.
 *
 * El puerto es el UNICO que escribe en la caja por este documento: tipo, categoria y origen son
 * LITERALES de la clase (molde `CajaPagoPorCuentaFeedService`). Se prueba lo que escribe cada metodo
 * y la lista EXACTA de categorias y origenes que su fuente nombra: un tercer literal (otra categoria,
 * por ejemplo una PROPIA) aqui se pone rojo.
 */

const TX = { soyLaTx: true } as never;
const INSTANTE = new Date("2026-09-20T06:00:00.000Z");
const MOV = {
  abonoId: "abono-1",
  monto: "4000.00",
  descripcion: "Nuform · Pago · SINPE · 123",
  registradoPor: "u-maestro",
  fechaMovimiento: INSTANTE,
};

function montar() {
  const crearMovimientos = vi.fn(async () => 1);
  const repo = { crearMovimientos } as unknown as IWalletMovimientoRepository;
  return { feed: new CajaAbonoTiendaFeedService(repo), crearMovimientos };
}

describe("457/T3.2 — CajaAbonoTiendaFeedService", () => {
  it("R17/R19: la entrada es `ingreso / ingreso_abono_tienda`, origen el documento, con el monto, la descripcion y el instante recibidos", async () => {
    const m = montar();
    expect(await m.feed.emitirIngresoDeAbono(TX, MOV)).toBe(1);
    expect(m.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(m.crearMovimientos).toHaveBeenCalledWith(TX, [
      {
        tipo: "ingreso",
        categoria: "ingreso_abono_tienda",
        monto: "4000.00",
        origenTipo: "abono_tienda",
        origenId: "abono-1",
        descripcion: "Nuform · Pago · SINPE · 123",
        registradoPor: "u-maestro",
        fechaMovimiento: INSTANTE,
      },
    ]);
  });

  it("R31/R39: el reverso es `egreso / egreso_reverso_abono_tienda` con el MISMO origen (la idempotencia la da la categoria)", async () => {
    const m = montar();
    expect(await m.feed.emitirReversoDeAbono(TX, MOV)).toBe(1);
    expect(m.crearMovimientos).toHaveBeenCalledWith(TX, [
      {
        tipo: "egreso",
        categoria: "egreso_reverso_abono_tienda",
        monto: "4000.00",
        origenTipo: "abono_tienda",
        origenId: "abono-1",
        descripcion: "Nuform · Pago · SINPE · 123",
        registradoPor: "u-maestro",
        fechaMovimiento: INSTANTE,
      },
    ]);
  });

  it("R22: la fuente del puerto nombra EXACTAMENTE dos categorias y un origen (lista cerrada)", () => {
    const fuente = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../../../lib/services/CajaAbonoTiendaFeedService.ts"), "utf8"),
    );
    const categorias = [...fuente.matchAll(/categoria:\s*"([a-z_]+)"/g)].map((x) => x[1]);
    const origenes = [...fuente.matchAll(/origenTipo:\s*"([a-z_]+)"/g)].map((x) => x[1]);
    const tipos = [...fuente.matchAll(/tipo:\s*"([a-z_]+)"/g)].map((x) => x[1]);
    expect(categorias).toEqual(["ingreso_abono_tienda", "egreso_reverso_abono_tienda"]);
    expect(origenes).toEqual(["abono_tienda", "abono_tienda"]);
    expect(tipos).toEqual(["ingreso", "egreso"]);
  });
});

describe("457/T2.4 — la carpeta del comprobante (R27)", () => {
  it("carpeta propia `abonos-tienda/` + uuid aleatorio + extension del tipo", () => {
    expect(rutaDeComprobante("abono_tienda", "application/pdf", () => "ALEATORIO")).toBe("abonos-tienda/ALEATORIO.pdf");
    expect(rutaDeComprobante("abono_tienda", "image/webp", () => "ALEATORIO")).toBe("abonos-tienda/ALEATORIO.webp");
  });

  it("dos rutas no se repiten y no llevan ningun identificador de tienda, documento ni usuario", () => {
    const a = rutaDeComprobante("abono_tienda", "image/png");
    const b = rutaDeComprobante("abono_tienda", "image/png");
    expect(a).not.toBe(b);
    for (const ruta of [a, b]) expect(ruta).toMatch(/^abonos-tienda\/[0-9a-f-]{36}\.png$/);
  });
});
