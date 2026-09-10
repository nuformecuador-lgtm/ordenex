import { describe, it, expect, vi } from "vitest";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
// FICHA 407 (T6): el gate REAL, para medir el cable entero — input -> writer -> gate.
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { MSG_TOPE_INTENTOS_ASIGNACION } from "@/lib/services/mensajes-bloqueo";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R8) — el gate de asignabilidad en el TERCER writer de
// `mensajero_asignado_id`: `AsignacionSateliteService.asignar` (rol adminSatelite).

const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ZONA = "z-limon";

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    estatusValue: "en_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}) {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosNoAsignablesPorEstado: vi.fn(async (): Promise<Set<string>> => new Set()),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })]),
    findEstatusIdByValue: vi.fn(async (v: string) =>
      v === "en_bodega_satelite" ? "os-sat" : "os-espera",
    ),
    asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: null, longitud: null, geocodeStatus: null })),
    ),
    ...over,
  };
}

function gate(porOrden: Record<string, EstadoAsignabilidad> = {}): IAsignabilidadCoordenadasService {
  return {
    evaluar: vi.fn(async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(
        ordenes.map((o) => [o.id, porOrden[o.id] ?? "asignable"]),
      ),
    ),
  };
}

const NO_ASIGNABLES: EstadoAsignabilidad[] = [
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
];

