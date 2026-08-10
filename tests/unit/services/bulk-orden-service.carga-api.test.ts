import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type {
  CreateOrdenData,
  CreateOrdenConGuiaResultRow,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

// Feature 98 — tarifa vigente por defecto del lote (no-central: valorFlete; central:
// valorFleteGam). `ivaFlete` 12% no trivial para verificar la suma del IVA (D2/R7).
const TARIFA: TarifaVigente = {
  valorFlete: "3.50", // -> costoEnvio no-central = 3.50 + 12% = "3.92"
  valorFleteGam: "5.00", // -> costoEnvio central = 5.00 + 12% = "5.60"
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00", // 12%
  ivaComisionCod: "12.00",
};

// Fake del resolver de tarifa por tienda. `tarifa=null` simula el gap (D1 -> "0.00").
function buildTarifaRepo(tarifa: TarifaVigente | null = TARIFA): ITarifaVigentePorTiendaRepository {
  return {
    resolveTarifaPorTienda: vi.fn(async () => tarifa),
    resolveTarifasPorTiendas: vi.fn(async () => new Map()),
  };
}

// Servicio con las dos dependencias (repo + tarifa). Por defecto usa la TARIFA de arriba.
function buildService(
  repo: IOrdenRepository,
  tarifaRepo: ITarifaVigentePorTiendaRepository = buildTarifaRepo(),
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
    update: vi.fn(),
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
    findRecepcionSateliteGeoByZona: vi.fn().mockResolvedValue([]),
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
    recibirLoteEnSatelite: vi.fn().mockResolvedValue(0),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    // [89] Lecturas de /novedades, incorporadas a `IOrdenRepository` al mergear `dev`. La
    // carga por API no las usa; se stubean neutras para satisfacer la interfaz completa.
    countDevueltasByTienda: vi.fn(async (): Promise<number> => 0),
    findDevueltasByTienda: vi.fn(async () => []),
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
  // inicial FIJO, no consulta fulfillment" ahora dice "estado resuelto por el flag del dueño".
  it("155/R19/R20: consulta el flag del dueño de la key y nace en por_recolectar_en_tienda", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);

    // R19: el predicado se evalua sobre el DUEÑO de la key, una sola vez.
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledTimes(1);
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith("key-user-1");
    // R20/R22: nace en el estado de la rama (b), NUNCA en el viejo estado fijo.
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(repo.findEstatusIdByValue).not.toHaveBeenCalledWith("en_ruta_bodega_central");
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
      expect(r.summary.filas[0].numGuia).toBe(1000); // R20: guia asignada, reportada
      expect(r.destino).toEqual({
        estatus: "por_recolectar_en_tienda",
        conGuia: true,
        emiteManifiesto: true,
      });
    }
    expect(conGuiaArg(repo)[0].estatusId).toBe("os-erbp");
  });

  // R21 — RAMA DEFENSIVA, hoy inalcanzable (decision del gate del 2026-07-29, pregunta 3): el
  // switch de fulfillment solo se acepta para `adminTienda` y el dueño de una key es de rol
  // `apiKey`. Se prueba igual: el dia que un integrador con bodega propia pueda marcarse, la
  // respuesta NO debe fabricar un numero de guia.
  it("155/R21: dueño con fulfillment=true -> en_preparacion y numGuia null, sin fabricar numero", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    const r = await buildService(repo).cargarViaApi([row({ num_remision: "REM-1" })], APIKEY);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.filas[0].numGuia).toBeNull();
      expect(r.summary.ordenes[0]).toMatchObject({
        numRemision: "REM-1",
        numGuia: null,
        estado: "en_preparacion",
      });
      // El resto del bloque de respuesta se conserva (R23).
      expect(r.summary.ordenes[0].costoEnvio).toBe("3.92");
      expect(r.destino.emiteManifiesto).toBe(false); // R26: la rama (a) no emite manifiesto
    }
    // Se persiste por la MISMA ruta, con la numeracion desactivada: nadie consume la secuencia.
    // Feature 141: `opciones` es el 5.o argumento — el 4.o es el contexto del LOTE.
    const opciones = (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock.calls[0][4];
    expect(opciones).toEqual({ conGuia: false });
  });

  it("155/R4: resuelve el flag UNA sola vez por lote, no una vez por fila", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi(
      [row({ num_remision: "A" }), row({ num_remision: "B" }), row({ num_remision: "C" })],
      APIKEY,
    );
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledTimes(1);
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
      // Bloque plano `ordenes` (R10): id + numGuia + estado + costoEnvio (feature 98/R5) por
      // creada. No-central con TARIFA por defecto -> 3.50 + 12% = "3.92".
      expect(r.summary.ordenes).toEqual([
        { id: "ord-REM-1", numRemision: "REM-1", numGuia: 1000, estado: "por_recolectar_en_tienda", costoEnvio: "3.92" },
        { id: "ord-REM-2", numRemision: "REM-2", numGuia: 1001, estado: "por_recolectar_en_tienda", costoEnvio: "3.92" },
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

  it("R3: la tarifa del lote se resuelve UNA sola vez para N ordenes (sin N+1)", async () => {
    const repo = buildRepo();
    const tarifaRepo = buildTarifaRepo(TARIFA);
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" }), row({ num_remision: "REM-3" })],
      APIKEY,
    );
    if (r.status === "ok") expect(r.summary.creadas).toBe(3);
    expect(tarifaRepo.resolveTarifaPorTienda).toHaveBeenCalledTimes(1);
    // Resuelta por la tienda dueña (el usuario dedicado de la key, D4).
    expect(tarifaRepo.resolveTarifaPorTienda).toHaveBeenCalledWith("key-user-1");
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

  it("R8/D1: tienda SIN tarifa (resolver -> null) -> todas las creadas con costoEnvio '0.00', ninguna a error", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(null)).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      APIKEY,
    );
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(2);
      expect(r.summary.conError).toBe(0);
      expect(r.summary.ordenes.map((o) => o.costoEnvio)).toEqual(["0.00", "0.00"]);
    }
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
    // Feature 155: estado inicial RESUELTO por el flag (asercion invertida respecto de la 88)
    // y num_guia inmediato (via createManyOrdenesConGuia). El resto del contrato, intacto.
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith("key-user-1");
    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    if (r.status === "ok") {
      // El bloque `ordenes` es EXACTAMENTE el de la 88 (id/numRemision/numGuia/estado) + costoEnvio,
      // sin campos de mas: costoEnvio es la unica extension observable (R10).
      expect(r.summary.ordenes[0]).toEqual({
        id: "ord-REM-1",
        numRemision: "REM-1",
        numGuia: 1000,
        estado: "por_recolectar_en_tienda",
        costoEnvio: "3.92",
      });
    }
  });
});

// Feature 142 (B6/R38) — la plantilla v2 de la via sesion (columna unica
// `direccion_destinatario`) NO toca el contrato publico de la 88: el integrador
// sigue enviando provincia/canton/distrito/direccion como campos separados.
describe("cargarViaApi — no-regresión del contrato 88 frente a la plantilla v2 (feature 142/R38)", () => {
  it("R38: fila con provincia/canton/distrito separados y SIN direccion_destinatario se crea igual", async () => {
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

  it("R38: una columna direccion_destinatario presente en el payload API es ignorada (manda la geografia separada)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [row({ direccion_destinatario: "basura sin formato", direccion: "Av. Amazonas" })],
      APIKEY,
    );

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(0);
    }
    expect(conGuiaArg(repo)[0].direccion).toBe("Av. Amazonas");
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
