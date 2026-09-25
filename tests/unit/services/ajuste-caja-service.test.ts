import { describe, it, expect, vi } from "vitest";

import type { IAjusteCajaAnulacionRepository } from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AjusteCajaService } from "@/lib/services/AjusteCajaService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R69–R70 (auditoria de la wallet, D3) — `AjusteCajaService.anular`, con dobles.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se decide en el SERVICIO: el orden (rol → leer → transaccion), que solo la correccion
// ORIGINAL se anula, que el contra-asiento es el OPUESTO exacto por el monto DE LA CORRECCION —nunca
// de la peticion—, fechado con el reloj inyectado, y que `ya_anulado` no deja rastro. Lo que decide
// la BASE (UNIQUE, FK, R7 al centimo, el `documento` del libro) se mide en
// `tests/integration/db/ajuste-caja-anulacion-461.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero" };
const AHORA = new Date("2026-09-25T21:15:33.123Z");

function mov(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  const base = {
    id: "corr-1",
    tipo: "ingreso" as const,
    categoria: "ingreso_ajuste" as const,
    monto: "1000.25",
    origenTipo: "manual" as const,
    origenId: null,
    descripcion: "Sobrante de caja",
    registradoPor: "u-maestro",
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    ...over,
  };
  return { ...base, dueno: NATURALEZA_POR_CATEGORIA[base.categoria], documento: null };
}

function montaje(correccion: WalletMovimientoDTO | null = mov(), constancia: "anulado" | "ya_anulado" = "anulado") {
  const TX = { marca: "tx-461" };
  const walletRepo = {
    obtenerPorId: vi.fn(async () => correccion),
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoInput[]) => movs.length),
  } as unknown as IWalletMovimientoRepository;
  const anulaciones: IAjusteCajaAnulacionRepository = {
    anular: vi.fn(async () => ({ status: constancia })),
    estadoDeDocumentos: vi.fn(async () => []),
  };
  const runTransaction = vi.fn(async (fn: (tx: never) => Promise<unknown>) => fn(TX as never));
  const servicio = new AjusteCajaService(walletRepo, anulaciones, runTransaction as never, () => AHORA);
  return { servicio, walletRepo, anulaciones, runTransaction, TX };
}

const peticion = { movimientoId: "corr-1", motivo: "Se registro dos veces" };

