import { describe, it, expect, vi } from "vitest";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 157 — RECOLECCION EN TIENDA por el mensajero (`por_recolectar_en_tienda` ->
// `en_ruta_bodega_central`, arista #43). Espejo de `recepcion-bodega-central-service.test.ts`
// con tres diferencias: el rol autorizado es `mensajero`, hay guardia de PROPIEDAD (R30) y hay
// guardia de BLOQUEO por cierre pendiente (R31). Cada guardia asegura ademas "sin efectos".
// Un caso por resultado de la maquina (design §4.1).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO_MENSAJERO: Actor = { usuarioId: "m2", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };

const NUM_GUIA = 4321;
const DESTINO_ID = "os-en-ruta-bodega-central";

type RepoMethods = Pick<
  IOrdenRepository,
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recolectarEnTienda"
  | "findMensajerosBloqueados"
>;

function transicionRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "recolectando",
    numGuia: NUM_GUIA,
    deletedAt: null,
    zonaId: "z-1",
    zonaEsGam: false,
    tiendaId: "store-9",
    mensajeroAsignadoId: MENSAJERO.usuarioId,
    ...overrides,
  };
}

/** Repo doble: por defecto la orden es del actor, esta en el origen y la escritura gana. */
function makeRepo(overrides: Partial<RepoMethods> = {}) {
  const repo: RepoMethods = {
    findByNumGuiaForTransicion: vi.fn().mockResolvedValue(transicionRow()),
    findEstatusIdByValue: vi.fn().mockResolvedValue(DESTINO_ID),
    recolectarEnTienda: vi.fn().mockResolvedValue(true),
    findMensajerosBloqueados: vi.fn().mockResolvedValue(new Set<string>()),
    ...overrides,
  };
  return { repo, service: new RecoleccionTiendaService(repo) };
}

