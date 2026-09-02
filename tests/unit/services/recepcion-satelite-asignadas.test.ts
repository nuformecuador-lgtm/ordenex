import { describe, it, expect, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type {
  IOrdenRepository,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fakeIntentosEnLote, type IntentosSvcDoble } from "@/tests/fixtures/intentos-entrega";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

// Feature 149 — T6.3 (R35/R36): bucket `asignadas` del modulo de la bodega satelite.
//
// R35 se verifica AQUI, a nivel de SERVICE (no de componente): "el sistema DEBE mostrar las
// ordenes de SU zona en `por_recoger`". Lo que el componente prueba es que, DADA la lista, la
// pinta y ofrece la accion; lo que se prueba aqui es que la lista existe, sale de la zona del
// actor resuelta SERVER-SIDE y no incluye el caso (b).

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

const ZONA = "z-limon";

type RepoMethods = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findRecepcionSateliteByZona"
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
>;

function recepcionRow(overrides: Partial<RecepcionSateliteRow> = {}): RecepcionSateliteRow {
  return {
    // FICHA 349: los escalares de `OrdenDTO` que la fila comparte con `/ordenes`, en un solo sitio.
    ...CAMPOS_BASE_ORDEN,
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusValue: "por_recoger",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    montoCobrar: 25,
    tiendaNombre: "T",
    zonaNombre: "Limon",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    prioridad: false,
    fechaRepartoISO: null, // feature 262/B8: el dia por orden, ya serializado por el repo
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA as string | null),
    findRecepcionSateliteByZona: vi.fn(async () => [] as RecepcionSateliteRow[]),
    findByNumGuiaForTransicion: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => null),
    recibirEnSatelite: vi.fn(async () => true),
    ...overrides,
  };
}

function newService(
  repo: RepoMethods = fakeRepo(),
  // Feature 160 (integrada desde `dev`): el derivador de intentos EN LOTE es una dependencia
  // REQUERIDA del constructor. El bucket `asignadas` no lo usa (las `por_recoger` no tienen
  // intentos), pero el doble tiene que estar para construir el service.
  intentos: IntentosSvcDoble = fakeIntentosEnLote(),
) {
  return new RecepcionSateliteService(repo as unknown as IOrdenRepository, intentos);
}

describe("T6.3/R35 — el modulo satelite lista las `por_recoger` de SU zona", () => {
  it("clasifica las `por_recoger` en el bucket `asignadas`, con el DTO completo", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "por_recoger", numGuia: 77 }),
        recepcionRow({ id: "b", estatusValue: "en_bodega_satelite" }),
      ]),
    });

    const r = await newService(repo).listar(ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.asignadas.map((o) => o.id)).toEqual(["a"]);
    expect(r.recibidas.map((o) => o.id)).toEqual(["b"]);
    // El DTO trae lo que la tabla del modulo renderiza (guia, remision, destinatario, tienda...).
    expect(r.asignadas[0]).toMatchObject({
      id: "a",
      numGuia: 77,
      numRemision: "R-1",
      estatusValue: "por_recoger",
      destinatario: "Ana",
      tiendaNombre: "T",
      zonaNombre: "Limon",
    });
  });

  it("SCOPING: consulta con la zona del actor resuelta SERVER-SIDE y pide `por_recoger`", async () => {
    const repo = fakeRepo();
    await newService(repo).listar(ADMIN);

    expect(repo.findUsuarioZonaId).toHaveBeenCalledWith(ADMIN.usuarioId); // nunca del cliente
    const [zonaId, estatusValues] = vi.mocked(repo.findRecepcionSateliteByZona).mock.calls[0];
    expect(zonaId).toBe(ZONA); // D1: una bodega satelite solo ve su zona
    expect(estatusValues).toContain("por_recoger");
  });

  it("SCOPING: la consulta es POR ZONA — no hay ruta para ver ordenes de otra zona", async () => {
    // El repo filtra `zonaId` en el WHERE; el service NUNCA le pasa otra zona que la del actor.
    // Aunque el repo devolviera una fila ajena (imposible con ese WHERE), el actor solo puede
    // pedir la suya: el unico argumento de zona es el resuelto server-side.
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => "z-otra" as string | null) });
    await newService(repo).listar(ADMIN);
    expect(vi.mocked(repo.findRecepcionSateliteByZona).mock.calls[0][0]).toBe("z-otra");
    expect(vi.mocked(repo.findRecepcionSateliteByZona).mock.calls).toHaveLength(1);
  });

  it("R36: una `en_ruta_bodega_satelite` NO cae en `asignadas` (sigue en `porRecibir`)", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "en_ruta_bodega_satelite" }),
      ]),
    });

    const r = await newService(repo).listar(ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.asignadas).toEqual([]); // el caso (b) es competencia de la bodega central
    expect(r.porRecibir.map((o) => o.id)).toEqual(["a"]);
  });

  it("el bucket nuevo NO contamina los ya existentes (139/100 intactos)", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "por_recoger" }),
        recepcionRow({ id: "b", estatusValue: "en_ruta_bodega_satelite" }),
        recepcionRow({ id: "c", estatusValue: "en_bodega_satelite" }),
        recepcionRow({ id: "d", estatusValue: "por_devolver" }),
        recepcionRow({ id: "e", estatusValue: "devolviendo_a_bodega_central" }),
        recepcionRow({ id: "f", estatusValue: "devuelta" }),
      ]),
    });

    const r = await newService(repo).listar(ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.asignadas.map((o) => o.id)).toEqual(["a"]);
    expect(r.porRecibir.map((o) => o.id)).toEqual(["b"]);
    expect(r.recibidas.map((o) => o.id)).toEqual(["c"]);
    expect(r.porDevolver.map((o) => o.id)).toEqual(["d"]);
    expect(r.enTransitoACentral.map((o) => o.id)).toEqual(["e"]);
    expect(r.devueltas.map((o) => o.id)).toEqual(["f"]);
  });

  it("adminSatelite SIN zona -> `asignadas` vacio y ninguna consulta de ordenes", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).listar(ADMIN);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.asignadas).toEqual([]);
    expect(repo.findRecepcionSateliteByZona).not.toHaveBeenCalled();
  });

  it.each([
    ["maestro", MAESTRO],
    ["adminTienda", ADMIN_TIENDA],
  ])("rol %s -> forbidden: el bucket no se expone fuera del adminSatelite", async (_n, actor) => {
    const repo = fakeRepo();
    expect((await newService(repo).listar(actor)).status).toBe("forbidden");
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
  });
});
