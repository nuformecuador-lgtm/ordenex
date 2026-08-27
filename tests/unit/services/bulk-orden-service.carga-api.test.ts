import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type {
  CreateOrdenData,
  CreateOrdenConGuiaResultRow,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import {
  MSG_CARGA_SIN_TARIFA,
  MSG_FILA_SIN_TARIFA,
} from "@/lib/services/mensajes-tarifa";
import { ConflictError } from "@/lib/errors/app-error";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

// Feature 98 — tarifa vigente por defecto del lote (no-central: valorFlete; central:
// valorFleteGam). `ivaFlete` 12% no trivial para verificar la suma del IVA (D2/R7).
//
// Feature 274: pasa a ser la tarifa de la ZONA `z1` (la del distrito por defecto del doble de
// repositorio). El tipo es `TarifaVigenteResuelta` porque el resolver de la 274 devuelve
// tambien `tarifaId`/`fulfillment`; los 7 campos de la formula no cambian (R24).
const TARIFA: TarifaVigenteResuelta = {
  tarifaId: "t-z1",
  fulfillment: "0.00",
  valorFlete: "3.50", // -> costoEnvio no-central = 3.50 + 12% = "3.92"
  valorFleteGam: "5.00", // -> costoEnvio central = 5.00 + 12% = "5.60"
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00", // 12%
  ivaComisionCod: "12.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

// Feature 274/R25 — tarifa DISTINTA para la zona `z2`: es lo que permite comprobar que dos
// ordenes del MISMO lote en zonas distintas cobran distinto (hasta la 273 cobraban lo mismo:
// habia una unica tarifa por lote).
const TARIFA_Z2: TarifaVigenteResuelta = {
  ...TARIFA,
  tarifaId: "t-z2",
  valorFlete: "10.00", // -> costoEnvio no-central = 10.00 + 12% = "11.20"
  valorFleteGam: "20.00",
};

/**
 * FULFILLMENT (2026-08-25) — la MISMA tarifa de z1 pero con monto de fulfillment. Es el unico
 * dato que cambia donde nace la orden por esta via: `fulfillment > 0` -> la tienda hace
 * fulfillment -> `en_preparacion` sin guia. El monto (2.00) tambien se suma a `costoEnvio`.
 */
const TARIFA_FULFILLMENT: TarifaVigenteResuelta = { ...TARIFA, fulfillment: "2.00" };

/**
 * Fake del resolver de la CASCADA (R1-R7). Se le da un mapa `zonaId -> tarifa`; todo par cuya
 * zona no este en el mapa resuelve `null`, que es el hueco de tarifa (R2).
 *
 * `resolveTarifas` devuelve UNA entrada por CADA par pedido, indexada por `clavePar`, igual
 * que el repositorio real: si el service consultara con un par mal construido, el fake
 * devolveria `undefined` y la fila caeria como "sin tarifa" — el fake no perdona.
 */
function buildTarifaRepoPorZona(
  porZona: Record<string, TarifaVigenteResuelta>,
): ITarifaVigenteRepository {
  return {
    resolveTarifa: vi.fn(async (_tiendaId: string, zonaId: string | null) =>
      zonaId === null ? null : porZona[zonaId] ?? null,
    ),
    resolveTarifas: vi.fn(
      async (pares: readonly ParTarifa[]) =>
        new Map<string, TarifaVigenteResuelta | null>(
          pares.map((p) => [clavePar(p), p.zonaId === null ? null : porZona[p.zonaId] ?? null]),
        ),
    ),
  };
}

// Atajo compatible con los casos de la 98: `tarifa` para TODA zona; `null` = ninguna zona
// resuelve (el hueco de tarifa, que desde la 274 es un 409 de lote, R29).
function buildTarifaRepo(
  tarifa: TarifaVigenteResuelta | null = TARIFA,
): ITarifaVigenteRepository {
  return buildTarifaRepoPorZona(tarifa === null ? {} : { z1: tarifa, z2: tarifa });
}

// Servicio con las dos dependencias (repo + tarifa). Por defecto usa la TARIFA de arriba.
function buildService(
  repo: IOrdenRepository,
  tarifaRepo: ITarifaVigenteRepository = buildTarifaRepo(),
): BulkOrdenService {
  return new BulkOrdenService(repo, tarifaRepo);
}

// Feature 88 — BulkOrdenService.cargarViaApi: reusa la resolucion/dedup/validacion de la
// carga masiva pero autoriza SOLO al rol apiKey y persiste con num_guia inmediato.
//
// FEATURE 155 (R19-R23): el estado inicial DEJA DE SER FIJO. Se resuelve con el mismo punto de
// decision que la via sesion (`resolverDestinoCreacion`) sobre el flag `fulfillment` del dueño
// de la key. Las aserciones de "no consulta fulfillment" no se borran: se INVIERTEN, porque son
// justamente el contrato que esta feature cambia. En la practica el dueño de una key tiene rol
// `apiKey` y el flag solo se acepta para `adminTienda`, asi que el caso vivo es siempre la
// rama (b): `por_recolectar_en_tienda` con guia en el acto.

const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" as RolValue };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };

// Mock por defecto de la persistencia con guia: hace eco de las filas recibidas,
// asignando guias consecutivas desde 1000 y el estado inicial resuelto por la bifurcacion.
// Feature 155/R21: respeta `opciones.conGuia` — con `false` NO reparte numeros (devuelve
// `null`), que es exactamente lo que hace el repositorio real.
function conGuiaEco(
  data: CreateOrdenData[],
  opciones?: { conGuia?: boolean },
): CreateOrdenConGuiaResultRow[] {
  const conGuia = opciones?.conGuia ?? true;
  return data.map((d, i) => ({
    ordenId: `ord-${d.numRemision}`,
    numRemision: d.numRemision,
    numGuia: conGuia ? 1000 + i : null,
    estatusValue: conGuia ? "por_recolectar_en_tienda" : "en_preparacion",
  }));
}

function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    // Feature 260 (B3): hidratacion por lote de ids. No la ejercita este servicio.
    findListItemsByIds: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    // Feature «eliminar orden»: writer de `deleted_at`. Ningun servicio de este archivo lo
    // invoca; el doble existe para satisfacer el contrato completo del repo.
    softDelete: vi.fn().mockResolvedValue(0),
    // Pedido humano 2026-08-27: el gemelo, `restore`. Mismo motivo que su vecino.
    restore: vi.fn().mockResolvedValue(0),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-erbp"),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]),
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      ]),
    createManyOrdenes: vi.fn().mockResolvedValue({ inserted: 0, cargaId: null }),
    // Feature 141 (R47/R48): persistencia de las URLs de descarga de etiquetas.
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
    // Feature 141: el repo devuelve las creadas + el `cargaId` del lote de ESTA peticion.
    // Feature 155/R21: `opciones.conGuia` viaja ahora en el 5.º parametro (detras del contexto
    // del lote de la 141), y sigue decidiendo si la fila nace numerada.
    // Feature 159: `findResumenByNumRemisiones` sigue en el contrato — el resumen del lote
    // se restituyo en el cierre de la 159.
    createManyOrdenesConGuia: vi.fn(
      async (
        data: CreateOrdenData[],
        _batchSize: number,
        _historial: unknown,
        _lote: unknown,
        opciones?: { conGuia?: boolean },
      ) => ({ creadas: conGuiaEco(data, opciones), cargaId: "carga-api-1" }),
    ),
    // Feature 16: resumen del lote (solo lectura), exigido por IOrdenRepository y no
    // ejercitado por la carga via API.
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    findByIdsForTransicion: vi.fn().mockResolvedValue([]),
    findByNumGuiaForTransicion: vi.fn().mockResolvedValue(null),
    findMensajeroIdsValidos: vi.fn().mockResolvedValue(new Set()),
    findAllMensajeros: vi.fn().mockResolvedValue([]),
    listOrderStatus: vi.fn().mockResolvedValue([]),
    generarGuiaLote: vi.fn().mockResolvedValue([]),
    asignarBodegaLote: vi.fn().mockResolvedValue(0),
    findMensajerosByZona: vi.fn().mockResolvedValue([]),
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosNoAsignablesPorEstado: vi.fn(async () => new Set<string>()),
    findMensajeroIdsValidosByZona: vi.fn().mockResolvedValue(new Set()),
    rutearBodegaSateliteLote: vi.fn().mockResolvedValue(0),
    findEtiquetasByIds: vi.fn().mockResolvedValue([]),
    findEtiquetaByNumGuia: vi.fn().mockResolvedValue(null),
    // Feature 148: stubs del manifiesto (READ derivado, no lo ejercita este test).
    findManifiestoByIds: vi.fn().mockResolvedValue([]),
    findManifiestoByRemisiones: vi.fn().mockResolvedValue([]),
    findUsuarioNombre: vi.fn().mockResolvedValue(null),
    findUsuarioZonaId: vi.fn().mockResolvedValue(null),
    findUsuarioVehiculoId: vi.fn().mockResolvedValue(null),
    findRecepcionSateliteByZona: vi.fn().mockResolvedValue([]),
    // Feature 170 (T K.1/T K.2): la pagina del listado satelite y el catalogo de sus filtros.
    findRecepcionSatelitePaginada: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    // Feature 184 (T A.1/T A.2): el conjunto completo del listado y la vigencia de ids.
    findRecepcionSateliteCompleta: vi.fn().mockResolvedValue([]),
    findIdsVigentesEnBodega: vi.fn().mockResolvedValue([]),
    recibirEnSatelite: vi.fn().mockResolvedValue(false),
    recibirEnOrigen: vi.fn().mockResolvedValue(false),
    recibirEnBodegaCentral: vi.fn().mockResolvedValue(false),
    // feature 157: recoleccion en tienda (asignacion sin transicion + confirmacion por QR)
    asignarRecoleccionLote: vi.fn().mockResolvedValue(0),
    desasignarRecoleccionLote: vi.fn().mockResolvedValue(0),
    // feature 157: regla de dedicacion (reparto y recoleccion no se mezclan)
    findMensajerosConOrdenesEn: vi.fn().mockResolvedValue(new Set()),
    recolectarEnTienda: vi.fn().mockResolvedValue(false),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    // Feature 271: el contador N/V y el detalle del bloqueo son parte del puerto.
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    // [89] Lecturas de /novedades, incorporadas a `IOrdenRepository` al mergear `dev`. La
    // carga por API no las usa; se stubean neutras para satisfacer la interfaz completa.
    // Solicitud de ayuda (2026-08-18): exigidos por la interfaz, no ejercitados aqui.
    // Feature 235: los tres metodos de la bandera colapsaron en UN punto de escritura.
    transicionarAyuda: vi.fn(async (): Promise<boolean> => true),
    findParaHabilitacionApi: vi.fn(async () => null), // feature 266/T3.1: lectura scoped por owner del canal por API key
    incrementarIntentoContacto: vi.fn(async (): Promise<number> => 0),
    // Feature 236: los dos metodos del listado pasan a llevar el GRUPO en la firma.
    countNovedadesByTienda: vi.fn(async (): Promise<number> => 0),
    findNovedadesByTienda: vi.fn(async () => []),
    findFechaSolicitudAyuda: vi.fn(async () => new Map()),
    // Feature 92 (R8/R35): metodos nuevos de lectura de `IOrdenRepository`. Estos
    // tests no ejercitan el gate de coordenadas ni la ruta: devuelven vacio.
    findParaAsignabilidad: vi.fn(async () => []),
    findParadasEnReparto: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn(async () => new Map()),
    // Feature 106: canal integrador (API por key), no ejercitado aqui.
    listByOwner: vi.fn(async () => ({ items: [], total: 0 })),
    findDetalleByNumGuiaForOwner: vi.fn(async () => null),
    cancelarViaApi: vi.fn(async () => ({ status: "not_found" as const })),
    // Feature 177: consulta por identificador libre + PDF de etiquetas, no ejercitada aqui.
    findByGuiaORemisionForOwner: vi.fn(
      async (): Promise<Array<{ id: string; numGuia: number | null; numRemision: string }>> => [],
    ),
    findDetalleByOrdenIdForOwner: vi.fn(async () => null),
    findDownloadStoragePathByOrdenForOwner: vi.fn(async () => null),
    setOrdenDownloadStoragePath: vi.fn(async () => {}),
    findCargaConOrdenesForOwner: vi.fn(async () => null),
    setCargaDownloadStoragePath: vi.fn(async () => {}),
    // Feature 102: rechazos por SLA de la tienda, exigidos por IOrdenRepository.
    countRechazadasSlaByTienda: vi.fn(async () => 0),
    findRechazadasSlaByTienda: vi.fn(async () => []),
    // Feature 149: writer de la reversion de asignacion, exigido por IOrdenRepository.
    deshacerAsignacionLote: vi.fn(async () => 0),
    // Feature 262: writer de la correccion del dia de reparto, exigido por IOrdenRepository.
    corregirDiaRepartoLote: vi.fn(async () => []),
    ...overrides,
  };
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    ...overrides,
  };
}

