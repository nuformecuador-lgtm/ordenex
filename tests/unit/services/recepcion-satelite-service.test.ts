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
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
  | "recibirLoteEnSatelite"
>;

function transicionRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_ruta_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "store-1",
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
    prioridad: false, // feature 101/R9: el service propaga este flag al DTO (resalte R8)
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findRecepcionSateliteByZona: vi.fn(async () => []),
    findByNumGuiaForTransicion: vi.fn(async () => transicionRow()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    recibirEnSatelite: vi.fn(async () => true),
    recibirLoteEnSatelite: vi.fn(async (ordenIds: string[]) => ordenIds.length),
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
      devueltas: [], // Feature 100/T4.1/R12: sin zona -> tampoco hay por recuperar
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
    // Feature 100/T4.1/R12: ninguna fila devuelta -> devueltas vacio.
    expect(r.devueltas).toEqual([]);
    expect(r.sinZona).toBe(false);
    expect(r.zonaNombre).toBe("Limon"); // R9: derivado de orden.zonaId
    // R4 + R14 + Feature 100/R12: consulta acotada a la zona del actor con los CUATRO estados
    // relevantes (por recibir, recibidas, las rechazada por devolver a tienda y las devuelta
    // por recuperar a bodega).
    expect(repo.findRecepcionSateliteByZona).toHaveBeenCalledWith(ZONA, [
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
      "rechazada",
      "devuelta",
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

  // Feature 101/R9: el service propaga `prioridad` de la fila del repo al DTO del grupo
  // "Recibidas" (en_bodega_satelite), donde el frontend resalta la fila (R8).
  it("R9: propaga `prioridad` de la fila al DTO de recibidas", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "p1", estatusValue: "en_bodega_satelite", prioridad: true }),
        recepcionRow({ id: "n1", estatusValue: "en_bodega_satelite", prioridad: false }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recibidas.find((o) => o.id === "p1")?.prioridad).toBe(true);
    expect(r.recibidas.find((o) => o.id === "n1")?.prioridad).toBe(false);
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

  // Feature 100/T4.1/R12: bucket `devueltas` (devuelta de la zona del adminSatelite),
  // mismo patron que `porDevolver` (48). La recuperacion a bodega la ejecuta luego
  // RecuperacionBodegaService; aqui solo el LISTADO acotado por zona.
  it("R12: clasifica en devueltas las ordenes devuelta de SU zona (y NO en los otros 3 grupos)", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "a", estatusValue: "en_ruta_bodega_satelite" }),
        recepcionRow({ id: "b", estatusValue: "en_bodega_satelite" }),
        recepcionRow({ id: "r1", estatusValue: "rechazada" }),
        recepcionRow({ id: "d1", estatusValue: "devuelta" }),
        recepcionRow({ id: "d2", estatusValue: "devuelta" }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Las devuelta caen SOLO en devueltas.
    expect(r.devueltas.map((o) => o.id)).toEqual(["d1", "d2"]);
    // ... y NO se filtran a los otros buckets (no mezcla).
    expect(r.porRecibir.map((o) => o.id)).toEqual(["a"]);
    expect(r.recibidas.map((o) => o.id)).toEqual(["b"]);
    expect(r.porDevolver.map((o) => o.id)).toEqual(["r1"]);
  });

  it("R12: una fila devuelta de la MISMA zona aparece en devueltas; otros estados NO", async () => {
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async () => [
        recepcionRow({ id: "d1", estatusValue: "devuelta" }),
      ]),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.devueltas.map((o) => o.id)).toEqual(["d1"]);
    expect(r.porRecibir).toEqual([]);
    expect(r.recibidas).toEqual([]);
    expect(r.porDevolver).toEqual([]);
  });

  it("R12: adminSatelite sin zona -> devueltas vacio (sin consultar ordenes)", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.devueltas).toEqual([]);
    expect(repo.findRecepcionSateliteByZona).not.toHaveBeenCalled();
  });

  it("R12: la consulta se acota SIEMPRE a la zona del actor -> otra zona no ve sus devueltas", async () => {
    // El adminSatelite `as1` esta en `z-limon`; otra zona `z-otra` tiene su propia devuelta. El
    // repo (query real, guardado por `zonaId` en el WHERE) SOLO devuelve las de la zona que se le
    // pasa; el service llama con la zona del actor, asi que la devuelta de `z-otra` no sale.
    const porZona: Record<string, RecepcionSateliteRow[]> = {
      [ZONA]: [recepcionRow({ id: "d-mia", estatusValue: "devuelta" })],
      "z-otra": [recepcionRow({ id: "d-ajena", estatusValue: "devuelta" })],
    };
    const repo = fakeRepo({
      findRecepcionSateliteByZona: vi.fn(async (zonaId: string) => porZona[zonaId] ?? []),
    });
    const r = await newService(repo).listar(ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Solo la devuelta de SU zona; la de otra zona no viaja.
    expect(r.devueltas.map((o) => o.id)).toEqual(["d-mia"]);
    expect(repo.findRecepcionSateliteByZona).toHaveBeenCalledWith(
      ZONA,
      expect.arrayContaining(["devuelta"]),
    );
  });
});

// --- recibir (R11-R18) ---

