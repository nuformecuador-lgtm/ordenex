import { describe, it, expect, vi } from "vitest";
import { listarMisCierresAction } from "@/lib/actions/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import type { CierreTiendaOpcionDTO } from "@/lib/types/wallet-tienda";

/**
 * FICHA 335 (A10) — la Server Action que alimenta el selector de cierre de `/mi-wallet`.
 *
 * REPARTO DE RESPONSABILIDADES QUE ESTOS CASOS FIJAN, y que es el mismo de las ocho actions
 * vecinas: la SESION la resuelve el borde (`unauthenticated`), y el ROL lo decide el SERVICIO
 * (`forbidden`), que la action devuelve tal cual. Un `forbidden` nacido aqui seria un guard
 * duplicado que podria divergir del real sin que nada lo dijera.
 *
 * No hay caso de `validation_error` porque no hay entrada que validar (R5): el unico argumento
 * es `deps`, la costura de inyeccion de estos tests.
 */

const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const OPCION: CierreTiendaOpcionDTO = {
  cierreId: "cierre-1",
  fecha: "2026-07-12T14:30:00.000Z",
  movimientos: 4,
};

function fakeService(overrides: Partial<IWalletTiendaService> = {}): IWalletTiendaService {
  return {
    verMiSaldo: vi.fn(async () => ({
      status: "ok" as const,
      saldo: { creditos: "0.00", debitos: "0.00", saldo: "0.00", signo: "cero" as const },
    })),
    listarMisMovimientos: vi.fn(async () => ({
      status: "ok" as const,
      data: {
        movimientos: [],
        total: 0,
        page: 1,
        pageSize: 20,
        saldo: { creditos: "0.00", debitos: "0.00", saldo: "0.00", signo: "cero" as const },
        desglose: {
          aFavor: "0.00",
          cargos: "0.00",
          pagado: "0.00",
          saldo: "0.00",
          signo: "cero" as const,
        },
      },
    })),
    listarMisMovimientosCompleto: vi.fn(async () => ({ status: "ok" as const, items: [], total: 0 })),
    listarSaldosTiendas: vi.fn(async () => ({ status: "ok" as const, tiendas: [] })),
    listarSaldosTiendasPaginado: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    })),
    listarSaldosTiendasCompleto: vi.fn(async () => ({ status: "ok" as const, items: [], total: 0 })),
    listarMovimientosDeTienda: vi.fn(async () => ({
      status: "ok" as const,
      data: {
        tiendaId: "t1",
        movimientos: [],
        total: 0,
        page: 1,
        pageSize: 20,
        desglose: {
          aFavor: "0.00",
          cargos: "0.00",
          pagado: "0.00",
          saldo: "0.00",
          signo: "cero" as const,
        },
      },
    })),
    listarMovimientosDeTiendaCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarMisCierres: vi.fn(async () => ({
      status: "ok" as const,
      cierres: [OPCION],
      hayMas: false,
    })),
    ...overrides,
  };
}

describe("listarMisCierresAction (ficha 335, R3/R4/R5)", () => {
  it("R4: sin sesión responde `unauthenticated` y NO instancia el servicio", async () => {
    // El `service` inyectado hace de testigo: si el borde lo llamara, este caso lo ve. Y como
    // se pasa uno, la action tampoco construye el real (que abriria conexion a la base).
    const service = fakeService();
    const r = await listarMisCierresAction({ service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarMisCierres).not.toHaveBeenCalled();
  });

  it("R3: el `forbidden` del servicio se devuelve tal cual, sin filas", async () => {
    const service = fakeService({
      listarMisCierres: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarMisCierresAction({ service, getActor: async () => MAESTRO });

    // Igualdad estricta: `forbidden` NUNCA viaja con `cierres`, ni siquiera con una lista vacia.
    expect(r).toEqual({ status: "forbidden" });
    expect(Object.keys(r)).toEqual(["status"]);
    expect(service.listarMisCierres).toHaveBeenCalledWith(MAESTRO);
  });

  it("con sesión de tienda devuelve el conjunto del servicio, con el actor resuelto", async () => {
    // Control de no-vacuidad de los dos casos de arriba: sin este, un borde que devolviera
    // siempre `unauthenticated` los pasaria a los dos.
    const service = fakeService();
    const r = await listarMisCierresAction({ service, getActor: async () => TIENDA });

    expect(r).toEqual({ status: "ok", cierres: [OPCION], hayMas: false });
    expect(service.listarMisCierres).toHaveBeenCalledWith(TIENDA);
  });

  it("R5: un objeto colado como argumento no cambia el conjunto (la action ignora todo lo que no sea `deps`)", async () => {
    const service = fakeService();
    const limpio = await listarMisCierresAction({ service, getActor: async () => TIENDA });

    // Lo que un cliente podria intentar en JS: colar `tiendaId` junto a las deps, o pasar un
    // segundo argumento. Ni la firma ni el cuerpo leen nada de eso.
    const conClaveExtra = await (
      listarMisCierresAction as unknown as (d: unknown) => Promise<unknown>
    )({ service, getActor: async () => TIENDA, tiendaId: "t2", limite: 9999 });
    const conSegundoArgumento = await (
      listarMisCierresAction as unknown as (d: unknown, extra: unknown) => Promise<unknown>
    )({ service, getActor: async () => TIENDA }, { tiendaId: "t2" });

    expect(conClaveExtra).toEqual(limpio);
    expect(conSegundoArgumento).toEqual(limpio);
    // Y el servicio recibio SIEMPRE el actor, y nada mas: ninguna llamada llevo un segundo
    // argumento por el que pudiera colarse otra tienda.
    const llamadas = (service.listarMisCierres as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas).toHaveLength(3);
    for (const llamada of llamadas) expect(llamada).toEqual([TIENDA]);
  });
});
