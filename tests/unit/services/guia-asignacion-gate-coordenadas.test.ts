import { describe, it, expect, vi } from "vitest";
import {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_TOPE_INTENTOS_ASIGNACION,
} from "@/lib/services/mensajes-bloqueo";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
// FICHA 407 (T5): el gate REAL, para medir el cable entero — input -> writer -> gate.
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R8) — el gate de asignabilidad enganchado en los writers de
// `mensajero_asignado_id` de `GuiaAsignacionService`.
//
// La invariante que este archivo protege: una orden sin coordenadas utilizables NUNCA
// entra a la ruta de un mensajero, y el rechazo es TODO-O-NADA por lote (contrato ya
// vigente de estos services, no se cambia) con un `motivo` que identifica el estado.
//
// FEATURE 156 (R12/R19) — `generarGuia` deja de escribir `mensajero_asignado_id`, asi que
// sale de la lista de writers y el gate DEJA de aplicarsele: numerar una orden y moverla a
// la bodega central no la mete en la ruta de nadie. Los casos de `generarGuia` no se
// borran: se INVIERTEN (ahora terminan en `ok`) y ademas se afirma que el gate ni se
// invoca. Los de `asignarDesdeBodega` se conservan INTACTOS — es el punto del que depende
// la invariante, porque ahi si se asigna. Tras esta feature los dos unicos writers del
// sistema son `asignarDesdeBodega` (aqui) y `AsignacionSateliteService` (su propio test).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const GAM = "z-gam";

const ESTATUS: Record<string, string> = {
  por_recoger: "os-espera",
  en_bodega_central: "os-bodega",
  en_ruta_bodega_satelite: "os-ruta-satelite",
};

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    // Feature 156: `en_preparacion` es el unico origen de generar guia.
    estatusValue: "en_preparacion",
    numGuia: null,
    deletedAt: null,
    zonaId: GAM,
    zonaEsGam: true,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}): IOrdenRepository {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    findByIdsForTransicion: vi.fn(async () => [ordenRow()]),
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosNoAsignablesPorEstado: vi.fn(async (): Promise<Set<string>> => new Set()),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    // Feature 157 (regla de dedicacion): nadie ocupado, para no interferir con el gate.
    findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
    findMensajerosByZona: vi.fn(async () => []),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: null, longitud: null, geocodeStatus: null })),
    ),
    generarGuiaLote: vi.fn(async (ds: { ordenId: string }[]) =>
      ds.map((d, i) => ({ ordenId: d.ordenId, numGuia: i + 1 })),
    ),
    asignarBodegaLote: vi.fn(async () => 1),
    ...over,
  } as unknown as IOrdenRepository;
}

function fakeZonaRepo(): IZonaRepository {
  return { findCentralZonaId: vi.fn(async () => GAM) } as unknown as IZonaRepository;
}

/** Gate que devuelve el estado indicado por orden; el resto, `asignable`. */
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

describe("156/R12 — generarGuia YA NO pasa por el gate (dejo de asignar mensajero)", () => {
  // Estos son los mismos casos que antes exigian el gate en `generarGuia`. No se borran:
  // se invierten, porque la razon de ser del gate desaparecio de esta via. Si alguien
  // devolviera la asignacion a `generarGuia` sin devolver el gate, estos casos seguirian
  // verdes — por eso el archivo conserva ADEMAS los de `asignarDesdeBodega` (R19), que son
  // los que de verdad protegen la invariante.
  it.each(NO_ASIGNABLES)("motivo %s -> ok igualmente, la orden se numera", async (estado) => {
    const repo = fakeRepo();
    const g = gate({ o1: estado });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_bodega_central" });
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
    // Ni se consulta: no hay a quien asignar, no hay coordenadas que exigir.
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.findParaAsignabilidad).not.toHaveBeenCalled();
  });

  it("un lote entero sin coordenadas se numera completo (ninguna orden entra a una ruta)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
        ordenRow({ id: "o3" }),
      ]),
    });
    const g = gate({ o2: "geocodificacion_agotada" });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2", "o3"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toHaveLength(3);
    expect(g.evaluar).not.toHaveBeenCalled();
  });

  it("156/R2: ninguna decision del lote lleva mensajero (por eso el gate sobra)", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    const decisiones = vi.mocked(repo.generarGuiaLote).mock.calls[0]![0] as {
      mensajeroAsignadoId: string | null;
    }[];
    for (const d of decisiones) expect(d.mensajeroAsignadoId).toBeNull();
  });
});

