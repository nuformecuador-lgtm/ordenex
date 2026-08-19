import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
  VentanaDia,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import {
  fakeIntentosEnLote,
  llamadasIntentos,
  type IntentosSvcDoble,
} from "@/tests/fixtures/intentos-entrega";

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO: Actor = { usuarioId: "m2", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  por_recoger: "os-espera",
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devuelta: "os-devuelta",
  rechazada: "os-rechazada",
  // Feature 239 (2026-08-19): gestionar `devuelta` ya NO resuelve el estatus `devuelta`, sino el
  // PRE-ESTADO. El fake tiene que conocerlo o la rama cae en "catalogo incompleto".
  devolucion_por_confirmar: "os-devolucion-por-confirmar",
};

function gestionRow(overrides: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
    zonaId: "z-satelite", // feature 47: por defecto una zona satelite (no la central)
    ...overrides,
  };
}

function asignacionRow(overrides: Partial<MiAsignacionRow> = {}): MiAsignacionRow {
  return {
    id: "o1",
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "por_recoger",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    // Feature 97: coords de la parada (ya serializadas a number|null en el repo).
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: null,
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    mensajeroAsignadoId: "m1",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true), // feature 100: no lo usa MisAsignacionesService
    ...overrides,
  };
}

function fakeOrdenRepo(
  bloqueados: string[] = [],
): Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueados"> {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    // Feature 111/R1-R4: predicado de bloqueo total (default = NO bloqueado).
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(bloqueados)),
  };
}

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    // Feature 119 (R13): el service firma las N evidencias con `createSignedUrls`; el doble
    // devuelve el mapa path -> url para que el resultado pueda mapearlas en orden.
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
}


/**
 * Feature 92 (R23/R28): doble del repo de ruta optimizada. Por defecto NO hay ruta
 * (`findByMensajero` -> null), que es el estado de un mensajero que nunca se optimizo: en
 * ese caso `porGestionar` conserva EXACTAMENTE el orden previo, asi que los tests
 * heredados de la 36/47/73 siguen midiendo lo mismo que antes.
 */
function fakeRutaRepo(
  over: Partial<Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">> = {},
): Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> {
  return {
    findByMensajero: vi.fn(async () => null),
    upsertOrigen: vi.fn(async () => {}),
    ...over,
  };
}

// Feature 115: doble del meta-repo. Por defecto SIN marcas (Set vacio) -> `marcarLuego` false
// en todas las cards, que es el estado previo a la 115; los tests heredados miden lo mismo.
function fakeMetaRepo(
  over: Partial<
    Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero">
  > = {},
): Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero"> {
  return {
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    ...over,
  };
}

function newService(
  repo: IGestionOrdenRepository = fakeRepo(),
  storage: IFileStorage = fakeStorage(),
  signed: ISignedUrlProvider = fakeSignedUrls(),
  rutaRepo: Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> = fakeRutaRepo(),
  // Feature 160: derivador de intentos EN LOTE, dependencia REQUERIDA del constructor.
  intentos: IntentosSvcDoble = fakeIntentosEnLote(),
) {
  return new MisAsignacionesService(
    repo,
    fakeOrdenRepo(),
    storage,
    signed,
    rutaRepo,
    fakeMetaRepo(),
    intentos,
  );
}

function evidencia() {
  return { contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) };
}

// --- Feature 160 (T9): intentos de entrega en lote en las DOS listas del mensajero ---

