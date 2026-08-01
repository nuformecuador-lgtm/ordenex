import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type { ICierreDiaRepository } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarCierresPasadosSchema } from "@/lib/types/cierre";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Cierres solicitados» del mensajero.
//
// El alcance de este listado ES el propio usuario: el `mensajero_id` sale de la sesion y no
// hay parametro por el que pedir el historico de otro. El repositorio doble se toma eso en
// serio —guarda cierres de DOS mensajeros y filtra por el id que RECIBE—, que es lo unico que
// convierte «no se puede pedir» en algo comprobable.

const MENSAJERO_A: Actor = { usuarioId: "m-a", rol: "mensajero" };
const MENSAJERO_B: Actor = { usuarioId: "m-b", rol: "mensajero" };

/** Contraprueba por el lado del rechazo: este modulo es del mensajero y de nadie mas. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

interface FilaConDueno extends CierrePasadoDTO {
  mensajeroId: string;
}

function fila(
  cierreId: string,
  mensajeroId: string,
  dia: number,
  estado: CierrePasadoDTO["estado"] = "aprobado",
): FilaConDueno {
  return {
    mensajeroId,
    cierreId,
    estado,
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    totales: { efectivo: "80.00", simpe: "0.00", transferencia: "0.00", general: "80.00" },
    totalPagoMensajero: "8.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: `2026-04-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  };
}

/**
 * Este listado NO filtra por estado: el mensajero ve TODOS sus cierres, incluido el que tiene
 * `solicitado` o `vencido` (que es justo el que le esta bloqueando las guias). Por eso el
 * almacen los mezcla.
 */
const ALMACEN: FilaConDueno[] = [
  fila("a-1", "m-a", 1),
  fila("a-2", "m-a", 2, "rechazado"),
  fila("a-3", "m-a", 3, "vencido"),
  fila("a-4", "m-a", 4),
  fila("a-5", "m-a", 5, "solicitado"),
  fila("b-1", "m-b", 11),
  fila("b-2", "m-b", 12),
];

function sinDueno(f: FilaConDueno): CierrePasadoDTO {
  const { mensajeroId: _mensajeroId, ...dto } = f;
  return dto;
}

function porSolicitadoDesc(a: FilaConDueno, b: FilaConDueno): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

function repoEnMemoria(filas: FilaConDueno[] = ALMACEN) {
  const llamadas: string[] = [];

  const findCierresByMensajero = vi.fn(async (mensajeroId: string) => {
    llamadas.push("findCierresByMensajero");
    return filas.filter((f) => f.mensajeroId === mensajeroId).sort(porSolicitadoDesc).map(sinDueno);
  });

  const findCierresByMensajeroPaginado = vi.fn(async (mensajeroId: string, rango: RangoPagina) => {
    llamadas.push("findCierresByMensajeroPaginado");
    const conjunto = filas
      .filter((f) => f.mensajeroId === mensajeroId)
      .sort(porSolicitadoDesc)
      .map(sinDueno);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findCierresByMensajero,
    findCierresByMensajeroPaginado,
    findGestionesPendientes: vi.fn(async () => {
      llamadas.push("findGestionesPendientes");
      return [];
    }),
    contarOrdenesPendientesGestion: vi.fn(async () => {
      llamadas.push("contarOrdenesPendientesGestion");
      return 0;
    }),
    existeCierreSolicitado: vi.fn(async () => false),
    crearCierre: vi.fn(async () => "c-nuevo"),
    findGestionParaDeshacer: vi.fn(async () => null),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
  } as unknown as ICierreDiaRepository;

  return { repo, llamadas, findCierresByMensajeroPaginado };
}

function servicio(repo: ICierreDiaRepository, contarTarifa?: { n: number }) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => {
      if (contarTarifa) contarTarifa.n += 1;
      return "z-central";
    }),
    findUsuarioVehiculoId: vi.fn(async () => {
      if (contarTarifa) contarTarifa.n += 1;
      return null;
    }),
  } as unknown as IOrdenRepository;
  const signedUrls = { createSignedUrls: vi.fn(async () => ({})) } as unknown as ISignedUrlProvider;
  const tarifaRepo = {
    resolvePagoTarifa: vi.fn(async () => {
      if (contarTarifa) contarTarifa.n += 1;
      return null;
    }),
  } as unknown as ITarifaZonaMensajeroRepository;
  return new CierreDiaService(repo, zonaRepo, ordenRepo, signedUrls, tarifaRepo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresPasadosSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreId: string }>): string[] {
  return items.map((c) => c.cierreId);
}

