import { describe, it, expect, vi } from "vitest";
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
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { listarHistoricoIncidentesSchema } from "@/lib/types/incidente";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Incidentes: historico» paginado.
//
// El alcance se resuelve por rol+zona DE LA ORDEN: el acceso total lo ve todo, el
// `adminSatelite` solo su zona. El almacen tiene incidentes de DOS zonas para que un
// acotamiento roto tenga de verdad algo que filtrar, y las dos se comprueban en los dos
// sentidos (nadie ve lo ajeno, y cada uno SI ve lo suyo).

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
  estado: IncidenteAdminRow["estado"] = "aprobado",
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
    indemnizacion: estado === "aprobado" ? "100.00" : null,
    reportadoPor: "u-otro",
    reportadoPorNombre: "Otro",
    resueltoPor: estado === "solicitado" ? null : "u-maestro",
    resueltoPorNombre: estado === "solicitado" ? null : "Maestro",
    resueltoAt: estado === "solicitado" ? null : `2026-05-${String(dia).padStart(2, "0")}T12:00:00.000Z`,
    motivoRechazo: null,
    createdAt: `2026-05-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    evidenciaStoragePaths: [`${incidenteId}/ev-0.jpg`],
  };
}

const ALMACEN: IncidenteAdminRow[] = [
  fila("i-a1", "z-a", 1),
  fila("i-a2", "z-a", 2, "rechazado"),
  fila("i-a3", "z-a", 3, "solicitado"), // cola
  fila("i-a4", "z-a", 4),
  fila("i-b1", "z-b", 11),
  fila("i-b2", "z-b", 12, "rechazado"),
  fila("i-b3", "z-b", 13, "solicitado"), // cola
];

function casaAlcance(row: IncidenteAdminRow, alcance: AlcanceIncidente): boolean {
  return alcance.zonaId === null || row.zonaId === alcance.zonaId;
}

function esHistorico(row: IncidenteAdminRow): boolean {
  return !(ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
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

  const findHistoricoPaginado = vi.fn(async (alcance: AlcanceIncidente, rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = filas
      .filter((f) => casaAlcance(f, alcance) && esHistorico(f))
      .sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findByAlcance,
    findHistoricoPaginado,
    findByIdEnAlcance: vi.fn(async () => null),
    reportar: vi.fn(async () => ({ status: "ok" as const, incidenteId: "i-nuevo" })),
    resolver: vi.fn(async () => "updated" as const),
  } as unknown as IIncidenteAdminRepository;

  return { repo, llamadas, findHistoricoPaginado };
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
  return listarHistoricoIncidentesSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ incidenteId: string }>): string[] {
  return items.map((i) => i.incidenteId);
}

describe("IncidenteAdminService.listarHistoricoIncidentesPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarHistoricoIncidentesPaginado(input({ page: 1, pageSize: 2 }), MAESTRO);
    const p2 = await svc.listarHistoricoIncidentesPaginado(input({ page: 2, pageSize: 2 }), MAESTRO);
    const p3 = await svc.listarHistoricoIncidentesPaginado(input({ page: 3, pageSize: 2 }), MAESTRO);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["i-b2", "i-b1"]);
    expect(ids(p2.items)).toEqual(["i-a4", "i-a2"]);
    expect(ids(p3.items)).toEqual(["i-a1"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarHistoricoIncidentesPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // incidentesConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN, SAT_A, SAT_B]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarIncidentes(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarHistoricoIncidentesPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `usuario ${actor.usuarioId}`).toEqual(ids(sinPaginar.historico));
      expect(total, `usuario ${actor.usuarioId}`).toBe(sinPaginar.historico.length);
    }
  });

  it("CONTRAPRUEBA de R44: cada zona ve la SUYA, el acceso total las ve todas", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarHistoricoIncidentesPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const deA = await pagina(SAT_A);
    const deB = await pagina(SAT_B);
    const delMaestro = await pagina(MAESTRO);

    expect(deA).toEqual(["i-a4", "i-a2", "i-a1"]);
    expect(deB).toEqual(["i-b2", "i-b1"]);
    // Ninguno ve lo del otro...
    expect(deA.some((id) => id.startsWith("i-b"))).toBe(false);
    expect(deB.some((id) => id.startsWith("i-a"))).toBe(false);
    // ...y el acceso total SI ve la union de los dos. Sin este lado, un servicio que devolviera
    // siempre vacio pasaria las dos comprobaciones de arriba.
    expect(delMaestro.sort()).toEqual([...deA, ...deB].sort());
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas, sin total y sin tocar el storage", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const firmas = { n: 0, paths: [] as string[] };
      const r = await servicio(repo, firmas).listarHistoricoIncidentesPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
      // Ni una URL firmada: una evidencia firmada es un dato que sale del bucket privado.
      expect(firmas.n, `rol ${actor.rol}`).toBe(0);
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia, sin base ni storage (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const firmas = { n: 0, paths: [] as string[] };
    const r = await servicio(repo, firmas).listarHistoricoIncidentesPaginado(input(), {
      usuarioId: "u-sat-sin",
      rol: "adminSatelite",
    });

    if (r.status !== "ok") throw new Error("no ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(llamadas).toEqual([]);
    expect(firmas.n).toBe(0);
  });

  it("conserva el criterio de ordenacion actual: createdAt descendente (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarHistoricoIncidentesPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarIncidentes(MAESTRO);

    if (r.status !== "ok" || sinPaginar.status !== "ok") throw new Error("no ok");
    const fechas = r.items.map((i) => i.createdAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.historico));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    const firmasSinPaginar = { n: 0, paths: [] as string[] };
    await servicio(sinPaginar.repo, firmasSinPaginar).listarIncidentes(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["findByAlcance"]);

    const paginado = repoEnMemoria();
    const firmasPaginado = { n: 0, paths: [] as string[] };
    await servicio(paginado.repo, firmasPaginado).listarHistoricoIncidentesPaginado(
      input({ pageSize: 2 }),
      MAESTRO,
    );

    expect(paginado.llamadas).toEqual(["findHistoricoPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);
    await expect(paginado.findHistoricoPaginado.mock.results[0]!.value).resolves.toMatchObject({
      total: 5,
    });

    // R46: UNA sola llamada al storage, como el listado sin paginar — pero con los paths de la
    // PAGINA, no los de un historico que crece sin techo.
    expect(firmasPaginado.n).toBe(1);
    expect(firmasPaginado.paths).toHaveLength(2);
    expect(firmasSinPaginar.paths.length).toBeGreaterThan(firmasPaginado.paths.length);

    // El coste no crece con el numero de filas de la pagina: sigue siendo 1 consulta + 1 firma.
    const grande = repoEnMemoria();
    const firmasGrande = { n: 0, paths: [] as string[] };
    await servicio(grande.repo, firmasGrande).listarHistoricoIncidentesPaginado(
      input({ pageSize: 100 }),
      MAESTRO,
    );
    expect(grande.llamadas).toEqual(["findHistoricoPaginado"]);
    expect(firmasGrande.n).toBe(1);
  });

  it("las evidencias de la pagina salen FIRMADAS, nunca como storage_path (R46)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarHistoricoIncidentesPaginado(
      input({ pageSize: 2 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.items.map((i) => i.evidenciaUrls)).toEqual([
      ["https://firmada/i-b2/ev-0.jpg"],
      ["https://firmada/i-b1/ev-0.jpg"],
    ]);
    expect(JSON.stringify(r.items)).not.toContain("evidenciaStoragePaths");
  });
});
