import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  IRutaOptimizadaRepository,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R28/R29) — el ORDEN de las cards, resuelto en el SERVICE.
//
// El repositorio NO cambia su `orderBy` (`createdAt desc` sigue siendo el orden base y el
// de "Por recoger", R29): el reordenado vive aqui, sobre la particion en dos arrays que el
// service ya hacia. Regla:
//
//   porGestionar = [ ...con posicion, por `secuencia` ASC,
//                    ...sin posicion, conservando su `createdAt desc` ]
//
// Las que no tienen posicion son las que entraron a la ruta DESPUES de la ultima
// optimizacion; van al final y se marcan como pendientes de optimizar.

const MENSAJERO: Actor = { usuarioId: "m-1", rol: "mensajero" };

/** Las filas llegan del repo en `createdAt desc` (el orden base ya verificado). */
function row(id: string, estatusValue: string): MiAsignacionRow {
  return {
    id,
    numGuia: 1,
    numRemision: `R-${id}`,
    estatusValue,
    destinatario: "Ana",
    telefonoDest: "8888",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    // Feature 97: coords de la parada (number|null); irrelevantes para el reordenado.
    latitud: 9.9,
    longitud: -84.1,
    notas: null,
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: null,
    mensajeroAsignadoId: "m-1",
  };
}

function ruta(over: Partial<RutaOptimizadaDTO> = {}): RutaOptimizadaDTO {
  return {
    id: "r1",
    mensajeroId: "m-1",
    estado: "vigente",
    calculadaAt: new Date("2026-07-20T12:00:00.000Z"),
    origenLat: 9.9,
    origenLng: -84.1,
    origenAt: new Date("2026-07-20T11:59:00.000Z"),
    origenFuente: "gps",
    huellaSet: "h",
    ultimoError: null,
    secuenciaPorOrden: new Map(),
    ...over,
  };
}

function build(rows: MiAsignacionRow[], rutaPrevia: RutaOptimizadaDTO | null) {
  const repo = {
    getOrdenEnGestion: vi.fn(async () => null),
    findMisAsignaciones: vi.fn(async () => rows),
    contarEntregadas: vi.fn(async () => 7),
    sumMontoCobrarEntregadas: vi.fn(async () => 500),
  } as unknown as IGestionOrdenRepository;

  const rutaRepo = {
    findByMensajero: vi.fn(async () => rutaPrevia),
    upsertOrigen: vi.fn(async () => {}),
  } as unknown as Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">;

  // Feature 115 (R17): sin marcas -> `marcarLuego` false; este test mide el orden por ruta.
  // Feature 116: sin notas -> `notaPrivada` null en todas las cards.
  const metaRepo = {
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    findNotasByMensajero: vi.fn(async () => new Map<string, string>()),
  };

  return new MisAsignacionesService(
    repo,
    { findEstatusIdByValue: vi.fn(async () => "x") } as unknown as IOrdenRepository,
    {} as IFileStorage,
    {} as ISignedUrlProvider,
    rutaRepo,
    metaRepo,
  );
}

async function listar(rows: MiAsignacionRow[], rutaPrevia: RutaOptimizadaDTO | null) {
  const r = await build(rows, rutaPrevia).listarMisAsignaciones(MENSAJERO);
  if (r.status !== "ok") throw new Error("se esperaba ok");
  return r;
}

describe("R28 — todas con posicion", () => {
  it("ordena por secuencia ASC, ignorando el orden de llegada", async () => {
    // El repo devuelve C, A, B (createdAt desc); la ruta dice A=1, B=2, C=3.
    const r = await listar(
      [row("C", "en_reparto"), row("A", "en_reparto"), row("B", "en_reparto")],
      ruta({
        secuenciaPorOrden: new Map([
          ["A", 1],
          ["B", 2],
          ["C", 3],
        ]),
      }),
    );

    expect(r.porGestionar.map((o) => o.id)).toEqual(["A", "B", "C"]);
    expect(r.porGestionar.map((o) => o.secuenciaRuta)).toEqual([1, 2, 3]);
    expect(r.ruta.paradasSinOptimizar).toBe(0);
  });
});

