import { describe, it, expect, vi } from "vitest";
import { RecepcionOrigenService } from "@/lib/services/RecepcionOrigenService";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Recepción en la tienda de ORIGEN: cierra el flujo de devolución
// (`devuelta_origen` -> `recibido_origen`) cuando el adminTienda escanea el QR.
// Espejo de `recepcion-satelite-service.test.ts` cambiando el alcance de ZONA por
// el de TIENDA. Cada guardia asegura además "sin efectos": no se escribe.

// Para el adminTienda su `usuarioId` ES el `tiendaId` de sus órdenes.
const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "store-2", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const ADMIN_SATELITE: Actor = { usuarioId: "as1", rol: "adminSatelite" };

const NUM_GUIA = 14;

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  recibido_origen: "os-recibido-origen",
  devuelta_origen: "os-devuelta-origen",
};

type RepoMethods = Pick<
  IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recibirEnOrigen"
>;

function transicionRow(
  overrides: Partial<OrdenTransicionRow> = {},
): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "devuelta_origen",
    numGuia: NUM_GUIA,
    deletedAt: null,
    zonaId: "z-limon",
    zonaEsGam: false,
    tiendaId: "store-1", // la tienda de TIENDA
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findByNumGuiaForTransicion: vi.fn(async () => transicionRow()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    recibirEnOrigen: vi.fn(async () => true),
    ...overrides,
  };
}

function newService(repo: RepoMethods = fakeRepo()) {
  return new RecepcionOrigenService(repo as unknown as IOrdenRepository);
}

describe("RecepcionOrigenService.recibirEnOrigen", () => {
  it("ok: transiciona devuelta_origen -> recibido_origen", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({
      status: "ok",
      ordenId: "o1",
      estado: "recibido_origen",
    });
  });

  it("persiste con la tienda del actor como guarda y marca el historial", async () => {
    const repo = fakeRepo();
    await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(repo.recibirEnOrigen).toHaveBeenCalledWith(
      "o1",
      "store-1", // guarda por tienda en el WHERE: la defensa real
      "os-recibido-origen",
      // Misma marca que la transición anterior del flujo (DevolucionOrigenService):
      // no se agrega un valor al enum nativo, que en Postgres es irreversible.
      { actorUsuarioId: "store-1", origenTipo: "ajuste_estado" },
    );
  });

  // --- Rol ---

  it.each([
    ["maestro", MAESTRO],
    ["mensajero", MENSAJERO],
    ["adminSatelite", ADMIN_SATELITE],
  ])("forbidden si el actor es %s, sin efectos", async (_label, actor) => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, actor as Actor);

    expect(res).toEqual({ status: "forbidden" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
    // Ni siquiera lee: el rol se descarta antes de tocar la orden.
    expect(repo.findByNumGuiaForTransicion).not.toHaveBeenCalled();
  });

  // --- Existencia ---

  it("no_encontrada si no hay orden con ese num_guia, sin efectos", async () => {
    const repo = fakeRepo({ findByNumGuiaForTransicion: vi.fn(async () => null) });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "no_encontrada" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  it("no_encontrada si la orden está borrada (no revela que existió), sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ deletedAt: new Date("2026-07-01") }),
      ),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "no_encontrada" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  // --- Alcance por tienda ---

  it("tienda_ajena si la orden es de otra tienda, sin efectos", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, OTRA_TIENDA);

    expect(res).toEqual({ status: "tienda_ajena" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  // El alcance se comprueba ANTES del estado: una orden ajena nunca revela en qué
  // estado está, ni siquiera para decir "ya estaba recibida".
  it("una orden AJENA y ya recibida sigue siendo tienda_ajena (no ya_recibida)", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "recibido_origen" }),
      ),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, OTRA_TIENDA);

    expect(res).toEqual({ status: "tienda_ajena" });
  });

  // --- Estado ---

  it("ya_recibida si ya está en recibido_origen: idempotente, sin escritura", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "recibido_origen" }),
      ),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "ya_recibida" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  it("estado_invalido lleva el estado actual, sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "en_reparto" }),
      ),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "estado_invalido", estado: "en_reparto" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  // Una orden que la tienda aún no recibió de vuelta (`rechazada`, esperando que el
  // adminSatelite la despache) NO es elegible: el flujo pasa por `devuelta_origen`.
  it("estado_invalido si sigue en rechazada (aún no salió hacia la tienda)", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () =>
        transicionRow({ estatusValue: "rechazada" }),
      ),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "estado_invalido", estado: "rechazada" });
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  // --- Config ---

  it("validation_error si el catálogo no tiene recibido_origen, sin efectos", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res.status).toBe("validation_error");
    expect(repo.recibirEnOrigen).not.toHaveBeenCalled();
  });

  // --- Carreras ---

  it("si pierde la carrera y otro la recibió primero -> ya_recibida", async () => {
    const lecturas = [
      transicionRow(), // lectura inicial: elegible
      transicionRow({ estatusValue: "recibido_origen" }), // re-lectura: ya recibida
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnOrigen: vi.fn(async () => false), // 0 filas: perdió la guarda
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "ya_recibida" });
  });

  it("si pierde la carrera y el estado es otro -> conflict", async () => {
    const lecturas = [
      transicionRow(),
      transicionRow({ estatusValue: "en_reparto" }), // cambió a otra cosa
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnOrigen: vi.fn(async () => false),
    });
    const res = await newService(repo).recibirEnOrigen(NUM_GUIA, TIENDA);

    expect(res).toEqual({ status: "conflict" });
  });
});