function conGuiaArg(repo: IOrdenRepository) {
  return (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateOrdenData[];
}

describe("cargarViaApi — autorizacion (R15)", () => {
  it.each([TIENDA, MAESTRO, MENSAJERO])("rol %o distinto de apiKey -> forbidden sin tocar datos", async (actor) => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], actor);
    expect(r.status).toBe("forbidden");
    expect(repo.findExistingRemisiones).not.toHaveBeenCalled();
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("rol apiKey -> autorizado", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    expect(r.status).toBe("ok");
  });
});

describe("cargarViaApi — dueño y estado inicial (R8, D4)", () => {
  it("tienda_id = usuario dedicado de la key (D4)", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi([row()], APIKEY);
    expect(conGuiaArg(repo)[0].tiendaId).toBe("key-user-1");
  });

  // Feature 155/R19/R20/R22 — el caso de la 88 no se borra: se INVIERTE. Donde decia "estado
  // inicial FIJO" ahora dice "estado resuelto por la bifurcacion de creacion".
  it("155/R20: sin fulfillment en la tarifa, nace en por_recolectar_en_tienda con guia", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);

    // R20/R22: nace en el estado de la rama (b), NUNCA en el viejo estado fijo.
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(repo.findEstatusIdByValue).not.toHaveBeenCalledWith("en_ruta_bodega_central");
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
      expect(r.summary.filas[0].numGuia).toBe(1000); // R20: guia asignada, reportada
      // R24: la rama (b) SI emite manifiesto, y la orden creada esta en su seleccion.
      expect(r.manifiestoOrdenIds).toEqual(["ord-REM-1"]);
    }
    expect(conGuiaArg(repo)[0].estatusId).toBe("os-erbp");
  });

  // FULFILLMENT (2026-08-25) — EL PREDICADO DE ESTA VIA ES LA TARIFA, NO EL FLAG DEL USUARIO.
  // `Usuario.fulfillment` solo puede quedar en `true` para `adminTienda` y el dueño de una key
  // es de rol `apiKey`: preguntarselo devolvia siempre `false`, que es lo que mantenia la rama
  // (a) inalcanzable desde la 155. Ya no se le pregunta.
  it("no consulta el flag `fulfillment` del usuario: por esta via el predicado es la tarifa", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi(
      [row({ num_remision: "A" }), row({ num_remision: "B" }), row({ num_remision: "C" })],
      APIKEY,
    );
    expect(repo.findUsuarioFulfillment).not.toHaveBeenCalled();
  });

  it("tarifa con fulfillment > 0 -> en_preparacion y numGuia null, sin fabricar numero", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA_FULFILLMENT)).cargarViaApi(
      [row({ num_remision: "REM-1" })],
      APIKEY,
    );

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.filas[0].numGuia).toBeNull();
      expect(r.summary.ordenes[0]).toMatchObject({
        numRemision: "REM-1",
        numGuia: null,
        estado: "en_preparacion",
      });
      // El monto de bodega se SUMA al costo del envio (3.50 + 12% = 3.92, + 2.00) y viaja
      // desglosado al lado, para que ese total no haya que adivinarlo.
      expect(r.summary.ordenes[0].costoEnvio).toBe("5.92");
      expect(r.summary.ordenes[0].fulfillment).toBe("2.00");
      // R26: la rama (a) no emite manifiesto — no hubo movimiento fisico que documentar.
      expect(r.manifiestoOrdenIds).toEqual([]);
    }
    // Se persiste por la MISMA ruta, con la numeracion desactivada: nadie consume la secuencia.
    // Feature 141: `opciones` es el 5.o argumento — el 4.o es el contexto del LOTE.
    const opciones = (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock.calls[0][4];
    expect(opciones).toEqual({ conGuia: false });
  });

  it("sin fulfillment el desglose es un cero explicito y `costoEnvio` no se mueve", async () => {
    const r = await buildService(buildRepo()).cargarViaApi([row()], APIKEY);
    if (r.status !== "ok") return;
    expect(r.summary.ordenes[0].costoEnvio).toBe("3.92"); // lo mismo que antes de la fecha
    expect(r.summary.ordenes[0].fulfillment).toBe("0.00");
  });
});

