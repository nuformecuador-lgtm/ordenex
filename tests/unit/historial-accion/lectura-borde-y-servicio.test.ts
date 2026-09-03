import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { ROLES_HISTORIAL_ACCIONES, ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";
import { descargaConfig } from "@/lib/config/descarga";
import type {
  FilaHistorialAccion,
  IHistorialAccionRepository,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  HistorialAccionService,
  resolverTiposDelFiltro,
} from "@/lib/services/HistorialAccionService";
import {
  BUSQUEDA_MIN_CHARS_DEL_BORDE,
  accionesDeCategoria,
  filtroHistorialAccionSchema,
} from "./_reexports";

// FICHA 362 / T4.3 + T4.4 — EL BORDE Y EL SERVICIO DE LECTURA.
//
// Lo que estos casos cubren: la union CERRADA del filtro (R15), el defecto y la inversion del
// orden (R26), el minimo de caracteres leido de la constante del borde (R32), la autorizacion
// maestro-only en las TRES acciones (R33, Q4) y el DTO money-safe (R6).
//
// Lo que NO cubren, y esta dicho: el `WHERE`. Los dobles no ven el SQL — en este repo esta medido
// que una mutacion del `WHERE` pasa en verde con dobles. Eso vive en
// `tests/integration/db/historial-accion-lectura.test.ts`, contra Postgres.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const API_KEY: Actor = { usuarioId: "u-key", rol: "apiKey" };

/** Todos los roles del esquema MENOS el maestro. Ninguno puede leer este modulo (Q4). */
const DENEGADOS: Actor[] = [ADMIN, ADMIN_TIENDA, MENSAJERO, ADMIN_SATELITE, API_KEY];

function fila(overrides: Partial<FilaHistorialAccion> = {}): FilaHistorialAccion {
  return {
    id: "h-1",
    createdAt: new Date("2026-09-02T12:00:00.000Z"),
    accion: "cierre_dia_aprobado",
    entidadTipo: "cierre_dia",
    entidadEtiqueta: "Ana Torres · 2026-09-02",
    actorUsuarioId: "u-admin",
    actorNombre: "Ana Torres",
    actorRol: "admin",
    monto: new Prisma.Decimal("15000.50"),
    valorAnterior: null,
    valorNuevo: null,
    loteId: "lote-1",
    ...overrides,
  };
}

function repoDoble(overrides: Partial<IHistorialAccionRepository> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [fila()], total: 1 }),
    listAll: vi.fn().mockResolvedValue([fila()]),
    listarActores: vi.fn().mockResolvedValue([{ id: "u-admin", nombre: "Ana Torres" }]),
    ...overrides,
  } as unknown as IHistorialAccionRepository & {
    list: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
    listarActores: ReturnType<typeof vi.fn>;
  };
}

// =============================================================================================
// Q4 — QUIEN LO VE
// =============================================================================================

