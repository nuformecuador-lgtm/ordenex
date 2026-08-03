import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { listarCierresBodegaPaginadoSchema } from "@/lib/types/cierre-bodega";

// Feature 170 — FASE 2, T J.1 (R40/R41/R44/R49/R51/R54) — «Cierres de bodega pendientes», la
// COLA paginada del maestro.
//
// Es la otra mitad de la particion que T I.1 pagino por el lado de los resueltos. Cada fila de
// esta cola es dinero AGREGADO de una zona entera (el snapshot del cierre de bodega), asi que
// el guard de rol tiene que resolverse ANTES de tocar la base: con el guard despues, esas
// cabeceras ya habrian salido de Postgres aunque la respuesta fuera un error.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

/**
 * Roles SIN acceso total. Es el lado del rechazo de la contraprueba de R44; el de la
 * aceptacion son MAESTRO y ADMIN, sin los cuales el test pasaria con un servicio que no le
 * devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-sat", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

function fila(
  cierreBodegaId: string,
  zonaId: string,
  dia: number,
  estado: CierreBodegaResumenRow["estado"],
  general: string,
  pago: string,
): CierreBodegaResumenRow {
  return {
    cierreBodegaId,
    zonaId,
    zonaNombre: `Zona ${zonaId}`,
    solicitadoPorId: `u-${zonaId}`,
    solicitadoPorNombre: `Admin ${zonaId}`,
    estado,
    totales: { efectivo: general, simpe: "0.00", transferencia: "0.00", general },
    totalPagoMensajero: pago,
    totalIngresoBodegaRechazos: "1.00",
    cantidadCierres: 3,
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    resueltoAt: estado === "solicitado" ? null : "2026-02-01T00:00:00.000Z",
    motivoRechazo: estado === "rechazado" ? "faltan comprobantes" : null,
  };
}

/**
 * El almacen: cinco en la cola (`solicitado`) y tres ya resueltos —incluido un RECHAZADO, que
 * es historico y no debe colarse en la cola— repartidos entre tres zonas.
 */
const ALMACEN: CierreBodegaResumenRow[] = [
  fila("cb-1", "z-a", 11, "solicitado", "100.00", "10.00"),
  fila("cb-2", "z-b", 12, "solicitado", "200.00", "20.00"),
  fila("cb-3", "z-c", 13, "solicitado", "300.00", "30.00"),
  fila("cb-4", "z-a", 14, "solicitado", "400.00", "40.00"),
  fila("cb-5", "z-b", 15, "solicitado", "500.00", "50.00"),
  fila("cr-1", "z-a", 1, "aprobado", "999.00", "99.00"),
  fila("cr-2", "z-b", 2, "rechazado", "888.00", "88.00"),
  fila("cr-3", "z-c", 3, "aprobado", "777.00", "77.00"),
];

function esCola(row: CierreBodegaResumenRow): boolean {
  return (ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
}

/** `solicitadoAt` descendente: el criterio que el listado presenta hoy (R51). */
function porSolicitadoDesc(a: CierreBodegaResumenRow, b: CierreBodegaResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

function repoEnMemoria(filas: CierreBodegaResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresBodega = vi.fn(async () => {
    llamadas.push("findCierresBodega");
    return [...filas].sort(porSolicitadoDesc);
  });

  const findColaPaginada = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = filas.filter(esCola).sort(porSolicitadoDesc);
    return {
      items: conjunto.slice(rango.skip, rango.skip + rango.take),
      total: conjunto.length,
    };
  });

  const repo = {
    findCierresBodega,
    findColaPaginada,
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findCierreBodegaConDetalle: vi.fn(async () => null),
    resolverCierreBodega: vi.fn(async () => "updated" as const),
  } as unknown as ICierresBodegaAdminRepository;

  return { repo, llamadas, findColaPaginada };
}

function servicio(repo: ICierresBodegaAdminRepository) {
  const signedUrls = {
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  return new CierresBodegaAdminService(repo, signedUrls);
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresBodegaPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreBodegaId: string }>): string[] {
  return items.map((c) => c.cierreBodegaId);
}

/** Suma money-safe (Prisma.Decimal, como produccion) del dinero de las filas dadas. */
function suma(items: ReadonlyArray<CierreBodegaResumen>, campo: "general" | "pago"): string {
  let acc = new Prisma.Decimal(0);
  for (const c of items) {
    acc = acc.plus(campo === "general" ? c.totales.general : c.totalPagoMensajero);
  }
  return acc.toFixed(2);
}

