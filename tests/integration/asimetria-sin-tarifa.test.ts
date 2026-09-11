import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { CotizacionOrdenService } from "@/lib/services/CotizacionOrdenService";
// ⏳ 2026-09-10 (feature 415, T8): la QUINTA superficie ante el mismo hueco.
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import {
  handleCotizacionApi,
  type CotizacionApiDeps,
} from "@/app/api/ordenes/api-key/cotizacion/route";
import type { CreateOrdenData, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IEtiquetasDescargaService } from "@/lib/interfaces/services/IEtiquetasDescargaService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";
import { MSG_CARGA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import { MSG_COTIZACION_SIN_TARIFA } from "@/lib/services/mensajes-cotizacion";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

/**
 * FEATURE 274 (T8.5) — LA ASIMETRIA ENTRE SUPERFICIES, AFIRMADA EN UN SOLO ARCHIVO (R39).
 *
 * ⚠️ SI ESTE ARCHIVO SE TE PONE ROJO, LEE ESTO ANTES DE "ARREGLARLO".
 *
 * Ante EL MISMO hueco de datos —ninguna fila de `tarifas` aplica al par (tienda, zona)— las
 * CINCO superficies responden distinto, y es DELIBERADO. Lo decidio el humano el 2026-08-24
 * y esta escrito en `specs/274-cascada-tarifa-zona-tienda/requirements.md`, seccion «Tres
 * superficies, dos comportamientos»:
 *
 *   · Listado de ordenes  -> `tarifa: null` e importes en `"0.00"`. NO bloquea (R20).
 *   · Cierre de dia       -> las 9 columnas de tarifa en NULL y el cierre se crea (R23).
 *   · Carga por API key   -> `409` (R29).
 *   · Cotizacion por key  -> `409` (R35).
 *   · Lectura por API key -> `costoEstimado: null` (415/R22). ⏳ 2026-09-10, LA QUINTA.
 *
 * ⏳ 2026-09-10 — POR QUE LA QUINTA NECESITA UNA RESPUESTA PROPIA Y NO PUEDE COPIAR A NINGUNA DE
 * LAS CUATRO. El listado y el detalle por API key los consume el MISMO integrador que la carga y
 * la cotizacion, asi que le aplica el argumento (2) de abajo palabra por palabra: un `"0.00"` ahi
 * seria una MENTIRA sobre dinero servida como precio. Pero **no puede devolver 409**: la orden
 * EXISTE y hay que listarla; un 409 le negaria el listado entero de sus ordenes por un hueco de
 * configuracion de una zona. La salida es el hueco DECLARADO —`costoEstimado: null`—, que no
 * bloquea y no miente. Y su hermano `costoReal` SI emite cinco `"0.00"` cuando la fila congelada
 * no tiene tarifa (415/R28): ahi el cero es VERDAD, porque ese cierre liquido cero. Las dos
 * mitades viven explicadas juntas en `lib/utils/api-orden-costo.ts`.
 *
 * EL PORQUE, que es lo que hace que no sea una incoherencia:
 *
 *   (1) Las dos superficies internas las usa gente que NO controla el dato que falta. El
 *       cierre lo solicita el MENSAJERO y la tarifa es configuracion de la TIENDA: bloquearle
 *       el cierre por eso le impide terminar su dia por algo ajeno, y ademas tumbaria el corte
 *       diario masivo de la feature 41, que cierra a todo el mundo de una vez. El listado es
 *       una pantalla de trabajo: un gap de configuracion en UNA tienda no puede dejar sin
 *       tablero a toda la operacion.
 *   (2) Los dos bordes de API los consume un INTEGRADOR que si controla su configuracion y que
 *       toma decisiones de dinero con la respuesta. Ahi un `"0.00"` no es un dato faltante: es
 *       una MENTIRA sobre dinero servida como precio. Ese era el gap D1/R8 de la feature 98, y
 *       esta feature lo invierte a proposito.
 *
 * Por eso «unificar los cinco bordes por simetria» no es una limpieza: es revertir una
 * decision, y hay que discutirla antes, no descubrirla al ver este archivo en rojo.
 *
 * COMO SE PRUEBA QUE ES EL MISMO ESTADO: las CINCO superficies corren contra el MISMO array
 * `TABLA_TARIFAS` y el MISMO doble de `prisma.tarifa.findMany`, resolviendo con el
 * `TarifaVigenteRepository` REAL (no un doble que devuelva `null` cuando le conviene). Y hay
 * una contraprueba: con UNA fila anadida que si aplica al par, las cinco pasan a responder
 * bien —asi se descarta que el "0.00", el `null` y los dos `409` salgan de un montaje roto.
 */

// El dueño de la API key es TAMBIEN la tienda de la orden del listado y del cierre: es lo que
// permite que las cuatro superficies pregunten literalmente por el MISMO par.
const TIENDA = "key-user-1";
const ZONA = "z1";
const KEY_ACTOR: Actor = { usuarioId: TIENDA, rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

// ---------------------------------------------------------------------------------------
// EL ESTADO COMPARTIDO DE `tarifas`
// ---------------------------------------------------------------------------------------

function filaTarifa(over: {
  id: string;
  tiendaId: string | null;
  zonaId: string | null;
  valorFlete: string;
}) {
  return {
    id: over.id,
    tiendaId: over.tiendaId,
    zonaId: over.zonaId,
    valorFlete: new Prisma.Decimal(over.valorFlete),
    valorFleteGam: new Prisma.Decimal("800.00"),
    valorFleteDevuelto: new Prisma.Decimal("500.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    tarifaEspecial: null,
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

type FilaTarifa = ReturnType<typeof filaTarifa>;

/**
 * La tabla NO esta vacia: tiene filas, pero NINGUNA aplica al par (key-user-1, z1). Se hace
 * asi y no con `[]` porque una tabla vacia probaria menos: aqui la cascada tiene candidatas
 * delante y tiene que RECHAZARLAS —la de otra tienda por el nivel 3, la de otra zona de la
 * misma tienda por los niveles 1 y 2—.
 */
const TABLA_TARIFAS: FilaTarifa[] = [
  filaTarifa({ id: "ta-otra-tienda", tiendaId: "t-otra", zonaId: ZONA, valorFlete: "111.00" }),
  filaTarifa({ id: "ta-otra-zona", tiendaId: TIENDA, zonaId: "z-otra", valorFlete: "222.00" }),
];

/** La misma tabla MAS la fila de nivel 1 del par: la contraprueba. */
const TABLA_CON_TARIFA: FilaTarifa[] = [
  ...TABLA_TARIFAS,
  filaTarifa({ id: "ta-del-par", tiendaId: TIENDA, zonaId: ZONA, valorFlete: "1000.00" }),
];

/**
 * El doble de `prisma.tarifa.findMany` compartido por las cuatro superficies. Devuelve la
 * tabla ENTERA sin filtrar: la seleccion tiene que salir de `elegirPorCascada`, no de que el
 * doble le haya escondido las candidatas ajenas.
 */
function prismaTarifas(filas: readonly FilaTarifa[]) {
  return { tarifa: { findMany: vi.fn(async () => [...filas]) } };
}

function resolverReal(filas: readonly FilaTarifa[]): TarifaVigenteRepository {
  return new TarifaVigenteRepository(prismaTarifas(filas) as unknown as PrismaClient);
}

// ---------------------------------------------------------------------------------------
// Geografia comun a los dos bordes de API: el distrito `d1` vive en la zona `z1`.
// ---------------------------------------------------------------------------------------

// FICHA 374: `disponible` es la disponibilidad EFECTIVA del nodo (la cascada ya aplicada).
const PROVINCIAS = [{ id: "p1", nombre: "San José", disponible: true }];
const CANTONES = [{ id: "c1", nombre: "Escazú", provinciaId: "p1", disponible: true }];
const DISTRITOS = [
  { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: ZONA, esCentral: false, disponible: true },
];

function filaApi(numRemision: string): Record<string, string> {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "San José",
    canton: "Escazú",
    distrito: "San Rafael",
    direccion: "Multiplaza, local 12",
    producto: "Caja",
    monto_cobrar: "25900",
  };
}

// ---------------------------------------------------------------------------------------
// SUPERFICIE 1 — el listado de ordenes
// ---------------------------------------------------------------------------------------

function ordenListRow() {
  return {
    id: "ord-1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: idEstado("en_bodega_central"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: TIENDA,
    zonaId: ZONA,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: new Prisma.Decimal("1.500"),
    notas: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    mensajeroAsignadoId: null,
    prioridad: false,
    estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
    tienda: { id: TIENDA, nombre: "Tienda X", email: "t@x.co", telefono: "0990000001" },
    zona: { id: ZONA, nombre: "Limón", esCentral: false },
    provincia: { id: "p1", nombre: "Limón" },
    canton: { id: "c1", nombre: "Central" },
    distrito: null,
    mensajeroAsignado: null,
    gestiones: [],
    montoCobrar: new Prisma.Decimal("25000.00"),
    cobraComision: true,
  };
}

async function porElListado(filas: readonly FilaTarifa[]) {
  const prisma = {
    orden: { findMany: vi.fn(async () => [ordenListRow()]), count: vi.fn(async () => 1) },
    ...prismaTarifas(filas),
  };
  const res = await new OrdenRepository(prisma as unknown as PrismaClient).list({
    where: {},
    sortBy: "created_at",
    sortDir: "desc",
    skip: 0,
    take: 50,
  });
  const item = res.items[0];
  return {
    tarifa: item.relaciones?.tienda?.tarifa ?? null,
    fleteConIva: item.fleteConIva,
    comisionConIva: item.comisionConIva,
  };
}

// ---------------------------------------------------------------------------------------
// SUPERFICIE 2 — el cierre de dia
// ---------------------------------------------------------------------------------------

const COLUMNAS_TARIFA_CIERRE = [
  "tarifaId",
  "tarifaValorFlete",
  "tarifaValorFleteGam",
  "tarifaValorFleteDevuelto",
  "tarifaValorFleteDevueltoGam",
  "tarifaComisionCod",
  "tarifaIvaFlete",
  "tarifaIvaComisionCod",
  "tarifaFulfillment",
] as const;

function snapshotRow() {
  return {
    ordenId: "ord-1",
    orden: {
      montoCobrar: new Prisma.Decimal("25000.00"),
      cobraComision: true,
      zonaId: ZONA,
      tiendaId: TIENDA,
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      zona: { nombre: "Limón", esCentral: false },
      tienda: { nombre: "Tienda X" },
      provincia: { nombre: "Limón" },
      canton: { nombre: "Central" },
      distrito: null,
    },
  };
}

const INPUT_CIERRE = {
  mensajeroId: "m1",
  destinoTipo: "bodega_satelite" as const,
  destinoZonaId: ZONA,
  totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
  pagoByGestionId: { g1: "0.00" },
  totalPagoMensajero: "0.00",
  ingresoByGestionId: { g1: "0.00" },
  totalIngresoBodegaRechazos: "0.00",
};

async function porElCierre(filas: readonly FilaTarifa[]) {
  const tx = {
    cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
    gestionOrden: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [snapshotRow()]),
    },
    cierreDetail: { createMany: vi.fn(async () => ({ count: 1 })) },
    ...prismaTarifas(filas),
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    ...prismaTarifas(filas),
  };
  const repo = new CierreDiaRepository(
    prisma as unknown as PrismaClient,
    new TarifaVigenteRepository(prisma as unknown as PrismaClient),
  );

  const cierreId = await repo.crearCierre(INPUT_CIERRE);
  const data = (
    tx.cierreDetail.createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }]
  )[0].data;
  return { cierreId, detalle: data[0] };
}

