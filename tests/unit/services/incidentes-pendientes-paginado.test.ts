import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import type {
  AlcanceIncidente,
  IIncidenteAdminRepository,
  IncidenteAdminRow,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { listarPendientesIncidentesSchema } from "@/lib/types/incidente";

// Feature 170 — FASE 2, T J.1 (R40/R41/R44/R49/R51/R54) — «Incidentes pendientes de decision»,
// la COLA paginada.
//
// Es la otra mitad de la particion que T I.1 pagino por el lado del historico. El alcance se
// resuelve por rol + zona DE LA ORDEN, y el almacen tiene incidentes de DOS zonas para que un
// acotamiento roto tenga de verdad algo que filtrar; las dos se comprueban en los dos sentidos.
//
// Ojo con `esPropio` (feature 158/R51, «quien reporta no aprueba»): lo decide el SERVIDOR con
// el actor de la peticion. Paginar no puede cambiar quien puede resolver que, y por eso se
// afirma en la pagina, no solo en el listado entero.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  incidenteId: string,
  zonaId: string,
  dia: number,
  estado: IncidenteAdminRow["estado"],
  extra: { indemnizacion?: string | null; reportadoPor?: string } = {},
): IncidenteAdminRow {
  return {
    incidenteId,
    ordenId: `o-${incidenteId}`,
    numGuia: dia,
    numRemision: `REM-${incidenteId}`,
    destinatario: "Ana",
    zonaId,
    zonaNombre: `Zona ${zonaId}`,
    estatusValue: "incidente",
    causa: "robado",
    motivo: "motivo",
    estado,
    indemnizacion: extra.indemnizacion ?? (estado === "aprobado" ? "100.00" : null),
    reportadoPor: extra.reportadoPor ?? "u-otro",
    reportadoPorNombre: "Otro",
    resueltoPor: estado === "solicitado" ? null : "u-maestro",
    resueltoPorNombre: estado === "solicitado" ? null : "Maestro",
    resueltoAt:
      estado === "solicitado" ? null : `2026-05-${String(dia).padStart(2, "0")}T12:00:00.000Z`,
    motivoRechazo: null,
    createdAt: `2026-05-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    evidenciaStoragePaths: [`${incidenteId}/ev-0.jpg`],
  };
}

/**
 * Cinco en la cola de la zona A —uno reportado por el propio maestro, para poder afirmar
 * `esPropio`— y tres resueltos que NO deben aparecer, mas la zona B con su cola propia.
 */
const ALMACEN: IncidenteAdminRow[] = [
  fila("i-a1", "z-a", 1, "solicitado"),
  fila("i-a2", "z-a", 2, "solicitado"),
  fila("i-a3", "z-a", 3, "solicitado", { reportadoPor: "u-maestro" }),
  fila("i-a4", "z-a", 4, "solicitado"),
  fila("i-a5", "z-a", 5, "solicitado"),
  fila("i-a6", "z-a", 6, "aprobado", { indemnizacion: "999.00" }), // historico
  fila("i-a7", "z-a", 7, "rechazado"), // historico
  fila("i-b1", "z-b", 11, "solicitado"),
  fila("i-b2", "z-b", 12, "solicitado"),
  fila("i-b3", "z-b", 13, "aprobado", { indemnizacion: "888.00" }), // historico
];

function casaAlcance(row: IncidenteAdminRow, alcance: AlcanceIncidente): boolean {
  return alcance.zonaId === null || row.zonaId === alcance.zonaId;
}

function esCola(row: IncidenteAdminRow): boolean {
  return (ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
}

/** `createdAt` descendente: el criterio que el listado presenta hoy (R51). */
function porCreadoDesc(a: IncidenteAdminRow, b: IncidenteAdminRow): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function repoEnMemoria(filas: IncidenteAdminRow[] = ALMACEN) {
  const llamadas: string[] = [];

  const findByAlcance = vi.fn(async (alcance: AlcanceIncidente) => {
    llamadas.push("findByAlcance");
    return filas.filter((f) => casaAlcance(f, alcance)).sort(porCreadoDesc);
  });

  const findColaPaginada = vi.fn(async (alcance: AlcanceIncidente, rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = filas.filter((f) => casaAlcance(f, alcance) && esCola(f)).sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findByAlcance,
    findColaPaginada,
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findByIdEnAlcance: vi.fn(async () => null),
    reportar: vi.fn(async () => ({ status: "ok" as const, incidenteId: "i-nuevo" })),
    resolver: vi.fn(async () => "updated" as const),
  } as unknown as IIncidenteAdminRepository;

  return { repo, llamadas, findColaPaginada };
}

function servicio(repo: IIncidenteAdminRepository, firmas?: { n: number; paths: string[] }) {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => ZONA_POR_USUARIO[usuarioId] ?? null),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  const historialRepo = {
    findOrigenesReversion: vi.fn(async () => []),
  } as unknown as IOrdenHistorialRepository;
  const storage = { subir: vi.fn(), remove: vi.fn() } as unknown as IFileStorage;
  const signedUrls = {
    createSignedUrls: vi.fn(async (paths: string[]) => {
      if (firmas) {
        firmas.n += 1;
        firmas.paths.push(...paths);
      }
      return Object.fromEntries(paths.map((p) => [p, `https://firmada/${p}`]));
    }),
  } as unknown as ISignedUrlProvider;
  return new IncidenteAdminService(repo, ordenRepo, historialRepo, storage, signedUrls);
}

