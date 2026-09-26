import { describe, it, expect, vi } from "vitest";

import type { AnularAbonoTiendaInput } from "@/lib/types/abono-tienda";

import { MAESTRO, TIENDA_ID, montar, registro } from "./_abono-tienda-montar";

/**
 * FICHA 457 / T4.2 — `AbonoTiendaService.anular` con dobles (R31–R40). MUTACIONES que este archivo pone
 * en rojo (design §13): (7) anular con el monto de la PETICION (`input.monto ?? abono.monto`: la
 * peticion trae `monto: "1.00"` a proposito, leccion del mutante equivalente de la 461); (8) anular sin
 * el debito de la tienda.
 */

/** La peticion lleva un monto de MAS, como lo haria un cliente malicioso; el borde lo rechaza, y el servicio lo IGNORA. */
const PETICION = { abonoId: "ab-1", motivo: "Referencia equivocada", monto: "1.00" } as unknown as AnularAbonoTiendaInput;

describe("457/T4.2 — anular un pago de una tienda a Ordenex", () => {
  it("R37: sin acceso total -> forbidden ANTES de leer el documento", async () => {
    for (const actor of [
      { usuarioId: TIENDA_ID, rol: "adminTienda" as const },
      { usuarioId: "m", rol: "mensajero" as const },
    ]) {
      const m = montar();
      expect(await m.svc.anular(PETICION, actor)).toEqual({ status: "forbidden" });
      expect(m.abonoRepo.obtenerPorId).not.toHaveBeenCalled();
      expect(m.runTx).not.toHaveBeenCalled();
    }
  });

  it("R37: documento inexistente -> no_encontrado sin transaccion", async () => {
    const m = montar({ documento: null });
    expect(await m.svc.anular({ abonoId: "ab-x", motivo: "x" }, MAESTRO)).toEqual({ status: "no_encontrado" });
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R31/R34/R38 (mutaciones 7 y 8): candado, constancia, DEBITO en la tienda y EGRESO en la caja con el monto DEL DOCUMENTO; saldo al final", async () => {
    const m = montar({ documento: registro({ monto: "2500.50" }) });
    const r = await m.svc.anular(PETICION, MAESTRO);
    expect(r.status).toBe("ok");
    expect(m.orden).toEqual(["candado", "anular", "tienda:abono_tienda_anulado", "caja:reverso", "saldo"]);
    expect(m.candado.bloquearBeneficiario).toHaveBeenCalledWith(m.tx, { tipo: "tienda", tiendaId: TIENDA_ID });
    const constancia = vi.mocked(m.abonoRepo.anular).mock.calls[0][1];
    expect(constancia).toEqual({ abonoId: "ab-1", motivo: "Referencia equivocada", anuladoPor: MAESTRO.usuarioId });
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1];
    expect(tienda).toHaveLength(1);
    expect(tienda[0]).toMatchObject({
      tiendaId: TIENDA_ID,
      tipo: "debito",
      categoria: "abono_tienda_anulado",
      monto: "2500.50", // DEL DOCUMENTO: el «1.00» de la peticion no existe para el servicio
      origenTipo: "abono_tienda",
      origenId: "ab-1",
      registradoPor: MAESTRO.usuarioId,
    });
    const caja = vi.mocked(m.caja.emitirReversoDeAbono).mock.calls[0][1];
    expect(caja.monto).toBe("2500.50");
    expect(caja.abonoId).toBe("ab-1");
    expect(m.caja.emitirIngresoDeAbono).not.toHaveBeenCalled();
  });

  it("R32: los dos contra-asientos llevan el MISMO instante: el inicio del dia de la anulacion en Costa Rica", async () => {
    // 12:00 CR del 24 → 2026-09-24T06:00Z.
    const mediodia = montar({ ahora: new Date("2026-09-24T18:00:00.000Z") });
    await mediodia.svc.anular(PETICION, MAESTRO);
    expect(mediodia.tiendaRepo.crearMovimientos.mock.calls[0][1][0].fechaMovimiento?.toISOString()).toBe("2026-09-24T06:00:00.000Z");
    expect(vi.mocked(mediodia.caja.emitirReversoDeAbono).mock.calls[0][1].fechaMovimiento.toISOString()).toBe("2026-09-24T06:00:00.000Z");
    // 22:00 CR del 24 (ya es el 25 en UTC) → sigue siendo el 24 en CR: 2026-09-24T06:00Z, no el 25.
    const noche = montar({ ahora: new Date("2026-09-25T04:00:00.000Z") });
    await noche.svc.anular(PETICION, MAESTRO);
    expect(noche.tiendaRepo.crearMovimientos.mock.calls[0][1][0].fechaMovimiento?.toISOString()).toBe("2026-09-24T06:00:00.000Z");
    expect(vi.mocked(noche.caja.emitirReversoDeAbono).mock.calls[0][1].fechaMovimiento.toISOString()).toBe("2026-09-24T06:00:00.000Z");
  });

  it("R21/R33: las descripciones son «Anulación · » + la original, SIN el motivo de la anulacion", async () => {
    const m = montar();
    await m.svc.anular(PETICION, MAESTRO);
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirReversoDeAbono).mock.calls[0][1];
    expect(tienda.descripcion).toBe("Anulación · Pago de lo que debía por los fletes de septiembre · SINPE · 123456");
    expect(caja.descripcion).toBe("Anulación · Nuform · Pago de lo que debía por los fletes de septiembre · SINPE · 123456");
    expect(tienda.descripcion).not.toContain("Referencia equivocada");
    expect(caja.descripcion).not.toContain("Referencia equivocada");
  });

  it("R36: ya anulado -> ya_anulado y ningun asiento", async () => {
    const m = montar({ anular: async () => ({ status: "ya_anulado" as const }) });
    expect(await m.svc.anular(PETICION, MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.caja.emitirReversoDeAbono).not.toHaveBeenCalled();
  });

  it("R38: devuelve el saldo resultante, que PUEDE volver a ser negativo", async () => {
    const m = montar({ saldos: [{ creditos: "9000.00", debitos: "15000.00" }] });
    const r = await m.svc.anular(PETICION, MAESTRO);
    expect(r).toEqual({
      status: "ok",
      saldo: { creditos: "9000.00", debitos: "15000.00", saldo: "-6000.00", signo: "negativo" },
    });
  });

  it("R33: la anulacion no toca el comprobante ni el documento", async () => {
    const m = montar({
      documento: registro({ comprobantePath: "abonos-tienda/a.pdf", comprobanteContentType: "application/pdf" }),
    });
    await m.svc.anular(PETICION, MAESTRO);
    expect(m.storage.remove).not.toHaveBeenCalled();
    expect(m.storage.upload).not.toHaveBeenCalled();
    expect(m.abonoRepo.crear).not.toHaveBeenCalled();
  });
});
