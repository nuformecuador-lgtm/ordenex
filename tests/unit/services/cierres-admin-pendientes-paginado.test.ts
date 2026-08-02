import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
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
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
import { listarPendientesCierresAdminSchema } from "@/lib/types/cierres-admin";

// Feature 170 — FASE 2, T J.1 (R40/R41/R44/R49/R51/R54) — «Cierres del dia pendientes de
// decision», la COLA paginada.
//
// Es la otra mitad de la particion que T I.1 pagino por el lado del historico. El repositorio
// doble aplica de verdad el alcance que RECIBE y el corte cola/historico, sobre un almacen con
// cierres de la central y de DOS zonas satelite en los cuatro estados: sin filas ajenas no
// habria nada que un acotamiento roto pudiera filtrar.
//
// `vencido` esta en la cola a proposito (feature 41/R20): es un estado RESOLUBLE que bloquea la
// bodega de su mensajero. Si se cayera de esta pagina, el admin no lo veria para destrabarlo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SATELITE_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SATELITE_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
};

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  over: Partial<CierreAdminResumenRow> & { cierreId: string },
): CierreAdminResumenRow {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: `Mensajero ${over.cierreId}`,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: { efectivo: "100.00", simpe: "0.00", transferencia: "0.00", general: "100.00" },
    totalPagoMensajero: "10.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-01-01T00:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

/** Cierre de la bodega CENTRAL (lo ven maestro/admin), con dinero propio por fila. */
function central(
  cierreId: string,
  dia: number,
  estado: CierreAdminResumenRow["estado"],
  general: string,
  pago: string,
) {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    totales: { efectivo: general, simpe: "0.00", transferencia: "0.00", general },
    totalPagoMensajero: pago,
    resueltoAt: estado === "aprobado" || estado === "rechazado" ? "2026-02-01T00:00:00.000Z" : null,
  });
}

/** Cierre de una bodega SATELITE (solo lo ve el adminSatelite de esa zona). */
function satelite(
  cierreId: string,
  zonaId: string,
  dia: number,
  estado: CierreAdminResumenRow["estado"],
  general: string,
  pago: string,
) {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_satelite",
    destinoZonaId: zonaId,
    destinoZonaNombre: `Zona ${zonaId}`,
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    totales: { efectivo: general, simpe: "0.00", transferencia: "0.00", general },
    totalPagoMensajero: pago,
    resueltoAt: estado === "aprobado" || estado === "rechazado" ? "2026-02-01T00:00:00.000Z" : null,
  });
}

/**
 * El almacen: cinco en la cola de la central (mezclando `solicitado` y `vencido`), dos ya
 * resueltos que NO deben aparecer, y dos zonas satelite con cola propia.
 */
const ALMACEN: CierreAdminResumenRow[] = [
  central("cp-1", 11, "solicitado", "100.00", "10.00"),
  central("cp-2", 12, "vencido", "200.00", "20.00"),
  central("cp-3", 13, "solicitado", "300.00", "30.00"),
  central("cp-4", 14, "vencido", "400.00", "40.00"),
  central("cp-5", 15, "solicitado", "500.00", "50.00"),
  central("ch-1", 1, "aprobado", "999.00", "99.00"), // historico: NO es cola
  central("ch-2", 2, "rechazado", "888.00", "88.00"), // historico: NO es cola
  satelite("sa-1", "z-a", 21, "solicitado", "11.00", "1.00"),
  satelite("sa-2", "z-a", 22, "vencido", "22.00", "2.00"),
  satelite("sa-3", "z-a", 23, "aprobado", "33.00", "3.00"), // historico de la zona A
  satelite("sb-1", "z-b", 31, "solicitado", "44.00", "4.00"),
  satelite("sb-2", "z-b", 32, "solicitado", "55.00", "5.00"),
];

function casaAlcance(row: CierreAdminResumenRow, alcance: Alcance): boolean {
  if (row.destinoTipo !== alcance.destinoTipo) return false;
  return alcance.destinoZonaId === null || row.destinoZonaId === alcance.destinoZonaId;
}

function esCola(row: CierreAdminResumenRow): boolean {
  return (ESTADOS_COLA_CIERRE_DIA as readonly string[]).includes(row.estado);
}