describe("cargarViaApi — resultado con num_guia (R10)", () => {
  it("happy path: summary con num_guia por creada + bloque plano ordenes", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(2);
      // Filas creadas extendidas con numGuia.
      expect(r.summary.filas[0]).toMatchObject({ resultado: "creada", numGuia: 1000, estatus: "por_recolectar_en_tienda" });
      expect(r.summary.filas[1]).toMatchObject({ resultado: "creada", numGuia: 1001 });
      // Bloque plano `ordenes` (R10): id + numGuia + estado + costoEnvio (feature 98/R5) +
      // fulfillment (2026-08-25) por creada. No-central con TARIFA por defecto -> 3.50 + 12%
      // = "3.92", y sin monto de bodega el desglose es el cero explicito.
      expect(r.summary.ordenes).toEqual([
        { id: "ord-REM-1", numRemision: "REM-1", numGuia: 1000, estado: "por_recolectar_en_tienda", costoEnvio: "3.92", fulfillment: "0.00" },
        { id: "ord-REM-2", numRemision: "REM-2", numGuia: 1001, estado: "por_recolectar_en_tienda", costoEnvio: "3.92", fulfillment: "0.00" },
      ]);
    }
  });
});

describe("cargarViaApi — validacion de valor heredada (R13, D3 override)", () => {
  it("monto_cobrar no numerico -> error de fila, no crea", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "abc" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("monto_cobrar negativo -> error de fila", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "-5" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });

  // D3 (override del humano): NO se endurece el monto. Vacio/null se HEREDA de la carga
  // masiva -> la orden se crea igual (no se agrega obligatoriedad).
  it("monto_cobrar vacio -> se crea igual (regla heredada, sin obligatoriedad)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(0);
    }
    expect(conGuiaArg(repo)[0].montoCobrar).toBeNull();
  });
});