// ---------------------------------------------------------------------------------------
// SUPERFICIE 3 — la carga por API key (borde HTTP real)
// ---------------------------------------------------------------------------------------

function ordenRepoDoble(): IOrdenRepository {
  return {
    findUsuarioFulfillment: vi.fn(async () => false),
    findEstatusIdByValue: vi.fn(async () => "os-erbp"),
    findExistingRemisiones: vi.fn(async () => new Map<string, string>()),
    findAllProvincias: vi.fn(async () => PROVINCIAS),
    findCantonesByProvinciaIds: vi.fn(async () => CANTONES),
    findDistritosByCantonIds: vi.fn(async () => DISTRITOS),
    createManyOrdenes: vi.fn(async () => ({ inserted: 0, cargaId: null, omitidas: [] })),
    createManyOrdenesConGuia: vi.fn(async (data: CreateOrdenData[]) => ({
      creadas: data.map((d, i) => ({
        ordenId: `ord-${d.numRemision}`,
        numRemision: d.numRemision,
        numGuia: 1000 + i,
        estatusValue: "por_recolectar_en_tienda",
      })),
      cargaId: "44444444-4444-4444-8444-444444444444",
      omitidas: [],
    })),
  } as unknown as IOrdenRepository;
}

const etiquetasStub = {
  generarYPersistir: vi.fn(async () => ({ consolidado: null, porOrden: new Map<string, string>() })),
} as unknown as IEtiquetasDescargaService;