describe("listarMisAsignaciones — intentos de entrega en lote (160/R11-R15/R24)", () => {
  it("R11/R14: ambos grupos salen con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "por_recoger" }),
        asignacionRow({ id: "b", estatusValue: "en_reparto" }),
        asignacionRow({ id: "c", estatusValue: "en_reparto" }),
      ]),
    });
    // `c` no viene en el mapa: sin intentos -> 0.
    const intentos = fakeIntentosEnLote({ a: 1, b: 3 });
    const r = await newService(repo, undefined, undefined, undefined, intentos)
      .listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.porRecoger.map((o) => o.intentosEntrega)).toEqual([1]);
    // `porGestionar` se reordena por secuencia de ruta; se compara por id.
    const porId = new Map(r.porGestionar.map((o) => [o.id, o.intentosEntrega]));
    expect(porId.get("b")).toBe(3);
    expect(porId.get("c")).toBe(0); // R14: `0`, no `undefined`
  });

  it("R12: UNA sola llamada al derivador con la union de los ids de los DOS grupos", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "por_recoger" }),
        asignacionRow({ id: "b", estatusValue: "en_reparto" }),
      ]),
    });
    const intentos = fakeIntentosEnLote();
    await newService(repo, undefined, undefined, undefined, intentos).listarMisAsignaciones(
      MENSAJERO,
    );

    expect(intentos.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(intentos)).toEqual([["a", "b"]]);
  });

  it("R13/R15: sin asignaciones -> lote vacio; y los ids son los del PROPIO mensajero", async () => {
    const repo = fakeRepo({ findMisAsignaciones: vi.fn(async () => []) });
    const intentos = fakeIntentosEnLote();
    const r = await newService(repo, undefined, undefined, undefined, intentos)
      .listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    expect(llamadasIntentos(intentos)).toEqual([[]]);
    // R15: el alcance lo impuso la consulta del repo, acotada al actor.
    // Feature 167 (R34): y a EXACTAMENTE los dos estados del flujo de Entregas.
    expect(repo.findMisAsignaciones).toHaveBeenCalledWith("m1", ["por_recoger", "en_reparto"]);
  });

  it("R15: un rol no autorizado ni siquiera llega al derivador", async () => {
    const intentos = fakeIntentosEnLote();
    const r = await newService(undefined, undefined, undefined, undefined, intentos)
      .listarMisAsignaciones(MAESTRO);

    expect(r.status).toBe("forbidden");
    expect(intentos.contarIntentosEnLote).not.toHaveBeenCalled();
  });
});

// --- listarMisAsignaciones (R9-R13) ---

describe("listarMisAsignaciones (R9-R13)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().listarMisAsignaciones(MAESTRO);
    expect(r.status).toBe("forbidden");
  });

  it("R10/R13: separa por recoger (por_recoger) de por gestionar (en_reparto) + ordenEnGestionId", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "por_recoger" }),
        asignacionRow({ id: "b", estatusValue: "en_reparto" }),
      ]),
      getOrdenEnGestion: vi.fn(async () => "b"),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.porRecoger.map((o) => o.id)).toEqual(["a"]);
    expect(r.porGestionar.map((o) => o.id)).toEqual(["b"]);
    expect(r.ordenEnGestionId).toBe("b");
    // R13: la consulta se hizo con el mensajero del actor.
    expect(repo.findMisAsignaciones).toHaveBeenCalledWith("m1", ["por_recoger", "en_reparto"]);
  });

  it("Feature 61: KPIs = pendientes (en_reparto), entregadas (conteo) y porCobrar (suma COD de en_reparto; null=0)", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "por_recoger", montoCobrar: 999 }),
        asignacionRow({ id: "b", estatusValue: "en_reparto", montoCobrar: 100 }),
        asignacionRow({ id: "c", estatusValue: "en_reparto", montoCobrar: 250 }),
        asignacionRow({ id: "d", estatusValue: "en_reparto", montoCobrar: null }),
      ]),
      contarEntregadas: vi.fn(async () => 7),
      // COD ya GESTIONADO hoy (400), cualquier resultado y ya fuera de reparto: es la otra
      // mitad de 'Total a cobrar', disjunta del COD de en_reparto (350).
      sumMontoCobrarGestionadas: vi.fn(async () => 400),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // pendientes = # en_reparto (no cuenta por recoger); porCobrar suma solo en_reparto,
    // null cuenta 0 (100 + 250 + 0) — sin ventana de dia, es estado vivo.
    // totalACobrar = COD en_reparto (350) + COD gestionado hoy (400) = 750: la jornada
    // completa del mensajero, sin doble conteo (la query excluye en_reparto).
    expect(r.kpis).toEqual({
      pendientes: 3,
      entregadas: 7,
      porCobrar: 350,
      totalACobrar: 750,
    });
    // Los KPIs de jornada van ACOTADOS AL DIA de Costa Rica, y AMBOS con la MISMA ventana:
    // si cada query calculara la suya, una corrida que cruce la medianoche contaria las
    // entregas de un dia y el monto de otro.
    const ventana = (repo.contarEntregadas as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as VentanaDia;
    expect(repo.contarEntregadas).toHaveBeenCalledWith("m1", ventana);
    expect(repo.sumMontoCobrarGestionadas).toHaveBeenCalledWith("m1", ventana);
    // Ventana half-open de un dia CR: empieza a las 06:00Z (00:00 CR) y dura 24 h exactas.
    expect(ventana.desde.toISOString()).toMatch(/T06:00:00\.000Z$/);
    expect(ventana.hasta.getTime() - ventana.desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  // El acote es del DIA CALENDARIO de Costa Rica, no de "las ultimas 24 h" ni del dia UTC.
  // Es la trampa clasica del repo (ver `inicioDelDiaCREnUtc`): a las 20:00 CR el dia UTC ya
  // rodo al siguiente, y un corte en UTC le vaciaria la jornada al mensajero a las 18:00.
  it("la ventana del dia es la de CR: a las 20:00 CR sigue siendo el dia CR en curso", async () => {
    const repo = fakeRepo({});
    // 2026-07-16T02:00:00Z = 20:00 CR del 15 -> la ventana debe ser la del 15, no la del 16.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
    try {
      await newService(repo).listarMisAsignaciones(MENSAJERO);
    } finally {
      vi.useRealTimers();
    }

    const ventana = (repo.contarEntregadas as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as VentanaDia;
    expect(ventana.desde.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(ventana.hasta.toISOString()).toBe("2026-07-16T06:00:00.000Z");
  });

  // Feature 97: el DTO expone las coords de la parada (feature 91) para dibujar el mapa.
  // Es un campo de la orden -> viaja en AMBOS grupos; el `null` (sin geocodificar) se preserva.
  it("F97: el DTO propaga latitud/longitud (number|null) en porRecoger y porGestionar", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "r", estatusValue: "por_recoger", latitud: 9.9, longitud: -84.1 }),
        asignacionRow({ id: "g", estatusValue: "en_reparto", latitud: null, longitud: null }),
      ]),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.porRecoger[0]).toMatchObject({ latitud: 9.9, longitud: -84.1 });
    expect(r.porGestionar[0]).toMatchObject({ latitud: null, longitud: null });
  });

  // Feature 227 (R21) — la nota privada del mensajero (feature 116) se retiro entera junto con
  // la columna `orden_mensajero_meta.nota`. Esta asercion es sobre la AUSENCIA, y por eso no se
  // escribe con `toMatchObject` (que ignora lo que no nombra) sino sobre las CLAVES REALES del
  // objeto: un `notaPrivada: null` reintroducido por descuido pasaria desapercibido con la
  // primera forma y aqui no.
  //
  // Se comprueba en los DOS grupos porque el campo se emitia en ambos, y con `in` ademas de
  // `undefined`: el contrato es que la clave NO EXISTE, no que exista valiendo `undefined`
  // (que es lo que cruzaria el borde RSC como un hueco).
  it("el DTO no emite el campo de nota privada", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "r", estatusValue: "por_recoger" }),
        asignacionRow({ id: "g", estatusValue: "en_reparto" }),
      ]),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    for (const dto of [...r.porRecoger, ...r.porGestionar]) {
      expect(Object.keys(dto)).not.toContain("notaPrivada");
      expect("notaPrivada" in dto).toBe(false);
    }
    // Y lo que SI sigue viajando, para que este test no pueda quedar verde sobre un DTO vacio:
    // `marcarLuego` es de la feature 115 y R24 exige que no se lo lleve la retirada.
    expect(r.porRecoger[0].marcarLuego).toBe(false);
    expect(r.porGestionar[0].marcarLuego).toBe(false);
  });
});