describe("cargarViaApi — dedup y exito parcial (R7/R11/R12)", () => {
  it("R11: remision existente en DB -> duplicada, sin consumir guia", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "entregada"]])),
    });
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.duplicadas).toBe(1);
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0]).toMatchObject({ resultado: "duplicada" });
      expect(r.summary.filas[0].numGuia).toBeUndefined(); // duplicada no lleva guia
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("R12: geo invalida en una fila no aborta el resto del lote", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [row({ num_remision: "REM-A" }), row({ num_remision: "REM-B", provincia: "Inexistente" })],
      APIKEY,
    );
    if (r.status === "ok") {
      expect(r.summary.total).toBe(2);
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[1].errores).toHaveProperty("provincia");
    }
    // Solo la valida se persiste.
    expect(conGuiaArg(repo)).toHaveLength(1);
    expect(conGuiaArg(repo)[0].numRemision).toBe("REM-A");
  });
});

describe("cargarViaApi — guarda de seed de estado", () => {
  it("estatus inicial no disponible (seed pendiente) -> todas a error, sin persistir", async () => {
    const repo = buildRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores).toHaveProperty("estatus");
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});

// Feature 98 (T7) — costoEnvio (FLETE + IVA del flete) por orden creada. Mapea R1/R2/R3/R4/
// R5/R6/R7/R8.
describe("cargarViaApi — costoEnvio flete + IVA (feature 98)", () => {
  // Distrito en zona CENTRAL, para forzar la columna valorFleteGam (R2).
  const distritoCentral = {
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: true },
      ]),
  };

  it("R1/R2/R7: creada en zona NO-central -> costoEnvio = valorFlete + IVA (3.50 + 12% = 3.92)", async () => {
    const repo = buildRepo(); // distrito por defecto esCentral:false
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.ordenes[0].costoEnvio).toBe("3.92");
    }
  });

  it("R2/R7: creada en zona CENTRAL -> costoEnvio = valorFleteGam + IVA (5.00 + 12% = 5.60)", async () => {
    const repo = buildRepo(distritoCentral);
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.ordenes[0].costoEnvio).toBe("5.60");
    }
  });

  // Feature 274/R26: el caso de la 98 no se borra, se ACTUALIZA al resolver nuevo. Lo que se
  // resuelve una sola vez ya no es "la tarifa de la tienda" sino los PARES del lote.
  it("R3 + 274/R26: las tarifas del lote se resuelven en UNA sola llamada (sin N+1)", async () => {
    const repo = buildRepo();
    const tarifaRepo = buildTarifaRepo(TARIFA);
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" }), row({ num_remision: "REM-3" })],
      APIKEY,
    );
    if (r.status === "ok") expect(r.summary.creadas).toBe(3);
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledTimes(1);
    // Los pares se piden con la tienda dueña (el usuario dedicado de la key, D4) y la zona del
    // distrito de cada fila.
    // Y se piden los pares DISTINTOS: tres filas de la misma zona son UN par.
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: "key-user-1", zonaId: "z1" },
    ]);
  });

  it("R4/R6: filas duplicada y error NO llevan costoEnvio y conservan su shape", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-DUP", "entregada"]])),
    });
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [
        row({ num_remision: "REM-OK" }),
        row({ num_remision: "REM-DUP" }),
        row({ num_remision: "REM-ERR", provincia: "Inexistente" }),
      ],
      APIKEY,
    );
    if (r.status === "ok") {
      const dup = r.summary.filas.find((f) => f.resultado === "duplicada")!;
      const err = r.summary.filas.find((f) => f.resultado === "error")!;
      // Las filas NO tienen costoEnvio (vive solo en el bloque `ordenes`).
      expect(dup).not.toHaveProperty("costoEnvio");
      expect(err).not.toHaveProperty("costoEnvio");
      // Shape intacto: la duplicada expone `estatus`, la error expone `errores`.
      expect(dup).toMatchObject({ resultado: "duplicada", estatus: "entregada" });
      expect(err.errores).toHaveProperty("provincia");
      // Y `ordenes` (una por creada) sí lleva costoEnvio, solo para la creada.
      expect(r.summary.ordenes).toHaveLength(1);
      expect(r.summary.ordenes[0]).toMatchObject({ numRemision: "REM-OK", costoEnvio: "3.92" });
    }
  });

  // Feature 274/R29/R31 — el caso R8/D1 de la 98 se INVIERTE, no se borra: era el que decia
  // que un lote entero sin tarifa se creaba con `costoEnvio: "0.00"`. Eso es exactamente lo
  // que esta feature retira (un precio inventado que ya movia paquetes): ahora es un 409 y
  // cero persistencia. La asercion se conserva aqui para que la inversion quede escrita.
  it("274/R29 (era 98/R8/D1): ninguna fila resuelve -> 409, y NUNCA un costoEnvio '0.00'", async () => {
    const repo = buildRepo();
    await expect(
      buildService(repo, buildTarifaRepo(null)).cargarViaApi(
        [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
        APIKEY,
      ),
    ).rejects.toThrow(MSG_CARGA_SIN_TARIFA);
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("R7: costoEnvio es STRING escala 2 (money-safe, nunca number)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      const c = r.summary.ordenes[0].costoEnvio;
      expect(typeof c).toBe("string");
      expect(c).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("R7: monto_cobrar (COD) y costoEnvio (flete) coexisten sin confundirse", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [row({ monto_cobrar: "100.00" })],
      APIKEY,
    );
    if (r.status === "ok") {
      // costoEnvio es el flete + IVA (3.92), NO el COD (100.00).
      expect(r.summary.ordenes[0].costoEnvio).toBe("3.92");
    }
    // El COD sigue viajando al persistir, separado del costoEnvio.
    expect(conGuiaArg(repo)[0].montoCobrar).toBe(100);
  });
});