const manifiestoStub = {
  armar: vi.fn(async () => ({ status: "ok", filas: [], omitidas: [] })),
} as unknown as IManifiestoService;

function depsCarga(repo: IOrdenRepository, filas: readonly FilaTarifa[]): CargaApiDeps {
  return {
    autenticar: async () =>
      ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    bulkService: new BulkOrdenService(repo, resolverReal(filas)),
    descargaService: etiquetasStub,
    manifiestoService: manifiestoStub,
  };
}

async function porLaCarga(filas: readonly FilaTarifa[], repo: IOrdenRepository = ordenRepoDoble()) {
  const req = new Request("http://localhost/api/ordenes/api-key/carga", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
    body: JSON.stringify({ ordenes: [filaApi("REM-1")] }),
  });
  const res = await handleCargaApi(req, depsCarga(repo, filas));
  return { res, body: (await res.json()) as Record<string, unknown>, repo };
}

// ---------------------------------------------------------------------------------------
// SUPERFICIE 4 — la cotizacion por API key (borde HTTP real)
// ---------------------------------------------------------------------------------------

function depsCotizacion(filas: readonly FilaTarifa[]): CotizacionApiDeps {
  const geo = {
    findAllProvincias: async () => PROVINCIAS,
    findCantonesByProvinciaIds: async () => CANTONES,
    findDistritosByCantonIds: async () => DISTRITOS,
  } as unknown as IOrdenRepository;
  return {
    autenticar: async () =>
      ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    cotizacionService: new CotizacionOrdenService(geo, resolverReal(filas)),
  };
}

