import { describe, it, expect, vi } from "vitest";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

// Feature 34 — service de la asignacion satelite. Dobles de repo (sin DB/HTTP),
// patron recepcion-satelite-service.test.ts. Cubre R3, R7, R8, R9, R10, R11, R12,
// R13, R14.

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO_ACTOR: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA = "z-satelite";
const MENSAJERO = "m-zona";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_bodega_satelite: "os-bodega-satelite",
  en_espera_aceptacion: "os-espera",
};

type RepoMethods = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajeroIdsValidosByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "asignarSateliteLote"
  | "existeBodegaSateliteBloqueada" // feature 41/R18
  | "findMensajerosBloqueados" // feature 41/R14
  | "findParaAsignabilidad" // feature 92/R8
>;

function transicionRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "store-1",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findMensajeroIdsValidosByZona: vi.fn(async () => new Set([MENSAJERO])),
    findByIdsForTransicion: vi.fn(async () => [transicionRow()]),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    asignarSateliteLote: vi.fn(async () => 1),
    // Feature 41: por defecto bodega libre y mensajero no bloqueado (los tests de
    // bloqueo overridean estos dobles).
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    // Feature 92 (R8): filas que consume el gate de coordenadas.
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: 9.9, longitud: -84.1, geocodeStatus: "OK" })),
    ),
    ...overrides,
  };
}

/**
 * Feature 92 (R8): el gate de asignabilidad es una dep REQUERIDA del service. Estos tests
 * no lo ejercitan (eso vive en `asignacion-satelite-gate-coordenadas.test.ts`), asi que se
 * inyecta un doble que declara TODA orden asignable — que es el estado real de una orden ya
 * geocodificada. Es el escenario feliz, no un aflojamiento: el gate tiene su test propio.
 */
function gateTodoAsignable(): IAsignabilidadCoordenadasService {
  return {
    evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
  };
}

function newService(
  repo: RepoMethods = fakeRepo(),
  gate: IAsignabilidadCoordenadasService = gateTodoAsignable(),
) {
  return new AsignacionSateliteService(repo as unknown as IOrdenRepository, gate);
}

describe("AsignacionSateliteService.asignar", () => {
  it("R13: rol != adminSatelite -> forbidden ANTES de tocar datos", async () => {
    const repo = fakeRepo();
    for (const actor of [MAESTRO, MENSAJERO_ACTOR]) {
      const res = await newService(repo).asignar(
        { ordenIds: ["o1"], mensajeroId: MENSAJERO },
        actor,
      );
      expect(res).toEqual({ status: "forbidden" });
    }
    // Sin efectos ni lecturas: la autorizacion corta antes de resolver la zona.
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R3: adminSatelite sin zona (zonaId null) -> sin_zona, sin escribir", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({ status: "sin_zona" });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R9: mensajero de otra zona / no-mensajero -> validation_error mensajero_invalido, sin escribir", async () => {
    const repo = fakeRepo({ findMensajeroIdsValidosByZona: vi.fn(async () => new Set<string>()) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: "m-ajeno" },
      ADMIN,
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { mensajeroId: ["mensajero_invalido"] },
    });
    // Valida el mensajero contra la zona del actor (defensa en profundidad R5/R9).
    expect(repo.findMensajeroIdsValidosByZona).toHaveBeenCalledWith(["m-ajeno"], ZONA);
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R7/R8: lote OK -> ok, todas en_espera_aceptacion; escribe con mensajero y NO toca num_guia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2" }),
      ]),
      asignarSateliteLote: vi.fn(async () => 2),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "en_espera_aceptacion" },
        { ordenId: "o2", estado: "en_espera_aceptacion" },
      ],
    });
    // R8: escribe con estatus origen/destino resueltos, sin num_guia.
    // Feature 49/#7: pasa ademas el contexto de historial (actor = adminSatelite).
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o1", "o2"],
      MENSAJERO,
      ZONA,
      "os-espera",
      "os-bodega-satelite",
      { actorUsuarioId: "as1", origenTipo: "asignacion_satelite" },
    );
  });

  it("R10/R11: orden de otra zona en el lote -> conflict/zona_ajena; ninguna transiciona", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", zonaId: "z-otra" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: "zona_ajena" }],
    });
    // R10 (todo-o-nada): no escribe si hay cualquier motivo.
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R10/R12: orden en estado != en_bodega_satelite -> conflict/estado_invalido con el estado actual", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1", estatusValue: "en_espera_aceptacion" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado_invalido: en_espera_aceptacion" }],
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R10: orden inexistente o borrada -> conflict/no_encontrada", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1", deletedAt: new Date("2026-01-01") }),
        // o2 no existe (ausente del resultado)
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [
        { ordenId: "o1", motivo: "no_encontrada" },
        { ordenId: "o2", motivo: "no_encontrada" },
      ],
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("catalogo de estados incompleto -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R14: carrera (write count incompleto) -> conflict re-leido, sin efectos parciales", async () => {
    const findByIds = vi
      .fn()
      // 1a lectura: ambas validas.
      .mockResolvedValueOnce([transicionRow({ id: "o1" }), transicionRow({ id: "o2" })])
      // re-lectura tras el count incompleto: o2 ya se movio (carrera).
      .mockResolvedValueOnce([
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", estatusValue: "en_espera_aceptacion" }),
      ]);
    const repo = fakeRepo({
      findByIdsForTransicion: findByIds,
      asignarSateliteLote: vi.fn(async () => 1), // solo 1 de 2 transiciono
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: "conflict" }],
    });
    // Re-lee para armar el detalle de la carrera.
    expect(findByIds).toHaveBeenCalledTimes(2);
  });
});

describe("AsignacionSateliteService.asignar — bloqueo por reprogramacion (feature 46/R1/R3/R5)", () => {
  it("R3: orden reprogramada en el lote -> conflict con motivo tipado, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", estatusValue: "reprogramada" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }],
    });
    // R5/R3: todo-o-nada, no escribe.
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});

describe("AsignacionSateliteService.asignar — bloqueo (feature 41/R14/R18)", () => {
  it("R18 (i): bodega bloqueada por cierres de sus mensajeros -> bodega_bloqueada, sin escribir", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: false },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
    // R18: aborta ANTES de validar mensajero/ordenes.
    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
  });

  it("R18 (ii): bodega bloqueada por su propio CierreBodega pendiente -> bodega_bloqueada", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: false,
        porCierreBodega: true,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: false, porCierreBodega: true },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R18: bloqueada por AMBAS causas -> los dos flags viajan", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: true,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: true },
    });
  });

  it("R14: mensajero destino bloqueado por cierre pendiente -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({
      // bodega libre, pero el mensajero elegido esta bloqueado.
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set([MENSAJERO])),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { mensajeroId: ["mensajero_bloqueado_por_cierre"] },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("camino feliz sin bloqueo -> ok (los dobles por defecto no bloquean)", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res.status).toBe("ok");
    expect(repo.existeBodegaSateliteBloqueada).toHaveBeenCalledWith(ZONA);
  });
});