/** `solicitadoAt` descendente: el criterio que el listado presenta hoy (R51). */
function porSolicitadoDesc(a: CierreAdminResumenRow, b: CierreAdminResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

function repoEnMemoria(filas: CierreAdminResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresByAlcance = vi.fn(async (alcance: Alcance) => {
    llamadas.push("findCierresByAlcance");
    return filas.filter((f) => casaAlcance(f, alcance)).sort(porSolicitadoDesc);
  });

  const findColaPaginada = vi.fn(async (alcance: Alcance, rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = filas
      .filter((f) => casaAlcance(f, alcance) && esCola(f))
      .sort(porSolicitadoDesc);
    return {
      items: conjunto.slice(rango.skip, rango.skip + rango.take),
      total: conjunto.length,
    };
  });

  const repo = {
    findCierresByAlcance,
    findColaPaginada,
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    findGestionesIncidenteDelCierre: vi.fn(async () => [] as string[]),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
  } as unknown as ICierresAdminRepository;

  return { repo, llamadas, findColaPaginada };
}

function servicio(repo: ICierresAdminRepository, contarZona?: { n: number }) {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => {
      if (contarZona) contarZona.n += 1;
      return ZONA_POR_USUARIO[usuarioId] ?? null;
    }),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  return new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls);
}

function input(extra: Record<string, unknown> = {}) {
  return listarPendientesCierresAdminSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreId: string }>): string[] {
  return items.map((c) => c.cierreId);
}

/** Suma money-safe (Prisma.Decimal, como produccion) del dinero de las filas dadas. */
function suma(items: ReadonlyArray<CierreAdminResumen>, campo: "general" | "pago"): string {
  let acc = new Prisma.Decimal(0);
  for (const c of items) {
    acc = acc.plus(campo === "general" ? c.totales.general : c.totalPagoMensajero);
  }
  return acc.toFixed(2);
}