describe("recibir (R11-R18)", () => {
  it("R17: rol != adminSatelite -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibir(10, MAESTRO);
    expect(r.status).toBe("forbidden");
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R5: adminSatelite sin zona -> sin_zona, sin efectos", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("sin_zona");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R15: ninguna orden con ese num_guia -> no_encontrada, sin efectos", async () => {
    const repo = fakeRepo({ findByNumGuiaForTransicion: vi.fn(async () => null) });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("no_encontrada");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R15: orden borrada -> no_encontrada, sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => transicionRow({ deletedAt: new Date() })),
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("no_encontrada");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R12: orden de otra zona -> zona_ajena, sin efectos", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => transicionRow({ zonaId: "z-otra" })),
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("zona_ajena");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R14: orden ya en_bodega_satelite -> ya_recibida idempotente, sin escribir", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => transicionRow({ estatusValue: "en_bodega_satelite" })),
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("ya_recibida");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido con el estado actual", async () => {
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => transicionRow({ estatusValue: "en_fulfillment" })),
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r).toEqual({ status: "estado_invalido", estado: "en_fulfillment" });
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("catalogo incompleto (destino sin seed) -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("validation_error");
    expect(repo.recibirEnSatelite).not.toHaveBeenCalled();
  });

  it("R16: la orden se resuelve por el num_guia escaneado (el QR codifica /paquete/<numGuia>)", async () => {
    const repo = fakeRepo();
    await newService(repo).recibir(10, ADMIN);
    expect(repo.findByNumGuiaForTransicion).toHaveBeenCalledWith(10);
  });

  it("R11/R18: origen valido y de la zona -> transiciona a en_bodega_satelite (guardado por estado+zona)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibir(10, ADMIN);
    // El `ordenId` del resultado sale de la fila resuelta por num_guia, no del input.
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
    const lecturas: (OrdenTransicionRow | null)[] = [
      transicionRow(),
      transicionRow({ estatusValue: "en_bodega_satelite" }),
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnSatelite: vi.fn(async () => false), // race: 0 filas
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("ya_recibida");
  });

  it("R18: race — UPDATE no afecta y al re-leer NO esta recibida -> conflict", async () => {
    const lecturas: (OrdenTransicionRow | null)[] = [
      transicionRow(),
      transicionRow({ estatusValue: "en_fulfillment" }),
    ];
    let i = 0;
    const repo = fakeRepo({
      findByNumGuiaForTransicion: vi.fn(async () => lecturas[i++] ?? null),
      recibirEnSatelite: vi.fn(async () => false),
    });
    const r = await newService(repo).recibir(10, ADMIN);
    expect(r.status).toBe("conflict");
  });
});

// --- Feature 63: recibirLote (paridad con "Recoger todas" del mensajero) ---

describe("recibirLote (feature 63)", () => {
  it("autz: rol != adminSatelite -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    for (const otro of [MAESTRO, MENSAJERO]) {
      const r = await newService(repo).recibirLote({ ordenIds: ["o1"] }, otro);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(repo.recibirLoteEnSatelite).not.toHaveBeenCalled();
  });

  it("adminSatelite sin zona -> sin_zona, sin efectos", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await newService(repo).recibirLote({ ordenIds: ["o1", "o2"] }, ADMIN);
    expect(r.status).toBe("sin_zona");
    expect(repo.recibirLoteEnSatelite).not.toHaveBeenCalled();
  });

  it("lote vacio -> ok con 0 recibidas, sin escribir", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibirLote({ ordenIds: [] }, ADMIN);
    expect(r).toEqual({ status: "ok", recibidas: 0 });
    expect(repo.recibirLoteEnSatelite).not.toHaveBeenCalled();
  });

  it("catalogo incompleto (origen/destino sin seed) -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const r = await newService(repo).recibirLote({ ordenIds: ["o1"] }, ADMIN);
    expect(r.status).toBe("validation_error");
    expect(repo.recibirLoteEnSatelite).not.toHaveBeenCalled();
  });

  it("transiciona el lote de SU zona en_ruta -> en_bodega_satelite (escritura guardada por origen+zona+historial)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).recibirLote({ ordenIds: ["a", "b", "c"] }, ADMIN);
    expect(r).toEqual({ status: "ok", recibidas: 3 });
    // Alcance por zona + estado de ORIGEN + contexto de historial (actor = adminSatelite).
    expect(repo.recibirLoteEnSatelite).toHaveBeenCalledWith(
      ["a", "b", "c"],
      ZONA,
      "os-ruta-satelite", // origen: en_ruta_bodega_satelite
      "os-recibida", // destino: en_bodega_satelite
      { actorUsuarioId: "as1", origenTipo: "recepcion_satelite" },
    );
  });

  it("dedupe: ids repetidos se colapsan antes de la escritura", async () => {
    const repo = fakeRepo();
    await newService(repo).recibirLote({ ordenIds: ["a", "a", "b"] }, ADMIN);
    expect(repo.recibirLoteEnSatelite).toHaveBeenCalledWith(
      ["a", "b"],
      ZONA,
      "os-ruta-satelite",
      "os-recibida",
      { actorUsuarioId: "as1", origenTipo: "recepcion_satelite" },
    );
  });

  it("alcance por zona/estado server-side: el conteo refleja SOLO lo transicionado (ajenas omitidas)", async () => {
    // La guarda del repo omite las de otra zona / fuera del origen: de 3 pedidas, solo 1 recibida.
    const repo = fakeRepo({ recibirLoteEnSatelite: vi.fn(async () => 1) });
    const r = await newService(repo).recibirLote({ ordenIds: ["a", "b", "c"] }, ADMIN);
    expect(r).toEqual({ status: "ok", recibidas: 1 });
  });

  it("idempotencia: re-ejecutar cuando ya no hay nada en el origen -> ok con 0 recibidas", async () => {
    const repo = fakeRepo({ recibirLoteEnSatelite: vi.fn(async () => 0) });
    const r = await newService(repo).recibirLote({ ordenIds: ["a", "b"] }, ADMIN);
    expect(r).toEqual({ status: "ok", recibidas: 0 });
  });
});