// Feature 98 (T12) — el contrato 88 sigue intacto: la UNICA extension observable es costoEnvio.
describe("cargarViaApi — no-regresión del contrato 88 (feature 98/R10)", () => {
  it("estado inicial fijo, num_guia inmediato y shape de `ordenes` = 88 + costoEnvio", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [row({ num_remision: "REM-1" })],
      APIKEY,
    );
    // Feature 155: estado inicial RESUELTO por la bifurcacion (asercion invertida respecto de
    // la 88) y num_guia inmediato (via createManyOrdenesConGuia). El resto, intacto.
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    if (r.status === "ok") {
      // El bloque `ordenes` es EXACTAMENTE el de la 88 (id/numRemision/numGuia/estado) mas las
      // DOS extensiones declaradas y ninguna otra: `costoEnvio` (feature 98/R10) y su desglose
      // `fulfillment` (2026-08-25). La igualdad ESTRICTA es lo que hace de guardian: un campo
      // que se cuele en la respuesta publica del canal integrador rompe aqui.
      expect(r.summary.ordenes[0]).toEqual({
        id: "ord-REM-1",
        numRemision: "REM-1",
        numGuia: 1000,
        estado: "por_recolectar_en_tienda",
        costoEnvio: "3.92",
        fulfillment: "0.00",
      });
    }
  });
});