// --- recogerAsignaciones (R14-R17) ---

describe("recogerAsignaciones (R14-R17)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().recogerAsignaciones({ ordenIds: ["o1"] }, MAESTRO);
    expect(r.status).toBe("forbidden");
  });

  it("R15/R16: recoge el lote (por_recoger -> en_reparto) de sus ordenes", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "por_recoger" }),
        gestionRow({ id: "o2", estatusValue: "por_recoger" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1", "o2"] }, MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.recogidas.sort()).toEqual(["o1", "o2"]);
    expect(repo.recogerLote).toHaveBeenCalledWith(["o1", "o2"], "m1", "os-espera", "os-reparto");
  });

  it("R17: orden de OTRO mensajero -> forbidden, sin recoger", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "por_recoger", mensajeroAsignadoId: "m2" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  it("R17: origen invalido (no por_recoger) -> conflict, sin recoger", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "en_reparto" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("conflict");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  // Feature 46/R4: una orden reprogramada NO es origen valido de "recoger"; el bloqueo de
  // envio es inherente a la maquina de estados (se verifica explicitamente, sin codigo nuevo).
  it("feature 46/R4: recoger una orden reprogramada -> conflict por origen, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "reprogramada", mensajeroAsignadoId: "m1" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("conflict");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });
});

// --- escogerParaGestion (R19-R21) ---

describe("escogerParaGestion (R19-R21)", () => {
  it("R19: fija la orden activa (en_reparto, propia)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(repo.setOrdenEnGestion).toHaveBeenCalledWith("m1", "o1");
  });

  it("R21: ya hay OTRA orden activa -> conflict", async () => {
    const repo = fakeRepo({ setOrdenEnGestion: vi.fn(async () => false) });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("conflict");
  });

  it("R31: orden ajena -> forbidden", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r = await newService(repo).escogerParaGestion("o1", OTRO);
    // OTRO es m2, la orden es de m2 -> ok; probamos el caso ajeno real:
    expect(r.status).toBe("ok");

    const repo2 = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r2 = await newService(repo2).escogerParaGestion("o1", MENSAJERO);
    expect(r2.status).toBe("forbidden");
  });
});