describe("R28 — mezcla de con y sin posicion", () => {
  it("las posicionadas van primero por secuencia; las demas AL FINAL en createdAt desc", async () => {
    // Llegada (createdAt desc): NUEVA2, NUEVA1, B, A.
    // Ruta: A=1, B=2. NUEVA1 y NUEVA2 entraron despues de la ultima optimizacion.
    const r = await listar(
      [
        row("NUEVA2", "en_reparto"),
        row("NUEVA1", "en_reparto"),
        row("B", "en_reparto"),
        row("A", "en_reparto"),
      ],
      ruta({
        secuenciaPorOrden: new Map([
          ["A", 1],
          ["B", 2],
        ]),
      }),
    );

    expect(r.porGestionar.map((o) => o.id)).toEqual(["A", "B", "NUEVA2", "NUEVA1"]);
    expect(r.porGestionar.map((o) => o.secuenciaRuta)).toEqual([1, 2, null, null]);
    // Las dos sin posicion CONSERVAN su orden relativo de llegada (sort estable).
    expect(r.ruta.paradasSinOptimizar).toBe(2);
  });

  it("una secuencia con huecos (orden ya entregada) sigue ordenando bien", async () => {
    const r = await listar(
      [row("C", "en_reparto"), row("A", "en_reparto")],
      ruta({
        secuenciaPorOrden: new Map([
          ["A", 1],
          ["C", 5], // la 2, 3 y 4 ya se entregaron y salieron de en_reparto
        ]),
      }),
    );
    expect(r.porGestionar.map((o) => o.id)).toEqual(["A", "C"]);
  });
});

describe("R28 — ninguna con posicion: orden IDENTICO al actual", () => {
  it("sin ruta persistida, `porGestionar` conserva exactamente el orden previo", async () => {
    const rows = [row("C", "en_reparto"), row("B", "en_reparto"), row("A", "en_reparto")];
    const r = await listar(rows, null);

    expect(r.porGestionar.map((o) => o.id)).toEqual(["C", "B", "A"]);
    expect(r.porGestionar.every((o) => o.secuenciaRuta === null)).toBe(true);
    expect(r.ruta.paradasSinOptimizar).toBe(3);
    // Y "nunca se calculo" NO es "esta desactualizada": la UI distingue por `calculadaAt`.
    expect(r.ruta.estado).toBe("vigente");
    expect(r.ruta.calculadaAt).toBeNull();
  });

  it("con ruta persistida pero sin paradas, tampoco se altera el orden", async () => {
    const rows = [row("C", "en_reparto"), row("B", "en_reparto")];
    const r = await listar(rows, ruta({ secuenciaPorOrden: new Map() }));
    expect(r.porGestionar.map((o) => o.id)).toEqual(["C", "B"]);
  });
});

describe("R29 — 'Por recoger' NO se toca", () => {
  it("conserva su orden de llegada y su secuenciaRuta es siempre null", async () => {
    const r = await listar(
      [
        row("P2", "en_espera_aceptacion"),
        row("A", "en_reparto"),
        row("P1", "en_espera_aceptacion"),
        row("B", "en_reparto"),
      ],
      ruta({
        secuenciaPorOrden: new Map([
          ["A", 2],
          ["B", 1],
          // Una posicion PARA UNA ORDEN POR RECOGER no debe filtrarse a esa seccion.
          ["P1", 9],
        ]),
      }),
    );

    expect(r.porRecoger.map((o) => o.id)).toEqual(["P2", "P1"]);
    expect(r.porRecoger.every((o) => o.secuenciaRuta === null)).toBe(true);
    // Y el reordenado de "por gestionar" si aplica.
    expect(r.porGestionar.map((o) => o.id)).toEqual(["B", "A"]);
  });
});

describe("bloque `ruta` del resultado y KPIs", () => {
  it("expone estado, calculadaAt, origenFuente y paradasSinOptimizar", async () => {
    const calculada = new Date("2026-07-20T12:00:00.000Z");
    const r = await listar(
      [row("A", "en_reparto"), row("N", "en_reparto")],
      ruta({
        estado: "desactualizada",
        calculadaAt: calculada,
        origenFuente: "centroide",
        secuenciaPorOrden: new Map([["A", 1]]),
      }),
    );

    expect(r.ruta).toEqual({
      estado: "desactualizada",
      calculadaAt: calculada,
      origenFuente: "centroide",
      paradasSinOptimizar: 1,
    });
  });

  it("los KPIs de la feature 61 NO se alteran por el reordenado", async () => {
    const r = await listar(
      [row("A", "en_reparto"), row("B", "en_reparto"), row("P", "en_espera_aceptacion")],
      ruta({ secuenciaPorOrden: new Map([["B", 1]]) }),
    );

    expect(r.kpis).toEqual({
      pendientes: 2, // las dos en_reparto
      entregadas: 7,
      porCobrar: 200, // 100 + 100
      totalACobrar: 700, // 200 + 500 ya entregado
    });
  });
});
