import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
import { listarHistoricoCierresAdminSchema } from "@/lib/types/cierres-admin";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Cierres del dia: historico» paginado.
//
// El repositorio doble NO es un stub que devuelve lo que se le diga: aplica de verdad el
// alcance que RECIBE, el corte cola/historico y el recorte de pagina, sobre un almacen con
// cierres de DOS bodegas y DOS zonas satelite. Es lo unico que hace honesto al test de R44: si
// el servicio pasara al metodo paginado un alcance distinto del que pasa al listado sin
// paginar —o ninguno—, las filas cambiarian y el test se pondria rojo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SATELITE_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SATELITE_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };

/** Zona de cada adminSatelite, tal como la resolveria `findUsuarioZonaId` desde el usuario. */
const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
};

/**
 * Roles que NO alcanzan este listado. Es la lista de contraprueba de R44 por el lado del
 * rechazo; el lado de la aceptacion lo cubren `MAESTRO`/`ADMIN`/`SATELITE_A`, sin los cuales
 * el test pasaria con un servicio que no le devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(over: Partial<CierreAdminResumenRow> & { cierreId: string }): CierreAdminResumenRow {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: `Mensajero ${over.cierreId}`,
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: {
      efectivo: "100.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "100.00",
    },
    totalPagoMensajero: "10.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-01-01T00:00:00.000Z",
    resueltoAt: "2026-01-02T00:00:00.000Z",
    motivoRechazo: null,
    ...over,
  };
}

/** Cierre resuelto de la bodega CENTRAL (lo ven maestro/admin). */
function central(cierreId: string, dia: number, estado: CierreAdminResumenRow["estado"] = "aprobado") {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  });
}

/** Cierre resuelto de una bodega SATELITE (solo lo ve el adminSatelite de esa zona). */
function satelite(
  cierreId: string,
  zonaId: string,
  dia: number,
  estado: CierreAdminResumenRow["estado"] = "aprobado",
) {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_satelite",
    destinoZonaId: zonaId,
    destinoZonaNombre: `Zona ${zonaId}`,
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  });
}

/**
 * El almacen de la suite. Cierres de la central y de DOS zonas satelite, en los cuatro
 * estados: sin filas ajenas no habria nada que un acotamiento roto pudiera filtrar.
 */
const ALMACEN: CierreAdminResumenRow[] = [
  central("c-01", 1),
  central("c-02", 2, "rechazado"),
  central("c-03", 3),
  central("c-04", 4, "solicitado"), // cola: NO es historico
  central("c-05", 5, "vencido"), // cola: NO es historico
  central("c-06", 6),
  central("c-07", 7, "rechazado"),
  satelite("s-a1", "z-a", 11),
  satelite("s-a2", "z-a", 12, "rechazado"),
  satelite("s-a3", "z-a", 13, "solicitado"), // cola de la zona A
  satelite("s-b1", "z-b", 21),
  satelite("s-b2", "z-b", 22),
];

function casaAlcance(row: CierreAdminResumenRow, alcance: Alcance): boolean {
  if (row.destinoTipo !== alcance.destinoTipo) return false;
  return alcance.destinoZonaId === null || row.destinoZonaId === alcance.destinoZonaId;
}

function esHistorico(row: CierreAdminResumenRow): boolean {
  return !(ESTADOS_COLA_CIERRE_DIA as readonly string[]).includes(row.estado);
}

