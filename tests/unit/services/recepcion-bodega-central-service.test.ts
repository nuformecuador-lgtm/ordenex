import { describe, it, expect, vi } from "vitest";
import { RecepcionBodegaCentralService } from "@/lib/services/RecepcionBodegaCentralService";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 138 — Recepcion en la BODEGA CENTRAL: cierra el dead-end de la carga por API
// (`en_ruta_bodega_central` -> `en_bodega_central`) cuando el maestro/admin escanea el QR.
// Espejo de `recepcion-origen-service.test.ts` cambiando el alcance por TIENDA por el alcance
// GLOBAL de maestro/admin (`esAccesoTotal`), SIN guardia de zona ni tienda (R11). Cada guardia
// asegura ademas "sin efectos": no se escribe.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const ADMIN_SATELITE: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const NUM_GUIA = 77;

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_bodega_central: "os-en-bodega-central",
  en_ruta_bodega_central: "os-en-ruta-bodega-central",
};

type RepoMethods = Pick<
  IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recibirEnBodegaCentral"
>;

function transicionRow(
  overrides: Partial<OrdenTransicionRow> = {},
): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_ruta_bodega_central",
    numGuia: NUM_GUIA,
    deletedAt: null,
    zonaId: "z-cualquiera",
    zonaEsGam: false,
    tiendaId: "store-9",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findByNumGuiaForTransicion: vi.fn(async () => transicionRow()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    recibirEnBodegaCentral: vi.fn(async () => true),
    ...overrides,
  };
}

function newService(repo: RepoMethods = fakeRepo()) {
  return new RecepcionBodegaCentralService(repo as unknown as IOrdenRepository);
}

describe("RecepcionBodegaCentralService.recibirEnBodegaCentral", () => {
  // R1/R2: transiciona en_ruta_bodega_central -> en_bodega_central.
  it("R2: ok — transiciona en_ruta_bodega_central -> en_bodega_central (maestro)", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({
      status: "ok",
      ordenId: "o1",
      estado: "en_bodega_central",
    });
  });

  it("R2: ok tambien para admin (acceso total, equivalente a maestro)", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, ADMIN);

    expect(res.status).toBe("ok");
  });

  // R3/R17: persiste con la guarda por estado y marca el historial con el tipo propio.
  it("R3/R17: persiste con destino resuelto y origenTipo recepcion_bodega_central", async () => {
    const repo = fakeRepo();
    await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(repo.recibirEnBodegaCentral).toHaveBeenCalledWith(
      "o1",
      "os-en-bodega-central",
      { actorUsuarioId: "u-maestro", origenTipo: "recepcion_bodega_central" },
    );
  });

  // --- Rol (R4) ---

  it.each([
    ["adminTienda", ADMIN_TIENDA],
    ["adminSatelite", ADMIN_SATELITE],
    ["mensajero", MENSAJERO],
  ])("R4: forbidden si el actor es %s, sin efectos", async (_label, actor) => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, actor as Actor);

    expect(res).toEqual({ status: "forbidden" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
    // Ni siquiera lee: el rol se descarta antes de tocar la orden.
    expect(repo.findByNumGuiaForTransicion).not.toHaveBeenCalled();
  });

  // --- Existencia (R6) ---

  it("R6: no_encontrada si no hay orden con ese num_guia, sin efectos", async () => {
    const repo = fakeRepo({ findByNumGuiaForTransicion: vi.fn(async () => null) });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "no_encontrada" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  it("R6: no_encontrada si la orden esta borrada (no revela que existio), sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ deletedAt: new Date("2026-07-01") }),
      ),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "no_encontrada" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  // --- Alcance GLOBAL (R11): cualquier orden en el origen es elegible ---

  it("R11: recibe una orden de CUALQUIER zona/tienda (sin acotar), transiciona ok", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ zonaId: "z-otra", tiendaId: "store-otra" }),
      ),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.recibirEnBodegaCentral).toHaveBeenCalledTimes(1);
  });

  // --- Estado (R7/R8) ---

  it("R7: ya_recibida si ya esta en en_bodega_central: idempotente, sin escritura", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "en_bodega_central" }),
      ),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "ya_recibida" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  it("R8: estado_invalido lleva el estado actual, sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "en_ruta" }),
      ),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "estado_invalido", estado: "en_ruta" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  // Una orden ya en la bodega satelite NO es elegible por la central: el flujo pasa por
  // en_ruta_bodega_central.
  it("R8: estado_invalido si esta en en_bodega_satelite (no es el origen central)", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "en_bodega_satelite" }),
      ),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "estado_invalido", estado: "en_bodega_satelite" });
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  // --- Config ---

  it("validation_error si el catalogo no tiene en_bodega_central, sin efectos", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res.status).toBe("validation_error");
    expect(repo.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  // --- Carreras (R9) ---

  it("R9: si pierde la carrera y otro la recibio primero -> ya_recibida", async () => {
    const lecturas = [
      transicionRow(), // lectura inicial: elegible
      transicionRow({ estatusValue: "en_bodega_central" }), // re-lectura: ya recibida
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnBodegaCentral: vi.fn(async () => false), // 0 filas: perdio la guarda
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "ya_recibida" });
  });

  it("R9: si pierde la carrera y el estado es otro -> conflict", async () => {
    const lecturas = [
      transicionRow(),
      transicionRow({ estatusValue: "en_ruta" }), // cambio a otra cosa
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnBodegaCentral: vi.fn(async () => false),
    });
    const res = await newService(repo).recibirEnBodegaCentral(NUM_GUIA, MAESTRO);

    expect(res).toEqual({ status: "conflict" });
  });
});
