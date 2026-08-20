import { describe, it, expect, vi } from "vitest";
import {
  listarAyudaTiendaAction,
  listarAyudaTiendaCompletoAction,
  listarNovedadesAction,
  listarNovedadesCompletoAction,
} from "@/lib/actions/novedades";
import type { INovedadesService } from "@/lib/interfaces/services/INovedadesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 236 (T2.6, design §4) — el BORDE de las dos superficies de `/novedades`.
//
// LO QUE ESTE ARCHIVO EXISTE PARA FIJAR, y no es la mecanica de zod:
//
//   **el cliente NO puede elegir que estatus se consulta.**
//
// Hay cuatro Server Actions y no una con bandera, precisamente por eso. Si el grupo viajara en el
// input —aunque zod acotara el enum—, este borde tendria un parametro de filtrado controlado desde
// fuera sobre la pantalla que ya sufrio una fuga de visibilidad. Con cuatro funciones, el grupo es
// una CONSTANTE DEL MODULO SERVIDOR: el cliente elige a que funcion llama, no que filtra.
//
// Lo demas es espejo literal de las dos acciones de devoluciones que ya existian: `unauthenticated`
// ANTES de tocar el service, `validation_error` de zod en el borde, y `forbidden`/`ok` desde el
// service. `PAGE_SIZE` es fijo y tampoco viaja.

const ADMIN: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const noActor = async () => null;
const actorTienda = async () => ADMIN;

const PAGE_SIZE = 10;

function buildService(overrides: Partial<INovedadesService> = {}): INovedadesService {
  return {
    listar: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
    })),
    listarCompleto: vi.fn(async () => ({ status: "ok" as const, items: [], total: 0 })),
    ...overrides,
  };
}