/** `solicitadoAt` descendente: el criterio que el listado presenta hoy (R51). */
function porSolicitadoDesc(a: CierreAdminResumenRow, b: CierreAdminResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

/**
 * Repositorio EN MEMORIA: filtra por el alcance que recibe, ordena y recorta de verdad, y
 * lleva la cuenta de cuantas veces se le llama (R54).
 */
function repoEnMemoria(filas: CierreAdminResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresByAlcance = vi.fn(async (alcance: Alcance) => {
    llamadas.push("findCierresByAlcance");
    return filas.filter((f) => casaAlcance(f, alcance)).sort(porSolicitadoDesc);
  });

  const findHistoricoPaginado = vi.fn(async (alcance: Alcance, rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = filas
      .filter((f) => casaAlcance(f, alcance) && esHistorico(f))
      .sort(porSolicitadoDesc);
    return {
      items: conjunto.slice(rango.skip, rango.skip + rango.take),
      total: conjunto.length,
    };
  });

  const repo = {
    findCierresByAlcance,
    findHistoricoPaginado,
    findCierreByIdEnAlcance: vi.fn(async () => null),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
  } as unknown as ICierresAdminRepository;

  return { repo, llamadas, findCierresByAlcance, findHistoricoPaginado };
}

function servicio(repo: ICierresAdminRepository, contarZona?: { n: number }) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => {
      if (contarZona) contarZona.n += 1;
      return ZONA_POR_USUARIO[usuarioId] ?? null;
    }),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  const signedUrls = { createSignedUrls: vi.fn(async () => ({})) } as unknown as ISignedUrlProvider;
  // Feature 172 (T C.2): sin pagos registrados. El conteo de llamadas de ESTE doble lo mide
  // `cierres-admin-pendiente.test.ts`; aqui solo hace falta que exista.
  return new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  });
}

function input(extra: Record<string, unknown> = {}) {
  return listarHistoricoCierresAdminSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreId: string }>): string[] {
  return items.map((c) => c.cierreId);
}

