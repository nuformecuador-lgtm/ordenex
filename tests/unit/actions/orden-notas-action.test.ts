import { describe, it, expect, vi } from "vitest";
import { borrarNotaOrden, listarNotasOrden, publicarNotaOrden } from "@/lib/actions/orden-notas";
import { CUERPO_MAX } from "@/lib/types/orden-nota";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import type {
  CrearOrdenNotaInput,
  IOrdenNotaRepository,
  OrdenNotaRow,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 227 (T2.9) — el BORDE: las tres Server Actions. Cubre R6, R7, R8, R13 y R27, con los
// nombres de `tasks.md` al pie de la letra.
//
// No se levanta sesion real: el actor entra por `getActor` y el service por `service` (DI, patron
// de `notas-privadas-mensajero-action.test.ts`).
//
// DOS DOBLES DISTINTOS, a proposito:
//  - Para R13 y R27 basta un doble del SERVICE: lo que se mide es que el borde corta ANTES.
//  - Para R6, R7 y R8 se monta el SERVICE REAL sobre un doble del REPOSITORIO. El recorte del
//    cuerpo (R6) y el rechazo de la orden inexistente (R8) son decisiones del service; con un
//    service falso, los tests afirmarian lo que el propio mock devuelve y no probarian nada.
//    Ademas asi «no crea nota» se comprueba contando FILAS, no llamadas.

const TIENDA = "u-tienda";
const ORDEN = "11111111-1111-4111-8111-111111111111";
const ORDEN_INEXISTENTE = "99999999-9999-4999-8999-999999999999";
const NOTA = "44444444-4444-4444-8444-444444444444";

const ACTOR_TIENDA: Actor = { usuarioId: TIENDA, rol: "adminTienda" };
const sinSesion = async () => null;
const conSesion = async () => ACTOR_TIENDA;

/** Doble del SERVICE, con las tres operaciones espiadas. */
function serviceDoble(): IOrdenNotaService {
  return {
    listar: vi.fn(async () => ({ status: "ok" as const, notas: [], puedeEscribir: true })),
    publicar: vi.fn(async () => ({ status: "forbidden" as const })),
    borrar: vi.fn(async () => ({ status: "forbidden" as const })),
  };
}

/** El service REAL sobre un repositorio en memoria. `filas` es la evidencia de «no crea nota». */
function servicioReal(estatusValue = "devuelta") {
  const filas: OrdenNotaRow[] = [];
  const repo: IOrdenNotaRepository = {
    listarPorOrden: vi.fn(async () => filas),
    crear: vi.fn(async (input: CrearOrdenNotaInput): Promise<OrdenNotaRow> => {
      const nueva: OrdenNotaRow = {
        id: `n${filas.length + 1}`,
        autorId: input.autorId,
        rolAutor: input.rolAutor,
        cuerpo: input.cuerpo,
        createdAt: new Date("2026-08-15T10:00:00.000Z"),
        deletedAt: null,
        autor: { nombre: "Tienda Uno" },
      };
      filas.push(nueva);
      return nueva;
    }),
    marcarBorrada: vi.fn(async () => 0),
    findOrdenParaHilo: vi.fn(async (ordenId: string): Promise<OrdenParaHilo | null> =>
      ordenId === ORDEN
        ? {
            tiendaId: TIENDA,
            mensajeroAsignadoId: null,
            estatusValue,
            // 2026-08-18: la ventana del adminTienda tambien se abre con ayuda viva. Aqui `false`
            // para que estos casos sigan midiendo la ventana por ESTATUS y nada mas.
            ayuda: false,
            deletedAt: null,
          }
        : null,
    ),
  };
  return { service: new OrdenNotaService(repo), repo, filas };
}

// =============================================================================================

describe("R13 — sin sesion, el service ni se entera", () => {
  it("devuelve no autenticado sin llamar al servicio", async () => {
    const service = serviceDoble();

    const leer = await listarNotasOrden({ ordenId: ORDEN }, { service, getActor: sinSesion });
    const publicar = await publicarNotaOrden(
      { ordenId: ORDEN, cuerpo: "hola" },
      { service, getActor: sinSesion },
    );
    const borrar = await borrarNotaOrden(
      { ordenId: ORDEN, notaId: NOTA },
      { service, getActor: sinSesion },
    );

    expect(leer).toEqual({ status: "unauthenticated" });
    expect(publicar).toEqual({ status: "unauthenticated" });
    expect(borrar).toEqual({ status: "unauthenticated" });

    // El doble del service NO recibe NINGUNA llamada: el corte es ANTES de consultar datos de
    // negocio, no un `forbidden` disfrazado a la vuelta.
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.publicar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R27 — validacion de borde con errores por campo", () => {
  it("devuelve validation_error con errores por campo ante una entrada mal formada", async () => {
    const service = serviceDoble();

    // `ordenId` que no es uuid.
    const malOrden = await listarNotasOrden({ ordenId: "no-uuid" }, { service, getActor: conSesion });
    expect(malOrden.status).toBe("validation_error");
    if (malOrden.status === "validation_error") {
      expect(Object.keys(malOrden.fieldErrors)).toContain("ordenId");
      expect(malOrden.fieldErrors.ordenId.length).toBeGreaterThan(0);
    }

    // Campos ausentes y de tipo equivocado.
    const sinCuerpo = await publicarNotaOrden({ ordenId: ORDEN }, { service, getActor: conSesion });
    expect(sinCuerpo.status).toBe("validation_error");
    if (sinCuerpo.status === "validation_error") {
      expect(Object.keys(sinCuerpo.fieldErrors)).toContain("cuerpo");
    }

    const notaMal = await borrarNotaOrden(
      { ordenId: ORDEN, notaId: 42 },
      { service, getActor: conSesion },
    );
    expect(notaMal.status).toBe("validation_error");
    if (notaMal.status === "validation_error") {
      expect(Object.keys(notaMal.fieldErrors)).toContain("notaId");
    }

    // Ningun resultado filtra internals, y el service no llego a ejecutarse.
    for (const r of [malOrden, sinCuerpo, notaMal]) {
      expect(JSON.stringify(r)).not.toMatch(/at\s+\w+\s+\(/); // sin stack traces
    }
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.publicar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R6 — el cuerpo en blanco no es una nota", () => {
  it("rechaza un cuerpo que queda vacío al recortar y no crea nota", async () => {
    const { service, repo, filas } = servicioReal();

    for (const cuerpo of ["   ", "", "\n\t  \n"]) {
      const r = await publicarNotaOrden({ ordenId: ORDEN, cuerpo }, { service, getActor: conSesion });
      expect(r.status, JSON.stringify(cuerpo)).toBe("validation_error");
      if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain("cuerpo");
    }

    // Y NO se creo ninguna fila: el conteo del hilo no cambia.
    expect(repo.crear).not.toHaveBeenCalled();
    expect(filas).toHaveLength(0);
  });
});

describe("R7 — tope de 200 caracteres", () => {
  it("acepta 200 caracteres y rechaza 201 sin crear nota", async () => {
    expect(CUERPO_MAX).toBe(200);
    const { service, filas } = servicioReal();

    const justo = "a".repeat(CUERPO_MAX);
    const aceptado = await publicarNotaOrden(
      { ordenId: ORDEN, cuerpo: justo },
      { service, getActor: conSesion },
    );
    expect(aceptado.status).toBe("ok");
    if (aceptado.status === "ok") expect(aceptado.nota.cuerpo).toBe(justo);
    expect(filas).toHaveLength(1);

    const pasado = "a".repeat(CUERPO_MAX + 1);
    const rechazado = await publicarNotaOrden(
      { ordenId: ORDEN, cuerpo: pasado },
      { service, getActor: conSesion },
    );
    expect(rechazado.status).toBe("validation_error");
    // Cero filas NUEVAS: sigue habiendo solo la de 200.
    expect(filas).toHaveLength(1);
  });

  it("el tope se mide sobre el texto CRUDO, antes del recorte", async () => {
    // 199 letras + 2 espacios = 201 crudos que recortarian a 199. Se rechaza igual: el schema
    // mira el texto tal como llego (mismo criterio que la 116).
    const { service, filas } = servicioReal();
    const r = await publicarNotaOrden(
      { ordenId: ORDEN, cuerpo: ` ${"a".repeat(CUERPO_MAX - 1)} ` },
      { service, getActor: conSesion },
    );
    expect(r.status).toBe("validation_error");
    expect(filas).toHaveLength(0);
  });
});

describe("R8 — orden inexistente: rechazo tipado, nunca excepcion", () => {
  it("devuelve rechazo tipado sobre una orden inexistente, sin excepción", async () => {
    const { service, repo, filas } = servicioReal();

    const r = await publicarNotaOrden(
      { ordenId: ORDEN_INEXISTENTE, cuerpo: "sobre una guia que no existe" },
      { service, getActor: conSesion },
    );

    // Resultado de DOMINIO (no un throw) e indistinguible del de una orden ajena (R10).
    expect(r).toEqual({ status: "forbidden" });
    // Cero filas huerfanas: no se intento crear nada.
    expect(repo.crear).not.toHaveBeenCalled();
    expect(filas).toHaveLength(0);
  });
});

describe("el borde delega, propaga y no traga errores", () => {
  it("con sesion y entrada valida, delega en el service con el input parseado y el actor", async () => {
    const service = serviceDoble();
    await listarNotasOrden({ ordenId: ORDEN }, { service, getActor: conSesion });
    expect(service.listar).toHaveBeenCalledWith({ ordenId: ORDEN }, ACTOR_TIENDA);

    await borrarNotaOrden({ ordenId: ORDEN, notaId: NOTA }, { service, getActor: conSesion });
    expect(service.borrar).toHaveBeenCalledWith({ ordenId: ORDEN, notaId: NOTA }, ACTOR_TIENDA);
  });

  it("propaga tal cual el `forbidden` del service (es resultado de dominio, no excepcion)", async () => {
    const service = serviceDoble();
    const r = await publicarNotaOrden(
      { ordenId: ORDEN, cuerpo: "x" },
      { service, getActor: conSesion },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("un fallo EXCEPCIONAL del service no se traga: el traductor lanza ante un codigo inesperado", async () => {
    const service: IOrdenNotaService = {
      ...serviceDoble(),
      listar: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    await expect(
      listarNotasOrden({ ordenId: ORDEN }, { service, getActor: conSesion }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
