import { describe, it, expect, vi } from "vitest";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
// El tope vive en `lib/constants/` (una sola fuente): lo aplica el service y lo NOMBRA el aviso
// de recorte de la UI. Se importa de su casa, no del service que lo consume.
import { TOPE_RECOLECTADAS_HOY } from "@/lib/constants/recoleccion-tienda";
import type { MiAsignacionRow } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { RecoleccionHistorialRow } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
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
//
// Feature 167 (T1.6): el MISMO service gana la LECTURA del apartado propio (`listarRecoleccion`)
// en el bloque del final. Los casos R26-R35 de la 157 de arriba NO se tocan (167/R16: la logica
// de confirmacion se conserva intacta); lo unico que cambio de ellos es el cableado del
// constructor en `makeRepo`, que ahora inyecta los dos repos de lectura y el reloj.

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
  // Feature 167: los dos repos de LECTURA son dependencias REQUERIDAS del constructor (una
  // opcional dejaria que el wiring se la olvidara). Los casos de confirmacion de la 157 no los
  // usan: aqui van como dobles vacios.
  const repoGestion = {
    findMisAsignaciones: vi.fn().mockResolvedValue([]),
    findMisAsignacionesByIds: vi.fn().mockResolvedValue([]),
  };
  const repoHistorial = { findRecoleccionesDeActor: vi.fn().mockResolvedValue([]) };
  return {
    repo,
    service: new RecoleccionTiendaService(repo, repoGestion, repoHistorial),
  };
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

// =======================================================================================
// Feature 167 (T1.6) — `listarRecoleccion`: la LECTURA del apartado propio `/recoleccion`.
//
// Dos listas con fuentes DISTINTAS a proposito:
//   - «Por recolectar» sale del ESTADO ACTUAL (`recolectando`), acotado al actor;
//   - «Recolectadas hoy» sale del HISTORIAL de la transicion, porque el estado actual ya
//     cambio en cuanto la bodega central recibio el paquete (138) y el mensajero veria
//     evaporarse su trabajo del dia justo al llegar a la central (R26).
// =======================================================================================

const RECOLECTANDO = "recolectando";
const ORIGEN_TIPO = "recoleccion_tienda";

/** Fila de "mis asignaciones" (estado actual). Los campos que R38 prohibe transportar van a
 *  valores NO nulos a proposito: si el DTO los copiara, el test lo veria. */
function asignacionRow(overrides: Partial<MiAsignacionRow> = {}): MiAsignacionRow {
  return {
    id: "o-rec",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: RECOLECTANDO,
    destinatario: "Ana Solis",
    telefonoDest: "70001111",
    direccion: "200m sur de la iglesia",
    producto: "Zapatos",
    peso: 1.2,
    montoCobrar: 25000,
    latitud: 9.93,
    longitud: -84.08,
    notas: "llamar antes",
    tiendaNombre: "Tienda Central",
    tiendaTelefono: "88880000",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Escazu",
    distritoNombre: "San Rafael",
    mensajeroAsignadoId: MENSAJERO.usuarioId,
    ...overrides,
  };
}

