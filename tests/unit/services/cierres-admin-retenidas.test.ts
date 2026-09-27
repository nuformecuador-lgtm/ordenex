import { describe, it, expect, vi } from "vitest";

import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { conRetenidas, sinRetenidas, type RetenidasDoble } from "@/tests/fixtures/retenidas-doble";

// FICHA 462 (T2.9, S3, R26/R27/R28/R30/R51) — LA MARCA «Retiene N reprogramadas de hoy» EN LAS
// FILAS DE `/cierres-admin`, con dobles.
//
// Cuatro cosas se afirman aqui, y las cuatro CONTANDO, no leyendo:
//   1. los TRES caminos (cola paginada, historico paginado, detalle) y el listado sin paginar traen
//      `reprogramadasRetenidasHoy` poblado;
//   2. el numero de llamadas al conteo por listado es UNA, con los ids de la pagina, sea de 1 o de
//      50 filas (R26/R51; mutacion 12 del design: una por fila => N llamadas => ROJO);
//   3. un cierre `aprobado` sale con `0` (R28) y el que no retiene tambien (R27);
//   4. el ALCANCE no cambia: el satelite sigue pidiendo su zona y el central el suyo; el conteo NO
//      participa en el `where` (R30).
// El `hoy` con el que se cuenta es `startOfDayCR(now())`, en la convencion `@db.Date`.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };
const SATELITE: Actor = { usuarioId: "sat", rol: "adminSatelite", zonaId: "z-sat" };
/** 07:00 CR del 25/09/2026 = 13:00Z. */
const AHORA = new Date("2026-09-25T13:00:00.000Z");

const CERO = { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" };

function row(over: Partial<CierreAdminResumenRow> & { cierreId: string }): CierreAdminResumenRow {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: CERO,
    totalPagoMensajero: "50000.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-09-24T22:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function fakeRepo(overrides: Partial<ICierresAdminRepository> = {}): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findHistoricoPaginado: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findColaCompleta: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [], mensajerosFiltro: [] })),
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    corregirResultadoGestionEnCierre: vi.fn(async () => ({ status: "conflict" as const })),
    ...overrides,
  } as unknown as ICierresAdminRepository;
}

function newService(repo: ICierresAdminRepository, retenidas: RetenidasDoble = sinRetenidas()) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  const signedUrls = { createSignedUrls: vi.fn(async () => ({})) } as unknown as ISignedUrlProvider;
  const liquidacion = {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "0.00"]))),
    obtenerCierreParaPago: vi.fn(async () => null),
  };
  const premios = {
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "0.00"]))),
  };
  const service = new CierresAdminService(
    repo,
    zonaRepo,
    ordenRepo,
    signedUrls,
    liquidacion,
    premios,
    retenidas,
    undefined,
    undefined,
    undefined,
    () => AHORA,
  );
  return { service, retenidas, repo };
}

const pagina = { page: 1, pageSize: 50 };