// --- gestionar (R18, R22-R32) ---

describe("gestionar — guardias (R12/R18/R21/R31)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
      MAESTRO,
    );
    expect(r.status).toBe("forbidden");
  });

  it("R18: origen no en_reparto (aun por_recoger) -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "por_recoger" }),
      ]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R31: orden ajena -> forbidden, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R21: otra orden activa distinta -> conflict, sin persistir", async () => {
    const repo = fakeRepo({ getOrdenEnGestion: vi.fn(async () => "o-otra") });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  // Feature 46/R4: gestionar exige origen en_reparto; una orden reprogramada se rechaza
  // por origen (bloqueo de "envio" inherente a la maquina de estados).
  it("feature 46/R4: gestionar una orden reprogramada -> conflict por origen, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "reprogramada", mensajeroAsignadoId: "m1" }),
      ]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("gestionar — ENTREGADA (R22/R23/R32)", () => {
  // Feature 212 (R11/R12): el desglose es OBLIGATORIO en el input del service y llega YA
  // normalizado desde el borde. La forma escalar historica de este fixture equivale a UNA
  // linea con el total, que es exactamente lo que produce `normalizarPagos` (R12): lo que
  // cada caso de abajo AFIRMA sigue siendo lo mismo.
  const entrega = (monto: number): GestionarInput => ({
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: monto,
    metodoPago: "efectivo",
    pagos: [{ metodo: "efectivo", monto }],
    evidencias: [evidencia()],
  });

  it("R22 (h): monto != montoCobrar -> validation_error, NO sube ni persiste", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(entrega(50), MENSAJERO);
    expect(r.status).toBe("validation_error");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  // menor-2: comparacion en Decimal EXACTA (no float).
  it("menor-2: monto == montoCobrar EXACTO -> ok (comparacion Decimal)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 100 })]),
    });
    const r = await newService(repo).gestionar(entrega(100), MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.montoRecibido).toBe(100);
  });

  it("menor-2: diferencia minima (100.01 vs 100) -> validation_error, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 100 })]),
    });
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(entrega(100.01), MENSAJERO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(r.fieldErrors.montoRecibido).toBeDefined();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("menor-2: montoCobrar null + monto 100 -> validation_error (100 no cuadra con 0)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]),
    });
    const r = await newService(repo).gestionar(entrega(100), MENSAJERO);
    expect(r.status).toBe("validation_error");
  });

  it("sin cobro: montoCobrar 0 + monto 0 -> ok (entrega sin recaudo)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 0 })]),
    });
    const r = await newService(repo).gestionar(entrega(0), MENSAJERO);
    expect(r.status).toBe("ok");
  });

  it("sin cobro: montoCobrar null + monto 0 -> ok (null cuadra con 0)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]),
    });
    const r = await newService(repo).gestionar(entrega(0), MENSAJERO);
    expect(r.status).toBe("ok");
  });

  it("R23/R32: entrega valida -> sube foto, crea gestion(entregada), deja estado entregada + URL firmada", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const signed = fakeSignedUrls();
    const r = await newService(repo, storage, signed).gestionar(entrega(100), MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estado).toBe("entregada");
    // Feature 119 (R13): el resultado devuelve la lista de URLs firmadas (una por foto).
    expect(r.evidenciaUrls?.[0]).toMatch(/^https:\/\/signed\//);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("entregada");
    expect(gArg.gestion.montoRecibido).toBe(100);
    expect(gArg.gestion.metodoPago).toBe("efectivo");
    // Feature 119 (R1): la portada (indice 0) viaja como primera evidencia de la lista.
    expect(gArg.gestion.evidencias[0].storagePath).toContain("o1/entregada-");
    expect(gArg.gestion.evidencias[0].indice).toBe(0);
    expect(gArg.nuevoEstatusId).toBe("os-entregada");
  });

  it("R8: persiste storage_path (no URL); la URL solo se firma para mostrar", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(entrega(100), MENSAJERO);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.evidencias[0].storagePath).not.toMatch(/^https?:\/\//);
  });

  it("R23: si la transaccion falla tras subir -> limpia el objeto (best-effort) y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(newService(repo, storage).gestionar(entrega(100), MENSAJERO)).rejects.toThrow(
      "db caida",
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});