/** Una fila del historial tal como la entrega `findRecoleccionesDeActor`. */
function recoleccionRow(
  overrides: Partial<RecoleccionHistorialRow> = {},
): RecoleccionHistorialRow {
  return {
    ordenId: "o-hist",
    numGuia: 2002,
    numRemision: "REM-H",
    tiendaNombre: "Tienda Sur",
    recolectadaAt: new Date("2026-07-31T15:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Fila CRUDA del historial para el doble "con semantica": lleva el actor, la familia, el
 * instante y si la orden esta borrada, de modo que el doble pueda aplicar el MISMO filtro que
 * el WHERE real del repositorio (probado aparte en
 * `tests/unit/repositories/orden-historial-recolecciones-actor.test.ts`). Sin esto, "no trae la
 * de otro actor ni la de ayer" no seria mas que "el service reenvia los argumentos".
 */
interface FilaCruda extends RecoleccionHistorialRow {
  actorUsuarioId: string;
  origenTipo: string;
  ordenBorrada: boolean;
}

function cruda(overrides: Partial<FilaCruda> = {}): FilaCruda {
  return {
    ...recoleccionRow(),
    actorUsuarioId: MENSAJERO.usuarioId,
    origenTipo: ORIGEN_TIPO,
    ordenBorrada: false,
    ...overrides,
  };
}

/** Doble del repo de historial que APLICA el filtro real: actor + familia + [desde, hasta) +
 *  no borrada, `createdAt` desc, `take`. */
function historialConSemantica(filas: FilaCruda[]): HistorialDoble {
  return {
    findRecoleccionesDeActor: vi.fn(
      async (actorUsuarioId: string, desde: Date, hasta: Date, limite: number) => {
        if (limite <= 0) return [];
        return filas
          .filter(
            (f) =>
              f.actorUsuarioId === actorUsuarioId &&
              f.origenTipo === ORIGEN_TIPO &&
              !f.ordenBorrada &&
              f.recolectadaAt.getTime() >= desde.getTime() &&
              f.recolectadaAt.getTime() < hasta.getTime(),
          )
          .sort((a, b) => b.recolectadaAt.getTime() - a.recolectadaAt.getTime())
          .slice(0, limite)
          .map(({ ordenId, numGuia, numRemision, tiendaNombre, recolectadaAt }) => ({
            ordenId,
            numGuia,
            numRemision,
            tiendaNombre,
            recolectadaAt,
          }));
      },
    ),
  };
}

/** Doble tipado del repo de historial: el `Mock` conserva la firma real del metodo. */
type HistorialDoble = {
  findRecoleccionesDeActor: ReturnType<
    typeof vi.fn<
      (
        actorUsuarioId: string,
        desde: Date,
        hasta: Date,
        limite: number,
      ) => Promise<RecoleccionHistorialRow[]>
    >
  >;
};

/** Doble simple: devuelve SIEMPRE las mismas filas, sin aplicar ningun filtro. */
function historialFijo(filas: RecoleccionHistorialRow[] = []): HistorialDoble {
  return { findRecoleccionesDeActor: vi.fn(async () => filas) };
}

interface LecturaOpts {
  pendientes?: MiAsignacionRow[];
  historial?: HistorialDoble;
  ahora?: Date;
}

/** Service cableado SOLO para la lectura (los metodos de confirmacion no se ejercitan aqui). */
function makeLectura(opts: LecturaOpts = {}) {
  const repo: RepoMethods = {
    findByNumGuiaForTransicion: vi.fn(),
    findEstatusIdByValue: vi.fn(),
    recolectarEnTienda: vi.fn(),
    findMensajerosBloqueados: vi.fn(),
  };
  const repoGestion = {
    findMisAsignaciones: vi.fn().mockResolvedValue(opts.pendientes ?? []),
    // 2026-08-11: «Recolectadas hoy» pinta la MISMA card, asi que el service resuelve los datos
    // de cada orden que el historial nombra. El doble devuelve una fila por id pedido, que es lo
    // que hace la base cuando la orden existe y sigue siendo del actor; los casos que ejercen la
    // AUSENCIA (borrada o reasignada) lo sobreescriben.
    findMisAsignacionesByIds: vi.fn(async (_mensajeroId: string, ids: string[]) =>
      ids.map((id) => asignacionRow({ id })),
    ),
  };
  const repoHistorial = opts.historial ?? historialFijo();
  // Por defecto: 09:00 hora CR del 31 de julio de 2026.
  const ahora = opts.ahora ?? new Date("2026-07-31T15:00:00.000Z");
  const service = new RecoleccionTiendaService(
    repo,
    repoGestion,
    repoHistorial,
    () => ahora,
  );
  return { repo, repoGestion, repoHistorial, service };
}

describe("listarRecoleccion — autorizacion (R21)", () => {
  it.each([
    ["maestro", MAESTRO],
    ["adminTienda", ADMIN_TIENDA],
  ])("%s -> forbidden, sin leer NADA (ni pendientes ni historial)", async (_n, actor) => {
    const { repoGestion, repoHistorial, service } = makeLectura();

    expect(await service.listarRecoleccion(actor)).toEqual({ status: "forbidden" });
    expect(repoGestion.findMisAsignaciones).not.toHaveBeenCalled();
    expect(repoHistorial.findRecoleccionesDeActor).not.toHaveBeenCalled();
  });
});

describe("listarRecoleccion — «Por recolectar» (R21/R38)", () => {
  it("R21: pide EXACTAMENTE el estado `recolectando` del PROPIO actor", async () => {
    const { repoGestion, service } = makeLectura();

    await service.listarRecoleccion(MENSAJERO);

    expect(repoGestion.findMisAsignaciones).toHaveBeenCalledTimes(1);
    // Lista EXACTA: si algun dia entrara `por_recoger` o `en_reparto` aqui, este apartado
    // empezaria a mostrar ordenes de reparto y R21 se romperia en silencio.
    expect(repoGestion.findMisAsignaciones).toHaveBeenCalledWith(MENSAJERO.usuarioId, [
      RECOLECTANDO,
    ]);
  });

  it("R21: la lectura va acotada al actor, asi que otro mensajero no ve estas ordenes", async () => {
    const repoGestion = {
      findMisAsignaciones: vi.fn(async (mensajeroId: string) =>
        mensajeroId === MENSAJERO.usuarioId ? [asignacionRow()] : [],
      ),
      findMisAsignacionesByIds: vi.fn(async (_mensajeroId: string, ids: string[]) =>
        ids.map((id) => asignacionRow({ id })),
      ),
    };
    const service = new RecoleccionTiendaService(
      {
        findByNumGuiaForTransicion: vi.fn(),
        findEstatusIdByValue: vi.fn(),
        recolectarEnTienda: vi.fn(),
        findMensajerosBloqueados: vi.fn(),
      },
      repoGestion,
      historialFijo(),
    );

    const mio = await service.listarRecoleccion(MENSAJERO);
    const ajeno = await service.listarRecoleccion(OTRO_MENSAJERO);

    if (mio.status !== "ok" || ajeno.status !== "ok") throw new Error("esperaba ok");
    expect(mio.porRecolectar.map((o) => o.id)).toEqual(["o-rec"]);
    expect(ajeno.porRecolectar).toEqual([]);
  });

  // 2026-08-11 (decision del humano): la recoleccion usa la MISMA card que «Por recoger». Eso
  // RETIRA el recorte de R38 —el DTO era pobre precisamente para que la card no pudiera pintar
  // cobro, ubicacion ni detalle— y con el, la unica razon por la que las dos pantallas hermanas
  // del portal mostraban distinto de la misma orden. Los dos casos de abajo son los de R38
  // DADOS VUELTA: vigilan que el corte no vuelva a aparecer.
  it("el DTO transporta la orden COMPLETA, igual que «Por recoger»", async () => {
    const { service } = makeLectura({ pendientes: [asignacionRow()] });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecolectar).toEqual([
      {
        id: "o-rec",
        numGuia: 1001,
        numRemision: "REM-1",
        estatusValue: RECOLECTANDO,
        producto: "Zapatos",
        destinatario: "Ana Solis",
        telefonoDest: "70001111",
        direccion: "200m sur de la iglesia",
        peso: 1.2,
        montoCobrar: 25000,
        latitud: 9.93,
        longitud: -84.08,
        notas: "llamar antes",
        tiendaNombre: "Tienda Central",
        tiendaTelefono: "88880000",
        zonaNombre: "GAM",
        provinciaNombre: "San Jose",
        cantonNombre: "Escazu",
        distritoNombre: "San Rafael",
        // Una orden que sigue en la tienda no es parada de ninguna ruta, no tiene marca privada
        // (es de la gestion en reparto) y no ha tenido ningun intento de entrega.
        secuenciaRuta: null,
        marcarLuego: false,
        intentosEntrega: 0,
        // Solicitud de ayuda (2026-08-18): entro en `toDTO`, la proyeccion COMPARTIDA con «Por
        // recoger», asi que viaja tambien aqui. Que este en la lista es justo lo que este caso
        // afirma: las dos pantallas hermanas transportan los MISMOS campos. La fila del fixture
        // no la declara (es opcional, patron aditivo) -> `false`.
        ayuda: false,
      },
    ]);
  });

  it("`ayuda` es el flag REAL de la orden, no un `false` de relleno", async () => {
    // Sin este caso, el `ayuda: false` de arriba pasaria igual si alguien clavara la constante
    // en la proyeccion: el fixture tampoco lo trae. Aqui la fila SI lo trae encendido.
    const { service } = makeLectura({ pendientes: [asignacionRow({ ayuda: true })] });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecolectar[0]!.ayuda).toBe(true);
  });

  it("los campos que la card lee llegan CON la clave, no recortados", async () => {
    // Mirar las CLAVES —y no solo el objeto entero— mantiene el caso legible como contrato: si
    // alguien vuelve a recortar el DTO, la card empezaria a pintar huecos y esto lo ve primero.
    const { service } = makeLectura({ pendientes: [asignacionRow()] });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    const dto = r.porRecolectar[0]!;
    for (const requerido of [
      "montoCobrar",
      "latitud",
      "longitud",
      "secuenciaRuta",
      "marcarLuego",
      "intentosEntrega",
      "direccion",
      "notas",
      "peso",
      "cantonNombre",
      "distritoNombre",
    ]) {
      expect(dto).toHaveProperty(requerido);
    }
  });

  it("R20: sin telefono de tienda el campo es `null`, nunca `undefined`", async () => {
    // El campo es opcional en la fila (patron aditivo de la 157): un doble que no lo declare
    // debe producir `null`, que es lo que la UI usa para NO pintar controles de contacto.
    const sinTelefono = asignacionRow();
    delete sinTelefono.tiendaTelefono; // la fila lo declara `?`: aqui NI SIQUIERA esta la clave
    const { service } = makeLectura({ pendientes: [sinTelefono] });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecolectar[0]!.tiendaTelefono).toBeNull();
  });

  it("R8: sin nada asignado devuelve la lista VACIA (no un error ni un ausente)", async () => {
    const { service } = makeLectura();

    const r = await service.listarRecoleccion(MENSAJERO);

    expect(r).toEqual({
      status: "ok",
      porRecolectar: [],
      recolectadasHoy: [],
      recolectadasHoyRecortada: false,
    });
  });
});