describe("CierresAdminService.listarPendientesCierresAdminPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarPendientesCierresAdminPaginado(
      input({ page: 1, pageSize: 2 }),
      MAESTRO,
    );
    const p2 = await svc.listarPendientesCierresAdminPaginado(
      input({ page: 2, pageSize: 2 }),
      MAESTRO,
    );
    const p3 = await svc.listarPendientesCierresAdminPaginado(
      input({ page: 3, pageSize: 2 }),
      MAESTRO,
    );

    expect(p1.status).toBe("ok");
    expect(p2.status).toBe("ok");
    expect(p3.status).toBe("ok");
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") return;

    // La cola de la central son 5 (los dos resueltos quedan fuera), mas reciente primero.
    expect(ids(p1.items)).toEqual(["cp-5", "cp-4"]);
    expect(ids(p2.items)).toEqual(["cp-3", "cp-2"]);
    expect(ids(p3.items)).toEqual(["cp-1"]);

    for (const [i, p] of [p1, p2, p3].entries()) {
      expect(p.total, `pagina ${i + 1}`).toBe(5);
      expect(p.pageSize, `pagina ${i + 1}`).toBe(2);
      expect(p.page, `pagina ${i + 1}`).toBe(i + 1);
    }
    // La ultima pagina es la que hace visible la mentira de contar el array: es EXACTAMENTE
    // el numero que el contador de cabecera de la pantalla mostraria (R42).
    expect(p3.items).toHaveLength(1);
    expect(p3.total).not.toBe(p3.items.length);

    // Y los `vencido` siguen dentro de la cola, que es lo que permite destrabarlos.
    const todos = await svc.listarPendientesCierresAdminPaginado(
      input({ pageSize: 50 }),
      MAESTRO,
    );
    if (todos.status !== "ok") return;
    expect(todos.items.filter((c) => c.estado === "vencido").map((c) => c.cierreId)).toEqual([
      "cp-4",
      "cp-2",
    ]);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarPendientesCierresAdminPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pageSize).toBe(100); // cierreConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN, SATELITE_A, SATELITE_B]) {
      const { repo } = repoEnMemoria();
      const svc = servicio(repo);

      const sinPaginar = await svc.listarCierresAdmin(actor);
      expect(sinPaginar.status, `rol ${actor.rol}`).toBe("ok");
      if (sinPaginar.status !== "ok") return;

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarPendientesCierresAdminPaginado(
          input({ page, pageSize: 2 }),
          actor,
        );
        expect(p.status, `rol ${actor.rol}`).toBe("ok");
        if (p.status !== "ok") return;
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `rol ${actor.rol}/${actor.usuarioId}`).toEqual(ids(sinPaginar.pendientes));
      expect(total, `rol ${actor.rol}: el total es el del conjunto`).toBe(
        sinPaginar.pendientes.length,
      );
    }
  });

  it("CONTRAPRUEBA de R44: cada actor ve LO SUYO y nada del vecino", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarPendientesCierresAdminPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const delMaestro = await pagina(MAESTRO);
    expect(delMaestro).toEqual(["cp-5", "cp-4", "cp-3", "cp-2", "cp-1"]);
    expect(delMaestro.some((id) => id.startsWith("s"))).toBe(false);

    // El adminSatelite de la zona A ve SU cola: ni la central ni la de la zona B.
    const deA = await pagina(SATELITE_A);
    expect(deA).toEqual(["sa-2", "sa-1"]);

    // Y el de la zona B ve la suya. Sin este segundo lado, un servicio que devolviera siempre
    // vacio pasaria la mitad de arriba.
    const deB = await pagina(SATELITE_B);
    expect(deB).toEqual(["sb-2", "sb-1"]);

    expect(delMaestro.filter((id) => deA.includes(id) || deB.includes(id))).toEqual([]);
    expect(deA.filter((id) => deB.includes(id))).toEqual([]);
  });

  it("CONTRAPRUEBA de R44: el rol sin acceso recibe forbidden sin filas ni total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarPendientesCierresAdminPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const sinZona: Actor = { usuarioId: "u-sin-zona", rol: "adminSatelite" };

    const r = await servicio(repo).listarPendientesCierresAdminPaginado(input(), sinZona);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(llamadas).toEqual([]);
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarPendientesCierresAdminPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarCierresAdmin(MAESTRO);

    expect(r.status).toBe("ok");
    expect(sinPaginar.status).toBe("ok");
    if (r.status !== "ok" || sinPaginar.status !== "ok") return;

    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    // Y es EL MISMO orden que presenta hoy la pantalla, no solo "un orden".
    expect(ids(r.items)).toEqual(ids(sinPaginar.pendientes));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarCierresAdmin(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["findCierresByAlcance"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarPendientesCierresAdminPaginado(
      input({ pageSize: 2 }),
      MAESTRO,
    );
    expect(paginado.llamadas).toEqual(["findColaPaginada"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // La pagina y el total salen de la MISMA llamada.
    expect(paginado.findColaPaginada).toHaveBeenCalledTimes(1);
    await expect(paginado.findColaPaginada.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // El coste NO crece con el numero de filas devueltas (nada de N+1 por fila).
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarPendientesCierresAdminPaginado(
      input({ pageSize: 100 }),
      MAESTRO,
    );
    expect(grande.llamadas).toEqual(["findColaPaginada"]);

    // adminSatelite: la consulta EXTRA es la de su zona, la MISMA que ya hace el listado sin
    // paginar. Paginar no anade ninguna resolucion de alcance nueva.
    const zonaSinPaginar = { n: 0 };
    const sp = repoEnMemoria();
    await servicio(sp.repo, zonaSinPaginar).listarCierresAdmin(SATELITE_A);

    const zonaPaginado = { n: 0 };
    const pg = repoEnMemoria();
    await servicio(pg.repo, zonaPaginado).listarPendientesCierresAdminPaginado(
      input(),
      SATELITE_A,
    );

    expect(zonaPaginado.n).toBe(zonaSinPaginar.n);
    expect(pg.llamadas.length).toBe(sp.llamadas.length);
  });

  it("los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)", async () => {
    // MEDIDO al implementar: esta pantalla NO deriva ningun total de dinero del array de la
    // cola —los montos viajan por FILA como snapshot y el unico panel de totales que existe
    // vive dentro del modal de detalle de UN cierre—. Lo que R49 exige aqui, entonces, es que
    // el dinero del CONJUNTO siga siendo el mismo despues de paginar: ni una fila de mas
    // (duplicada entre paginas) ni una de menos (caida entre dos).
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const sinPaginar = await svc.listarCierresAdmin(MAESTRO);
    expect(sinPaginar.status).toBe("ok");
    if (sinPaginar.status !== "ok") return;

    const recorrido: CierreAdminResumen[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarPendientesCierresAdminPaginado(
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

    // Y una sola pagina NO llega a esos numeros: la desigualdad es la que da valor a la
    // igualdad de arriba. Los datos abarcan tres paginas a proposito.
    const p1 = await svc.listarPendientesCierresAdminPaginado(
      input({ page: 1, pageSize: 2 }),
      MAESTRO,
    );
    if (p1.status !== "ok") return;
    expect(suma(p1.items, "general")).toBe("900.00"); // 500 + 400
    expect(suma(p1.items, "general")).not.toBe(suma(recorrido, "general"));

    // Los montos por fila NO se recomputan al paginar: son el MISMO snapshot, string a string.
    const porId = new Map(sinPaginar.pendientes.map((c) => [c.cierreId, c]));
    for (const c of recorrido) {
      expect(c.totales, c.cierreId).toEqual(porId.get(c.cierreId)!.totales);
      expect(c.totalPagoMensajero, c.cierreId).toBe(porId.get(c.cierreId)!.totalPagoMensajero);
      expect(c.totalIngresoBodegaRechazos, c.cierreId).toBe(
        porId.get(c.cierreId)!.totalIngresoBodegaRechazos,
      );
    }
  });
});