// Feature 142 (B6/R38) y 276 (B6/R28, R29) — las plantillas de la via sesion han
// cambiado DOS veces (v2: columna unica `direccion_destinatario`; v3: `provincia` +
// `canton_distrito` + `direccion`) y el contrato publico de la 88 NO se ha movido:
// el integrador sigue enviando provincia/canton/distrito/direccion por separado.
describe("cargarViaApi — no-regresión del contrato 88 frente a las plantillas v2 y v3 (142/R38, 276/R28)", () => {
  it("R28: fila con provincia/canton/distrito separados se crea igual", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [
        {
          num_remision: "REM-88",
          destinatario: "Ana",
          telefono: "0991234567",
          provincia: "Pichincha",
          canton: "Quito",
          distrito: "La Mariscal",
          direccion: "Av. Amazonas N33-12",
          producto: "Caja",
        },
      ],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary).toMatchObject({ total: 1, creadas: 1, conError: 0 });
      expect(r.summary.filas[0]).toMatchObject({ resultado: "creada", numGuia: 1000 });
    }
    // La geografia se deriva de las 4 columnas separadas, no de ninguna columna unificada.
    expect(conGuiaArg(repo)[0]).toMatchObject({
      numRemision: "REM-88",
      provinciaId: "p1",
      cantonId: "c1",
      distritoId: "d1",
      zonaId: "z1",
      direccion: "Av. Amazonas N33-12",
    });
  });

  it("R28: una columna de otra plantilla presente en el payload API es ignorada (manda la geografia separada)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [
        row({
          direccion_destinatario: "basura sin formato", // v2
          canton_distrito: "basura sin parentesis", // v3
          direccion: "Av. Amazonas",
        }),
      ],
      APIKEY,
    );

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(0);
    }
    expect(conGuiaArg(repo)[0].direccion).toBe("Av. Amazonas");
  });

  it("R29: la via API key NO acepta canton_distrito como sustituto de canton/distrito", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [
        {
          num_remision: "REM-V3",
          destinatario: "Ana",
          telefono: "0991234567",
          provincia: "Pichincha",
          canton_distrito: "Quito (La Mariscal)",
          direccion: "Av. Amazonas",
          producto: "Caja",
        },
      ],
      APIKEY,
    );

    // Sin `canton` propio, la fila muere donde siempre: en resolveGeo, bajo `canton`.
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0].errores).toHaveProperty("canton");
    }
  });
});

// Feature 159 (R9, R7) — contrato PUBLICO del canal por API key tras retirar la
// sugerencia de mensajero. `filaCargaSchema` no es `.strict()` (ancla de la 143), asi
// que la clave sobrante se descarta en silencio; esto lo hace verificable.
describe("cargarViaApi — mensajero sugerido retirado (159/R9, R7)", () => {
  it("R9: la MISMA fila con y sin `mensajero_sugerido_id` produce el mismo resultado", async () => {
    const conClave = await buildService(buildRepo()).cargarViaApi(
      [row({ mensajero_sugerido_id: "no-existe" })],
      APIKEY,
    );
    const sinClave = await buildService(buildRepo()).cargarViaApi([row()], APIKEY);

    // Mismo `status` del service -> mismo codigo HTTP (el route mapea 1:1; ese
    // mapeo lo cubre `tests/integration/api/ordenes-api-key-carga.route.test.ts`).
    expect(conClave.status).toBe("ok");
    expect(conClave.status).toBe(sinClave.status);
    if (conClave.status === "ok" && sinClave.status === "ok") {
      // Mismo `RowResult` (resultado + estatus + numGuia + errores), campo a campo.
      expect(conClave.summary.filas).toEqual(sinClave.summary.filas);
      // Y el bloque plano `ordenes` del contrato 88 tampoco cambia.
      expect(conClave.summary).toEqual(sinClave.summary);
    }
  });

  it("R8: la clave no llega a la persistencia", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi([row({ mensajero_sugerido_id: "u-1" })], APIKEY);

    expect(conGuiaArg(repo)[0]).not.toHaveProperty("mensajeroSugeridoId");
  });

  it("R7: la via API tampoco consulta el catalogo de mensajeros", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      APIKEY,
    );

    expect(repo.findAllMensajeros).not.toHaveBeenCalled();
    expect(repo.findMensajeroIdsValidos).not.toHaveBeenCalled();
    expect(repo.findMensajerosByZona).not.toHaveBeenCalled();
    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Feature 274 (T6.3) — la carga por API tarifa POR PAR (tienda, zona) y la falta de tarifa
// deja de ser un "0.00": es un error de fila (R28) o un 409 de lote (R29).
// ---------------------------------------------------------------------------

// Dos distritos en ZONAS distintas dentro del mismo canton: es lo minimo para que un lote
// tenga dos pares (tienda, zona) y, por tanto, dos precios.
const DOS_ZONAS = {
  findDistritosByCantonIds: vi
    .fn()
    .mockResolvedValue([
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      { id: "d2", nombre: "Cumbaya", cantonId: "c1", zonaId: "z2", esCentral: false },
    ]),
};

/** Fila en la zona `z1` (distrito por defecto del doble de repositorio). */
const filaZ1 = (numRemision: string) => row({ num_remision: numRemision });
/** Fila en la zona `z2`. */
const filaZ2 = (numRemision: string) => row({ num_remision: numRemision, distrito: "Cumbaya" });

describe("cargarViaApi — cascada por par (tienda, zona) (274/R25/R26)", () => {
  it("R25: dos ordenes del MISMO lote en zonas distintas con tarifas distintas cobran distinto", async () => {
    const repo = buildRepo(DOS_ZONAS);
    const tarifaRepo = buildTarifaRepoPorZona({ z1: TARIFA, z2: TARIFA_Z2 });

    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-Z1"), filaZ2("REM-Z2")],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const porRemision = new Map(r.summary.ordenes.map((o) => [o.numRemision, o.costoEnvio]));
    // 3.50 + 12% vs 10.00 + 12%: hasta la 273 las DOS devolvian "3.92" (una tarifa por lote).
    expect(porRemision.get("REM-Z1")).toBe("3.92");
    expect(porRemision.get("REM-Z2")).toBe("11.20");
    expect(porRemision.get("REM-Z1")).not.toBe(porRemision.get("REM-Z2"));
  });

  it("R26: UNA sola llamada al resolver por lote, con los dos pares distintos", async () => {
    const repo = buildRepo(DOS_ZONAS);
    const tarifaRepo = buildTarifaRepoPorZona({ z1: TARIFA, z2: TARIFA_Z2 });

    await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-1"), filaZ2("REM-2"), filaZ1("REM-3"), filaZ2("REM-4")],
      APIKEY,
    );

    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledTimes(1);
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: "key-user-1", zonaId: "z1" },
      { tiendaId: "key-user-1", zonaId: "z2" },
    ]);
  });
});