async function porLaCotizacion(filas: readonly FilaTarifa[]) {
  const req = new Request("http://localhost/api/ordenes/api-key/cotizacion", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
    body: JSON.stringify({ ordenes: [filaApi("REM-0001")] }),
  });
  const res = await handleCotizacionApi(req, depsCotizacion(filas));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------------------
// SUPERFICIE 5 — la LECTURA por API key (listado/detalle), ⏳ 2026-09-10, feature 415
// ---------------------------------------------------------------------------------------

/** Fila de `orden` como la devuelve el `select` del canal integrador (`apiOrdenSelect`). */
function ordenApiRow() {
  return {
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Av 1",
    montoCobrar: new Prisma.Decimal("25000.00"),
    createdAt: new Date("2026-01-01"),
    estatus: { value: "en_bodega_central" },
    mensajeroAsignado: null,
    // ⭑ EL MISMO PAR que preguntan las otras cuatro: (key-user-1, z1).
    zonaId: ZONA,
    cobraComision: true,
    zona: { id: ZONA, nombre: "Limón", esCentral: false },
    distrito: null,
    // Sin fila congelada: este archivo mide el hueco de la tarifa VIGENTE.
    cierreDetalles: [],
    gestiones: [],
    historialEstados: [],
    incidentesAdmin: [],
  };
}