describe("462/R26/R51 — UNA lectura del conteo por pagina, con los ids de la pagina", () => {
  it("⭑ la COLA paginada con 3 filas: `contarPorCierre` UNA vez, con los 3 ids (mutacion 12: por fila => 3 llamadas => ROJO)", async () => {
    const filas = [row({ cierreId: "c1" }), row({ cierreId: "c2", estado: "vencido" }), row({ cierreId: "c3" })];
    const { service, retenidas } = newService(
      fakeRepo({ findColaPaginada: vi.fn(async () => ({ items: filas, total: 3 })) }),
      conRetenidas({ c1: 2, c3: 1 }),
    );

    const r = await service.listarPendientesCierresAdminPaginado(pagina, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(retenidas.contarPorCierre).toHaveBeenCalledTimes(1);
    expect(retenidas.contarPorCierre.mock.calls[0][1]).toEqual(["c1", "c2", "c3"]);
    expect(r.items.map((i) => [i.cierreId, i.reprogramadasRetenidasHoy])).toEqual([
      ["c1", 2],
      ["c2", 0], // R27: no retiene -> 0, y la pantalla no pinta nada
      ["c3", 1],
    ]);
  });

  it("el HISTORICO paginado: UNA llamada, campo poblado, y el `rechazado` puede retener (R28/R41)", async () => {
    const filas = [
      row({ cierreId: "h1", estado: "aprobado", resueltoAt: "2026-09-25T01:00:00.000Z" }),
      row({ cierreId: "h2", estado: "rechazado", resueltoAt: "2026-09-25T02:00:00.000Z", motivoRechazo: "no cuadra" }),
    ];
    const { service, retenidas } = newService(
      fakeRepo({ findHistoricoPaginado: vi.fn(async () => ({ items: filas, total: 2 })) }),
      conRetenidas({ h2: 3 }),
    );

    const r = await service.listarHistoricoCierresAdminPaginado(pagina, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(retenidas.contarPorCierre).toHaveBeenCalledTimes(1);
    expect(retenidas.contarPorCierre.mock.calls[0][1]).toEqual(["h1", "h2"]);
    expect(r.items.find((i) => i.cierreId === "h1")?.reprogramadasRetenidasHoy).toBe(0);
    expect(r.items.find((i) => i.cierreId === "h2")?.reprogramadasRetenidasHoy).toBe(3);
  });

  it("el listado SIN paginar (la pagina de la cola): UNA llamada para cola + historico juntos", async () => {
    const filas = [row({ cierreId: "a" }), row({ cierreId: "b", estado: "aprobado", resueltoAt: "2026-09-25T01:00:00.000Z" })];
    const { service, retenidas } = newService(
      fakeRepo({ findCierresByAlcance: vi.fn(async () => filas) }),
      conRetenidas({ a: 4 }),
    );

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(retenidas.contarPorCierre).toHaveBeenCalledTimes(1);
    expect(r.pendientes[0]?.reprogramadasRetenidasHoy).toBe(4);
    expect(r.historico[0]?.reprogramadasRetenidasHoy).toBe(0);
  });

  it("el DETALLE: la cabecera trae la marca, con UNA llamada y el id del cierre", async () => {
    const cierre = row({ cierreId: "d1", estado: "vencido" });
    const { service, retenidas } = newService(
      fakeRepo({
        findCierreByIdEnAlcance: vi.fn(async () => ({
          cierre,
          gestiones: [],
          sinGestion: [],
          sinGestionRegistrado: true,
          rechazosDeTienda: [],
        })) as never,
      }),
      conRetenidas({ d1: 2 }),
    );

    const r = await service.verCierreDetalle("d1", MAESTRO);

    if (r.status !== "ok") throw new Error(`esperaba ok, vino ${r.status}`);
    expect(retenidas.contarPorCierre).toHaveBeenCalledTimes(1);
    expect(retenidas.contarPorCierre.mock.calls[0][1]).toEqual(["d1"]);
    expect(r.cierre.reprogramadasRetenidasHoy).toBe(2);
  });

  it("con una pagina VACIA se llama igual (con `[]`): el numero de consultas no depende de lo que se pinte", async () => {
    const { service, retenidas } = newService(fakeRepo());
    const r = await service.listarPendientesCierresAdminPaginado(pagina, MAESTRO);
    expect(r.status).toBe("ok");
    expect(retenidas.contarPorCierre).toHaveBeenCalledTimes(1);
    expect(retenidas.contarPorCierre.mock.calls[0][1]).toEqual([]);
  });
});

describe("462/R28 — un cierre `aprobado` sale SIEMPRE con 0, aunque el conteo dijera otra cosa", () => {
  it("el servicio no lo decide: el conteo no puede devolver un aprobado; pero si lo hiciera, la fila lo enseñaria — por eso el conteo lo excluye antes", async () => {
    // Anti-vacuidad del contrato: con el doble VACIO (lo que devuelve el conteo real para un
    // aprobado), el campo es `0` y no `undefined` ni `null`.
    const filas = [row({ cierreId: "ap", estado: "aprobado", resueltoAt: "2026-09-25T01:00:00.000Z" })];
    const { service } = newService(fakeRepo({ findColaPaginada: vi.fn(async () => ({ items: filas, total: 1 })) }));
    const r = await service.listarPendientesCierresAdminPaginado(pagina, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items[0].reprogramadasRetenidasHoy).toBe(0);
    expect(r.items[0].pendientePagoMensajero).toBe("50000.00"); // lo de la 172 sigue intacto
  });
});

describe("462/R30 — el alcance no cambia: el conteo NO entra en el `where` ni amplia ni recorta", () => {
  it("el adminSatelite sigue pidiendo SU zona al repositorio, y el conteo recibe los ids de ESA pagina", async () => {
    const filas = [row({ cierreId: "s1", destinoTipo: "bodega_satelite", destinoZonaId: "z-sat", destinoZonaNombre: "Sat" })];
    const findColaPaginada = vi.fn<ICierresAdminRepository["findColaPaginada"]>(async () => ({ items: filas, total: 1 }));
    const { service, retenidas } = newService(fakeRepo({ findColaPaginada }), conRetenidas({ s1: 1, ajeno: 9 }));

    const r = await service.listarPendientesCierresAdminPaginado(pagina, SATELITE);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(findColaPaginada.mock.calls[0][0]).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" });
    expect(retenidas.contarPorCierre.mock.calls[0][1]).toEqual(["s1"]);
    expect(r.items[0].reprogramadasRetenidasHoy).toBe(1);
  });

  it("el acceso total sigue pidiendo `bodega_central` sin zona", async () => {
    const findColaPaginada = vi.fn<ICierresAdminRepository["findColaPaginada"]>(async () => ({
      items: [row({ cierreId: "c1" })],
      total: 1,
    }));
    const { service } = newService(fakeRepo({ findColaPaginada }));
    await service.listarPendientesCierresAdminPaginado(pagina, MAESTRO);
    expect(findColaPaginada.mock.calls[0][0]).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
  });

  it("un adminSatelite SIN zona no consulta nada: ni el repo ni el conteo", async () => {
    const { service, retenidas } = newService(fakeRepo());
    (service as unknown as { ordenRepo: { findUsuarioZonaId: ReturnType<typeof vi.fn> } }).ordenRepo.findUsuarioZonaId = vi.fn(async () => null);
    const r = await service.listarPendientesCierresAdminPaginado(pagina, SATELITE);
    expect(r).toEqual({ status: "ok", items: [], page: 1, pageSize: 50, total: 0 });
    expect(retenidas.contarPorCierre).not.toHaveBeenCalled();
  });
});

describe("462 — el «hoy» del conteo es el del reloj del servicio, en convencion @db.Date", () => {
  it("con el reloj a las 07:00 CR del 25/09, el conteo recibe la medianoche UTC del 25/09", async () => {
    const { service, retenidas } = newService(fakeRepo({ findColaPaginada: vi.fn(async () => ({ items: [row({ cierreId: "c1" })], total: 1 })) }));
    await service.listarPendientesCierresAdminPaginado(pagina, MAESTRO);
    expect(retenidas.contarPorCierre.mock.calls[0][0].toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });
});