// FULFILLMENT (2026-08-25) — la bifurcacion es POR ORDEN, y esto es lo que lo obliga: la
// tarifa se resuelve por par (tienda, zona) desde la 274, asi que dos filas del mismo lote
// pueden caer en zonas con distinto monto de fulfillment. Decidir por lote dejaria una orden a
// la que se le COBRA fulfillment naciendo a la espera de que alguien la recoja en la tienda.
describe("cargarViaApi — lote MIXTO por fulfillment (una zona con monto, otra sin)", () => {
  const mixtoFulfillment = () => ({
    repo: buildRepo(DOS_ZONAS),
    tarifaRepo: buildTarifaRepoPorZona({ z1: TARIFA, z2: { ...TARIFA_Z2, fulfillment: "2.00" } }),
  });

  it("cada orden nace donde dice SU tarifa, y solo la de la tienda va al manifiesto", async () => {
    const { repo, tarifaRepo } = mixtoFulfillment();
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-Z1"), filaZ2("REM-Z2")],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const porRemision = new Map(r.summary.ordenes.map((o) => [o.numRemision, o]));
    expect(porRemision.get("REM-Z1")).toMatchObject({
      estado: "por_recolectar_en_tienda",
      numGuia: 1000,
      fulfillment: "0.00",
    });
    expect(porRemision.get("REM-Z2")).toMatchObject({
      estado: "en_preparacion",
      numGuia: null,
      // 10.00 + 12% = 11.20, mas el monto de bodega.
      costoEnvio: "13.20",
      fulfillment: "2.00",
    });
    // Solo la que espera EN LA TIENDA documenta un movimiento fisico.
    expect(r.manifiestoOrdenIds).toEqual(["ord-REM-Z1"]);
  });

  it("dos llamadas de persistencia (una por rama) pero UN solo lote: el cargaId se reutiliza", async () => {
    const { repo, tarifaRepo } = mixtoFulfillment();
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-Z1"), filaZ2("REM-Z2")],
      APIKEY,
    );

    const llamadas = (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas).toHaveLength(2);
    // Primero la rama (b) —numera en el acto—, luego la (a) —no numera nada—.
    expect(llamadas[0][4]).toEqual({ conGuia: true });
    expect(llamadas[1][4]).toEqual({ conGuia: false });
    // Feature 141/R30: UNA fila de `carga` por peticion. El segundo grupo recibe el id que
    // resolvio el primero, en vez de abrir un lote nuevo.
    expect(llamadas[0][3]).toMatchObject({ cargaId: null, totalFiles: 2 });
    expect(llamadas[1][3]).toMatchObject({ cargaId: "carga-api-1", totalFiles: 2 });
    if (r.status === "ok") expect(r.summary.cargaId).toBe("carga-api-1");
  });

  it("un lote homogeneo sigue haciendo UNA sola llamada de persistencia", async () => {
    const repo = buildRepo(DOS_ZONAS);
    await buildService(repo, buildTarifaRepoPorZona({ z1: TARIFA, z2: TARIFA_Z2 })).cargarViaApi(
      [filaZ1("REM-1"), filaZ2("REM-2")],
      APIKEY,
    );
    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
  });
});