describe("362/Q4 — el historial de acciones lo lee SOLO el maestro", () => {
  it("la constante es exactamente `[maestro]`, y no es la del historico de conversaciones", () => {
    // ⚠️ El motivo, escrito: este registro guarda las decisiones de dinero que toma EL ADMIN
    // —aprobar cierres, registrar pagos— y no puede ser el admin quien revise su propio registro.
    expect(ROLES_HISTORIAL_ACCIONES).toEqual(["maestro"]);
    // Y NO se estrecho la constante existente: el `admin` conserva el historico de
    // conversaciones, que es su herramienta de trabajo y nadie decidio quitarsela.
    expect(ROLES_HISTORICO_CONVERSACIONES).toEqual(["maestro", "admin"]);
    expect(ROLES_HISTORIAL_ACCIONES).not.toBe(ROLES_HISTORICO_CONVERSACIONES);
  });

  it.each(DENEGADOS.map((a) => [a.rol, a] as const))(
    "R18: `%s` recibe forbidden en `listar` y el repositorio NO se llama",
    async (_rol, actor) => {
      const repo = repoDoble();
      const r = await new HistorialAccionService(repo).listar({}, actor);
      expect(r).toEqual({ status: "forbidden" });
      // La asercion que distingue «no ve nada» de «consulta y luego filtra».
      expect(repo.list).not.toHaveBeenCalled();
    },
  );

  it.each(DENEGADOS.map((a) => [a.rol, a] as const))(
    "R33: `%s` recibe forbidden tambien en la DESCARGA, y el repositorio NO se llama",
    async (_rol, actor) => {
      const repo = repoDoble();
      const r = await new HistorialAccionService(repo).listarCompleto({}, actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(repo.listAll).not.toHaveBeenCalled();
    },
  );

  it("R18: el catalogo de actores tiene EL MISMO gate", async () => {
    const repo = repoDoble();
    for (const actor of DENEGADOS) {
      expect(await new HistorialAccionService(repo).obtenerCatalogoActores(actor)).toEqual({
        status: "forbidden",
      });
    }
    expect(repo.listarActores).not.toHaveBeenCalled();
  });

  it("sin sesion: `unauthenticated` en las tres, y ninguna consulta", async () => {
    const repo = repoDoble();
    const svc = new HistorialAccionService(repo);
    expect(await svc.listar({}, null)).toEqual({ status: "unauthenticated" });
    expect(await svc.listarCompleto({}, null)).toEqual({ status: "unauthenticated" });
    expect(await svc.obtenerCatalogoActores(null)).toEqual({ status: "unauthenticated" });
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.listAll).not.toHaveBeenCalled();
    expect(repo.listarActores).not.toHaveBeenCalled();
  });

  it("control positivo: el maestro SI lee, y el repositorio se llama", async () => {
    // Sin esto, los `not.toHaveBeenCalled()` de arriba podrian estar verdes por un servicio roto.
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar({}, MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.list).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================================
// T4.3 — EL BORDE
// =============================================================================================

describe("362/T4.3 (R15/R26/R32) — el borde valida sin ejecutar consulta", () => {
  it("R15: un tipo de accion INVENTADO da `validation_error`, y no se consulta", async () => {
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar(
      { accion: ["me_lo_acabo_de_inventar"] },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it(".strict(): una clave DESCONOCIDA es `validation_error`, no un descarte mudo", async () => {
    // La leccion de la 352: un filtro que se ignora en silencio enseña un conjunto que no es el
    // que se pidio, y en un registro de auditoria eso es peor que un error.
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar({ ordenId: "o-1" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("R26: `sortDir` fuera de la lista blanca es `validation_error`", async () => {
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar({ sortDir: "aleatorio" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("R26: `sortBy` fuera de la lista blanca es `validation_error`", async () => {
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar({ sortBy: "actor_nombre" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("R26: el DEFECTO es el mas RECIENTE primero", async () => {
    const repo = repoDoble();
    await new HistorialAccionService(repo).listar({}, MAESTRO);
    expect(repo.list.mock.calls[0][0].orden).toEqual({ sortBy: "created_at", sortDir: "desc" });
  });

  it("R26: se puede INVERTIR, y el orden invertido llega al repositorio", async () => {
    const repo = repoDoble();
    await new HistorialAccionService(repo).listar({ sortDir: "asc" }, MAESTRO);
    expect(repo.list.mock.calls[0][0].orden).toEqual({ sortBy: "created_at", sortDir: "asc" });
  });

  it("R32: el minimo de caracteres SALE de la constante del borde, no de un `3` a mano", () => {
    // El esquema tiene que RECHAZAR un termino de `MIN - 1` y ACEPTAR uno de `MIN`, sea cual sea
    // el valor de la constante. Escribir el numero aqui haria que este caso siguiera verde el dia
    // que alguien cambiara la constante y no el control — que es exactamente la mutacion de R32.
    const corto = "x".repeat(BUSQUEDA_MIN_CHARS_DEL_BORDE - 1);
    const justo = "x".repeat(BUSQUEDA_MIN_CHARS_DEL_BORDE);
    expect(filtroHistorialAccionSchema.safeParse({ q: corto }).success).toBe(false);
    expect(filtroHistorialAccionSchema.safeParse({ q: justo }).success).toBe(true);
  });

  it("R32: un termino demasiado corto NO ejecuta la consulta", async () => {
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar(
      { q: "x".repeat(BUSQUEDA_MIN_CHARS_DEL_BORDE - 1) },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("`pageSize` se acota al tope; la pagina y el tamaño devueltos son los EFECTIVOS", async () => {
    const repo = repoDoble();
    const r = await new HistorialAccionService(repo).listar({ pageSize: 5000 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.pageSize).toBe(100);
    expect(repo.list.mock.calls[0][0].pageSize).toBe(100);
  });
});

// =============================================================================================
// R17 — la categoria se traduce a tipos, y se INTERSECA
// =============================================================================================

describe("362/R17 — `categoria` se traduce a `accion IN (…)` en el borde", () => {
  it("sin filtros de tipo, no se acota por accion", () => {
    expect(resolverTiposDelFiltro({ accion: undefined, categoria: undefined })).toBeNull();
  });

  it("una categoria se expande a EXACTAMENTE sus tipos", () => {
    const tipos = resolverTiposDelFiltro({ accion: undefined, categoria: ["hace_desaparecer"] });
    expect(tipos?.slice().sort()).toEqual(accionesDeCategoria("hace_desaparecer").slice().sort());
  });

  it("dos categorias se unen sin repetir", () => {
    const tipos = resolverTiposDelFiltro({
      accion: undefined,
      categoria: ["hace_desaparecer", "cambia_permisos"],
    });
    expect(tipos).toHaveLength(6 + 11);
    expect(new Set(tipos).size).toBe(17);
  });

  it("categoria Y accion a la vez se INTERSECAN (design §4.2)", () => {
    const tipos = resolverTiposDelFiltro({
      accion: ["orden_eliminada", "cierre_dia_aprobado"],
      categoria: ["hace_desaparecer"],
    });
    // `cierre_dia_aprobado` es de DINERO: cae fuera de la interseccion.
    expect(tipos).toEqual(["orden_eliminada"]);
  });

  it("una combinacion IMPOSIBLE da una lista VACIA, no «sin filtro»", () => {
    // ⚠️ La distincion que importa: colapsar el vacio a `null` enseñaria el conjunto ENTERO a
    // quien pidio una combinacion que no existe — el fallo mudo del propio modulo.
    const tipos = resolverTiposDelFiltro({
      accion: ["orden_eliminada"],
      categoria: ["cambia_permisos"],
    });
    expect(tipos).toEqual([]);
    expect(tipos).not.toBeNull();
  });
});

// =============================================================================================
// T4.4 — EL DTO
// =============================================================================================

describe("362/T4.4 (R3/R6/R17/R36) — el DTO que cruza al cliente", () => {
  it("R6: `monto` es un STRING de escala 2, nunca un number", async () => {
    const r = await new HistorialAccionService(repoDoble()).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.items[0].monto).toBe("string");
    expect(r.items[0].monto).toBe("15000.50");
  });

  it("R17: la categoria viene DERIVADA del tipo, no de una columna", async () => {
    const r = await new HistorialAccionService(repoDoble()).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0].categoria).toBe("mueve_dinero");
  });

  it("R3: el nombre y el rol del actor son los CONGELADOS de la fila", async () => {
    // El caso que justifica congelarlos: la fila dice `admin` aunque hoy el usuario sea `maestro`.
    // Si esto se resolviera al leer, la historia se re-etiquetaria sola.
    const repo = repoDoble({
      list: vi.fn().mockResolvedValue({
        items: [fila({ actorNombre: "Ana Torres", actorRol: "admin" })],
        total: 1,
      }),
    } as Partial<IHistorialAccionRepository>);
    const r = await new HistorialAccionService(repo).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0].actorNombre).toBe("Ana Torres");
    expect(r.items[0].actorRol).toBe("admin");
  });

  it("R36: una fila SIN actor sale con los tres campos nulos (el sistema)", async () => {
    const repo = repoDoble({
      list: vi.fn().mockResolvedValue({
        items: [fila({ actorUsuarioId: null, actorNombre: null, actorRol: null })],
        total: 1,
      }),
    } as Partial<IHistorialAccionRepository>);
    const r = await new HistorialAccionService(repo).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0].actorNombre).toBeNull();
    expect(r.items[0].actorRol).toBeNull();
  });

  it("R38: el DTO NO lleva `entidadId` — el uuid no cruza a la pantalla ni al archivo", async () => {
    const r = await new HistorialAccionService(repoDoble()).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0]).not.toHaveProperty("entidadId");
  });

  it("R5: el DTO NO lleva `motivo`, y no puede llevarlo: no existe en la fila", async () => {
    const r = await new HistorialAccionService(repoDoble()).listar({}, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0]).not.toHaveProperty("motivo");
  });

  it("R22: la respuesta trae `pageSize` filas y el `total` del CONJUNTO, no del recorte", async () => {
    const repo = repoDoble({
      list: vi.fn().mockResolvedValue({ items: [fila(), fila({ id: "h-2" })], total: 4321 }),
    } as Partial<IHistorialAccionRepository>);
    const r = await new HistorialAccionService(repo).listar({ pageSize: 2 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(4321);
    // El recorte lo hizo la BASE: el servicio no corta nada.
    expect(repo.list.mock.calls[0][0].pageSize).toBe(2);
  });
});

// =============================================================================================
// T6.1 — LA DESCARGA
// =============================================================================================

describe("362/T6.1 (R30) — la descarga comparte filtro y orden con la pantalla", () => {
  it("el filtro y el orden que llegan a `listAll` son los MISMOS que a `list`", async () => {
    const repo = repoDoble();
    const svc = new HistorialAccionService(repo);
    const entrada = { categoria: ["hace_desaparecer"], sortDir: "asc" } as const;

    await svc.listar(entrada, MAESTRO);
    await svc.listarCompleto(entrada, MAESTRO);

    expect(repo.listAll.mock.calls[0][0].filtro).toEqual(repo.list.mock.calls[0][0].filtro);
    expect(repo.listAll.mock.calls[0][0].orden).toEqual(repo.list.mock.calls[0][0].orden);
  });

  it("pide UNA fila mas que el tope, para distinguir «cabe justo» de «se paso»", async () => {
    const repo = repoDoble();
    await new HistorialAccionService(repo).listarCompleto({}, MAESTRO);
    expect(repo.listAll.mock.calls[0][0].limite).toBe(descargaConfig.MAX_FILAS + 1);
  });

  it("pasarse del tope es un ERROR ACCIONABLE, no un truncado silencioso", async () => {
    const demasiadas = Array.from({ length: descargaConfig.MAX_FILAS + 1 }, (_, i) =>
      fila({ id: `h-${i}` }),
    );
    const repo = repoDoble({
      listAll: vi.fn().mockResolvedValue(demasiadas),
    } as Partial<IHistorialAccionRepository>);
    const r = await new HistorialAccionService(repo).listarCompleto({}, MAESTRO);
    expect(r).toEqual({ status: "limite_excedido", maximo: descargaConfig.MAX_FILAS });
  });

  it("justo en el tope SI descarga", async () => {
    const justas = Array.from({ length: descargaConfig.MAX_FILAS }, (_, i) => fila({ id: `h-${i}` }));
    const repo = repoDoble({
      listAll: vi.fn().mockResolvedValue(justas),
    } as Partial<IHistorialAccionRepository>);
    const r = await new HistorialAccionService(repo).listarCompleto({}, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items).toHaveLength(descargaConfig.MAX_FILAS);
  });
});
