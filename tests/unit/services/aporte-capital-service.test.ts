import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AporteCapitalRegistro,
  CrearAporteCapitalInput,
  IAporteCapitalRepository,
} from "@/lib/interfaces/repositories/IAporteCapitalRepository";
import type { ICajaAporteCapitalFeedService } from "@/lib/interfaces/services/ICajaAporteCapitalFeedService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import { AporteCapitalService } from "@/lib/services/AporteCapitalService";
import type { AporteCapitalTxRunner } from "@/lib/interfaces/services/IAporteCapitalService";
import type { RegistrarAporteCapitalInput } from "@/lib/types/aporte-capital";

/**
 * FICHA 459 / T B.11 — `AporteCapitalService` con dobles (R68–R76, R27). La serializacion REAL de
 * dos saldos iniciales simultaneos (R70) la prueba `tests/integration/db/aporte-capital.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-09-24T18:00:00.000Z");

function entrada(over: Partial<RegistrarAporteCapitalInput> = {}): RegistrarAporteCapitalInput {
  return {
    claveIdempotencia: "22222222-2222-4222-8222-222222222222",
    clase: "aporte",
    monto: "500000",
    fecha: "2026-09-20",
    motivo: "Aporte del socio",
    ...over,
  };
}

function registro(over: Partial<AporteCapitalRegistro> = {}): AporteCapitalRegistro {
  return {
    id: "a-1",
    clase: "aporte",
    monto: "500000.00",
    motivo: "Aporte del socio",
    fecha: "2026-09-20",
    comprobantePath: null,
    comprobanteContentType: null,
    registradoPorNombre: "Maestro",
    registradoAt: AHORA.toISOString(),
    anulado: false,
    ...over,
  };
}

function montar(opts: {
  primerDia?: string | null;
  hayVigente?: boolean;
  crear?: IAporteCapitalRepository["crear"];
  anular?: IAporteCapitalRepository["anular"];
  documento?: AporteCapitalRegistro | null;
  porClave?: AporteCapitalRegistro | null;
} = {}) {
  const orden: string[] = [];
  const repo: IAporteCapitalRepository = {
    bloquearSaldoInicial: vi.fn(async () => {
      orden.push("candado");
    }),
    haySaldoInicialVigente: vi.fn(async () => {
      orden.push("hay?");
      return opts.hayVigente ?? false;
    }),
    crear: vi.fn(
      opts.crear ??
        (async (_tx, i: CrearAporteCapitalInput) => {
          orden.push("crear");
          return { status: "creado" as const, aporte: registro({ id: i.id, clase: i.clase, monto: i.monto }) };
        }),
    ),
    anular: vi.fn(opts.anular ?? (async () => ({ status: "anulado" as const }))),
    obtenerPorClave: vi.fn(async () => (opts.porClave === undefined ? registro() : opts.porClave)),
    obtenerPorId: vi.fn(async () => (opts.documento === undefined ? registro() : opts.documento)),
    estadoDeDocumentos: vi.fn(async () => []),
  };
  const caja: ICajaAporteCapitalFeedService = {
    emitirIngresoDeCapital: vi.fn(async () => {
      orden.push("caja:ingreso");
      return 1;
    }),
    emitirReversoDeCapital: vi.fn(async () => {
      orden.push("caja:reverso");
      return 1;
    }),
  };
  const lectura = {
    primerDiaDeLaCaja: vi.fn(async () => (opts.primerDia === undefined ? "2026-08-25" : opts.primerDia)),
  };
  const storage: IFileStorage = { upload: vi.fn(async (i) => i.path), remove: vi.fn(async () => undefined) };
  const urls = { createSignedUrl: vi.fn(async (p: string) => `u:${p}`), createSignedUrls: vi.fn() };
  const runTx = vi.fn(async (fn: (t: never) => Promise<unknown>) => fn({} as never));
  const svc = new AporteCapitalService(repo, caja, lectura, storage, urls, runTx as unknown as AporteCapitalTxRunner, () => AHORA, {
    MAX_BYTES: 4 * 1024 * 1024,
    SIGNED_URL_TTL_SECONDS: 300,
  });
  return { svc, repo, caja, lectura, storage, runTx, orden };
}

describe("459/B.11 — registrar un saldo inicial o aporte", () => {
  it("R76: sin acceso total -> forbidden antes de leer nada", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada({ clase: "saldo_inicial" }), null, { usuarioId: "t", rol: "adminTienda" });
    expect(r).toEqual({ status: "forbidden" });
    expect(m.lectura.primerDiaDeLaCaja).not.toHaveBeenCalled();
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("P14: admin puede", async () => {
    const m = montar();
    expect((await m.svc.registrar(entrada(), null, { usuarioId: "a", rol: "admin" })).status).toBe("ok");
  });

  it("R69: fecha futura -> rechazada bajo `fecha`", async () => {
    const m = montar();
    expect(await m.svc.registrar(entrada({ fecha: "2026-09-25" }), null, MAESTRO)).toEqual({
      status: "validation_error",
      fieldErrors: { fecha: ["La fecha no puede ser posterior a hoy."] },
    });
  });

  it("P7: un APORTE no tiene ventana hacia atras (un año antes entra)", async () => {
    const m = montar();
    expect((await m.svc.registrar(entrada({ fecha: "2025-09-24" }), null, MAESTRO)).status).toBe("ok");
    expect(m.lectura.primerDiaDeLaCaja).not.toHaveBeenCalled();
  });

  it("R71: saldo inicial posterior al primer dia de la caja (sin capital) -> rechazado con el ultimo dia admitido", async () => {
    const m = montar({ primerDia: "2026-08-25" });
    const r = await m.svc.registrar(entrada({ clase: "saldo_inicial", fecha: "2026-08-26" }), null, MAESTRO);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: {
        fecha: [
          // Literal (recorrido F2): «día» con tilde y la fecha como la escribe la tarjeta.
          "El saldo inicial no puede ser posterior al 25 de agosto de 2026, el primer día con movimientos en la caja.",
        ],
      },
    });
    expect(m.lectura.primerDiaDeLaCaja).toHaveBeenCalledWith({ excluirCapital: true });
    // El mismo dia SI entra.
    const ok = montar({ primerDia: "2026-08-25" });
    expect((await ok.svc.registrar(entrada({ clase: "saldo_inicial", fecha: "2026-08-25" }), null, MAESTRO)).status).toBe("ok");
  });

  it("R70: saldo inicial: candado ANTES de mirar si ya hay uno; con uno vigente -> ya_hay_saldo_inicial sin escribir", async () => {
    const m = montar({ hayVigente: true, porClave: null });
    const r = await m.svc.registrar(entrada({ clase: "saldo_inicial", fecha: "2026-08-20" }), null, MAESTRO);
    expect(r).toEqual({ status: "ya_hay_saldo_inicial" });
    expect(m.orden).toEqual(["candado", "hay?"]);
    expect(m.repo.crear).not.toHaveBeenCalled();
    expect(m.caja.emitirIngresoDeCapital).not.toHaveBeenCalled();
  });

  it("R73 antes que R70: doble envio del MISMO saldo inicial -> ya_registrado con el original, no «ya hay uno»", async () => {
    const original = registro({ id: "si-1", clase: "saldo_inicial", monto: "900.00" });
    const m = montar({ hayVigente: true, porClave: original });
    const r = await m.svc.registrar(entrada({ clase: "saldo_inicial", fecha: "2026-08-20" }), null, MAESTRO);
    expect(r).toEqual({ status: "ya_registrado", aporte: expect.objectContaining({ id: "si-1", monto: "900.00" }) });
    expect(m.repo.crear).not.toHaveBeenCalled();
    expect(m.caja.emitirIngresoDeCapital).not.toHaveBeenCalled();
  });

  it("R68/R72: documento y entrada de capital con el MISMO monto de escala 2; el aporte no toma el candado", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada({ monto: "500000.5" }), null, MAESTRO);
    expect(r.status).toBe("ok");
    expect(m.orden).toEqual(["crear", "caja:ingreso"]);
    const doc = vi.mocked(m.repo.crear).mock.calls[0][1];
    const caja = vi.mocked(m.caja.emitirIngresoDeCapital).mock.calls[0][1];
    expect(doc.monto).toBe("500000.50");
    expect(caja.monto).toBe("500000.50");
    expect(caja.aporteId).toBe(doc.id);
    expect(caja.fechaMovimiento?.toISOString()).toBe("2026-09-20T06:00:00.000Z");
    expect(doc.fecha.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("R73: clave repetida -> ya_registrado con el original, sin segunda entrada", async () => {
    const m = montar({ crear: async () => ({ status: "clave_repetida" as const }) });
    const r = await m.svc.registrar(entrada(), null, MAESTRO);
    expect(r.status).toBe("ya_registrado");
    expect(m.caja.emitirIngresoDeCapital).not.toHaveBeenCalled();
  });

  it("R27: el servicio no expone ningun metodo que devuelva un importe sugerido", () => {
    const metodos = Object.getOwnPropertyNames(AporteCapitalService.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    expect(metodos).toEqual(["anular", "obtenerComprobante", "registrar"]);
  });
});

describe("459/B.11 — anular un saldo inicial o aporte", () => {
  it("R74: fila de anulacion y salida de capital por el monto DEL DOCUMENTO, fechada ahora", async () => {
    const m = montar({ documento: registro({ monto: "250000.00", clase: "saldo_inicial" }) });
    expect(await m.svc.anular({ aporteId: "a-1", motivo: "Error" }, MAESTRO)).toEqual({ status: "ok" });
    const caja = vi.mocked(m.caja.emitirReversoDeCapital).mock.calls[0][1];
    expect(caja).toMatchObject({ aporteId: "a-1", monto: "250000.00", fechaMovimiento: AHORA });
    expect(caja.descripcion).toBe("Anulación · Saldo inicial");
  });

  it("R74 (R49–R51): ya anulado -> ya_anulado; inexistente -> no_encontrado; sin rol -> forbidden", async () => {
    const ya = montar({ anular: async () => ({ status: "ya_anulado" as const }) });
    expect(await ya.svc.anular({ aporteId: "a-1", motivo: "x" }, MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(ya.caja.emitirReversoDeCapital).not.toHaveBeenCalled();
    const no = montar({ documento: null });
    expect(await no.svc.anular({ aporteId: "a-x", motivo: "x" }, MAESTRO)).toEqual({ status: "no_encontrado" });
    const rol = montar();
    expect(await rol.svc.anular({ aporteId: "a-1", motivo: "x" }, { usuarioId: "m", rol: "mensajero" })).toEqual({
      status: "forbidden",
    });
    expect(rol.repo.obtenerPorId).not.toHaveBeenCalled();
  });
});