describe("cargarViaApi — lote MIXTO: unas resuelven y otras no (274/R27/R28/R31/R38)", () => {
  // z1 tiene tarifa, z2 NO: es el unico caso en el que el hueco de tarifa es un error de fila
  // y no un 409 de lote (design §3.6).
  const mixto = () => ({
    repo: buildRepo(DOS_ZONAS),
    tarifaRepo: buildTarifaRepoPorZona({ z1: TARIFA }),
  });

  it("R27/R28: 200; la fila con tarifa se crea y la fila sin tarifa va a `error` con `errores.tarifa`", async () => {
    const { repo, tarifaRepo } = mixto();
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-OK"), filaZ2("REM-SIN")],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    const ok = r.summary.filas.find((f) => f.numRemision === "REM-OK")!;
    const sin = r.summary.filas.find((f) => f.numRemision === "REM-SIN")!;
    expect(ok).toMatchObject({ resultado: "creada", numGuia: 1000 });
    expect(sin).toMatchObject({ fila: 2, resultado: "error" });
    // R38: se compara contra la CONSTANTE importada, no contra un literal re-escrito.
    expect(sin.errores).toEqual({ tarifa: [MSG_FILA_SIN_TARIFA] });
    // La fila degradada no conserva el `estatus` de "creada" que llego a tener.
    expect(sin.estatus).toBeUndefined();

    // El bloque `ordenes` solo trae la creada, con su costo real.
    expect(r.summary.ordenes).toHaveLength(1);
    expect(r.summary.ordenes[0]).toMatchObject({ numRemision: "REM-OK", costoEnvio: "3.92" });
  });

  it("R28: `createManyOrdenesConGuia` recibe UNA sola fila (la que resolvio), no dos", async () => {
    const { repo, tarifaRepo } = mixto();
    await buildService(repo, tarifaRepo).cargarViaApi([filaZ1("REM-OK"), filaZ2("REM-SIN")], APIKEY);

    // Asercion sobre el ARGUMENTO: el summary podria cuadrar y aun asi haberse insertado la
    // fila sin tarifa (que es justo el bug que R28 prohibe).
    const arg = conGuiaArg(repo);
    expect(arg).toHaveLength(1);
    expect(arg[0].numRemision).toBe("REM-OK");
  });

  it("R31: la respuesta de un lote mixto no contiene NINGUN costoEnvio '0.00'", async () => {
    const { repo, tarifaRepo } = mixto();
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [filaZ1("REM-OK"), filaZ2("REM-SIN"), filaZ2("REM-SIN-2")],
      APIKEY,
    );

    if (r.status !== "ok") return;
    expect(r.summary.ordenes.map((o) => o.costoEnvio)).not.toContain("0.00");
    // El barrido sobre el JSON entero se conserva, pero EXCLUYENDO el desglose de fulfillment
    // (2026-08-25): ahi el "0.00" no es un precio fabricado por falta de tarifa —lo que R31
    // persigue— sino la afirmacion de que esta tienda no hace fulfillment. Los dos ceros se
    // parecen y significan cosas opuestas, asi que el guardian tiene que distinguirlos en vez
    // de dejar de mirar.
    const sinDesglose = r.summary.ordenes.map((o) =>
      Object.fromEntries(Object.entries(o).filter(([clave]) => clave !== "fulfillment")),
    );
    expect(JSON.stringify({ ...r.summary, ordenes: sinDesglose })).not.toContain("0.00");
  });

  it("summary: `total` = filas recibidas y creadas + duplicadas + conError = total (la degradada no se cuenta dos veces)", async () => {
    const repo = buildRepo({
      ...DOS_ZONAS,
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-DUP", "entregada"]])),
    });
    const tarifaRepo = buildTarifaRepoPorZona({ z1: TARIFA });
    const rows = [
      filaZ1("REM-OK"), // creada
      filaZ2("REM-SIN"), // degradada a error por falta de tarifa
      filaZ1("REM-DUP"), // duplicada contra DB
      row({ num_remision: "REM-GEO", provincia: "Inexistente" }), // error de cobertura
    ];

    const r = await buildService(repo, tarifaRepo).cargarViaApi(rows, APIKEY);

    if (r.status !== "ok") return;
    const { total, creadas, duplicadas, conError, filas } = r.summary;
    expect(total).toBe(rows.length); // lo RECIBIDO, no lo creado (141/R30-R33)
    expect(creadas + duplicadas + conError).toBe(total);
    expect({ creadas, duplicadas, conError }).toEqual({ creadas: 1, duplicadas: 1, conError: 2 });
    expect(filas).toHaveLength(rows.length); // la degradada sigue siendo UNA fila
  });
});

describe("cargarViaApi — ninguna fila resuelve: 409 y cero escrituras (274/R29)", () => {
  it("R29: lanza ConflictError con MSG_CARGA_SIN_TARIFA", async () => {
    const repo = buildRepo(DOS_ZONAS);
    const tarifaRepo = buildTarifaRepoPorZona({}); // ninguna zona con tarifa

    await expect(
      buildService(repo, tarifaRepo).cargarViaApi([filaZ1("REM-1"), filaZ2("REM-2")], APIKEY),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("R29: ni una orden, ni fila de `carga`, ni notificacion de fin de lote (spies en cero)", async () => {
    const repo = buildRepo(DOS_ZONAS);
    const tarifaRepo = buildTarifaRepoPorZona({});
    const notificar = vi.fn(async () => {});

    await expect(
      new BulkOrdenService(repo, tarifaRepo, notificar).cargarViaApi(
        [filaZ1("REM-1"), filaZ2("REM-2")],
        APIKEY,
      ),
    ).rejects.toThrow(MSG_CARGA_SIN_TARIFA);

    // El unico writer del lote (crea las ordenes Y la fila de `carga` en la misma tx) no se
    // llamo: no hay nada que revertir porque no se empezo.
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("cargarViaApi — nadie llega a resolver: 200, no 409 (274/R30)", () => {
  it("R30: lote entero con distritos inexistentes -> 200 con errores de geografia y sin consultar tarifas", async () => {
    const repo = buildRepo();
    const tarifaRepo = buildTarifaRepoPorZona({}); // ni siquiera importa: no se consulta

    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [
        row({ num_remision: "REM-1", distrito: "No existe" }),
        row({ num_remision: "REM-2", distrito: "Tampoco" }),
      ],
      APIKEY,
    );

    expect(r.status).toBe("ok"); // NO 409: la tarifa no es el motivo del fallo (design §3.6)
    if (r.status !== "ok") return;
    expect(r.summary.conError).toBe(2);
    expect(r.summary.creadas).toBe(0);
    for (const f of r.summary.filas) {
      expect(f.errores).toHaveProperty("distrito");
      expect(f.errores).not.toHaveProperty("tarifa");
    }
    // R30: el repo de tarifas no se consulta cuando no hay ninguna fila candidata.
    expect(tarifaRepo.resolveTarifas).not.toHaveBeenCalled();
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});
