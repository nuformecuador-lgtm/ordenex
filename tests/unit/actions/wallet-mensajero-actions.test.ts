import { describe, it, expect, vi } from "vitest";
import {
  verMiCuentaPorPagarAction,
  listarMisPagosAction,
  listarCuentasPorPagarAction,
  listarCuentasPorPagarCompletoAction,
  listarCuentasPorPagarPaginadoAction,
  listarPagosDeMensajeroAction,
} from "@/lib/actions/wallet-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletMensajeroService } from "@/lib/interfaces/services/IWalletMensajeroService";
import type { CuentaPorPagarDTO } from "@/lib/types/wallet-mensajero";

// Feature 44 (T13) — tests unit de las Server Actions del libro del pago por mensajero
// (R19/R20/R21/R27). Sin sesion -> unauthenticated; rol no autorizado -> forbidden (el service
// decide); input invalido -> validation_error (zod en el borde); DTOs con montos STRING (nunca
// number).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const CUENTA: CuentaPorPagarDTO = { devengado: "1000.00", pagado: "300.00", cuentaPorPagar: "700.00", signo: "positivo" };

function fakeService(overrides: Partial<IWalletMensajeroService> = {}): IWalletMensajeroService {
  return {
    verMiCuentaPorPagar: vi.fn(async () => ({ status: "ok" as const, cuenta: CUENTA })),
    listarMisPagos: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [], total: 0, page: 1, pageSize: 20, cuenta: CUENTA },
    })),
    listarCuentasPorPagar: vi.fn(async () => ({
      status: "ok" as const,
      mensajeros: [{ mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00", cuentaPorPagar: "700.00", signo: "positivo" as const }],
    })),
    listarPagosDeMensajero: vi.fn(async () => ({
      status: "ok" as const,
      data: {
        mensajeroId: "m1",
        mensajeroNombre: "Ana Mensajera",
        movimientos: [],
        total: 0,
        page: 1,
        pageSize: 20,
        cuenta: CUENTA,
      },
    })),
    // Feature 170 (T C.1): el doble implementa la interfaz COMPLETA. Los modos sin
    // paginacion los ejercitan `wallet-mis-pagos-descarga-action.test.ts` y
    // `wallet-desglose-mensajero-descarga-action.test.ts`.
    listarMisPagosCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarPagosDeMensajeroCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    // Feature 170 (T L.1): el listado paginado del maestro. Sus casos propios de borde estan
    // mas abajo, en el describe de `listarCuentasPorPagarPaginadoAction`.
    listarCuentasPorPagarPaginado: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    })),
    // Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el hermano SIN recorte del anterior, el
    // que alimenta la descarga. Sus casos de borde estan mas abajo, en su propio describe.
    listarCuentasPorPagarCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    ...overrides,
  };
}

describe("verMiCuentaPorPagarAction (R20/R27)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.verMiCuentaPorPagar).not.toHaveBeenCalled();
  });

  it("R20: rol no autorizado -> forbidden (el service decide)", async () => {
    const service = fakeService({ verMiCuentaPorPagar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: mensajero -> ok con cuenta por pagar STRING+signo", async () => {
    const service = fakeService();
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => MENSAJERO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.cuenta.cuentaPorPagar).toBe("string");
    expect(r.cuenta.signo).toBe("positivo");
  });
});

describe("listarMisPagosAction (R20/R22/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("input invalido (pageSize fuera de rango) -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction(
      { page: 1, pageSize: 9999 },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarMisPagos).not.toHaveBeenCalled();
  });

  it("R20: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ listarMisPagos: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarMisPagosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: mensajero -> ok con cuenta STRING", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MENSAJERO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.data.cuenta.cuentaPorPagar).toBe("string");
  });
});

describe("listarCuentasPorPagarAction (R18/R19/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R19: rol no maestro -> forbidden", async () => {
    const service = fakeService({ listarCuentasPorPagar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => MENSAJERO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: maestro -> ok con cuentas por pagar STRING por mensajero", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.mensajeros[0].cuentaPorPagar).toBe("string");
    expect(typeof r.mensajeros[0].devengado).toBe("string");
  });
});