async function porLaLecturaApi(filas: readonly FilaTarifa[]) {
  const fila = ordenApiRow();
  const prisma = {
    orden: {
      findMany: vi.fn(async () => [fila]),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => fila),
    },
    ...prismaTarifas(filas),
  };
  const svc = new ApiOrdenLecturaService(
    new OrdenRepository(prisma as unknown as PrismaClient),
    {
      createSignedUrl: vi.fn(async () => "https://signed/one"),
      createSignedUrls: vi.fn(async () => ({})),
    } as unknown as ISignedUrlProvider,
    // El resolutor REAL, igual que las otras cuatro superficies.
    resolverReal(filas),
  );
  const listado = await svc.listar(KEY_ACTOR, { limit: 50, offset: 0 });
  const detalle = await svc.detallePorOrdenId(KEY_ACTOR, "ord-1");
  return { item: listado.items[0], detalle: detalle! };
}

// =======================================================================================

beforeEach(async () => {
  await sembrarCatalogoEstados();
  vi.clearAllMocks();
});

describe("274/R39 — las superficies INTERNAS no bloquean ante el hueco de tarifa", () => {
  it("el listado devuelve `tarifa: null` y los importes en '0.00', sin error (R20)", async () => {
    const r = await porElListado(TABLA_TARIFAS);

    expect(r.tarifa).toBeNull();
    expect(r.fleteConIva).toBe("0.00");
    expect(r.comisionConIva).toBe("0.00");
  });

  it("el cierre de dia SE CREA, con las 9 columnas de tarifa en NULL (R23)", async () => {
    const r = await porElCierre(TABLA_TARIFAS);

    // Lo primero: el cierre existe. El mensajero termina su dia.
    expect(r.cierreId).toBe("c1");
    // Las NUEVE, todas o ninguna: un snapshot a medias seria peor que ninguno.
    for (const col of COLUMNAS_TARIFA_CIERRE) {
      expect(r.detalle[col], col).toBeNull();
    }
    // Y el resto de la fila SI se congelo: el gap es de tarifa, no del detalle entero.
    expect(r.detalle).toMatchObject({ numRemision: "REM-1", tiendaId: TIENDA, zonaId: ZONA });
  });
});

describe("274/R39 — los dos bordes de API por key SI bloquean, con 409", () => {
  it("la carga responde 409 con el mensaje publicado y no persiste nada (R29)", async () => {
    const { res, body, repo } = await porLaCarga(TABLA_TARIFAS);

    expect(res.status).toBe(409);
    // Contra la CONSTANTE, no contra un literal re-escrito (R38).
    expect(body).toMatchObject({
      status: "error",
      code: "CONFLICT",
      message: MSG_CARGA_SIN_TARIFA,
    });
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    // R31: y ni un importe en el cuerpo del error, tampoco un cero.
    expect(JSON.stringify(body)).not.toContain("0.00");
  });

  it("la cotizacion responde 409 con el mensaje publicado y sin importes (R35)", async () => {
    const { res, body } = await porLaCotizacion(TABLA_TARIFAS);

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      status: "error",
      code: "CONFLICT",
      message: MSG_COTIZACION_SIN_TARIFA,
    });
    expect(JSON.stringify(body)).not.toContain("0.00");
  });
});