// 156/R19 — NO-REGRESION. Ni una asercion de este bloque se relaja: `asignarDesdeBodega` es
// uno de los dos unicos escritores de `mensajero_asignado_id` que quedan y conserva el gate.
describe("R8 — asignarDesdeBodega (todo el lote recibe mensajero)", () => {
  function repoBodega(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
      ]),
      ...over,
    });
  }

  // Feature 21 (pedido humano 2026-08-26): el mensajero es de la zona GAM y esta libre,
  // pero no tiene vehiculo asociado. Se para AQUI y con motivo propio: el mismo texto que
  // emite la asignacion desde bodega satelite, porque es la misma regla.
  it("feature 21: mensajero sin vehiculo asociado -> validation_error, sin persistir", async () => {
    const repo = repoBodega({
      findMensajeroIdsConVehiculo: vi.fn(async () => new Set<string>()),
      findMensajerosNoAsignablesPorEstado: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { mensajeroId: [MSG_MENSAJERO_SIN_VEHICULO] },
    });
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  // Feature 368 (R1/R18) — ACTUALIZADO: una sola orden bloqueada por coordenadas YA NO aborta
  // el lote. La asignable se asigna (`partial`), la bloqueada se reporta, y `asignarBodegaLote`
  // se llama SOLO con la asignable.
  it.each(NO_ASIGNABLES)("motivo %s -> partial: asigna la asignable, reporta la bloqueada", async (estado) => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate({ o1: estado }), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("partial");
    if (r.status === "partial") {
      expect(r.resultados).toEqual([{ ordenId: "o2", estado: "por_recoger" }]);
      expect(r.bloqueadas).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o2"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // Feature 368 (R3) — NUEVO: ninguna orden asignable por coordenadas -> sigue siendo
  // `conflict` sin ningun efecto (no-regresion del caso ya cubierto en el archivo gemelo de
  // satelite, "TODO-O-NADA: dos ordenes no asignables...").
  it("368/R3: las DOS ordenes bloqueadas por coordenadas -> conflict SIN persistir", async () => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "geocodificacion_agotada", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([
        { ordenId: "o1", motivo: "geocodificacion_agotada" },
        { ordenId: "o2", motivo: "direccion_no_geocodificable" },
      ]);
    }
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  // Feature 368 (R1) — NUEVO: la bloqueada al MEDIO del lote no reordena nada; `resultados` y
  // `bloqueadas` preservan el orden original de `ordenIds` (protege contra un `filter`/`Set`
  // que reordene).
  it("368/R1: lote de 3 con la bloqueada al medio preserva el orden en ambos arrays", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o3", estatusValue: "en_bodega_central" }),
      ]),
    });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o2: "geocodificacion_en_curso" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("partial");
    if (r.status === "partial") {
      expect(r.resultados).toEqual([
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o3", estado: "por_recoger" },
      ]);
      expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "geocodificacion_en_curso" }]);
    }
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("el gate evalua el LOTE ENTERO (aqui todas reciben mensajero)", async () => {
    const repo = repoBodega();
    const g = gate();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(repo.findParaAsignabilidad).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("todas asignables -> persiste con normalidad", async () => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
  });

  it("el gate corre ANTES de resolver el catalogo de estados (aborta lo antes posible)", async () => {
    const orden: string[] = [];
    const repo = repoBodega({
      findParaAsignabilidad: vi.fn(async (ids: string[]) => {
        orden.push("gate");
        return ids.map((id) => ({
          id,
          direccion: "x",
          latitud: null,
          longitud: null,
          geocodeStatus: null,
        }));
      }),
      findEstatusIdByValue: vi.fn(async (v: string) => {
        orden.push(`estatus:${v}`);
        return ESTATUS[v] ?? null;
      }),
    });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(orden).toContain("gate");
    expect(orden.filter((o) => o.startsWith("estatus:en_espera"))).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FEATURE 400 (T10/T10b, 2026-09-09) — LA ORDEN SIN UBICACION SI SE ASIGNA, Y SE CUENTA
//
// El 2026-09-08 la credencial de Google empezo a rechazar todas las peticiones y 42 ordenes
// quedaron 19 horas sin poder asignarse a NINGUN mensajero. La causa era nuestra y la
// direccion estaba bien. Desde esta ficha esas ordenes pasan el gate como
// `asignable_sin_ubicacion`: reciben mensajero, NO entran en `bloqueadas`, y el writer
// informa CUANTAS quedaron asi — cuantas, nunca cuales (R32).
// ════════════════════════════════════════════════════════════════════════════════════════
describe("400/R6-R7, R31-R33, R35 — asignarDesdeBodega con ordenes `asignable_sin_ubicacion`", () => {
  function repoBodega3(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o3", estatusValue: "en_bodega_central" }),
      ]),
      ...over,
    });
  }

  it("400/R6: recibe mensajero y NO entra en el detalle — el lote sale `ok`, no `partial`", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    // La orden sin ubicacion esta ENTRE las asignadas, no fuera.
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1", "o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // R10: el estado nuevo NO aparece como motivo en ningun sitio del resultado.
    expect(JSON.stringify(r)).not.toContain("asignable_sin_ubicacion");
  });

  it("400/R7: la escritura NO lleva latitud, longitud, geocodeStatus ni geocodedAt", async () => {
    // Doble que REVIENTA si el writer intentara escribir ubicacion: la orden queda asignada
    // Y SIN ubicacion. Escribir un `geocode_status` aqui seria inventarse un desenlace de
    // geocodificacion que nunca ocurrio.
    const PROHIBIDOS = ["latitud", "longitud", "geocodeStatus", "geocodedAt"];
    const asignarBodegaLote = vi.fn(async (...args: unknown[]) => {
      for (const arg of args) {
        if (arg === null || typeof arg !== "object") continue;
        for (const clave of Object.keys(arg as Record<string, unknown>)) {
          if (PROHIBIDOS.includes(clave)) {
            throw new Error(`el writer paso ${clave} al repositorio (400/R7)`);
          }
        }
      }
      return 3;
    });
    const repo = repoBodega3({ asignarBodegaLote });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion", o2: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(asignarBodegaLote).toHaveBeenCalledTimes(1);
    // No-vacuidad: el doble corrio de verdad y reviso argumentos reales.
    const args = asignarBodegaLote.mock.calls[0] as unknown[];
    expect(args[0]).toEqual(["o1", "o2", "o3"]);
    expect(args.some((a) => a !== null && typeof a === "object")).toBe(true);
  });

  it("400/R31: N ordenes sin ubicacion -> `sinUbicacion` vale N en el resultado `ok`", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion", o3: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(2);
  });

  it("400/R31: tambien viaja en `partial`, junto a las bloqueadas", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(1);
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "direccion_no_geocodificable" }]);
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o3"]);
  });

  it("400/R32: es un NUMERO, no una lista — ningun id ni guia se cuela por ese campo", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion", o3: "asignable_sin_ubicacion" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(typeof r.sinUbicacion).toBe("number");
    expect(Array.isArray(r.sinUbicacion)).toBe(false);
    // Un `number` no se puede des-agregar: no hay forma de saber CUALES eran.
    expect(JSON.stringify(r.sinUbicacion)).toBe("2");
  });

  it("400/R33: sin ninguna orden sin ubicacion, la clave NO EXISTE en el resultado", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    // AUSENTE, no `sinUbicacion: 0`: es lo que mantiene verdes los `toEqual` vigentes y lo
    // que le dice al modal «no hay nada que avisar» sin ninguna rama extra.
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
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "asignable_sin_ubicacion", o2: "geocodificacion_agotada" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    if (r.status !== "partial") throw new Error("unreachable");
    // Hermanos del MISMO objeto...
    expect(Object.keys(r).sort()).toEqual(
      ["bloqueadas", "resultados", "sinUbicacion", "status"].sort(),
    );
    // ...y la cifra no aparece dentro de la lista de bloqueadas ni la contamina.
    expect(JSON.stringify(r.bloqueadas)).not.toContain("sinUbicacion");
    for (const b of r.bloqueadas) {
      expect(Object.keys(b).sort()).toEqual(["motivo", "ordenId"]);
      expect(b.ordenId).not.toBe("o1"); // la sin-ubicacion NO esta ahi dentro
    }
  });

  it("400/R33: cuando NINGUNA orden pasa el gate el desenlace sigue siendo `conflict`, sin aviso", async () => {
    // `conflict` significa cero efectos: no se asigno nada, asi que no hay nada de que
    // avisar. Es la unica rama que no puede llevar el campo.
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({
        o1: "geocodificacion_agotada",
        o2: "direccion_no_geocodificable",
        o3: "geocodificacion_en_curso",
      }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    expect(Object.keys(r)).not.toContain("sinUbicacion");
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FICHA 407 (T5, 2026-09-10) — LA MARCA LLEGA AL GATE, Y NO ABRE NINGUNA OTRA PUERTA
//
// Guia 76068276 (Quesada / San Carlos), `ZERO_RESULTS`, cinco dias parada: la direccion de
// referencias es seguible para el mensajero pero ilegible para el mapa. Desde esta ficha el
// operador puede AUTORIZAR esa asignacion a sabiendas, en la misma peticion que asigna.
//
// Lo que este bloque protege, ademas del camino feliz:
//   - que el writer REENVIE de verdad el conjunto al gate (el «composition root que no
//     inyecta»: importar el parametro y no pasarlo deja la suite verde y la feature muerta);
//   - que la marca NO desactive ninguna otra guarda (R6/R7): rol, cierres, origen y tope se
//     evaluan ANTES y siguen abortando el lote sin escribir nada;
//   - que las dos cifras (400 y 407) sean DISJUNTAS (R11) y la nueva desaparezca en cero (R10).
// ════════════════════════════════════════════════════════════════════════════════════════

/**
 * Doble del gate que HONRA el segundo parametro con la misma regla que el servicio real:
 * la marca solo convierte `direccion_no_geocodificable`, y solo si el id viene en el conjunto.
 *
 * Si el writer no reenviara el conjunto, `autorizadas` llega `undefined` y todos estos casos
 * se ponen rojos — que es exactamente para lo que existe este doble.
 */
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

describe("407/R1, R6-R8, R10-R11 — asignarDesdeBodega con la marca", () => {
  function repoBodega3(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o3", estatusValue: "en_bodega_central" }),
      ]),
      ...over,
    });
  }

  it("407/R1: la irresoluble MARCADA sale en `resultados` y NO en `bloqueadas`", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(r.sinUbicacionAutorizada).toBe(1);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1", "o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // El estado nuevo no se filtra como `motivo` a ningun sitio del resultado.
    expect(JSON.stringify(r)).not.toContain("asignable_sin_ubicacion_autorizada");
  });

  // EL CABLE, MEDIDO CON EL GATE REAL. Un doble puede honrar el parametro y aun asi mentir si
  // el writer se lo pasa mal; aqui el gate es `AsignabilidadCoordenadasService` de verdad y la
  // fila viene de `findParaAsignabilidad` con el `ZERO_RESULTS` del caso de produccion.
  it("407/R1: con el gate REAL enganchado, la marca viaja del input al gate y la orden se asigna", async () => {
    // `o1` es el caso de produccion: `ZERO_RESULTS` y sin coordenadas. Las otras dos tienen
    // coordenadas, asi que salen por R2 y no tocan la cola.
    const filasDeProduccion = () =>
      vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          direccion: "DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR",
          latitud: id === "o1" ? null : 9.93,
          longitud: id === "o1" ? null : -84.08,
          geocodeStatus: id === "o1" ? "ZERO_RESULTS" : "OK",
        })),
      );
    const repo = repoBodega3({ findParaAsignabilidad: filasDeProduccion() });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      new AsignabilidadCoordenadasService(colaVacia()),
      fakeIntentosEnLote(),
    );

    const conMarca = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      MAESTRO,
    );

    expect(conMarca.status).toBe("ok");
    if (conMarca.status !== "ok") throw new Error("unreachable");
    expect(conMarca.resultados.map((x) => x.ordenId)).toEqual(["o1", "o2", "o3"]);
    expect(conMarca.sinUbicacionAutorizada).toBe(1);

    // CONTRASTE, con el MISMO gate real y el mismo lote: sin la marca, `o1` sigue bloqueada.
    // Sin este contraste, un gate que dejara pasar `ZERO_RESULTS` por su cuenta pasaria igual.
    const sinMarca = await new GuiaAsignacionService(
      repoBodega3({ findParaAsignabilidad: filasDeProduccion() }),
      fakeZonaRepo(),
      new AsignabilidadCoordenadasService(colaVacia()),
      fakeIntentosEnLote(),
    ).asignarDesdeBodega({ ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" }, MAESTRO);

    expect(sinMarca.status).toBe("partial");
    if (sinMarca.status !== "partial") throw new Error("unreachable");
    expect(sinMarca.bloqueadas).toEqual([
      { ordenId: "o1", motivo: "direccion_no_geocodificable" },
    ]);
  });

  it("407/R8: lote mixto -> `partial`, la marcada se asigna y la que esta en curso se reporta", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({ o1: "direccion_no_geocodificable", o2: "geocodificacion_en_curso" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o1"] },
      MAESTRO,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.ordenId)).toEqual(["o1", "o3"]);
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "geocodificacion_en_curso" }]);
    expect(r.sinUbicacionAutorizada).toBe(1);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("407/R2: marcar una orden que NO es autorizable no la desbloquea", async () => {
    // Hostil a proposito: el cliente manda la marca sobre una orden `geocodificacion_en_curso`.
    // El gate no la honra ahi, asi que la orden sigue bloqueada y no recibe mensajero.
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({ o2: "geocodificacion_en_curso" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o2"] },
      MAESTRO,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.bloqueadas).toEqual([{ ordenId: "o2", motivo: "geocodificacion_en_curso" }]);
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("407/R3: marcar un id que NO esta en el lote no cambia nada", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      {
        ordenIds: ["o1", "o2", "o3"],
        mensajeroId: "m1",
        autorizarSinUbicacionIds: ["o-de-otro-lote"],
      },
      MAESTRO,
    );

    expect(r.status).toBe("partial");
    if (r.status !== "partial") throw new Error("unreachable");
    expect(r.bloqueadas).toEqual([{ ordenId: "o1", motivo: "direccion_no_geocodificable" }]);
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("407/R11: las dos cifras son DISJUNTAS — una orden de la 400 y otra de la 407", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({ o1: "asignable_sin_ubicacion", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1", autorizarSinUbicacionIds: ["o2"] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.sinUbicacion).toBe(1);
    expect(r.sinUbicacionAutorizada).toBe(1);
    // Ninguna orden se cuenta dos veces: 1 + 1 = 2 de las 3 asignadas.
    expect((r.sinUbicacion ?? 0) + (r.sinUbicacionAutorizada ?? 0)).toBe(2);
    expect(r.resultados).toHaveLength(3);
  });

  it("407/R10: con cero autorizadas, la clave NO EXISTE en el resultado", async () => {
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca(),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      MAESTRO,
    );

    // `not.toHaveProperty`, NO `toBeUndefined()`: este pasaria igual si la clave existiera con
    // valor `undefined`, y entonces los `toEqual` vigentes de arriba se romperian.
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
    // `conflict` significa cero efectos, asi que no hay nada de que avisar. La marca sobre
    // motivos no autorizables no cambia eso.
    const repo = repoBodega3();
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gateConMarca({
        o1: "geocodificacion_en_curso",
        o2: "geocodificacion_agotada",
        o3: "geocodificacion_encolada",
      }),
      fakeIntentosEnLote(),
    );

    const r = await service.asignarDesdeBodega(
      {
        ordenIds: ["o1", "o2", "o3"],
        mensajeroId: "m1",
        autorizarSinUbicacionIds: ["o1", "o2", "o3"],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    expect(r).not.toHaveProperty("sinUbicacionAutorizada");
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

describe("407/R6-R7 — la marca NO desactiva ninguna otra guarda", () => {
  function repoBodega2(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
      ]),
      ...over,
    });
  }

  const CON_MARCA = {
    ordenIds: ["o1", "o2"],
    mensajeroId: "m1",
    autorizarSinUbicacionIds: ["o1", "o2"],
  };

  it("un actor sin acceso total -> forbidden, y el gate ni se invoca", async () => {
    const repo = repoBodega2();
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega(CON_MARCA, {
      usuarioId: "u-sat",
      rol: "adminSatelite",
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("mensajero bloqueado por cierres -> conflict, sin escribir y sin llegar al gate", async () => {
    const repo = repoBodega2({
      findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>(["m1"])),
    });
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega(CON_MARCA, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle.map((d) => d.motivo)).toEqual([
      MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
      MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
    ]);
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("una orden en un origen NO permitido -> conflict, sin escribir y sin llegar al gate", async () => {
    const repo = repoBodega2({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "por_recoger" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
      ]),
    });
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega(CON_MARCA, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle.map((d) => d.ordenId)).toEqual(["o1"]);
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("una orden en el tope de intentos -> conflict, sin escribir y sin llegar al gate", async () => {
    const repo = repoBodega2();
    const g = gateConMarca({ o1: "direccion_no_geocodificable" });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      g,
      // 276: el umbral por defecto es 3 intentos vigentes.
      fakeIntentosEnLote({ o1: 3 }),
    );

    const r = await service.asignarDesdeBodega(CON_MARCA, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle.map((d) => d.motivo)).toEqual([
      MSG_TOPE_INTENTOS_ASIGNACION,
      MSG_TOPE_INTENTOS_ASIGNACION,
    ]);
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});