// Feature 170 — FASE 2 (T L.1, R40/R41/R44/R45): el BORDE del listado paginado. Lo que aqui se
// vigila es la lista blanca: el alcance de esta pantalla es «TODOS los mensajeros» y lo decide
// el ROL del actor, asi que ninguna clave de la peticion puede tener nada que decir sobre el.
describe("listarCuentasPorPagarPaginadoAction (T L.1)", () => {
  it("input vacío vale: es lo que pide la página 1, con los defaults del dominio (R40)", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarPaginadoAction(undefined, {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    expect(service.listarCuentasPorPagarPaginado).toHaveBeenCalledWith(
      { page: 1, pageSize: 25 }, // walletMensajeroConfig, no un literal de la pantalla
      MAESTRO,
    );
  });

  it("un pageSize desmedido se RECORTA al máximo, no se rechaza (R40)", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarPaginadoAction(
      { page: 3, pageSize: 100000 },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    expect(service.listarCuentasPorPagarPaginado).toHaveBeenCalledWith(
      { page: 3, pageSize: 100 },
      MAESTRO,
    );
  });

  it("la búsqueda por nombre llega al service TAL CUAL, sin recortar (R45)", async () => {
    const service = fakeService();
    // Espacios y mayusculas incluidos: normalizar es cosa del filtro, no del borde. Si el borde
    // recortara, el borde y el filtro no entenderian lo mismo por «texto vacio», que es lo
    // unico que decide si el listado sale entero o filtrado.
    await listarCuentasPorPagarPaginadoAction(
      { busqueda: "  Ana MENSAJERA " },
      { service, getActor: async () => MAESTRO },
    );

    expect(service.listarCuentasPorPagarPaginado).toHaveBeenCalledWith(
      { page: 1, pageSize: 25, busqueda: "  Ana MENSAJERA " },
      MAESTRO,
    );
  });

  it("una clave de ALCANCE colada muere en el borde, sin llegar al service (R44)", async () => {
    for (const colada of [{ mensajeroId: "m1" }, { rol: "maestro" }, { usuarioId: "u-1" }]) {
      const service = fakeService();
      const r = await listarCuentasPorPagarPaginadoAction(
        { page: 1, ...colada },
        { service, getActor: async () => MAESTRO },
      );

      expect(r.status, JSON.stringify(colada)).toBe("validation_error");
      expect(service.listarCuentasPorPagarPaginado, JSON.stringify(colada)).not.toHaveBeenCalled();
    }
  });

  it("sin sesión -> unauthenticated, sin tocar el service (R44)", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarPaginadoAction({}, { service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarCuentasPorPagarPaginado).not.toHaveBeenCalled();
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R44)", async () => {
    const service = fakeService({
      listarCuentasPorPagarPaginado: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarCuentasPorPagarPaginadoAction({}, {
      service,
      getActor: async () => MENSAJERO,
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
    expect(r).not.toHaveProperty("total");
  });

  it("un page no positivo muere en el borde (R40)", async () => {
    for (const malo of [{ page: 0 }, { page: -3 }, { pageSize: 0 }, { page: "abc" }]) {
      const service = fakeService();
      const r = await listarCuentasPorPagarPaginadoAction(malo, {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, JSON.stringify(malo)).toBe("validation_error");
      expect(service.listarCuentasPorPagarPaginado).not.toHaveBeenCalled();
    }
  });
});

// Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el BORDE del modo SIN paginación, el que
// alimenta la descarga (R52). Es el hermano del de arriba y su lista blanca es más estrecha:
// `page`/`pageSize` NO son claves válidas aquí, porque pedir «la página del dataset completo»
// no significa nada y aceptarlas dejaría la puerta abierta a que un día recortaran el archivo.
describe("listarCuentasPorPagarCompletoAction (T M.1, Q-L2)", () => {
  it("input vacío vale: es el conjunto entero, sin búsqueda (R52)", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarCompletoAction(undefined, {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    expect(service.listarCuentasPorPagarCompleto).toHaveBeenCalledWith({}, MAESTRO);
  });

  it("la búsqueda vigente llega al service TAL CUAL (R10/R45)", async () => {
    const service = fakeService();
    // El MISMO texto sin normalizar que recibe el listado paginado: si el borde de la descarga
    // lo recortara y el de la página no, el archivo y la tabla mirarían conjuntos distintos.
    await listarCuentasPorPagarCompletoAction(
      { busqueda: "  Ana MENSAJERA " },
      { service, getActor: async () => MAESTRO },
    );

    expect(service.listarCuentasPorPagarCompleto).toHaveBeenCalledWith(
      { busqueda: "  Ana MENSAJERA " },
      MAESTRO,
    );
  });

  it("page/pageSize NO pertenecen a la lista blanca del dataset completo (R18)", async () => {
    for (const colada of [{ page: 2 }, { pageSize: 10 }, { mensajeroId: "m1" }, { rol: "maestro" }]) {
      const service = fakeService();
      const r = await listarCuentasPorPagarCompletoAction(colada, {
        service,
        getActor: async () => MAESTRO,
      });

      expect(r.status, JSON.stringify(colada)).toBe("validation_error");
      expect(service.listarCuentasPorPagarCompleto, JSON.stringify(colada)).not.toHaveBeenCalled();
    }
  });

  it("sin sesión -> unauthenticated, sin tocar el service ni devolver filas (R16)", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarCompletoAction({}, { service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(r).not.toHaveProperty("items");
    expect(service.listarCuentasPorPagarCompleto).not.toHaveBeenCalled();
  });

  it("forbidden y limite_excedido pasan tal cual, y ninguno viaja con filas (R17/R27)", async () => {
    const prohibido = fakeService({
      listarCuentasPorPagarCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r1 = await listarCuentasPorPagarCompletoAction({}, {
      service: prohibido,
      getActor: async () => MENSAJERO,
    });
    expect(r1).toEqual({ status: "forbidden" });
    expect(r1).not.toHaveProperty("items");

    const excedido = fakeService({
      listarCuentasPorPagarCompleto: vi.fn(async () => ({
        status: "limite_excedido" as const,
        total: 5001,
        limite: 5000,
      })),
    });
    const r2 = await listarCuentasPorPagarCompletoAction({}, {
      service: excedido,
      getActor: async () => MAESTRO,
    });
    // R27: SOLO conteos —el total encontrado y el tope— y ni una fila.
    expect(r2).toEqual({ status: "limite_excedido", total: 5001, limite: 5000 });
    expect(r2).not.toHaveProperty("items");
  });
});

describe("listarPagosDeMensajeroAction (R18/R22/R27 — vista del MAESTRO)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20 },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("mensajeroId FALTANTE -> validation_error (el maestro debe elegir mensajero), sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("validation_error");
    expect(r.fieldErrors).toHaveProperty("mensajeroId");
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("mensajeroId vacio/invalido -> validation_error", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "", page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("R19: rol no maestro -> forbidden (el service decide)", async () => {
    const service = fakeService({ listarPagosDeMensajero: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20 },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R18/R22/R27: maestro -> ok con desglose por cierre + cuenta STRING del conjunto filtrado", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20, cierreId: "c2" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(r.data.mensajeroId).toBe("m1");
    expect(typeof r.data.mensajeroNombre).toBe("string");
    expect(typeof r.data.cuenta.cuentaPorPagar).toBe("string");
    // el service recibio el input parseado con el mensajeroId elegido por el maestro.
    expect(service.listarPagosDeMensajero).toHaveBeenCalledWith(
      expect.objectContaining({ mensajeroId: "m1", cierreId: "c2" }),
      MAESTRO,
    );
  });
});