describe("461/R70 — rol y lectura, ANTES de escribir", () => {
  it.each([TIENDA, MENSAJERO])("$rol -> forbidden sin leer ni abrir transaccion", async (actor) => {
    const m = montaje();
    expect(await m.servicio.anular(peticion, actor)).toEqual({ status: "forbidden" });
    expect(m.walletRepo.obtenerPorId).not.toHaveBeenCalled();
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it.each([MAESTRO, ADMIN])("$rol SI anula", async (actor) => {
    const m = montaje();
    expect(await m.servicio.anular(peticion, actor)).toEqual({ status: "ok" });
  });

  it("id inexistente -> no_encontrado, sin transaccion", async () => {
    const m = montaje(null);
    expect(await m.servicio.anular(peticion, MAESTRO)).toEqual({ status: "no_encontrado" });
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["su propio contra-asiento (origen manual CON origen_id)", mov({ origenTipo: "manual", origenId: "corr-0", categoria: "egreso_ajuste", tipo: "egreso" })],
    ["el reverso de un egreso (ingreso_ajuste con origen gasto)", mov({ origenTipo: "gasto", origenId: "eg-1" })],
    ["un sueldo (no es una correccion)", mov({ categoria: "egreso_sueldo", tipo: "egreso", origenTipo: "gasto" })],
    ["un asiento automatico del cierre", mov({ categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: "c-1" })],
    ["el cargo de un cobro a una tienda", mov({ categoria: "ingreso_cobro_tienda", origenTipo: "cobro_tienda", origenId: "cobro-1" })],
  ])("%s -> no_encontrado: solo la correccion ORIGINAL se anula por esta via", async (_n, fila) => {
    const m = montaje(fila);
    expect(await m.servicio.anular(peticion, MAESTRO)).toEqual({ status: "no_encontrado" });
    expect(m.runTransaction).not.toHaveBeenCalled();
    expect(m.anulaciones.anular).not.toHaveBeenCalled();
  });
});

describe("461/R69 — la transaccion: constancia + contra-asiento OPUESTO por el monto de la correccion", () => {
  it("una correccion que SUMO se deshace con un `egreso_ajuste` por su monto, origen manual/id, fechado con el reloj", async () => {
    const m = montaje(mov({ tipo: "ingreso", categoria: "ingreso_ajuste", monto: "1000.25" }));
    const r = await m.servicio.anular({ ...peticion, motivo: "  Se registro dos veces " }, ADMIN);
    expect(r).toEqual({ status: "ok" });

    expect(m.anulaciones.anular).toHaveBeenCalledWith(m.TX, {
      movimientoId: "corr-1",
      motivo: "  Se registro dos veces ", // el recorte es del borde (zod), no del servicio
      anuladoPor: "u-admin",
    });
    expect(m.walletRepo.crearMovimientos).toHaveBeenCalledWith(m.TX, [
      {
        tipo: "egreso",
        categoria: "egreso_ajuste",
        monto: "1000.25",
        origenTipo: "manual",
        origenId: "corr-1",
        descripcion: "Anulación · Sobrante de caja",
        registradoPor: "u-admin",
        fechaMovimiento: AHORA,
      },
    ]);
    // La constancia va ANTES del contra-asiento: si el UNIQUE la rechaza, no se escribe nada mas.
    const ordenConstancia = vi.mocked(m.anulaciones.anular).mock.invocationCallOrder[0];
    const ordenAsiento = vi.mocked(m.walletRepo.crearMovimientos).mock.invocationCallOrder[0];
    expect(ordenConstancia).toBeLessThan(ordenAsiento);
  });

  it("una correccion que RESTO se deshace con un `ingreso_ajuste`; sin descripcion, el texto es solo «Anulación»", async () => {
    const m = montaje(mov({ tipo: "egreso", categoria: "egreso_ajuste", monto: "500.10", descripcion: null }));
    await m.servicio.anular(peticion, MAESTRO);
    expect(m.walletRepo.crearMovimientos).toHaveBeenCalledWith(m.TX, [
      expect.objectContaining({
        tipo: "ingreso",
        categoria: "ingreso_ajuste",
        monto: "500.10",
        origenId: "corr-1",
        descripcion: "Anulación",
      }),
    ]);
  });

  it("el monto es el DE LA CORRECCION: nada de la peticion llega al asiento", async () => {
    const m = montaje(mov({ monto: "777.77" }));
    await m.servicio.anular({ ...peticion, monto: "1.00" } as never, MAESTRO);
    const [, filas] = vi.mocked(m.walletRepo.crearMovimientos).mock.calls[0] as [unknown, CrearMovimientoInput[]];
    expect(filas[0].monto).toBe("777.77");
  });

  it("`ya_anulado` del repositorio (el UNIQUE) -> `ya_anulado`, y el contra-asiento NO se escribe", async () => {
    const m = montaje(mov(), "ya_anulado");
    expect(await m.servicio.anular(peticion, MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.walletRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("cualquier otro error de la transaccion se propaga, no se traga", async () => {
    const m = montaje();
    vi.mocked(m.anulaciones.anular).mockRejectedValueOnce(new Error("se cayo la base"));
    await expect(m.servicio.anular(peticion, MAESTRO)).rejects.toThrow("se cayo la base");
  });

  it("la superficie del servicio es UN metodo: anular. Ni editar, ni borrar, ni des-anular", () => {
    const metodos = Object.getOwnPropertyNames(AjusteCajaService.prototype).filter((k) => k !== "constructor");
    expect(metodos).toEqual(["anular"]);
  });
});