describe("gestionar — REPROGRAMAR / DEVOLUCION / RECHAZO (R26/R28/R30/R32)", () => {
  it("R26: reprogramar valida -> gestion(reprogramada) + estado reprogramada, sin storage", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(storage.upload).not.toHaveBeenCalled();
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("reprogramada");
    expect(gArg.nuevoEstatusId).toBe("os-reprogramada");
  });

  it("R28 + 239/R2: devolucion valida -> sube foto, gestion(devuelta) con evidencia + estado PRE-CONFIRMACION", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "no estaba", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    // Pedido: la devolución ahora sube y persiste la evidencia (como rechazo/entrega).
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("devuelta");
    expect(gArg.gestion.evidencias[0].storagePath).toContain("o1/devuelta-");
    expect(gArg.gestion.evidencias[0].contentType).toBe("image/jpeg");
    // 2026-08-19 (feature 239/R2): el destino ya NO es `devuelta`. La aprobacion del cierre es
    // la que lleva la orden ahi; hasta entonces la tienda no la ve y su reloj no corre.
    expect(gArg.nuevoEstatusId).toBe("os-devolucion-por-confirmar");
    expect(gArg.nuevoEstatusId).not.toBe("os-devuelta");
  });

  it("feature 75: devolucion con transaccion fallida -> limpia storage y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(
      newService(repo, storage).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencias: [evidencia()] },
        MENSAJERO,
      ),
    ).rejects.toThrow("db caida");
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it("R30: rechazo valido -> sube foto, gestion(rechazada) + estado rechazada", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "rechazada", motivo: "cliente rechazo", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estado).toBe("rechazada");
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("rechazada");
    expect(gArg.gestion.evidencias[0].storagePath).toContain("o1/rechazada-");
    expect(gArg.nuevoEstatusId).toBe("os-rechazada");
  });

  it("R30: rechazo con transaccion fallida -> limpia storage y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(
      newService(repo, storage).gestionar(
        { ordenId: "o1", resultado: "rechazada", motivo: "x", evidencias: [evidencia()] },
        MENSAJERO,
      ),
    ).rejects.toThrow("db caida");
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});

// --- FEATURE 99 (R1/R29/R30): la devolucion DIFIERE el re-ruteo. INVIERTE la suite de la 47 ---
// Antes (feature 47) `gestionar` emitia una transicion de SEGUIMIENTO inmediata (reintento a
// bodega o escalado a `rechazada`) en la misma tx. Bajo la 99 esa logica se RELOCALIZO al cron
// SLA (`DevolucionSlaService`): al devolver, la orden QUEDA en `devuelta` sin seguimiento, y el
// intento se contabiliza por el append a `devuelta`. Las aserciones de reintento (<3 libera) /
// escalado (>=3 rechaza) / wrong_* directo MIGRARON a `tests/unit/services/devolucion-sla-service.test.ts`
// (no se aflojaron: se movieron al lugar donde ahora vive la capacidad, R30).