describe("CierresAdminService.listarHistoricoCierresAdminPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarHistoricoCierresAdminPaginado(input({ page: 1, pageSize: 2 }), MAESTRO);
    const p2 = await svc.listarHistoricoCierresAdminPaginado(input({ page: 2, pageSize: 2 }), MAESTRO);
    const p3 = await svc.listarHistoricoCierresAdminPaginado(input({ page: 3, pageSize: 2 }), MAESTRO);

    expect(p1.status).toBe("ok");
    expect(p2.status).toBe("ok");
    expect(p3.status).toBe("ok");
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") return;

    // La central tiene 5 cierres resueltos (c-01, c-02, c-03, c-06, c-07); los otros dos son
    // cola. Cada pagina trae SU tramo, nunca el conjunto entero.
    expect(ids(p1.items)).toEqual(["c-07", "c-06"]);
    expect(ids(p2.items)).toEqual(["c-03", "c-02"]);
    expect(ids(p3.items)).toEqual(["c-01"]);

    // R41: el total es el del CONJUNTO en las tres paginas, no la longitud de la pagina.
    for (const [i, p] of [p1, p2, p3].entries()) {
      expect(p.total, `pagina ${i + 1}`).toBe(5);
      expect(p.pageSize, `pagina ${i + 1}`).toBe(2);
      expect(p.page, `pagina ${i + 1}`).toBe(i + 1);
    }
    // La ultima pagina es la que hace visible la mentira de contar el array.
    expect(p3.items).toHaveLength(1);
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarHistoricoCierresAdminPaginado(input({ pageSize: 100000 }), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pageSize).toBe(100); // cierreConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    // Se recorre TODO el conjunto pagina a pagina y se compara con el historico que devuelve
    // el listado SIN paginar, para el MISMO actor. Tres actores con tres alcances distintos.
    for (const actor of [MAESTRO, ADMIN, SATELITE_A, SATELITE_B]) {
      const { repo } = repoEnMemoria();
      const svc = servicio(repo);

      const sinPaginar = await svc.listarCierresAdmin(actor);
      expect(sinPaginar.status, `rol ${actor.rol}`).toBe("ok");
      if (sinPaginar.status !== "ok") return;

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarHistoricoCierresAdminPaginado(input({ page, pageSize: 2 }), actor);
        expect(p.status, `rol ${actor.rol}`).toBe("ok");
        if (p.status !== "ok") return;
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `rol ${actor.rol}/${actor.usuarioId}`).toEqual(ids(sinPaginar.historico));
      expect(total, `rol ${actor.rol}: el total es el del conjunto`).toBe(sinPaginar.historico.length);
    }
  });

  it("CONTRAPRUEBA de R44: cada actor ve LO SUYO y nada del vecino", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarHistoricoCierresAdminPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    // El acceso total ve la bodega central... y NINGUN satelite.
    const delMaestro = await pagina(MAESTRO);
    expect(delMaestro).toEqual(["c-07", "c-06", "c-03", "c-02", "c-01"]);
    expect(delMaestro.some((id) => id.startsWith("s-"))).toBe(false);

    // El adminSatelite de la zona A ve SUS dos resueltos: ni los de la central ni los de la B.
    const deA = await pagina(SATELITE_A);
    expect(deA).toEqual(["s-a2", "s-a1"]);

    // Y el de la zona B ve los suyos. Sin este segundo lado, un servicio que devolviera
    // siempre vacio pasaria la mitad de arriba.
    const deB = await pagina(SATELITE_B);
    expect(deB).toEqual(["s-b2", "s-b1"]);

    // Los tres conjuntos son disjuntos: ninguna fila se ve desde dos alcances.
    expect(delMaestro.filter((id) => deA.includes(id) || deB.includes(id))).toEqual([]);
    expect(deA.filter((id) => deB.includes(id))).toEqual([]);
  });

  it("CONTRAPRUEBA de R44: el rol sin acceso recibe forbidden sin filas ni total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarHistoricoCierresAdminPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      // El guard va ANTES de la base: ni una consulta al historico ajeno.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const sinZona: Actor = { usuarioId: "u-sin-zona", rol: "adminSatelite" };

    const r = await servicio(repo).listarHistoricoCierresAdminPaginado(input(), sinZona);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    // Es lo mismo que devuelve hoy el listado sin paginar (historico []), sin tocar cierres.
    expect(llamadas).toEqual([]);
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarHistoricoCierresAdminPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarCierresAdmin(MAESTRO);

    expect(r.status).toBe("ok");
    expect(sinPaginar.status).toBe("ok");
    if (r.status !== "ok" || sinPaginar.status !== "ok") return;

    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    // Y es EL MISMO orden que presenta hoy la pantalla, no solo "un orden".
    expect(ids(r.items)).toEqual(ids(sinPaginar.historico));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    // (a) Acceso total: el listado sin paginar hace UNA consulta a cierres; la version
    // paginada tambien UNA — y dentro de ella viaja el conteo que R41 exige.
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarCierresAdmin(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["findCierresByAlcance"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarHistoricoCierresAdminPaginado(input({ pageSize: 2 }), MAESTRO);
    expect(paginado.llamadas).toEqual(["findHistoricoPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // La pagina y el total salen de la MISMA llamada: el conteo no es una consulta que el
    // servicio pueda resolver contra otro `where`.
    expect(paginado.findHistoricoPaginado).toHaveBeenCalledTimes(1);
    await expect(paginado.findHistoricoPaginado.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // (b) El coste NO crece con el numero de filas devueltas (nada de N+1 por fila).
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarHistoricoCierresAdminPaginado(input({ pageSize: 100 }), MAESTRO);
    expect(grande.llamadas).toEqual(["findHistoricoPaginado"]);

    // (c) adminSatelite: la consulta EXTRA es la de su zona, y es la MISMA que ya hace el
    // listado sin paginar. Paginar no anade ninguna resolucion de alcance nueva.
    const zonaSinPaginar = { n: 0 };
    const sp = repoEnMemoria();
    await servicio(sp.repo, zonaSinPaginar).listarCierresAdmin(SATELITE_A);

    const zonaPaginado = { n: 0 };
    const pg = repoEnMemoria();
    await servicio(pg.repo, zonaPaginado).listarHistoricoCierresAdminPaginado(input(), SATELITE_A);

    expect(zonaPaginado.n).toBe(zonaSinPaginar.n);
    expect(pg.llamadas.length).toBe(sp.llamadas.length);
  });
});
