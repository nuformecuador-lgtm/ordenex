import { describe, it, expect, vi } from "vitest";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { listarCierresBodegaPaginadoSchema } from "@/lib/types/cierre-bodega";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Cierres de bodega resueltos» paginado.
//
// Aqui el acotamiento NO es por zona sino por ROL: el historico agregado de TODAS las bodegas
// lo ve el acceso total (maestro/admin) y nadie mas. Por eso la contraprueba se juega entera
// en la lista de roles: los autorizados reciben las filas, el resto `forbidden` SIN que la
// consulta llegue a la base.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

/** Contraprueba de R44 por el lado del rechazo. El `adminSatelite` esta aqui a proposito:
 *  tiene su propia pantalla de bodega, pero NO el agregado de todas. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  cierreBodegaId: string,
  dia: number,
  estado: CierreBodegaResumenRow["estado"] = "aprobado",
): CierreBodegaResumenRow {
  return {
    cierreBodegaId,
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    solicitadoPorId: "u-sat",
    solicitadoPorNombre: "Sat Uno",
    estado,
    totales: { efectivo: "500.00", simpe: "0.00", transferencia: "0.00", general: "500.00" },
    totalPagoMensajero: "50.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 3,
    solicitadoAt: `2026-02-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    resueltoAt: estado === "solicitado" ? null : `2026-02-${String(dia).padStart(2, "0")}T12:00:00.000Z`,
    motivoRechazo: null,
  };
}

/** Cinco resueltos y dos en la cola: sin filas de la cola no habria nada que el corte pudiera
 *  colar en el historico. */
const ALMACEN: CierreBodegaResumenRow[] = [
  fila("cb-01", 1),
  fila("cb-02", 2, "rechazado"),
  fila("cb-03", 3, "solicitado"), // cola
  fila("cb-04", 4),
  fila("cb-05", 5, "solicitado"), // cola
  fila("cb-06", 6, "rechazado"),
  fila("cb-07", 7),
];

function esHistorico(row: CierreBodegaResumenRow): boolean {
  return !(ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
}

function porSolicitadoDesc(a: CierreBodegaResumenRow, b: CierreBodegaResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

function repoEnMemoria(filas: CierreBodegaResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresBodega = vi.fn(async () => {
    llamadas.push("findCierresBodega");
    return [...filas].sort(porSolicitadoDesc);
  });

  const findHistoricoPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = filas.filter(esHistorico).sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findCierresBodega,
    findHistoricoPaginado,
    findCierreBodegaConDetalle: vi.fn(async () => null),
    resolverCierreBodega: vi.fn(async () => "updated" as const),
  } as unknown as ICierresBodegaAdminRepository;

  return { repo, llamadas, findHistoricoPaginado };
}

function servicio(repo: ICierresBodegaAdminRepository) {
  const signedUrls = { createSignedUrls: vi.fn(async () => ({})) } as unknown as ISignedUrlProvider;
  return new CierresBodegaAdminService(repo, signedUrls);
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresBodegaPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreBodegaId: string }>): string[] {
  return items.map((c) => c.cierreBodegaId);
}

describe("CierresBodegaAdminService.listarHistoricoCierresBodegaPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarHistoricoCierresBodegaPaginado(input({ page: 1, pageSize: 2 }), MAESTRO);
    const p2 = await svc.listarHistoricoCierresBodegaPaginado(input({ page: 2, pageSize: 2 }), MAESTRO);
    const p3 = await svc.listarHistoricoCierresBodegaPaginado(input({ page: 3, pageSize: 2 }), MAESTRO);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["cb-07", "cb-06"]);
    expect(ids(p2.items)).toEqual(["cb-04", "cb-02"]);
    expect(ids(p3.items)).toEqual(["cb-01"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO
    expect(p3.items).toHaveLength(1);
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarHistoricoCierresBodegaPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // cierreBodegaConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarCierresBodegaAdmin(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarHistoricoCierresBodegaPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `rol ${actor.rol}`).toEqual(ids(sinPaginar.historico));
      expect(total, `rol ${actor.rol}`).toBe(sinPaginar.historico.length);
      // Y el historico NO se traga la cola: los dos `solicitado` siguen en pendientes.
      expect(ids(sinPaginar.pendientes)).toEqual(["cb-05", "cb-03"]);
      expect(recorrido.some((id) => ids(sinPaginar.pendientes).includes(id))).toBe(false);
    }
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarHistoricoCierresBodegaPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // El guard va ANTES de la base: el dinero agregado no sale de ahi ni para descartarse.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El otro lado, sin el cual lo de arriba pasaria con un servicio mudo.
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await servicio(repoEnMemoria().repo).listarHistoricoCierresBodegaPaginado(
        input({ pageSize: 50 }),
        actor,
      );
      if (r.status !== "ok") throw new Error("no ok");
      expect(ids(r.items), `rol ${actor.rol}`).toEqual(["cb-07", "cb-06", "cb-04", "cb-02", "cb-01"]);
    }
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarHistoricoCierresBodegaPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarCierresBodegaAdmin(MAESTRO);

    if (r.status !== "ok" || sinPaginar.status !== "ok") throw new Error("no ok");
    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.historico));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarCierresBodegaAdmin(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["findCierresBodega"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarHistoricoCierresBodegaPaginado(input({ pageSize: 2 }), MAESTRO);
    expect(paginado.llamadas).toEqual(["findHistoricoPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // El conteo viaja DENTRO de esa unica llamada; no es una consulta que el servicio pueda
    // resolver contra otro `where`.
    await expect(paginado.findHistoricoPaginado.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // El coste no crece con el numero de filas de la pagina.
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarHistoricoCierresBodegaPaginado(input({ pageSize: 100 }), MAESTRO);
    expect(grande.llamadas).toEqual(["findHistoricoPaginado"]);
  });
});