describe("gestionar — DEVUELTA queda en el PRE-ESTADO, sin seguimiento (feature 99 R1/R29 · 239 R2)", () => {
  const devolucion: GestionarInput = {
    ordenId: "o1",
    resultado: "devuelta",
    causaDevolucion: "not_found",
    motivo: "ausente",
    evidencias: [evidencia()],
  };

  function repoCall(repo: IGestionOrdenRepository) {
    return (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      nuevoEstatusId: string;
      seguimiento?: unknown;
    };
  }

  // 2026-08-19 (feature 239/R2) — EL CASO DE LA FEATURE. Antes afirmaba `os-devuelta`; ahora
  // afirma el pre-estado Y que NO es `devuelta`. Si esto volviera a `os-devuelta`, la ventana de
  // SLA arrancaria al gestionar y el cron cobraria el rechazo sin que la tienda viera la novedad.
  it("R1/239-R2: devolver deja la orden en el PRE-ESTADO (no en `devuelta`) y sin seguimiento", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: "z-satelite" })]),
    });
    const r = await newService(repo).gestionar(devolucion, MENSAJERO);
    expect(r.status).toBe("ok");
    const call = repoCall(repo);
    // 239/R2: la orden REPOSA en el pre-estado. El intento SIGUE contandose igual (R17): el
    // criterio mira `gestion_orden.resultado` + cierre aprobado + familia `gestion`, nunca el
    // destino de la transicion.
    expect(call.nuevoEstatusId).toBe("os-devolucion-por-confirmar");
    expect(call.nuevoEstatusId).not.toBe("os-devuelta");
    // R29: ni reintento a bodega ni escalado inmediato -> el input ya no lleva `seguimiento`.
    expect(call).not.toHaveProperty("seguimiento");
  });

  it("R29: la devolucion NO deriva la bodega responsable en `gestionar` (ni con zona central ni satelite)", async () => {
    // Antes la 47 resolvia en_bodega_central/en_bodega_satelite AQUI; ahora es competencia del cron.
    for (const zonaId of ["z-satelite", "z-central", null] as const) {
      const repo = fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId })]),
      });
      const ordenRepo = {
        findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
        findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()), // feature 111
      };
      const service = new MisAsignacionesService(
        repo,
        ordenRepo,
        fakeStorage(),
        fakeSignedUrls(),
        fakeRutaRepo(),
        fakeMetaRepo(),
        fakeIntentosEnLote(),
      );
      const r = await service.gestionar(devolucion, MENSAJERO);
      expect(r.status).toBe("ok");
      // `gestionar` solo resuelve el estatus del RESULTADO (`devuelta`), nunca los de bodega.
      expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalledWith("en_bodega_central");
      expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalledWith("en_bodega_satelite");
      expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalledWith("rechazada");
    }
  });

  it("R1: sin importar cuantas devoluciones previas hubo, la orden queda en el pre-estado (no escala aqui)", async () => {
    // Antes, la N-esima devolucion (N=umbral) escalaba a `rechazada` en esta misma tx. Ese
    // escalado ahora lo decide el cron: `gestionar` SIEMPRE deja `devuelta`, sin excepcion.
    const repo = fakeRepo();
    const r = await newService(repo).gestionar(devolucion, MENSAJERO);
    expect(r.status).toBe("ok");
    const call = repoCall(repo);
    expect(call.nuevoEstatusId).toBe("os-devolucion-por-confirmar"); // 2026-08-19 (239)
    expect(call).not.toHaveProperty("seguimiento");
  });

  it("R13: devolver NO escribe devolviendo_a_tienda (reservado a la feature 48)", async () => {
    const repo = fakeRepo();
    const ordenRepo = {
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()), // feature 111
    };
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      fakeStorage(),
      fakeSignedUrls(),
      fakeRutaRepo(),
      fakeMetaRepo(),
      fakeIntentosEnLote(),
    );
    await service.gestionar(devolucion, MENSAJERO);
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalledWith("devolviendo_a_tienda");
  });

  it("catalogo incompleto (sin el PRE-ESTADO) -> validation_error, sin persistir", async () => {
    const repo = fakeRepo();
    // ordenRepo que NO resuelve el destino de la rama `devuelta` (seed pendiente). 2026-08-19
    // (feature 239): ese destino es el PRE-ESTADO, no `devuelta`.
    const ordenRepo = {
      findEstatusIdByValue: vi.fn(async (v: string) =>
        v === "devolucion_por_confirmar" ? null : (ESTATUS_ID_BY_VALUE[v] ?? null),
      ),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()), // feature 111
    };
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      fakeStorage(),
      fakeSignedUrls(),
      fakeRutaRepo(),
      fakeMetaRepo(),
      fakeIntentosEnLote(),
    );
    const r = await service.gestionar(devolucion, MENSAJERO);
    expect(r.status).toBe("validation_error");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("67/R31: una orden devuelta a `en_reparto` por un deshacer es escogible (guardia 1-a-1 vigente)", async () => {
    // Tras el deshacer, la orden esta en `en_reparto` y asignada al mensajero (R18/R19): es
    // exactamente la precondicion de `cargarOrdenGestionable`. El flujo existente de la 36
    // funciona sin cambios — el deshacer NO toca el puntero (R29), asi que la retoma normal.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", mensajeroAsignadoId: "m1" }),
      ]),
      setOrdenEnGestion: vi.fn(async () => true),
    });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.setOrdenEnGestion).toHaveBeenCalledWith("m1", "o1"); // guardia 1-a-1 de la 36
  });

  it("67/R30: si el mensajero YA tiene OTRA orden activa, escoger la deshecha da conflict (1-a-1 intacta)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", mensajeroAsignadoId: "m1" }),
      ]),
      setOrdenEnGestion: vi.fn(async () => false), // ya hay otra activa
    });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("conflict");
  });

  it("R4: reprogramada tampoco pasa seguimiento (rama intacta)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(repoCall(repo)).not.toHaveProperty("seguimiento");
  });

  it("entregada NO pasa seguimiento (una sola transicion)", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(
      {
        ordenId: "o1",
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        pagos: [{ metodo: "efectivo", monto: 100 }], // feature 212: desglose normalizado (R12)
        evidencias: [evidencia()],
      },
      MENSAJERO,
    );
    expect(repoCall(repo)).not.toHaveProperty("seguimiento");
  });

  it("rechazada DIRECTA NO pasa seguimiento (una sola transicion)", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(
      { ordenId: "o1", resultado: "rechazada", motivo: "cliente rechazo", evidencias: [evidencia()] },
      MENSAJERO,
    );
    expect(repoCall(repo)).not.toHaveProperty("seguimiento");
  });

  // --- FEATURE 73 / R17: la causa viaja igual y NO altera el nuevo comportamiento diferido ---
  // Las 3 causas (not_found / wrong_number / wrong_address) dejan la orden en `devuelta` sin
  // seguimiento; la causa persiste en su columna (verificado en mis-asignaciones-causa-devolucion.test.ts)
  // y es el cron SLA quien la usa para elegir la ventana (24h vs 5 dias).
  const CAUSAS = CAUSA_DEVOLUCION_SEED; // ["not_found", "wrong_number", "wrong_address"]

  it.each(CAUSAS)(
    "73/R17: causa '%s' deja la orden en `devuelta` sin seguimiento (la ventana la decide el cron)",
    async (causa) => {
      const repo = fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: "z-satelite" })]),
      });
      const r = await newService(repo).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: causa, motivo: "ausente", evidencias: [evidencia()] },
        MENSAJERO,
      );
      expect(r.status).toBe("ok");
      const call = repoCall(repo);
      expect(call.nuevoEstatusId).toBe("os-devolucion-por-confirmar"); // 2026-08-19 (239)
      expect(call).not.toHaveProperty("seguimiento");
    },
  );
});

