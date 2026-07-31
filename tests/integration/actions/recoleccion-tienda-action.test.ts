import { describe, it, expect, vi } from "vitest";

import {
  listarRecoleccion,
  recolectarEnTiendaPorQr,
} from "@/lib/actions/recoleccion-tienda";
import type {
  IRecoleccionTiendaService,
  ListarRecoleccionServiceResult,
} from "@/lib/interfaces/services/IRecoleccionTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 157 (T1.13) — borde de la recoleccion en tienda. Espejo de
// `recepcion-bodega-central-action.test.ts`: el borde solo resuelve sesion + zod y hace
// passthrough del resultado de dominio; ni interpreta ni enmascara los estados del service.
//
// Feature 167 (T1.7): el MISMO archivo gana el borde de la LECTURA (`listarRecoleccion`), porque
// vive en el mismo modulo de acciones y es el mismo dominio. `tasks.md` lo situaba en
// `tests/unit/actions/`; el archivo de la 157 estaba ya en `tests/integration/actions/` y se
// respeta donde esta en vez de partir en dos el borde de un mismo modulo (correccion del censo
// T0.2, declarada en la bitacora).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const LISTA_VACIA: ListarRecoleccionServiceResult = {
  status: "ok",
  porRecolectar: [],
  recolectadasHoy: [],
  recolectadasHoyRecortada: false,
};

function fakeService(
  result: Awaited<ReturnType<IRecoleccionTiendaService["recolectarEnTienda"]>> = {
    status: "ok",
    ordenId: "o1",
    estado: "en_ruta_bodega_central",
  },
  listar: ListarRecoleccionServiceResult = LISTA_VACIA,
): IRecoleccionTiendaService {
  return {
    recolectarEnTienda: vi.fn(async () => result),
    listarRecoleccion: vi.fn(async () => listar),
  };
}

describe("recolectarEnTiendaPorQr (borde)", () => {
  it("R29: sin sesion -> unauthenticated, sin construir ni llamar al service", async () => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia: 1 },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it.each([
    ["cero", 0],
    ["negativo", -1],
    ["string", "12"],
    ["ausente", undefined],
  ])("R20: numGuia %s -> validation_error ANTES del service (sin tocar datos)", async (_n, numGuia) => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia },
      { service, getActor: async () => MENSAJERO },
    );

    expect(r).toMatchObject({ status: "validation_error" });
    expect(service.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("passthrough del `ok` del service, con el numGuia ya parseado a number", async () => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia: 4321 },
      { service, getActor: async () => MENSAJERO },
    );

    expect(r).toEqual({ status: "ok", ordenId: "o1", estado: "en_ruta_bodega_central" });
    expect(service.recolectarEnTienda).toHaveBeenCalledWith(4321, MENSAJERO);
  });

  it.each([
    ["no_encontrada", { status: "no_encontrada" as const }],
    ["ya_recolectada", { status: "ya_recolectada" as const }],
    ["forbidden", { status: "forbidden" as const }],
    ["estado_invalido", { status: "estado_invalido" as const, estado: "en_bodega_central" }],
    ["conflict", { status: "conflict" as const, motivo: "cierre pendiente" }],
  ])("passthrough del resultado de dominio `%s` sin reinterpretarlo", async (_n, result) => {
    const r = await recolectarEnTiendaPorQr(
      { numGuia: 7 },
      { service: fakeService(result), getActor: async () => MENSAJERO },
    );

    expect(r).toEqual(result);
  });
});

// ---------------------------------------------------------------------------------------
// Feature 167 (T1.7, R6) — borde de la LECTURA del apartado. Este borde NO tiene zod: no recibe
// entrada externa. Lo unico que hace es resolver la sesion y delegar; el rol lo impone el
// service. La pagina (Server Component) consume esto y pasa el payload al modulo POR PROPS.
// ---------------------------------------------------------------------------------------
describe("listarRecoleccion (borde)", () => {
  it("sin sesion -> unauthenticated, sin construir ni llamar al service", async () => {
    const service = fakeService();

    const r = await listarRecoleccion({ service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarRecoleccion).not.toHaveBeenCalled();
  });

  it("R6: pasa el actor de SESION al service (nunca un usuarioId de parametro)", async () => {
    const service = fakeService();

    await listarRecoleccion({ service, getActor: async () => MENSAJERO });

    expect(service.listarRecoleccion).toHaveBeenCalledWith(MENSAJERO);
    // Y con UN SOLO argumento: no hay ningun parametro de alcance que un llamador pudiera usar
    // para pedir las recolecciones de otro. El unico dato que gobierna la lectura sale de la
    // sesion, server-side.
    const args = (service.listarRecoleccion as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!;
    expect(args).toHaveLength(1);
  });

  it("R6: devuelve el payload del service TAL CUAL (las dos listas y el flag de recorte)", async () => {
    const payload: ListarRecoleccionServiceResult = {
      status: "ok",
      porRecolectar: [
        {
          id: "o1",
          numGuia: 1001,
          numRemision: "REM-1",
          producto: "Zapatos",
          destinatario: "Ana Solis",
          tiendaNombre: "Tienda Central",
          tiendaTelefono: "88880000",
        },
      ],
      recolectadasHoy: [
        {
          ordenId: "o9",
          numGuia: 2002,
          numRemision: "REM-9",
          tiendaNombre: "Tienda Sur",
          recolectadaAt: new Date("2026-07-31T15:00:00.000Z"),
        },
      ],
      recolectadasHoyRecortada: true,
    };

    const r = await listarRecoleccion({
      service: fakeService(undefined, payload),
      getActor: async () => MENSAJERO,
    });

    expect(r).toEqual(payload);
  });

  it("passthrough del `forbidden` del service (el rol lo decide el service, no el borde)", async () => {
    const service = fakeService(undefined, { status: "forbidden" });

    const r = await listarRecoleccion({
      service,
      getActor: async () => ({ usuarioId: "u-maestro", rol: "maestro" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    // El borde NO adelanta la guardia de rol: se la pide al service, que es el dueño de la
    // regla y el que la aplica tambien en la confirmacion.
    expect(service.listarRecoleccion).toHaveBeenCalledTimes(1);
  });
});
