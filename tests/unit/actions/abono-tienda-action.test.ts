import { describe, it, expect, vi } from "vitest";

import * as acciones from "@/lib/actions/abono-tienda";
import type { IAbonoTiendaService } from "@/lib/interfaces/services/IAbonoTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * FICHA 457 / T5.1 — el BORDE de las tres actions, con el servicio doble: la sesion va ANTES de mirar la
 * entrada (R3), zod `.strict()` rechaza lo no previsto (R12/R13/R34), el `File` del `FormData` llega
 * como bytes al servicio, un campo de archivo VACIO es «sin comprobante» (R30), y la lista de
 * exportaciones es EXACTAMENTE tres (R40: ni editar ni deshacer). El camino hasta Postgres lo prueba
 * `tests/integration/db/abono-tienda-457.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA = "7f1c2d3e-0000-4000-8000-00000000000a";
const ABONO = "9f2e3d4c-1b2a-4c3d-8e9f-0a1b2c3d4e5f";

function fd(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

const ENTRADA = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: TIENDA,
  monto: "4000.00",
  metodo: "SINPE",
  referencia: "123456",
  motivo: "Pago de lo que debía por los fletes de septiembre",
  fechaPago: "2026-09-20",
};

function servicio(): IAbonoTiendaService {
  return {
    registrar: vi.fn(async () => ({ status: "sin_deuda" as const, saldo: { creditos: "0.00", debitos: "0.00", saldo: "0.00", signo: "cero" as const } })),
    anular: vi.fn(async () => ({ status: "ya_anulado" as const })),
    obtenerComprobante: vi.fn(async () => ({ status: "sin_comprobante" as const })),
  };
}

describe("457/T5.1 — R40: la lista EXACTA de exportaciones (ni editar ni deshacer una anulacion)", () => {
  it("son tres", () => {
    expect(Object.keys(acciones).sort()).toEqual([
      "anularAbonoTiendaAction",
      "obtenerComprobanteAbonoAction",
      "registrarAbonoTiendaAction",
    ]);
  });
});

describe("457/T5.1 — registrarAbonoTiendaAction", () => {
  it("R3: sin sesion -> unauthenticated ANTES de validar (una entrada invalida no cambia la respuesta)", async () => {
    const service = servicio();
    expect(await acciones.registrarAbonoTiendaAction(fd({ basura: "x" }), { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R12: una clave no prevista -> validation_error, sin llamar al servicio", async () => {
    const service = servicio();
    const r = await acciones.registrarAbonoTiendaAction(fd({ ...ENTRADA, categoria: "ajuste_credito" }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R13: sin clave de idempotencia -> validation_error bajo claveIdempotencia", async () => {
    const service = servicio();
    const { claveIdempotencia: _c, ...sinClave } = ENTRADA;
    void _c;
    const r = await acciones.registrarAbonoTiendaAction(fd(sinClave), { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("imposible");
    expect(Object.keys(r.fieldErrors)).toEqual(["claveIdempotencia"]);
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R4/R6/R7/R9: cada rechazo se devuelve bajo SU campo", async () => {
    const casos: [Record<string, string>, string][] = [
      [{ ...ENTRADA, monto: "0" }, "monto"],
      [{ ...ENTRADA, motivo: "   " }, "motivo"],
      [{ ...ENTRADA, referencia: "" }, "referencia"],
      [{ ...ENTRADA, fechaPago: "2999-01-01" }, "fechaPago"],
      [{ ...ENTRADA, tiendaId: "nuform" }, "tiendaId"],
    ];
    for (const [campos, campo] of casos) {
      const service = servicio();
      const r = await acciones.registrarAbonoTiendaAction(fd(campos), { service, getActor: async () => MAESTRO });
      expect(r.status, campo).toBe("validation_error");
      if (r.status !== "validation_error") throw new Error("imposible");
      expect(Object.keys(r.fieldErrors), campo).toEqual([campo]);
      expect(service.registrar).not.toHaveBeenCalled();
    }
  });

  it("el File del FormData llega al servicio como bytes con su tipo; el resto sin el comprobante y con la fecha real", async () => {
    const service = servicio();
    const archivo = new File([new Uint8Array([1, 2, 3])], "c.pdf", { type: "application/pdf" });
    await acciones.registrarAbonoTiendaAction(fd({ ...ENTRADA, comprobante: archivo }), {
      service,
      getActor: async () => MAESTRO,
    });
    const [input, recibido, actor] = vi.mocked(service.registrar).mock.calls[0];
    expect(input).not.toHaveProperty("comprobante");
    expect(input).toEqual({
      claveIdempotencia: ENTRADA.claveIdempotencia,
      tiendaId: TIENDA,
      monto: "4000.00",
      metodo: "SINPE",
      referencia: "123456",
      motivo: "Pago de lo que debía por los fletes de septiembre",
      fechaPago: "2026-09-20",
    });
    expect(recibido?.contentType).toBe("application/pdf");
    expect([...(recibido?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(actor).toBe(MAESTRO);
  });

  it("R30: un campo de archivo VACIO (0 bytes) es «sin comprobante», no un comprobante invalido", async () => {
    const service = servicio();
    const vacio = new File([], "", { type: "application/octet-stream" });
    const r = await acciones.registrarAbonoTiendaAction(fd({ ...ENTRADA, comprobante: vacio }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("sin_deuda");
    expect(vi.mocked(service.registrar).mock.calls[0][1]).toBeNull();
  });

  it("devuelve lo que responde el servicio (forbidden y excede incluidos)", async () => {
    const forbidden = servicio();
    forbidden.registrar = vi.fn(async () => ({ status: "forbidden" as const }));
    expect(await acciones.registrarAbonoTiendaAction(fd(ENTRADA), { service: forbidden, getActor: async () => ({ usuarioId: "m", rol: "mensajero" }) })).toEqual({
      status: "forbidden",
    });
    const excede = servicio();
    excede.registrar = vi.fn(async () => ({ status: "excede" as const, deuda: "6170666.55" }));
    expect(await acciones.registrarAbonoTiendaAction(fd(ENTRADA), { service: excede, getActor: async () => MAESTRO })).toEqual({
      status: "excede",
      deuda: "6170666.55",
    });
  });
});

describe("457/T5.1 — anularAbonoTiendaAction y obtenerComprobanteAbonoAction", () => {
  it("R34: un monto en la anulacion -> validation_error sin llamar al servicio", async () => {
    const service = servicio();
    const r = await acciones.anularAbonoTiendaAction({ abonoId: ABONO, motivo: "Error", monto: "1.00" }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    expect(service.anular).not.toHaveBeenCalled();
  });

  it("R35: motivo vacio -> validation_error", async () => {
    const service = servicio();
    const r = await acciones.anularAbonoTiendaAction({ abonoId: ABONO, motivo: "   " }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    expect(service.anular).not.toHaveBeenCalled();
  });

  it("R3: sin sesion -> unauthenticated en las dos", async () => {
    const service = servicio();
    expect(await acciones.anularAbonoTiendaAction({ abonoId: ABONO, motivo: "Error" }, { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(await acciones.obtenerComprobanteAbonoAction({ abonoId: ABONO }, { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(service.anular).not.toHaveBeenCalled();
    expect(service.obtenerComprobante).not.toHaveBeenCalled();
  });

  it("entrada valida -> el servicio decide, y recibe el id y el actor", async () => {
    const service = servicio();
    expect(await acciones.anularAbonoTiendaAction({ abonoId: ABONO, motivo: "Error" }, { service, getActor: async () => MAESTRO })).toEqual({
      status: "ya_anulado",
    });
    expect(vi.mocked(service.anular).mock.calls[0]).toEqual([{ abonoId: ABONO, motivo: "Error" }, MAESTRO]);
    expect(await acciones.obtenerComprobanteAbonoAction({ abonoId: ABONO }, { service, getActor: async () => MAESTRO })).toEqual({
      status: "sin_comprobante",
    });
    expect(vi.mocked(service.obtenerComprobante).mock.calls[0]).toEqual([ABONO, MAESTRO]);
  });

  it("R42: el comprobante con una clave de mas -> validation_error", async () => {
    const service = servicio();
    const r = await acciones.obtenerComprobanteAbonoAction({ abonoId: ABONO, tiendaId: TIENDA }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    expect(service.obtenerComprobante).not.toHaveBeenCalled();
  });
});