// --- menor-3: liberarGestion (R35) ---

describe("liberarGestion (R35)", () => {
  it("R12: rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).liberarGestion("o1", MAESTRO);
    expect(r.status).toBe("forbidden");
    expect(repo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("mensajero -> ok e invoca repo.liberarOrdenEnGestion(actor, orden)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).liberarGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(repo.liberarOrdenEnGestion).toHaveBeenCalledWith("m1", "o1");
  });

  it("idempotente: ok aunque el repo no limpiara nada (count 0 -> false)", async () => {
    const repo = fakeRepo({ liberarOrdenEnGestion: vi.fn(async () => false) });
    const r = await newService(repo).liberarGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
  });
});

// ============================================================================
// Feature 111 — bloqueo total del mensajero (R1/R2/R3/R4/R20). Un mensajero con un cierre
// `solicitado`/`vencido` no puede gestionar NI recoger/escoger. MISMO predicado derivado
// (`findMensajerosBloqueados`), guarda ANTES de cualquier efecto (sin efectos parciales).
// ============================================================================

describe("Feature 111 · bloqueo total (R1/R2/R3/R4/R20)", () => {
  // Servicio con `ordenRepo` que reporta al mensajero como BLOQUEADO (Set con "m1").
  function bloqueado(repo = fakeRepo(), storage = fakeStorage(), signed = fakeSignedUrls()) {
    const ordenRepo = fakeOrdenRepo(["m1"]);
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      storage,
      signed,
      fakeRutaRepo(),
      fakeMetaRepo(),
      fakeIntentosEnLote(),
    );
    return { service, repo, storage, signed, ordenRepo };
  }

  const entrega = (): GestionarInput => ({
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: 100,
    metodoPago: "efectivo",
    pagos: [{ metodo: "efectivo", monto: 100 }], // feature 212: desglose normalizado (R12)
    evidencias: [evidencia()],
  });

  it("R1/R3: gestionar bloqueado -> conflict; NO sube evidencia, NO transiciona, NO crea gestion_orden", async () => {
    const { service, repo, storage, ordenRepo } = bloqueado();

    const r = await service.gestionar(entrega(), MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toMatch(/cierre pendiente/i);
    // R2: reusa el MISMO predicado derivado (doble espía).
    expect(ordenRepo.findMensajerosBloqueados).toHaveBeenCalledWith(["m1"]);
    // R3: sin efectos parciales (la guarda está ANTES de la subida y de la tx).
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R2: rechazado/aprobado NO bloquean (Set vacío) -> gestionar procede normal", async () => {
    // `fakeOrdenRepo([])` = ningún estado bloqueante presente (rechazado/aprobado no cuentan).
    const repo = fakeRepo();
    const r = await newService(repo).gestionar(entrega(), MENSAJERO);
    expect(r.status).toBe("ok");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("R4: recoger bloqueado -> conflict, sin transición (recogerLote no se invoca)", async () => {
    const { service, repo, ordenRepo } = bloqueado();

    const r = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.detalle[0].motivo).toMatch(/cierre pendiente/i);
    expect(ordenRepo.findMensajerosBloqueados).toHaveBeenCalledWith(["m1"]);
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  it("R4: escoger bloqueado -> conflict, sin fijar el puntero (setOrdenEnGestion no se invoca)", async () => {
    const { service, repo, ordenRepo } = bloqueado();

    const r = await service.escogerParaGestion("o1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toMatch(/cierre pendiente/i);
    expect(ordenRepo.findMensajerosBloqueados).toHaveBeenCalledWith(["m1"]);
    expect(repo.setOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("R20: el motivo del bloqueo es texto fijo SIN PII (ni ids del actor/orden/cierre)", async () => {
    const { service } = bloqueado();
    const r = await service.gestionar(entrega(), MENSAJERO);
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).not.toMatch(/m1|o1|c1/);
  });
});

// ---------------------------------------------------------------------------------------
// Feature 167 (R34/R36) — CORTE LIMPIO: Entregas ya no sabe nada de la recoleccion en tienda.
//
// Este bloque SUSTITUYE al `describe` "tercer grupo por recolectar (feature 157)" (7 casos),
// que dejo de tener sujeto: `porRecolectar` ya no existe en el contrato. Su cobertura no se
// pierde, se MUEVE: los casos de contenido (agrupacion, telefono de la tienda, alcance por
// actor) viven ahora en `recoleccion-tienda-service.test.ts` > `listarRecoleccion`, y los de
// NO-CONTAMINACION (157/R39: KPIs, paradas) se sustituyen aqui por su forma FUERTE — si el
// estado ni siquiera se LEE, no hay nada que pueda contaminar nada.
// ---------------------------------------------------------------------------------------
describe("MisAsignacionesService — corte limpio de la recoleccion (feature 167)", () => {
  const RECOLECTANDO = "recolectando";

  it("R34: pide EXACTAMENTE `[\"por_recoger\", \"en_reparto\"]`, ni un estado mas", async () => {
    const repo = fakeRepo();

    await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(repo.findMisAsignaciones).toHaveBeenCalledTimes(1);
    // Lista EXACTA (no `arrayContaining`): la forma fuerte de R34. Si alguien reintrodujera
    // `recolectando` "porque estaba antes", este caso lo caza antes que la pantalla.
    expect(repo.findMisAsignaciones).toHaveBeenCalledWith(MENSAJERO.usuarioId, [
      "por_recoger",
      "en_reparto",
    ]);
  });

  it("R34: el resultado NO declara ningun grupo de recoleccion", async () => {
    const r = await newService().listarMisAsignaciones(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r).not.toHaveProperty("porRecolectar");
    expect(Object.keys(r).sort()).toEqual([
      "kpis",
      "ordenEnGestionId",
      "porGestionar",
      "porRecoger",
      "ruta",
      "status",
    ]);
  });

  it("R34: aunque el repo devolviera una orden en `recolectando`, no cae en NINGUN grupo", async () => {
    // Defensa en profundidad: el estado ya no se pide, pero si una lectura futura lo trajera
    // (un repo mal cableado, un merge descuidado), NO debe colarse en "Por recoger" ni en
    // "Por gestionar" — donde el mensajero podria recogerla o gestionarla por error.
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "o-rec", estatusValue: RECOLECTANDO }),
        asignacionRow({ id: "o-recoger", estatusValue: "por_recoger" }),
        asignacionRow({ id: "o-reparto", estatusValue: "en_reparto" }),
      ]),
    });

    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecoger.map((o) => o.id)).toEqual(["o-recoger"]);
    expect(r.porGestionar.map((o) => o.id)).toEqual(["o-reparto"]);
  });

  it("R36: los KPIs y las paradas derivan SOLO de `en_reparto` (el COD de una recoleccion no cuenta)", async () => {
    // Sustituto de los dos casos de 157/R39. El COD de una orden que sigue en la tienda no es
    // plata en la calle del mensajero, y una recoleccion no es una parada de ruta.
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "o-rec1", estatusValue: RECOLECTANDO, montoCobrar: 5000 }),
        asignacionRow({ id: "o-rec2", estatusValue: RECOLECTANDO, montoCobrar: 3000 }),
      ]),
    });

    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.kpis).toMatchObject({ pendientes: 0, porCobrar: 0, totalACobrar: 0 });
    expect(r.ruta.paradasSinOptimizar).toBe(0);
  });
});