describe("R8 — AsignacionSateliteService.asignar", () => {
  // Feature 368 (R2/R18) — ACTUALIZADO: una sola orden bloqueada por coordenadas YA NO aborta
  // el lote. La asignable se asigna (`partial`), la bloqueada se reporta, y `asignarSateliteLote`
  // se llama SOLO con la asignable.
  it.each(NO_ASIGNABLES)("motivo %s -> partial: asigna la asignable, reporta la bloqueada", async (estado) => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: estado }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("partial");
    if (r.status === "partial") {
      expect(r.resultados).toEqual([{ ordenId: "o2", estado: "por_recoger" }]);
      expect(r.bloqueadas).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o2"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("TODO-O-NADA: dos ordenes no asignables producen dos entradas y cero escrituras", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "geocodificacion_agotada", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([
        { ordenId: "o1", motivo: "geocodificacion_agotada" },
        { ordenId: "o2", motivo: "direccion_no_geocodificable" },
      ]);
    }
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  // Feature 368 (R17) — NUEVO, el caso de carrera COMPUESTA: `o1` bloqueada por coordenadas Y,
  // de las que SI pasaron el gate (`o2`, `o3`), `o2` pierde la carrera de concurrencia (cambia
  // de zona entre la lectura y la escritura guardada). El resultado sigue siendo `conflict`
  // (NUNCA `partial` ni `ok` en este camino raro) y el `detalle` combina el motivo de carrera
  // de `o2` con el motivo de coordenadas de `o1`, para no perder esa informacion (design.md §5).
  it("368/R17: carrera compuesta — bloqueada por coordenadas + carrera en las asignables -> conflict con ambos motivos", async () => {
    let llamada = 0;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async (ids: string[]) => {
        llamada += 1;
        if (llamada === 1) {
          // Precarga inicial (paso 4): las tres en estado valido, para pasar las guardas de
          // zona/estado y llegar al gate de coordenadas.
          return [ordenRow({ id: "o1" }), ordenRow({ id: "o2" }), ordenRow({ id: "o3" })];
        }
        // Re-lectura tras la escritura (paso 7, solo sobre `asignables` = ["o2", "o3"]): o2
        // cambio de zona entre la lectura y la escritura (perdio la carrera); o3 si transiciono.
        return ids.map((id) =>
          id === "o2"
            ? ordenRow({ id, zonaId: "z-otra" })
            : ordenRow({ id, estatusValue: "por_recoger" }),
        );
      }),
      // Solo 1 de las 2 asignables (o2, o3) se escribio de verdad -> dispara el chequeo de carrera.
      asignarSateliteLote: vi.fn(async () => 1),
    });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "geocodificacion_agotada" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      const porOrden = new Map(r.detalle.map((d) => [d.ordenId, d.motivo]));
      expect(porOrden.get("o1")).toBe("geocodificacion_agotada"); // no se pierde el motivo de coordenadas
      expect(porOrden.get("o2")).toBe("zona_ajena"); // motivo de la carrera
    }
    // `asignarSateliteLote` solo se llamo con las asignables (["o2","o3"]), nunca con "o1".
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("todas asignables -> asigna con normalidad", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
  });

  it("el gate corre DESPUES de las guardas de zona/estado y ANTES de escribir", async () => {
    // Orden importante: una orden de zona ajena debe seguir reportando `zona_ajena`, no
    // un motivo de coordenadas; el gate solo opina de las que llegarian a asignarse.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", zonaId: "z-otra" })]),
    });
    const g = gate({ o1: "geocodificacion_agotada" });
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignar({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: "zona_ajena" }]);
    }
    expect(g.evaluar).not.toHaveBeenCalled();
  });

  it("rol no autorizado -> forbidden sin llegar al gate", async () => {
    const repo = fakeRepo();
    const g = gate();
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignar(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { usuarioId: "u", rol: "maestro" },
    );

    expect(r.status).toBe("forbidden");
    expect(g.evaluar).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FEATURE 400 (T10/T10b, 2026-09-09) — ESPEJO EXACTO del archivo de la bodega central.
//
// Los dos writers tienen que comportarse igual: que el campo se olvide en UNO de los dos
// lados es el riesgo que este par de archivos existe para cazar (design §9). Un olvido en
// un solo lado deja ESTE test rojo y el otro verde, no ambos.
// ════════════════════════════════════════════════════════════════════════════════════════
describe("400/R6-R7, R31-R33, R35 — AsignacionSateliteService con ordenes `asignable_sin_ubicacion`", () => {
  function repo3(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async (ids: string[]) =>
        ids.map((id) => ordenRow({ id })),
      ),
      asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length),
      ...over,
    });
  }

  it("400/R6: recibe mensajero y NO entra en `bloqueadas` — el lote sale `ok`", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o1", "o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(JSON.stringify(r)).not.toContain("asignable_sin_ubicacion");
  });

  it("400/R7: la escritura NO lleva latitud, longitud, geocodeStatus ni geocodedAt", async () => {
    const PROHIBIDOS = ["latitud", "longitud", "geocodeStatus", "geocodedAt"];
    const asignarSateliteLote = vi.fn(async (...args: unknown[]) => {
      for (const arg of args) {
        if (arg === null || typeof arg !== "object") continue;
        for (const clave of Object.keys(arg as Record<string, unknown>)) {
          if (PROHIBIDOS.includes(clave)) {
            throw new Error(`el writer paso ${clave} al repositorio (400/R7)`);
          }
        }
      }
      return (args[0] as string[]).length;
    });
    const repo = repo3({ asignarSateliteLote });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion", o2: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("ok");
    expect(asignarSateliteLote).toHaveBeenCalledTimes(1);
    const args = asignarSateliteLote.mock.calls[0] as unknown[];
    expect(args[0]).toEqual(["o1", "o2", "o3"]);
    expect(args.some((a) => a !== null && typeof a === "object" && !Array.isArray(a))).toBe(true);
  });

  it("400/R31: N ordenes sin ubicacion -> `sinUbicacion` vale N en el resultado `ok`", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion", o3: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(2);
  });

  it("400/R31: tambien viaja en `partial`, junto a las bloqueadas", async () => {
    const repo = repo3({ asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length) });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(1);
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "direccion_no_geocodificable" }]);
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o3"]);
  });

  it("400/R32: es un NUMERO, no una lista de ordenes", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion", o3: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(typeof r.sinUbicacion).toBe("number");
    expect(Array.isArray(r.sinUbicacion)).toBe(false);
    expect(JSON.stringify(r.sinUbicacion)).toBe("2");
  });

  it("400/R33: sin ninguna orden sin ubicacion, la clave NO EXISTE en el resultado", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate(),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
        { ordenId: "o3", estado: "por_recoger" },
      ],
    });
    expect(Object.keys(r)).not.toContain("sinUbicacion");
  });

  it("400/R35: `bloqueadas` y `sinUbicacion` son campos HERMANOS, ninguno dentro del otro", async () => {
    const repo = repo3({ asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length) });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "asignable_sin_ubicacion", o2: "geocodificacion_agotada" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    if (r.status !== "partial") throw new Error("unreachable");
    expect(Object.keys(r).sort()).toEqual(
      ["bloqueadas", "resultados", "sinUbicacion", "status"].sort(),
    );
    expect(JSON.stringify(r.bloqueadas)).not.toContain("sinUbicacion");
    for (const b of r.bloqueadas) {
      expect(Object.keys(b).sort()).toEqual(["motivo", "ordenId"]);
      expect(b.ordenId).not.toBe("o1");
    }
  });

  it("400/R33: `conflict` (ninguna paso el gate) no lleva el aviso: no se asigno nada", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({
        o1: "geocodificacion_agotada",
        o2: "direccion_no_geocodificable",
        o3: "geocodificacion_en_curso",
      }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("conflict");
    expect(Object.keys(r)).not.toContain("sinUbicacion");
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FICHA 407 (T6, 2026-09-10) — ESPEJO EXACTO del archivo de la bodega central.
//
// Y aqui importa MAS que alli: la guia 76068276 que origina la ficha esta en bodega
// SATELITE. Si la marca solo funcionara en la central, el caso medido seguiria parado y
// quien tiene el paquete delante tendria que escalar — que es lo que produjo los cinco dias.
//
// Que se olvide en UNO de los dos lados lo caza este par de archivos: un olvido deja ESTE
// rojo y el otro verde, no ambos.
// ════════════════════════════════════════════════════════════════════════════════════════

/** Doble del gate que HONRA el segundo parametro, con la misma regla que el servicio real. */
function gateConMarca(
  porOrden: Record<string, EstadoAsignabilidad> = {},
): IAsignabilidadCoordenadasService {
  return {
    evaluar: vi.fn(
      async (ordenes: OrdenAsignabilidadRow[], autorizadas?: ReadonlySet<string>) =>
        new Map<string, EstadoAsignabilidad>(
          ordenes.map((o) => {
            const base = porOrden[o.id] ?? "asignable";
            const autorizada =
              base === "direccion_no_geocodificable" && autorizadas?.has(o.id) === true;
            return [o.id, autorizada ? "asignable_sin_ubicacion_autorizada" : base];
          }),
        ),
    ),
  };
}

/** Cola en memoria minima para poder montar el gate REAL sobre este writer. */
function colaVacia(): IJobRepository {
  return {
    enqueue: vi.fn(async () => null),
    findByDedupeKeys: vi.fn(async () => []),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as IJobRepository;
}

describe("407/R1, R6-R8, R10-R11 — AsignacionSateliteService.asignar con la marca", () => {
  function repo3(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async (ids: string[]) => ids.map((id) => ordenRow({ id }))),
      asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length),
      ...over,
    });
  }

  it("407/R1: la irresoluble MARCADA sale en `resultados` y NO en `bloqueadas`", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(r.sinUbicacionAutorizada).toBe(1);
    expect(JSON.stringify(r)).not.toContain("asignable_sin_ubicacion_autorizada");
  });

  it("407/R1: con el gate REAL enganchado, la marca viaja del input al gate y la orden se asigna", async () => {
    const filasDeProduccion = () =>
      vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          direccion: "Del doit center 8 kilometros al norte camino a papagayo",
          latitud: id === "o1" ? null : 10.63,
          longitud: id === "o1" ? null : -85.44,
          geocodeStatus: id === "o1" ? "ZERO_RESULTS" : "OK",
        })),
      );
    const repo = repo3({ findParaAsignabilidad: filasDeProduccion() });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      new AsignabilidadCoordenadasService(colaVacia()),
      fakeIntentosEnLote(),
    );

    const conMarca = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      ADMIN_SATELITE,
    );

    expect(conMarca.status).toBe("ok");
    if (conMarca.status !== "ok") throw new Error("unreachable");
    expect(conMarca.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(conMarca.sinUbicacionAutorizada).toBe(1);

    // CONTRASTE con el MISMO gate real: sin la marca, `o1` sigue bloqueada.
    const sinMarca = await new AsignacionSateliteService(
      repo3({ findParaAsignabilidad: filasDeProduccion() }) as unknown as IOrdenRepository,
      new AsignabilidadCoordenadasService(colaVacia()),
      fakeIntentosEnLote(),
    ).asignar({ ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(sinMarca.status).toBe("partial");
    if (sinMarca.status !== "partial") throw new Error("unreachable");
    expect(sinMarca.bloqueadas).toEqual([
      { ordenId: "o1", motivo: "direccion_no_geocodificable" },
    ]);
  });

  it("407/R8: lote mixto -> `partial`, la marcada se asigna y la que esta en curso se reporta", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({ o1: "direccion_no_geocodificable", o2: "geocodificacion_en_curso" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o3"]);
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "geocodificacion_en_curso" }]);
    expect(r.sinUbicacionAutorizada).toBe(1);
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o1", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("407/R2: marcar una orden que NO es autorizable no la desbloquea", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({ o2: "geocodificacion_en_curso" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o2"] },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "geocodificacion_en_curso" }]);
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
  });

  it("407/R3: marcar un id que NO esta en el lote no cambia nada", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      {
        ordenIds: ["o1", "o2", "o3"],
        mensajeroId: "m1",
        autorizarSinUbicacionIds: ["o-de-otro-lote"],
      },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.bloqueadas).toEqual([{ ordenId: "o1", motivo: "direccion_no_geocodificable" }]);
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("407/R11: las dos cifras son DISJUNTAS — una orden de la 400 y otra de la 407", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({ o1: "asignable_sin_ubicacion", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o2"] },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(1);
    expect(r.sinUbicacionAutorizada).toBe(1);
    expect((r.sinUbicacion ?? 0) + (r.sinUbicacionAutorizada ?? 0)).toBe(2);
    expect(r.resultados).toHaveLength(3);
  });

  it("407/R10: con cero autorizadas, la clave NO EXISTE en el resultado", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca(),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(r).toEqual({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
        { ordenId: "o3", estado: "por_recoger" },
      ],
    });
  });

  it("407/R10: el lote entero marcado y bloqueado -> `conflict` sin ninguna cifra", async () => {
    const repo = repo3();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gateConMarca({
        o1: "geocodificacion_en_curso",
        o2: "geocodificacion_agotada",
        o3: "geocodificacion_encolada",
      }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(
      {
        ordenIds: ["o1", "o2", "o3"],
        mensajeroId: "m1",
        autorizarSinUbicacionIds: ["o1", "o2", "o3"],
      },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("conflict");
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});

describe("407/R6-R7 — en el satelite, la marca tampoco desactiva ninguna otra guarda", () => {
  const CON_MARCA = {
    ordenIds: ["o1", "o2"],
    mensajeroId: "m1",
    autorizarSinUbicacionIds: ["o1", "o2"],
  };

  it("rol no adminSatelite -> forbidden, y el gate ni se invoca", async () => {
    const repo = fakeRepo();
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      g,
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(CON_MARCA, { usuarioId: "u", rol: "maestro" });

    expect(r.status).toBe("forbidden");
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("adminSatelite SIN zona -> sin_zona, y el gate ni se invoca", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      g,
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(CON_MARCA, ADMIN_SATELITE);

    expect(r.status).toBe("sin_zona");
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("bodega bloqueada -> bodega_bloqueada, y el gate ni se invoca", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
      })),
    });
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      g,
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(CON_MARCA, ADMIN_SATELITE);

    expect(r.status).toBe("bodega_bloqueada");
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("una orden de zona ajena -> conflict, y el gate ni se invoca", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", zonaId: "z-otra" }),
        ordenRow({ id: "o2" }),
      ]),
    });
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      g,
      fakeIntentosEnLote(),
    );

    const r = await service.asignar(CON_MARCA, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: "zona_ajena" }]);
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("una orden en el tope de intentos -> conflict, y el gate ni se invoca", async () => {
    const repo = fakeRepo();
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      g,
      // 276: el umbral por defecto es 3 intentos vigentes.
      fakeIntentosEnLote({ o1: 3 }),
    );

    const r = await service.asignar(CON_MARCA, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle.map((d) => d.motivo)).toEqual([
      MSG_TOPE_INTENTOS_ASIGNACION,
      MSG_TOPE_INTENTOS_ASIGNACION,
    ]);
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});