describe("CierresBodegaAdminService.listarPendientesCierresBodegaPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarPendientesCierresBodegaPaginado(
      input({ page: 1, pageSize: 2 }),
      MAESTRO,
    );
    const p2 = await svc.listarPendientesCierresBodegaPaginado(
      input({ page: 2, pageSize: 2 }),
      MAESTRO,
    );
    const p3 = await svc.listarPendientesCierresBodegaPaginado(
      input({ page: 3, pageSize: 2 }),
      MAESTRO,
    );

    expect(p1.status).toBe("ok");
    expect(p2.status).toBe("ok");
    expect(p3.status).toBe("ok");
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") return;

    expect(ids(p1.items)).toEqual(["cb-5", "cb-4"]);
    expect(ids(p2.items)).toEqual(["cb-3", "cb-2"]);
    expect(ids(p3.items)).toEqual(["cb-1"]);

    for (const [i, p] of [p1, p2, p3].entries()) {
      expect(p.total, `pagina ${i + 1}`).toBe(5);
      expect(p.pageSize, `pagina ${i + 1}`).toBe(2);
      expect(p.page, `pagina ${i + 1}`).toBe(i + 1);
    }
    expect(p3.items).toHaveLength(1);
    expect(p3.total).not.toBe(p3.items.length);

    // Ni un resuelto se cuela en la cola: ni el aprobado ni el RECHAZADO, que es historico.
    const todos = await svc.listarPendientesCierresBodegaPaginado(
      input({ pageSize: 50 }),
      MAESTRO,
    );
    if (todos.status !== "ok") return;
    expect(todos.items.every((c) => c.estado === "solicitado")).toBe(true);
    expect(ids(todos.items)).not.toContain("cr-2");
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarPendientesCierresBodegaPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pageSize).toBe(100); // cierreBodegaConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { repo } = repoEnMemoria();
      const svc = servicio(repo);

      const sinPaginar = await svc.listarCierresBodegaAdmin(actor);
      expect(sinPaginar.status, `rol ${actor.rol}`).toBe("ok");
      if (sinPaginar.status !== "ok") return;

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarPendientesCierresBodegaPaginado(
          input({ page, pageSize: 2 }),
          actor,
        );
        expect(p.status, `rol ${actor.rol}`).toBe("ok");
        if (p.status !== "ok") return;
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `rol ${actor.rol}`).toEqual(ids(sinPaginar.pendientes));
      expect(total, `rol ${actor.rol}: el total es el del conjunto`).toBe(
        sinPaginar.pendientes.length,
      );
    }
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarPendientesCierresBodegaPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      // El guard va ANTES de la base: el dinero agregado de las zonas ni sale de Postgres.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El lado de la ACEPTACION, sin el cual lo de arriba pasaria con un servicio mudo.
    const { repo } = repoEnMemoria();
    const ok = await servicio(repo).listarPendientesCierresBodegaPaginado(
      input({ pageSize: 50 }),
      MAESTRO,
    );
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.total).toBe(5);
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarPendientesCierresBodegaPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarCierresBodegaAdmin(MAESTRO);

    expect(r.status).toBe("ok");
    expect(sinPaginar.status).toBe("ok");
    if (r.status !== "ok" || sinPaginar.status !== "ok") return;

    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.pendientes));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarCierresBodegaAdmin(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["findCierresBodega"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarPendientesCierresBodegaPaginado(
      input({ pageSize: 2 }),
      MAESTRO,
    );
    expect(paginado.llamadas).toEqual(["findColaPaginada"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    expect(paginado.findColaPaginada).toHaveBeenCalledTimes(1);
    await expect(paginado.findColaPaginada.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // El coste NO crece con el numero de filas devueltas (nada de N+1 por fila).
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarPendientesCierresBodegaPaginado(
      input({ pageSize: 100 }),
      MAESTRO,
    );
    expect(grande.llamadas).toEqual(["findColaPaginada"]);
  });

  it("los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)", async () => {
    // MEDIDO al implementar: `CierresBodegaAdminModule` NO deriva ningun total del array de la
    // cola. Sus tres paneles de totales (`TotalesPanel`, `PagoMensajeroTotal`,
    // `IngresoBodegaRechazosTotal`) viven DENTRO del modal de detalle de UN cierre de bodega,
    // alimentados por `verCierreBodegaDetalle`; la cola solo aporta filas. Lo que R49 exige
    // aqui es que el dinero del CONJUNTO no cambie al paginar: ni una fila duplicada entre
    // paginas ni una caida entre dos.
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const sinPaginar = await svc.listarCierresBodegaAdmin(MAESTRO);
    expect(sinPaginar.status).toBe("ok");
    if (sinPaginar.status !== "ok") return;

    const recorrido: CierreBodegaResumen[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarPendientesCierresBodegaPaginado(
        input({ page, pageSize: 2 }),
        MAESTRO,
      );
      if (p.status !== "ok" || p.items.length === 0) break;
      recorrido.push(...p.items);
    }

    // 100 + 200 + 300 + 400 + 500 = 1500.00 · 10 + 20 + 30 + 40 + 50 = 150.00
    expect(suma(recorrido, "general")).toBe("1500.00");
    expect(suma(recorrido, "pago")).toBe("150.00");
    expect(suma(recorrido, "general")).toBe(suma(sinPaginar.pendientes, "general"));
    expect(suma(recorrido, "pago")).toBe(suma(sinPaginar.pendientes, "pago"));

    // Una sola pagina NO llega a esos numeros: los datos abarcan tres paginas a proposito.
    const p1 = await svc.listarPendientesCierresBodegaPaginado(
      input({ page: 1, pageSize: 2 }),
      MAESTRO,
    );
    if (p1.status !== "ok") return;
    expect(suma(p1.items, "general")).toBe("900.00"); // 500 + 400
    expect(suma(p1.items, "general")).not.toBe(suma(recorrido, "general"));

    // Los montos por fila NO se recomputan al paginar: es el MISMO snapshot, string a string.
    const porId = new Map(sinPaginar.pendientes.map((c) => [c.cierreBodegaId, c]));
    for (const c of recorrido) {
      expect(c.totales, c.cierreBodegaId).toEqual(porId.get(c.cierreBodegaId)!.totales);
      expect(c.totalPagoMensajero, c.cierreBodegaId).toBe(
        porId.get(c.cierreBodegaId)!.totalPagoMensajero,
      );
    }
  });
});
