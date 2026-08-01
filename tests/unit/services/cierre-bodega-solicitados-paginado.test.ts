import { describe, it, expect, vi } from "vitest";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import type {
  CierreBodegaResumenRow,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarCierresBodegaPaginadoSchema } from "@/lib/types/cierre-bodega";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Cierres de bodega solicitados» paginado.
//
// PUNTO CALIENTE de la tanda: el alcance no lo fija el rol sino un DATO derivado del actor (la
// zona de SU bodega satelite). Un fallo aqui no devuelve menos filas de la cuenta: devuelve el
// historico de dinero de OTRA bodega. Por eso el almacen tiene cierres de DOS zonas y las dos
// se comprueban en los dos sentidos.

const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };
const SAT_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

/** Contraprueba por el lado del rechazo. El `maestro` esta aqui a proposito: ve los cierres de
 *  bodega por SU pantalla (`listarCierresBodegaAdmin`), no por la del satelite. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  cierreBodegaId: string,
  zonaId: string,
  dia: number,
  estado: CierreBodegaResumenRow["estado"] = "aprobado",
): CierreBodegaResumenRow {
  return {
    cierreBodegaId,
    zonaId,
    zonaNombre: `Zona ${zonaId}`,
    solicitadoPorId: `u-sat-${zonaId}`,
    solicitadoPorNombre: `Sat ${zonaId}`,
    estado,
    totales: { efectivo: "300.00", simpe: "0.00", transferencia: "0.00", general: "300.00" },
    totalPagoMensajero: "30.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 2,
    solicitadoAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    resueltoAt: null,
    motivoRechazo: null,
  };
}

/**
 * Este listado NO filtra por estado (muestra todos los cierres de bodega de la zona,
 * resueltos o no): por eso el almacen mezcla los cuatro estados a proposito — si el paginado
 * escondiera los `solicitado`, el adminSatelite dejaria de ver justo el que tiene pendiente.
 */
const ALMACEN: CierreBodegaResumenRow[] = [
  fila("a-01", "z-a", 1),
  fila("a-02", "z-a", 2, "rechazado"),
  fila("a-03", "z-a", 3, "solicitado"),
  fila("a-04", "z-a", 4),
  fila("a-05", "z-a", 5),
  fila("b-01", "z-b", 11),
  fila("b-02", "z-b", 12, "solicitado"),
];

function porSolicitadoDesc(a: CierreBodegaResumenRow, b: CierreBodegaResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

function repoEnMemoria(filas: CierreBodegaResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresBodegaByZona = vi.fn(async (zonaId: string) => {
    llamadas.push("findCierresBodegaByZona");
    return filas.filter((f) => f.zonaId === zonaId).sort(porSolicitadoDesc);
  });

  const findCierresBodegaByZonaPaginado = vi.fn(async (zonaId: string, rango: RangoPagina) => {
    llamadas.push("findCierresBodegaByZonaPaginado");
    const conjunto = filas.filter((f) => f.zonaId === zonaId).sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findCierresBodegaByZona,
    findCierresBodegaByZonaPaginado,
    findCierresDiaConsolidables: vi.fn(async () => {
      llamadas.push("findCierresDiaConsolidables");
      return [];
    }),
    contarCierresDiaSolicitados: vi.fn(async () => {
      llamadas.push("contarCierresDiaSolicitados");
      return 0;
    }),
    existeCierreBodegaSolicitado: vi.fn(async () => false),
    crearCierreBodega: vi.fn(async () => "cb-nuevo"),
  } as unknown as ICierreBodegaRepository;

  return { repo, llamadas, findCierresBodegaByZonaPaginado };
}

function servicio(repo: ICierreBodegaRepository, contarZona?: { n: number }) {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => {
      if (contarZona) contarZona.n += 1;
      return ZONA_POR_USUARIO[usuarioId] ?? null;
    }),
  } as unknown as IOrdenRepository;
  return new CierreBodegaService(repo, ordenRepo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresBodegaPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreBodegaId: string }>): string[] {
  return items.map((c) => c.cierreBodegaId);
}