describe("RecoleccionTiendaService — autorizacion y bloqueo (R29/R31)", () => {
  it.each([
    ["maestro", MAESTRO],
    ["adminTienda", ADMIN_TIENDA],
  ])("R29: %s NO recolecta (el acto fisico es del mensajero) y no lee la orden", async (_n, actor) => {
    const { repo, service } = makeRepo();

    const res = await service.recolectarEnTienda(NUM_GUIA, actor);

    expect(res).toEqual({ status: "forbidden" });
    expect(repo.findByNumGuiaForTransicion).not.toHaveBeenCalled();
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("R31: con un cierre pendiente NO recolecta, y ni siquiera llega a leer la orden", async () => {
    const { repo, service } = makeRepo({
      findMensajerosBloqueados: vi.fn().mockResolvedValue(new Set([MENSAJERO.usuarioId])),
    });

    const res = await service.recolectarEnTienda(NUM_GUIA, MENSAJERO);

    expect(res).toMatchObject({ status: "conflict" });
    expect(res).toHaveProperty("motivo", expect.stringMatching(/cierre pendiente/i));
    // El bloqueo va ANTES de leer: un mensajero bloqueado no averigua si la guia existe.
    expect(repo.findByNumGuiaForTransicion).not.toHaveBeenCalled();
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });
});

describe("RecoleccionTiendaService — opacidad de la orden ajena (R30)", () => {
  // Los tres casos comparten status A PROPOSITO: distinguirlos filtraria la existencia de una
  // orden que no es del actor a quien escanee una etiqueta suelta.
  it.each([
    ["inexistente", null],
    ["borrada", transicionRow({ deletedAt: new Date("2026-07-01T00:00:00Z") })],
    ["de otro mensajero", transicionRow({ mensajeroAsignadoId: OTRO_MENSAJERO.usuarioId })],
  ])("R30: orden %s -> no_encontrada, sin escritura", async (_n, row) => {
    const { repo, service } = makeRepo({
      findByNumGuiaForTransicion: vi.fn().mockResolvedValue(row),
    });

    const res = await service.recolectarEnTienda(NUM_GUIA, MENSAJERO);

    expect(res).toEqual({ status: "no_encontrada" });
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("R30: una orden SIN mensajero asignado tampoco es recolectable", async () => {
    const { repo, service } = makeRepo({
      findByNumGuiaForTransicion: vi
        .fn()
        .mockResolvedValue(transicionRow({ mensajeroAsignadoId: null })),
    });

    expect(await service.recolectarEnTienda(NUM_GUIA, MENSAJERO)).toEqual({
      status: "no_encontrada",
    });
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });
});

describe("RecoleccionTiendaService — estado de la orden (R32/R33)", () => {
  it("R32: ya recolectada -> idempotente, sin re-transicionar ni tocar el historial", async () => {
    const { repo, service } = makeRepo({
      findByNumGuiaForTransicion: vi
        .fn()
        .mockResolvedValue(transicionRow({ estatusValue: "en_ruta_bodega_central" })),
    });

    expect(await service.recolectarEnTienda(NUM_GUIA, MENSAJERO)).toEqual({
      status: "ya_recolectada",
    });
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("R33: fuera del origen -> estado_invalido CON el estado actual (la UI lo nombra)", async () => {
    const { repo, service } = makeRepo({
      findByNumGuiaForTransicion: vi
        .fn()
        .mockResolvedValue(transicionRow({ estatusValue: "en_bodega_central" })),
    });

    expect(await service.recolectarEnTienda(NUM_GUIA, MENSAJERO)).toEqual({
      status: "estado_invalido",
      estado: "en_bodega_central",
    });
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("catalogo sin el estado destino -> validation_error (config, no dato del usuario)", async () => {
    const { repo, service } = makeRepo({
      findEstatusIdByValue: vi.fn().mockResolvedValue(null),
    });

    const res = await service.recolectarEnTienda(NUM_GUIA, MENSAJERO);

    expect(res).toMatchObject({ status: "validation_error" });
    expect(repo.recolectarEnTienda).not.toHaveBeenCalled();
  });
});

describe("RecoleccionTiendaService — camino feliz y carrera (R26/R27/R34)", () => {
  it("R26/R27: transiciona a en_ruta_bodega_central con la familia de historial propia", async () => {
    const { repo, service } = makeRepo();

    const res = await service.recolectarEnTienda(NUM_GUIA, MENSAJERO);

    expect(res).toEqual({
      status: "ok",
      ordenId: "o1",
      estado: "en_ruta_bodega_central",
    });
    // El mensajero viaja al repo: es parte de la guardia ATOMICA, no solo del chequeo previo.
    expect(repo.recolectarEnTienda).toHaveBeenCalledWith(
      "o1",
      "recolectando", // feature 157 (ampliacion): se recolecta lo que YA esta asignado
      DESTINO_ID,
      MENSAJERO.usuarioId,
      { actorUsuarioId: MENSAJERO.usuarioId, origenTipo: "recoleccion_tienda" },
    );
  });

  it("R34: pierde la carrera y la otra ya recolecto -> ya_recolectada (no conflict)", async () => {
    const findByNumGuia = vi
      .fn()
      .mockResolvedValueOnce(transicionRow())
      .mockResolvedValueOnce(transicionRow({ estatusValue: "en_ruta_bodega_central" }));
    const { service } = makeRepo({
      findByNumGuiaForTransicion: findByNumGuia,
      recolectarEnTienda: vi.fn().mockResolvedValue(false),
    });

    expect(await service.recolectarEnTienda(NUM_GUIA, MENSAJERO)).toEqual({
      status: "ya_recolectada",
    });
  });

  it("R34: pierde la carrera y el estado quedo en otro sitio -> conflict con motivo", async () => {
    const findByNumGuia = vi
      .fn()
      .mockResolvedValueOnce(transicionRow())
      .mockResolvedValueOnce(transicionRow({ estatusValue: "devuelta_a_tienda" }));
    const { service } = makeRepo({
      findByNumGuiaForTransicion: findByNumGuia,
      recolectarEnTienda: vi.fn().mockResolvedValue(false),
    });

    const res = await service.recolectarEnTienda(NUM_GUIA, MENSAJERO);

    expect(res).toMatchObject({ status: "conflict" });
    expect(res).toHaveProperty("motivo", expect.any(String));
  });
});