describe("listarRecoleccion — «Recolectadas hoy» sale del HISTORIAL (R24/R25/R26/R29)", () => {
  it("R25: la lista se pide al repo de HISTORIAL, no al de asignaciones por estado", async () => {
    const { repoGestion, repoHistorial, service } = makeLectura();

    await service.listarRecoleccion(MENSAJERO);

    expect(repoHistorial.findRecoleccionesDeActor).toHaveBeenCalledTimes(1);
    // Una sola lectura por estado, y es la de pendientes: «Recolectadas hoy» NO deriva de ahi.
    expect(repoGestion.findMisAsignaciones).toHaveBeenCalledTimes(1);
    expect(repoGestion.findMisAsignaciones).toHaveBeenCalledWith(MENSAJERO.usuarioId, [
      RECOLECTANDO,
    ]);
  });

  it("R25/R26: una orden YA recibida en la bodega central sigue figurando", async () => {
    // El caso que hace obligatoria esta feature: la orden ya no esta en `recolectando` ni en
    // `en_ruta_bodega_central` —la central la recibio (138) y quedo en `en_bodega_central`—, asi
    // que NO aparece en ninguna lectura por estado. La fila de historial no se movio.
    const { service } = makeLectura({
      pendientes: [],
      historial: historialConSemantica([cruda({ ordenId: "o-ya-en-central" })]),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecolectar).toEqual([]);
    expect(r.recolectadasHoy.map((o) => o.id)).toEqual(["o-ya-en-central"]);
  });

  it("R29: no trae la de OTRO actor, ni la de AYER, ni la BORRADA, ni la de otra familia", async () => {
    const { service } = makeLectura({
      historial: historialConSemantica([
        cruda({ ordenId: "mia-hoy" }),
        cruda({ ordenId: "de-otro", actorUsuarioId: OTRO_MENSAJERO.usuarioId }),
        cruda({
          ordenId: "de-ayer",
          recolectadaAt: new Date("2026-07-30T20:00:00.000Z"), // 14:00 CR del 30
        }),
        cruda({ ordenId: "borrada", ordenBorrada: true }),
        cruda({ ordenId: "otra-familia", origenTipo: "gestion" }),
      ]),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy.map((o) => o.id)).toEqual(["mia-hoy"]);
  });

  it("R28: llega ordenada de la MAS RECIENTE a la mas antigua y el service no la reordena", async () => {
    const { service } = makeLectura({
      historial: historialFijo([
        recoleccionRow({ ordenId: "b", recolectadaAt: new Date("2026-07-31T20:00:00.000Z") }),
        recoleccionRow({ ordenId: "a", recolectadaAt: new Date("2026-07-31T08:00:00.000Z") }),
      ]),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("R28: cada item es la ORDEN COMPLETA mas el instante de la recoleccion", async () => {
    // 2026-08-11: la seccion pinta la MISMA card, asi que el item ya no son cuatro datos del
    // historial. Los de la orden salen de la segunda lectura (`findMisAsignacionesByIds`); del
    // historial se conserva lo unico que es suyo y que la orden no sabe: CUANDO se recolecto.
    const { service } = makeLectura({
      historial: historialFijo([recoleccionRow()]),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy).toHaveLength(1);
    const item = r.recolectadasHoy[0]!;
    expect(item.id).toBe("o-hist");
    expect(item.recolectadaAt).toEqual(new Date("2026-07-31T15:00:00.000Z"));
    // Los datos de la orden, los mismos que alimentan la card en las otras dos listas.
    expect(item.montoCobrar).toBe(25000);
    expect(item.direccion).toBe("200m sur de la iglesia");
    expect(item.cantonNombre).toBe("Escazu");
  });

  it("una orden que el historial nombra pero la lectura no devuelve se CAE de la lista", async () => {
    // Borrada o reasignada entre las dos lecturas: la card no admite huecos, asi que la fila se
    // omite en vez de pintarse a medias.
    const { service, repoGestion } = makeLectura({
      historial: historialFijo([recoleccionRow()]),
    });
    repoGestion.findMisAsignacionesByIds.mockResolvedValue([]);

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy).toEqual([]);
  });
});

describe("listarRecoleccion — la ventana de HOY es el dia natural de Costa Rica (R27)", () => {
  /** Los argumentos `desde`/`hasta` con los que el service llamo al repo de historial. */
  function ventanaDe(repoHistorial: { findRecoleccionesDeActor: ReturnType<typeof vi.fn> }) {
    const [, desde, hasta] = repoHistorial.findRecoleccionesDeActor.mock.calls[0]!;
    return { desde: desde as Date, hasta: hasta as Date };
  }

  it("a media mañana de CR la ventana es [06:00Z de hoy, 06:00Z de mañana)", async () => {
    // 2026-07-31T15:00Z = 09:00 hora CR del 31.
    const { repoHistorial, service } = makeLectura({
      ahora: new Date("2026-07-31T15:00:00.000Z"),
    });

    await service.listarRecoleccion(MENSAJERO);

    const { desde, hasta } = ventanaDe(repoHistorial);
    expect(desde.toISOString()).toBe("2026-07-31T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    // 24 h exactas: CR es UTC-6 FIJO, sin horario de verano.
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("BORDE 23:59 CR: sigue siendo el dia en curso, no el siguiente", async () => {
    // 2026-08-01T05:59Z = 23:59 hora CR del 31 de julio.
    const { repoHistorial, service } = makeLectura({
      ahora: new Date("2026-08-01T05:59:00.000Z"),
    });

    await service.listarRecoleccion(MENSAJERO);

    const { desde, hasta } = ventanaDe(repoHistorial);
    expect(desde.toISOString()).toBe("2026-07-31T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });

  it("BORDE 00:00 CR: el dia cambia, y la recoleccion de las 23:59 de anoche ya NO figura", async () => {
    // 2026-08-01T06:00Z = 00:00 hora CR del 1 de agosto.
    const { repoHistorial, service } = makeLectura({
      ahora: new Date("2026-08-01T06:00:00.000Z"),
      historial: historialConSemantica([
        cruda({ ordenId: "anoche", recolectadaAt: new Date("2026-08-01T05:59:00.000Z") }),
        cruda({ ordenId: "recien", recolectadaAt: new Date("2026-08-01T06:00:00.000Z") }),
      ]),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    const { desde, hasta } = ventanaDe(repoHistorial);
    expect(desde.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-08-02T06:00:00.000Z");
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy.map((o) => o.id)).toEqual(["recien"]);
  });

  it("las 19:00 hora CR pertenecen al dia que el mensajero llama HOY (no al siguiente)", async () => {
    // 2026-08-01T01:00Z = 19:00 hora CR del 31 de julio. La convencion 18:00-18:00 de
    // `RankingService` (deuda con ticket propio, feature 166) lo contaria en el dia siguiente;
    // aqui se usa la de la analitica (144/135) a proposito. Ver design §6.
    const { repoHistorial, service } = makeLectura({
      ahora: new Date("2026-08-01T01:00:00.000Z"),
    });

    await service.listarRecoleccion(MENSAJERO);

    const { desde } = ventanaDe(repoHistorial);
    expect(desde.toISOString()).toBe("2026-07-31T06:00:00.000Z");
  });

  it("sin reloj inyectado usa el del sistema (el default del constructor existe)", async () => {
    const repoHistorial = historialFijo();
    const service = new RecoleccionTiendaService(
      {
        findByNumGuiaForTransicion: vi.fn(),
        findEstatusIdByValue: vi.fn(),
        recolectarEnTienda: vi.fn(),
        findMensajerosBloqueados: vi.fn(),
      },
      {
        findMisAsignaciones: vi.fn().mockResolvedValue([]),
        findMisAsignacionesByIds: vi.fn(async (_m: string, ids: string[]) =>
          ids.map((id) => asignacionRow({ id })),
        ),
      },
      repoHistorial,
    );

    await service.listarRecoleccion(MENSAJERO);

    const [, desde, hasta] = repoHistorial.findRecoleccionesDeActor.mock.calls[0]!;
    expect((desde as Date).toISOString()).toMatch(/T06:00:00\.000Z$/);
    expect((hasta as Date).getTime() - (desde as Date).getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("listarRecoleccion — tope de presentacion (R31)", () => {
  function nRecolecciones(n: number): RecoleccionHistorialRow[] {
    return Array.from({ length: n }, (_, i) =>
      recoleccionRow({
        ordenId: `o${i}`,
        recolectadaAt: new Date(Date.UTC(2026, 6, 31, 23, 59) - i * 60_000),
      }),
    );
  }

  it("el tope es 100 y se pide UNA MAS para saber si hay recorte (sin un conteo extra)", async () => {
    const repoHistorial = historialFijo();
    const { service } = makeLectura({ historial: repoHistorial });

    await service.listarRecoleccion(MENSAJERO);

    expect(TOPE_RECOLECTADAS_HOY).toBe(100);
    const [, , , limite] = repoHistorial.findRecoleccionesDeActor.mock.calls[0]!;
    expect(limite).toBe(TOPE_RECOLECTADAS_HOY + 1);
  });

  it("justo en el tope: devuelve las 100 y NO marca recorte", async () => {
    const { service } = makeLectura({
      historial: historialFijo(nRecolecciones(100)),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy).toHaveLength(100);
    expect(r.recolectadasHoyRecortada).toBe(false);
  });

  it("por encima del tope: recorta a las 100 MAS RECIENTES y marca el recorte", async () => {
    const { service } = makeLectura({
      historial: historialFijo(nRecolecciones(101)),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy).toHaveLength(100);
    expect(r.recolectadasHoyRecortada).toBe(true);
    // Las que sobreviven son las primeras de la lista, que viene `createdAt desc`: las mas
    // recientes. La #101 (la mas antigua del dia) es la que se cae.
    expect(r.recolectadasHoy[0]!.id).toBe("o0");
    expect(r.recolectadasHoy.at(-1)!.id).toBe("o99");
  });

  it("por debajo del tope no marca recorte", async () => {
    const { service } = makeLectura({
      historial: historialFijo(nRecolecciones(3)),
    });

    const r = await service.listarRecoleccion(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.recolectadasHoy).toHaveLength(3);
    expect(r.recolectadasHoyRecortada).toBe(false);
  });
});