describe("415/R22 — la QUINTA superficie: la LECTURA por API key devuelve `null`", () => {
  it("`costoEstimado` es `null` y NO cinco `\"0.00\"` (ni en el item ni en el detalle)", async () => {
    const { item, detalle } = await porLaLecturaApi(TABLA_TARIFAS);

    expect(item.costoEstimado).toBeNull();
    expect(detalle.costoEstimado).toBeNull();
    // Ni un cero disfrazado de precio: el cuerpo no lleva ningun importe `"0.00"`. Se busca CON
    // las comillas a proposito —un valor de cadena, no una subcadena cualquiera—: el `createdAt`
    // serializado (`...T00:00:00.000Z`) contiene `0.00` y no es dinero.
    expect(JSON.stringify(item)).not.toContain('"0.00"');
    // Pero la orden SE SIRVE: esta superficie no puede bloquear con un 409 (la orden existe).
    expect(item.numRemision).toBe("REM-1");
    expect(item.zona).toEqual({ id: ZONA, nombre: "Limón" });
    // Y la clave viaja explicita, que es lo que distingue «no hay tarifa» de «no te lo digo».
    expect(JSON.stringify(item)).toContain('"costoEstimado":null');
  });

  it("CONTRAPRUEBA: anadida la fila del par, la quinta devuelve los CINCO conceptos", async () => {
    // Sin esta contraprueba, un montaje roto —un par mal formado, un resolutor que nunca
    // resuelve— daria `null` por una razon que no tiene nada que ver con la tarifa.
    const { item } = await porLaLecturaApi(TABLA_CON_TARIFA);

    // Aritmetica A MANO con `ta-del-par` (valorFlete 1000.00, zona NO central; IVA flete 13 %;
    // comision COD 5 % sobre 25000.00; IVA comision 13 %; fulfillment 1.00):
    //   flete       = 1000.00
    //   iva         = 1000.00 x 13 %            =  130.00
    //   comision    = 25000.00 x 5 %            = 1250.00
    //   ivaComision = 1250.00 x 13 %            =  162.50
    //   fulfillment = tarifas.fulfillment       =    1.00
    expect(item.costoEstimado).toEqual({
      flete: "1000.00",
      iva: "130.00",
      comision: "1250.00",
      ivaComision: "162.50",
      fulfillment: "1.00",
    });
  });
});

describe("274/R39 — la asimetria, afirmada de una sola vez sobre el MISMO estado", () => {
  it("mismo hueco, CINCO respuestas: '0.00' / NULL / 409 / 409 / null", async () => {
    // El MISMO array para las cinco llamadas: no hay margen para que una vea otra tabla.
    const filas = TABLA_TARIFAS;

    const listado = await porElListado(filas);
    const cierre = await porElCierre(filas);
    const carga = await porLaCarga(filas);
    const cotizacion = await porLaCotizacion(filas);
    const lecturaApi = await porLaLecturaApi(filas);

    expect({
      listado: listado.fleteConIva,
      listadoTarifa: listado.tarifa,
      cierre: cierre.detalle.tarifaId,
      cierreCreado: cierre.cierreId !== null,
      carga: carga.res.status,
      cotizacion: cotizacion.res.status,
      // ⏳ 2026-09-10 (415/R22): la quinta. NO bloquea —el item se sirve— y NO miente.
      lecturaApiCosto: lecturaApi.item.costoEstimado,
      lecturaApiSirveLaOrden: lecturaApi.item.numRemision,
    }).toEqual({
      listado: "0.00",
      listadoTarifa: null,
      cierre: null,
      cierreCreado: true,
      carga: 409,
      cotizacion: 409,
      lecturaApiCosto: null,
      lecturaApiSirveLaOrden: "REM-1",
    });
  });

  it("CONTRAPRUEBA: anadida la fila del par, las CINCO responden bien (el montaje no miente)", async () => {
    // Sin esta contraprueba, un montaje roto —una geografia que no resuelve, un actor mal
    // formado— daria "0.00" y dos 409 por motivos que no tienen nada que ver con la tarifa, y
    // el test de arriba estaria verde por la razon equivocada.
    const filas = TABLA_CON_TARIFA;

    const listado = await porElListado(filas);
    expect(listado.tarifa?.id).toBe("ta-del-par");
    expect(listado.fleteConIva).not.toBe("0.00");

    const cierre = await porElCierre(filas);
    expect(cierre.detalle.tarifaId).toBe("ta-del-par");

    const carga = await porLaCarga(filas);
    expect(carga.res.status).toBe(200);

    const cotizacion = await porLaCotizacion(filas);
    expect(cotizacion.res.status).toBe(200);

    // ⏳ 2026-09-10 (415/R22): la quinta pasa de `null` a los cinco conceptos.
    const lecturaApi = await porLaLecturaApi(filas);
    expect(lecturaApi.item.costoEstimado).not.toBeNull();
    expect(lecturaApi.item.costoEstimado!.flete).toBe("1000.00");
  });
});