function input(extra: Record<string, unknown> = {}) {
  return listarPendientesIncidentesSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ incidenteId: string }>): string[] {
  return items.map((i) => i.incidenteId);
}

/** Suma money-safe (Prisma.Decimal, como produccion) de las indemnizaciones ya escritas. */
function sumaIndemnizaciones(items: ReadonlyArray<IncidenteAdminDTO>): string {
  let acc = new Prisma.Decimal(0);
  for (const i of items) {
    if (i.indemnizacion !== null) acc = acc.plus(i.indemnizacion);
  }
  return acc.toFixed(2);
}

describe("IncidenteAdminService.listarPendientesIncidentesPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarPendientesIncidentesPaginado(input({ page: 1, pageSize: 3 }), SAT_A);
    const p2 = await svc.listarPendientesIncidentesPaginado(input({ page: 2, pageSize: 3 }), SAT_A);

    expect(p1.status).toBe("ok");
    expect(p2.status).toBe("ok");
    if (p1.status !== "ok" || p2.status !== "ok") return;

    // La cola de la zona A son 5 (los dos resueltos quedan fuera), mas reciente primero.
    expect(ids(p1.items)).toEqual(["i-a5", "i-a4", "i-a3"]);
    expect(ids(p2.items)).toEqual(["i-a2", "i-a1"]);

    for (const [i, p] of [p1, p2].entries()) {
      expect(p.total, `pagina ${i + 1}`).toBe(5);
      expect(p.pageSize, `pagina ${i + 1}`).toBe(3);
      expect(p.page, `pagina ${i + 1}`).toBe(i + 1);
    }
    // La ultima pagina es la que hace visible la mentira de contar el array.
    expect(p2.items).toHaveLength(2);
    expect(p2.total).not.toBe(p2.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarPendientesIncidentesPaginado(input({ pageSize: 100000 }), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pageSize).toBe(100); // incidentesConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN, SAT_A, SAT_B]) {
      const { repo } = repoEnMemoria();
      const svc = servicio(repo);

      const sinPaginar = await svc.listarIncidentes(actor);
      expect(sinPaginar.status, `rol ${actor.rol}`).toBe("ok");
      if (sinPaginar.status !== "ok") return;

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarPendientesIncidentesPaginado(input({ page, pageSize: 2 }), actor);
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

  it("CONTRAPRUEBA de R44: cada zona ve la SUYA, el acceso total las ve todas", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarPendientesIncidentesPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const deA = await pagina(SAT_A);
    const deB = await pagina(SAT_B);
    const delMaestro = await pagina(MAESTRO);

    expect(deA).toEqual(["i-a5", "i-a4", "i-a3", "i-a2", "i-a1"]);
    // Sin este segundo lado, un servicio que devolviera siempre vacio pasaria la mitad de
    // arriba: el de la zona B tiene que ver LO SUYO.
    expect(deB).toEqual(["i-b2", "i-b1"]);
    expect(deA.filter((id) => deB.includes(id))).toEqual([]);
    // El acceso total ve la union de las dos, y nada mas (ni un resuelto).
    expect([...delMaestro].sort()).toEqual([...deA, ...deB].sort());
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas, sin total y sin tocar el storage", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const firmas = { n: 0, paths: [] as string[] };
      const r = await servicio(repo, firmas).listarPendientesIncidentesPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
      expect(firmas.n, `rol ${actor.rol}`).toBe(0); // ni una URL firmada de evidencia ajena
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia, sin base ni storage (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const firmas = { n: 0, paths: [] as string[] };
    const sinZona: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

    const r = await servicio(repo, firmas).listarPendientesIncidentesPaginado(input(), sinZona);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(llamadas).toEqual([]);
    expect(firmas.n).toBe(0);
  });

  it("conserva el criterio de ordenacion actual: createdAt descendente (R51)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarPendientesIncidentesPaginado(input({ pageSize: 50 }), SAT_A);
    const sinPaginar = await svc.listarIncidentes(SAT_A);

    expect(r.status).toBe("ok");
    expect(sinPaginar.status).toBe("ok");
    if (r.status !== "ok" || sinPaginar.status !== "ok") return;

    const fechas = r.items.map((i) => i.createdAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.pendientes));

    // R51 tambien alcanza a lo que cada fila DICE: `esPropio` (158/R51, quien reporta no
    // aprueba) lo decide el servidor con el actor de ESTA peticion, y paginar no lo mueve.
    const delMaestro = await svc.listarPendientesIncidentesPaginado(input({ pageSize: 50 }), MAESTRO);
    if (delMaestro.status !== "ok") return;
    expect(delMaestro.items.filter((i) => i.esPropio).map((i) => i.incidenteId)).toEqual(["i-a3"]);
    // Y para el adminSatelite ninguno es propio: el mismo incidente, otro actor.
    expect(r.items.some((i) => i.esPropio)).toBe(false);
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    const firmasSinPaginar = { n: 0, paths: [] as string[] };
    await servicio(sinPaginar.repo, firmasSinPaginar).listarIncidentes(SAT_A);
    expect(sinPaginar.llamadas).toEqual(["findByAlcance"]);

    const paginado = repoEnMemoria();
    const firmasPaginado = { n: 0, paths: [] as string[] };
    await servicio(paginado.repo, firmasPaginado).listarPendientesIncidentesPaginado(
      input({ pageSize: 2 }),
      SAT_A,
    );
    expect(paginado.llamadas).toEqual(["findColaPaginada"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // La pagina y el total salen de la MISMA llamada.
    expect(paginado.findColaPaginada).toHaveBeenCalledTimes(1);
    await expect(paginado.findColaPaginada.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // R46: UNA sola llamada al storage, como el listado sin paginar — pero con N acotado por
    // el tamano de pagina en vez de por el tamano de la cola.
    expect(firmasPaginado.n).toBe(1);
    expect(firmasPaginado.paths).toHaveLength(2);
    expect(firmasSinPaginar.paths.length).toBeGreaterThan(firmasPaginado.paths.length);
  });

  it("los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)", async () => {
    // MEDIDO al implementar: `IncidentesAdminModule` NO deriva ningun total del array de la
    // cola. El unico monto que pinta es `money(detalle.indemnizacion)` de UNA fila abierta, y
    // en la cola de pendientes ese monto ni siquiera existe todavia (se captura al aprobar).
    // Lo que R49 exige aqui es que el dinero del CONJUNTO no cambie al paginar.
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const sinPaginar = await svc.listarIncidentes(MAESTRO);
    expect(sinPaginar.status).toBe("ok");
    if (sinPaginar.status !== "ok") return;

    const recorrido: IncidenteAdminDTO[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarPendientesIncidentesPaginado(input({ page, pageSize: 2 }), MAESTRO);
      if (p.status !== "ok" || p.items.length === 0) break;
      recorrido.push(...p.items);
    }

    // La cola no tiene dinero escrito todavia: 7 incidentes `solicitado`, cero indemnizaciones.
    expect(recorrido).toHaveLength(7);
    expect(sumaIndemnizaciones(recorrido)).toBe("0.00");
    expect(sumaIndemnizaciones(recorrido)).toBe(sumaIndemnizaciones(sinPaginar.pendientes));
    expect(recorrido.every((i) => i.indemnizacion === null)).toBe(true);

    // Y el dinero que SI existe —el del historico, 999 + 888— no se cuela en esta cola por
    // paginar: si se colara, el `0.00` de arriba dejaria de ser cierto.
    expect(sumaIndemnizaciones(sinPaginar.historico)).toBe("1887.00");
    expect(ids(recorrido)).not.toContain("i-a6");
    expect(ids(recorrido)).not.toContain("i-b3");

    // El conjunto que recorre la paginacion es EXACTAMENTE el del listado sin paginar.
    expect(ids(recorrido)).toEqual(ids(sinPaginar.pendientes));
  });
});
