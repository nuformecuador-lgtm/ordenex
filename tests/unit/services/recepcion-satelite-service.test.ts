import { describe, it, expect, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA = "z-limon";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_bodega_satelite: "os-recibida",
  en_ruta_bodega_satelite: "os-ruta-satelite",
};

type RepoMethods = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findRecepcionSateliteByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
>;

function transicionRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_ruta_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    ...overrides,
  };
}

function recepcionRow(overrides: Partial<RecepcionSateliteRow> = {}): RecepcionSateliteRow {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusValue: "en_ruta_bodega_satelite",
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
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findRecepcionSateliteByZona: vi.fn(async () => []),
    findByIdsForTransicion: vi.fn(async () => [transicionRow()]),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    recibirEnSatelite: vi.fn(async () => true),
    ...overrides,
  };
}

function newService(repo: RepoMethods = fakeRepo()) {
  return new RecepcionSateliteService(repo as unknown as IOrdenRepository);
}

// --- listar (R3/R4/R5/R6/R8/R9) ---

describe("listar (R3/R4/R5/R6/R8)", () => {
  it("R3/R17: rol != adminSatelite -> forbidden", async () => {
    expect((await newService().listar(MAESTRO)).status).toBe("forbidden");
    expect((await newService().listar(MENSAJERO)).status).toBe("forbidden");
  });

  it("R5: adminSatelite sin zona -> ok con listas vacias + sinZona", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).listar(ADMIN);
    expect(r).toEqual({
      status: "ok",
      porRecibir: [],
      recibidas: [],
      porDevolver: [], // Feature 48/T9/R14: sin zona -> tampoco hay por devolver
      zonaNombre: null,
      sinZona: true,
    });
    // R5: no consulta ordenes si no hay zona.
    expect(repo.findRecepcionSateliteByZona).not.toHaveBeenCalled();
  });

  it("R4/R6/R8: separa por recibir (en_ruta) de recibidas (en_bodega_satelite) de SU zona", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "en_ruta_bodega_satelite" }),
        recepcionRow({ id: "b", estatusValue: "en_bodega_satelite" }),
        recepcionRow({ id: "c", estatusValue: "en_ruta_bodega_satelite" }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecibir.map((o) => o.id)).toEqual(["a", "c"]);
    expect(r.recibidas.map((o) => o.id)).toEqual(["b"]);
    // Feature 48/T9/R14: ninguna fila rechazada -> porDevolver vacio.
    expect(r.porDevolver).toEqual([]);
    expect(r.sinZona).toBe(false);
    expect(r.zonaNombre).toBe("Limon"); // R9: derivado de orden.zonaId
    // R4 + R14: consulta acotada a la zona del actor con los TRES estados relevantes
    // (por recibir, recibidas y las rechazada elegibles para devolver a tienda).
    expect(repo.findRecepcionSateliteByZona).toHaveBeenCalledWith(ZONA, [
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
      "rechazada",
    ]);
  });

  // Feature 48/T9/R14: bucket `porDevolver` (rechazada de la zona del adminSatelite).
  it("R14: clasifica en porDevolver las ordenes rechazada de SU zona (y NO en porRecibir/recibidas)", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "en_ruta_bodega_satelite" }),
        recepcionRow({ id: "b", estatusValue: "en_bodega_satelite" }),
        recepcionRow({ id: "r1", estatusValue: "rechazada" }),
        recepcionRow({ id: "r2", estatusValue: "rechazada" }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Las rechazada caen SOLO en porDevolver.
    expect(r.porDevolver.map((o) => o.id)).toEqual(["r1", "r2"]);
    // ... y NO se filtran a los otros buckets.
    expect(r.porRecibir.map((o) => o.id)).toEqual(["a"]);
    expect(r.recibidas.map((o) => o.id)).toEqual(["b"]);
    expect(r.sinZona).toBe(false);
  });

  it("R14: una fila rechazada de la MISMA zona aparece en porDevolver; otros estados NO", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "r1", estatusValue: "rechazada" }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porDevolver.map((o) => o.id)).toEqual(["r1"]);
    expect(r.porRecibir).toEqual([]);
    expect(r.recibidas).toEqual([]);
  });

  it("R14: adminSatelite sin zona -> porDevolver vacio (sin consultar ordenes)", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porDevolver).toEqual([]);
    expect(repo.findRecepcionSateliteByZona).not.toHaveBeenCalled();
  });
});

// --- recibir (R11-R18) ---

describe("recibir (R11-R18)", () => {
  it("R17: rol != adminSatelite -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibir("o1", MAESTRO);
    expect(r.status).toBe("forbidden");
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R5: adminSatelite sin zona -> sin_zona, sin efectos", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("sin_zona");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R15: orden inexistente -> no_encontrada, sin efectos", async () => {
    const repo = fakeRepo({ findByIdsForTransicion: vi.fn(async () => []) });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("no_encontrada");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R15: orden borrada -> no_encontrada, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [transicionRow({ deletedAt: new Date() })]),
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("no_encontrada");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R12: orden de otra zona -> zona_ajena, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [transicionRow({ zonaId: "z-otra" })]),
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("zona_ajena");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R14: orden ya en_bodega_satelite -> ya_recibida idempotente, sin escribir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [transicionRow({ estatusValue: "en_bodega_satelite" })]),
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("ya_recibida");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido con el estado actual", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [transicionRow({ estatusValue: "en_fulfillment" })]),
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r).toEqual({ status: "estado_invalido", estado: "en_fulfillment" });
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("catalogo incompleto (destino sin seed) -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("validation_error");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R11/R18: origen valido y de la zona -> transiciona a en_bodega_satelite (guardado por estado+zona)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r).toEqual({ status: "ok", ordenId: "o1", estado: "en_bodega_satelite" });
    // R11/R18: escritura guardada con la zona del actor y el estatus destino.
    // Feature 49/#6: pasa ademas el contexto de historial (actor = adminSatelite, tipo).
    expect(repo.recibirEnSatelite).toHaveBeenCalledWith("o1", ZONA, "os-recibida", {
      actorUsuarioId: "as1",
      origenTipo: "recepcion_satelite",
    });
  });

  it("R18: race — UPDATE no afecta y al re-leer esta recibida -> ya_recibida", async () => {
    // 1a lectura: aun en origen; re-lectura tras el UPDATE fallido: ya recibida.
    const lecturas: OrdenTransicionRow[][] = [
      [transicionRow()],
      [transicionRow({ estatusValue: "en_bodega_satelite" })],
    ];
    let i = 0;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => lecturas[i++] ?? []),
      recibirEnSatelite: vi.fn(async () => false), // race: 0 filas
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("ya_recibida");
  });

  it("R18: race — UPDATE no afecta y al re-leer NO esta recibida -> conflict", async () => {
    const lecturas: OrdenTransicionRow[][] = [
      [transicionRow()],
      [transicionRow({ estatusValue: "en_fulfillment" })],
    ];
    let i = 0;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => lecturas[i++] ?? []),
      recibirEnSatelite: vi.fn(async () => false),
    });
    const r = await newService(repo).recibir("o1", ADMIN);
    expect(r.status).toBe("conflict");
  });
});