/** El primer argumento con el que se llamo a `listar` / `listarCompleto`. */
function inputDe(fn: unknown) {
  return (fn as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

// =============================================================================================
// R2 — el grupo lo pone el SERVIDOR: el cliente elige funcion, no filtro
// =============================================================================================

describe("236/R2 — el grupo es una constante del modulo servidor", () => {
  it("cada accion pide SU grupo, y son distintos", async () => {
    const service = buildService();
    await listarAyudaTiendaAction({ page: 1 }, { service, getActor: actorTienda });
    await listarNovedadesAction({ page: 1 }, { service, getActor: actorTienda });

    const llamadas = (service.listar as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas[0][0].grupo).toBe("ayuda");
    expect(llamadas[1][0].grupo).toBe("devolucion");
  });

  it("lo mismo en las dos descargas: cada archivo sale de su grupo (D3/R38)", async () => {
    const service = buildService();
    await listarAyudaTiendaCompletoAction({}, { service, getActor: actorTienda });
    await listarNovedadesCompletoAction({}, { service, getActor: actorTienda });

    const llamadas = (service.listarCompleto as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas[0][0]).toEqual({ grupo: "ayuda" });
    expect(llamadas[1][0]).toEqual({ grupo: "devolucion" });
  });

  it("NO existe ninguna clave de entrada con la que el cliente pueda elegir el grupo", async () => {
    // Se intenta por las cuatro formas plausibles y por las dos acciones paginadas. En las
    // paginadas el schema solo declara `page`, asi que la clave sobrante se IGNORA (no rompe) y
    // —esto es lo que importa— el grupo sigue siendo el de la funcion llamada.
    for (const intento of [
      { grupo: "devolucion" },
      { grupo: "ayuda" },
      { group: "devolucion" },
      { estatus: "devuelta" },
    ]) {
      const service = buildService();
      await listarAyudaTiendaAction(
        { page: 1, ...intento } as { page?: number },
        { service, getActor: actorTienda },
      );
      expect(inputDe(service.listar).grupo, JSON.stringify(intento)).toBe("ayuda");
    }
  });

  it("el listado COMPLETO rechaza CUALQUIER clave: lista blanca de cero (`.strict()`)", async () => {
    // Aqui la clave inventada no se ignora, es un error — el mismo criterio con el que un
    // `tiendaId` inventado no puede convertir el archivo de una tienda en el de la vecina.
    for (const intento of [{ grupo: "devolucion" }, { tiendaId: "tienda-2" }, { page: 1 }]) {
      const service = buildService();
      const r = await listarAyudaTiendaCompletoAction(intento, {
        service,
        getActor: actorTienda,
      });
      expect(r.status, JSON.stringify(intento)).toBe("validation_error");
      expect(service.listarCompleto).not.toHaveBeenCalled();
    }
  });

  it("control positivo: sin claves, la descarga de ayuda SI se ejecuta", async () => {
    // Sin este, el caso de arriba estaria verde tambien si la accion rechazara siempre.
    const service = buildService();
    const r = await listarAyudaTiendaCompletoAction({}, { service, getActor: actorTienda });
    expect(r.status).toBe("ok");
    expect(service.listarCompleto).toHaveBeenCalledTimes(1);
  });

  it("`pageSize` tampoco viaja: lo fija el borde en 10", async () => {
    const service = buildService();
    await listarAyudaTiendaAction({ page: 3 }, { service, getActor: actorTienda });
    expect(inputDe(service.listar)).toEqual({ page: 3, pageSize: PAGE_SIZE, grupo: "ayuda" });
  });
});

// =============================================================================================
// R11 — sin sesion, el service no recibe ni una llamada
// =============================================================================================

describe("236/R11 — `unauthenticated` ANTES de tocar el service", () => {
  it("las dos acciones de ayuda, sin actor, no llegan al service", async () => {
    const service = buildService();

    expect((await listarAyudaTiendaAction({ page: 1 }, { service, getActor: noActor })).status).toBe(
      "unauthenticated",
    );
    expect(
      (await listarAyudaTiendaCompletoAction({}, { service, getActor: noActor })).status,
    ).toBe("unauthenticated");

    expect(service.listar).not.toHaveBeenCalled();
    expect(service.listarCompleto).not.toHaveBeenCalled();
  });

  it("el `forbidden` del rol lo decide el SERVICE, y el borde lo transporta tal cual", async () => {
    // La puerta del rol no se duplica en el borde: una segunda tabla de permisos es justo lo que
    // este repo evita. El borde solo comprueba que HAY sesion.
    const service = buildService({
      listar: vi.fn(async () => ({ status: "forbidden" as const })),
      listarCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const mensajero = async (): Promise<Actor> => ({ usuarioId: "m1", rol: "mensajero" });

    expect(await listarAyudaTiendaAction({ page: 1 }, { service, getActor: mensajero })).toEqual({
      status: "forbidden",
    });
    expect(await listarAyudaTiendaCompletoAction({}, { service, getActor: mensajero })).toEqual({
      status: "forbidden",
    });
  });
});

// =============================================================================================
// El borde tipado: `page` se valida con zod, aqui
// =============================================================================================

describe("236 — `page` se valida en el borde", () => {
  it.each([0, -1, 1.5])("page invalido (%s) -> validation_error sin tocar el service", async (page) => {
    const service = buildService();
    const r = await listarAyudaTiendaAction({ page }, { service, getActor: actorTienda });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(Object.keys(r.fieldErrors)).toContain("page");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("sin input -> pagina 1 (el default del schema), no un error", async () => {
    const service = buildService();
    const r = await listarAyudaTiendaAction(undefined, { service, getActor: actorTienda });
    expect(r.status).toBe("ok");
    expect(inputDe(service.listar)).toEqual({ page: 1, pageSize: PAGE_SIZE, grupo: "ayuda" });
  });

  it("la pestaña VACIA responde `ok` con total 0 — no es un error ni un vacio mudo", async () => {
    // Medido el 2026-08-19: `ayuda_tienda` = 0 en produccion sobre 141 ordenes vivas. Este es el
    // primer camino que va a correr el dia del despliegue, asi que se prueba como uno de pleno
    // derecho: el borde tiene que devolver `ok`, para que la pantalla pinte su estado vacio (R16)
    // en vez de su modo de fallo.
    const service = buildService();
    const r = await listarAyudaTiendaAction({ page: 1 }, { service, getActor: actorTienda });
    expect(r).toEqual({ status: "ok", items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  });
});