describe("CierreDiaService.listarCierresPasadosPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarCierresPasadosPaginado(input({ page: 1, pageSize: 2 }), MENSAJERO_A);
    const p2 = await svc.listarCierresPasadosPaginado(input({ page: 2, pageSize: 2 }), MENSAJERO_A);
    const p3 = await svc.listarCierresPasadosPaginado(input({ page: 3, pageSize: 2 }), MENSAJERO_A);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["a-5", "a-4"]);
    expect(ids(p2.items)).toEqual(["a-3", "a-2"]);
    expect(ids(p3.items)).toEqual(["a-1"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO del mensajero
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarCierresPasadosPaginado(
      input({ pageSize: 100000 }),
      MENSAJERO_A,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // cierreConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MENSAJERO_A, MENSAJERO_B]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarCierreDia(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarCierresPasadosPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `mensajero ${actor.usuarioId}`).toEqual(ids(sinPaginar.cierresPasados));
      expect(total, `mensajero ${actor.usuarioId}`).toBe(sinPaginar.cierresPasados.length);
    }
  });

  it("CONTRAPRUEBA de R44: cada mensajero ve LOS SUYOS y ninguno del otro", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarCierresPasadosPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const deA = await pagina(MENSAJERO_A);
    const deB = await pagina(MENSAJERO_B);

    expect(deA).toEqual(["a-5", "a-4", "a-3", "a-2", "a-1"]);
    expect(deB).toEqual(["b-2", "b-1"]);
    expect(deA.some((id) => id.startsWith("b-"))).toBe(false);
    expect(deB.some((id) => id.startsWith("a-"))).toBe(false);
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea mensajero", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarCierresPasadosPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      expect(llamadas, `rol ${actor.rol}`).toEqual([]); // el guard va ANTES de la base
    }
  });

  it("conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarCierresPasadosPaginado(input({ pageSize: 50 }), MENSAJERO_A);
    const sinPaginar = await svc.listarCierreDia(MENSAJERO_A);

    if (r.status !== "ok" || sinPaginar.status !== "ok") throw new Error("no ok");
    const fechas = r.items.map((c) => c.solicitadoAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.cierresPasados));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    // Sin paginar, la pantalla del cierre del dia hace CUATRO lecturas; solo una es este
    // listado. La version paginada hace UNA, y el conteo viaja dentro de ella.
    const sinPaginar = repoEnMemoria();
    const tarifaSinPaginar = { n: 0 };
    await servicio(sinPaginar.repo, tarifaSinPaginar).listarCierreDia(MENSAJERO_A);
    expect(sinPaginar.llamadas).toContain("findCierresByMensajero");

    const paginado = repoEnMemoria();
    const tarifaPaginado = { n: 0 };
    await servicio(paginado.repo, tarifaPaginado).listarCierresPasadosPaginado(
      input({ pageSize: 2 }),
      MENSAJERO_A,
    );

    expect(paginado.llamadas).toEqual(["findCierresByMensajeroPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);
    await expect(paginado.findCierresByMensajeroPaginado.mock.results[0]!.value).resolves.toMatchObject(
      { total: 5 },
    );

    // Ni una resolucion de tarifa/zona: el historico no las necesita y no las pide.
    expect(tarifaPaginado.n).toBe(0);
    expect(tarifaSinPaginar.n).toBeGreaterThan(0);

    // El coste no crece con el numero de filas de la pagina.
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarCierresPasadosPaginado(input({ pageSize: 100 }), MENSAJERO_A);
    expect(grande.llamadas).toEqual(["findCierresByMensajeroPaginado"]);
  });
});