describe("CierreBodegaService.listarCierresBodegaSolicitadosPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarCierresBodegaSolicitadosPaginado(input({ page: 1, pageSize: 2 }), SAT_A);
    const p2 = await svc.listarCierresBodegaSolicitadosPaginado(input({ page: 2, pageSize: 2 }), SAT_A);
    const p3 = await svc.listarCierresBodegaSolicitadosPaginado(input({ page: 3, pageSize: 2 }), SAT_A);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["a-05", "a-04"]);
    expect(ids(p2.items)).toEqual(["a-03", "a-02"]);
    expect(ids(p3.items)).toEqual(["a-01"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO de la zona A
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarCierresBodegaSolicitadosPaginado(
      input({ pageSize: 100000 }),
      SAT_A,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // cierreBodegaConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [SAT_A, SAT_B]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarConsolidacion(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarCierresBodegaSolicitadosPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `usuario ${actor.usuarioId}`).toEqual(ids(sinPaginar.cierresBodegaPasados));
      expect(total, `usuario ${actor.usuarioId}`).toBe(sinPaginar.cierresBodegaPasados.length);
    }
  });

  it("CONTRAPRUEBA de R44: cada bodega ve la SUYA y ninguna de la vecina", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarCierresBodegaSolicitadosPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const deA = await pagina(SAT_A);
    const deB = await pagina(SAT_B);

    // Lo suyo, entero (incluidos los `solicitado`: este listado no filtra por estado).
    expect(deA).toEqual(["a-05", "a-04", "a-03", "a-02", "a-01"]);
    expect(deB).toEqual(["b-02", "b-01"]);
    // Y nada de la otra zona, en los DOS sentidos: sin el segundo, un servicio que devolviera
    // siempre la zona A pasaria la primera mitad.
    expect(deA.some((id) => id.startsWith("b-"))).toBe(false);
    expect(deB.some((id) => id.startsWith("a-"))).toBe(false);
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const zona = { n: 0 };
      const r = await servicio(repo, zona).listarCierresBodegaSolicitadosPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // El guard va ANTES de resolver la zona y ANTES de la base.
      expect(zona.n, `rol ${actor.rol}`).toBe(0);
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia y no consulta el historico (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const r = await servicio(repo).listarCierresBodegaSolicitadosPaginado(input(), SAT_SIN_ZONA);

    if (r.status !== "ok") throw new Error("no ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    // Es lo mismo que devuelve hoy `listarConsolidacion` (cierresBodegaPasados: []).
    expect(llamadas).toEqual([]);
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarCierresBodegaSolicitadosPaginado(input({ pageSize: 50 }), SAT_A);
    const sinPaginar = await svc.listarConsolidacion(SAT_A);

    if (r.status !== "ok" || sinPaginar.status !== "ok") throw new Error("no ok");
    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.cierresBodegaPasados));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    // Sin paginar, la pantalla entera hace TRES consultas a este repo (consolidables, conteo
    // de pendientes e historico); solo la ultima es este listado.
    const sinPaginar = repoEnMemoria();
    const zonaSinPaginar = { n: 0 };
    await servicio(sinPaginar.repo, zonaSinPaginar).listarConsolidacion(SAT_A);
    expect(sinPaginar.llamadas).toContain("findCierresBodegaByZona");

    const paginado = repoEnMemoria();
    const zonaPaginado = { n: 0 };
    await servicio(paginado.repo, zonaPaginado).listarCierresBodegaSolicitadosPaginado(
      input({ pageSize: 2 }),
      SAT_A,
    );

    // UNA sola consulta al repositorio para el listado, y el conteo viaja dentro de ella.
    expect(paginado.llamadas).toEqual(["findCierresBodegaByZonaPaginado"]);
    await expect(paginado.findCierresBodegaByZonaPaginado.mock.results[0]!.value).resolves.toMatchObject(
      { total: 5 },
    );

    // La resolucion de la zona es la MISMA que ya hace el listado sin paginar: paginar no
    // anade ninguna consulta de alcance.
    expect(zonaPaginado.n).toBe(zonaSinPaginar.n);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // El coste no crece con el numero de filas de la pagina.
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarCierresBodegaSolicitadosPaginado(input({ pageSize: 100 }), SAT_A);
    expect(grande.llamadas).toEqual(["findCierresBodegaByZonaPaginado"]);
  });
});
