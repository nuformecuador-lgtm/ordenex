import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  handleCotizacionApi,
  type CotizacionApiDeps,
} from "@/app/api/ordenes/api-key/cotizacion/route";
import { ConflictError } from "@/lib/errors";
import { CotizacionOrdenService } from "@/lib/services/CotizacionOrdenService";
import { MSG_COTIZACION_SIN_TARIFA } from "@/lib/services/mensajes-cotizacion";
import { MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigente,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import type { ICotizacionOrdenService } from "@/lib/interfaces/services/ICotizacionOrdenService";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { monedaConfig } from "@/lib/config/moneda";
import { codigoSinComentarios } from "../fixtures/sin-comentarios";

/**
 * Feature 255 (T8 + T13) — el BORDE HTTP de la cotizacion por API key, ejercitado sobre el
 * route handler con DEPENDENCIAS INYECTADAS: sin base de datos, sin cookies y sin red.
 *
 * Es el mismo patron que los tests de `handleCargaApi`, y aqui carga ademas el peso que en la
 * carga llevaria un E2E: `design.md` §8 declara que esta feature NO tiene Playwright porque no
 * ingesta nada, no tiene UI y su superficie entera es un contrato JSON autenticado por key.
 *
 * Dos formas de doble conviven a proposito:
 *   - un `ICotizacionOrdenService` ESPIA, para los casos que se resuelven ANTES del service
 *     (401/403/422): lo que se afirma es que el service no llega a invocarse;
 *   - el service REAL cableado a un repositorio proxy, para los casos de contrato de salida
 *     (200/409): asi lo que se comprueba es el JSON que veria el integrador, no el de un mock
 *     escrito para pasar el test.
 */

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" as RolValue };
const SECRETO = "ordx_secretovivo1234567890";
const HASH_FALSO = "9f2c4a1b8e7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f";

const RUTA = "http://localhost/api/ordenes/api-key/cotizacion";

/** La tarifa del ejemplo firmado de `design.md` §2.2 (misma que la suite del service). */
const TARIFA: TarifaVigente = {
  valorFlete: "2500.00",
  valorFleteGam: "3000.00",
  valorFleteDevuelto: "1396.46",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const PROVINCIAS = [{ id: "p1", nombre: "San José" }];
const CANTONES = [{ id: "c1", nombre: "Escazú", provinciaId: "p1" }];
/**
 * Feature 274 — la tarifa de OTRA zona, en la MISMA columna que la de `z1` (las dos filas son
 * no-centrales). Es lo que hace visible por el borde que el precio depende del par
 * (tienda, zona) y no de la tienda sola (R32).
 */
const TARIFA_Z3: TarifaVigente = {
  valorFlete: "4000.00",
  valorFleteGam: "4500.00",
  valorFleteDevuelto: "2000.00",
  valorFleteDevueltoGam: "2200.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const DISTRITOS = [
  { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: "z1", esCentral: false },
  { id: "d2", nombre: "Centro", cantonId: "c1", zonaId: "z2", esCentral: true },
  // Feature 274: un distrito NO-CENTRAL en una zona distinta de `z1`.
  { id: "d3", nombre: "Santa Ana", cantonId: "c1", zonaId: "z3", esCentral: false },
];

/** Fila cubierta, con la geografia en columnas SEPARADas (contrato publico de la 88). */
function filaOk(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    provincia: "San José",
    canton: "Escazú",
    distrito: "San Rafael",
    direccion: "Multiplaza, local 12",
    monto_cobrar: "25900",
    num_remision: "REM-0001",
    ...overrides,
  };
}

/** Fila cuya terna geografica NO resuelve: el distrito no vive en ese canton (R18). */
function filaSinCobertura(): Record<string, string> {
  return filaOk({ distrito: "Distrito Que No Existe", num_remision: "REM-0002" });
}

// ---------------------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------------------

/**
 * Los metodos de ESCRITURA de `IOrdenRepository` (T13.1/R43): crear, actualizar, transicionar,
 * asignar, recibir, persistir URLs... y, nombrados aparte por lo que significan, el consumo de
 * guias (`generarGuiaLote`, R44) y el rastro por orden (`transicionarAyuda`,
 * `incrementarIntentoContacto`, R45).
 *
 * La lista esta escrita a mano y con los nombres REALES de la interfaz. El `satisfies` de abajo
 * NO es decoracion: sin el, este censo es MUDO. El doble de repositorio es un `Proxy` que acepta
 * cualquier nombre de propiedad, asi que un metodo que ya no existe en `IOrdenRepository` seguiria
 * pasando en verde para siempre — el propio archivo lo decia («pasaria igual si el metodo no
 * existiera») y era literalmente cierto: al retirar `recibirLoteEnSatelite` en la feature 279, el
 * typecheck no dijo ni una palabra de esta lista.
 *
 * Feature 279 (T3B.5, R39/R41): `as const satisfies readonly (keyof IOrdenRepository)[]` convierte
 * ese fallo mudo en error de compilacion. Nombrar aqui un metodo inexistente ya NO compila.
 */
const METODOS_ESCRITURA = [
  "createManyOrdenes",
  "createManyOrdenesConGuia",
  "update",
  "cancelarViaApi",
  "generarGuiaLote",
  "asignarBodegaLote",
  "rutearBodegaSateliteLote",
  "asignarRecoleccionLote",
  "desasignarRecoleccionLote",
  "recolectarEnTienda",
  "recibirEnSatelite",
  "recibirEnOrigen",
  "recibirEnBodegaCentral",
  "asignarSateliteLote",
  "deshacerAsignacionLote",
  "transicionarAyuda",
  "incrementarIntentoContacto",
  "setCargaDownloadUrl",
  "setOrdenesDownloadUrl",
  "setOrdenDownloadStoragePath",
  "setCargaDownloadStoragePath",
] as const satisfies readonly (keyof IOrdenRepository)[];

/** Las TRES lecturas geograficas, y NADA MAS, es lo unico que puede tocar una cotizacion. */
const LECTURAS_PERMITIDAS = [
  "findAllProvincias",
  "findCantonesByProvinciaIds",
  "findDistritosByCantonIds",
] as const;

interface RepoDoble {
  repo: IOrdenRepository;
  /** Nombres de TODOS los metodos del repositorio que se invocaron, en orden. */
  invocados: string[];
}

/**
 * Repositorio de ordenes COMPLETO como proxy: cualquier metodo que alguien invoque queda
 * registrado por nombre, tenga o no implementacion. Las tres lecturas geograficas devuelven
 * datos; todo lo demas es un espia que registra y estalla si de verdad se usara su resultado.
 *
 * Se prefiere el proxy a un objeto con 70 `vi.fn()`: la afirmacion fuerte de R43/R44/R45 no es
 * "estos 22 metodos no se llamaron", es "NINGUNO fuera de las tres lecturas se llamo", y esa
 * solo se puede escribir si el doble ve TODOS los accesos.
 */
function buildRepoDoble(): RepoDoble {
  const invocados: string[] = [];
  const base: Record<string, unknown> = {
    findAllProvincias: async () => PROVINCIAS,
    findCantonesByProvinciaIds: async () => CANTONES,
    findDistritosByCantonIds: async () => DISTRITOS,
  };
  const repo = new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      const impl = target[prop];
      return (...args: unknown[]) => {
        invocados.push(prop);
        if (typeof impl === "function") return (impl as (...a: unknown[]) => unknown)(...args);
        throw new Error(`la cotizacion invoco un metodo prohibido del repositorio: ${prop}`);
      };
    },
  }) as unknown as IOrdenRepository;
  return { repo, invocados };
}

/**
 * Feature 274/R37 — el resolver es UNO SOLO (`resolveTarifa`/`resolveTarifas`), el mismo que
 * liquida el cierre de dia. Acepta una tarifa unica para todas las zonas o un mapa
 * `zonaId -> tarifa | null`, que es lo que permite montar un lote mixto por el borde.
 */
type TarifaPorZona = Record<string, TarifaVigente | null>;

function esTarifaUnica(v: TarifaVigente | TarifaPorZona): v is TarifaVigente {
  return "valorFlete" in v;
}

function buildTarifaRepo(
  tarifas: TarifaVigente | TarifaPorZona | null = TARIFA,
): ITarifaVigenteRepository {
  const paraZona = (zonaId: string | null): TarifaVigenteResuelta | null => {
    const base =
      tarifas === null
        ? null
        : esTarifaUnica(tarifas)
          ? tarifas
          : zonaId === null
            ? null
            : (tarifas[zonaId] ?? null);
    if (base === null) return null;
    return { ...base, tarifaId: `tarifa-${zonaId ?? "sin-zona"}`, fulfillment: "0.00" };
  };

  return {
    resolveTarifa: vi.fn(async (_tiendaId: string, zonaId: string | null) => paraZona(zonaId)),
    resolveTarifas: vi.fn(async (pares: readonly ParTarifa[]) => {
      const mapa = new Map<string, TarifaVigenteResuelta | null>();
      for (const par of pares) mapa.set(clavePar(par), paraZona(par.zonaId));
      return mapa;
    }),
  };
}

/** El service ESPIA: para los caminos que ni siquiera deben llegar a cotizar. */
function espiaService(): ICotizacionOrdenService {
  return { cotizar: vi.fn() };
}

function reqConBearer(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(RUTA, { method: "POST", headers, body: JSON.stringify(body) });
}

function deps(
  auth: ApiKeyAuthResult,
  service: ICotizacionOrdenService,
  spyAuth?: CotizacionApiDeps["autenticar"],
): CotizacionApiDeps {
  return { autenticar: spyAuth ?? (async () => auth), cotizacionService: service };
}

/** Cablea el service REAL con dobles de repositorio y devuelve tambien las sondas. */
function depsReales(
  opciones: { tarifa?: TarifaVigente | TarifaPorZona | null } = {},
): CotizacionApiDeps & { sondas: RepoDoble; tarifaRepo: ITarifaVigenteRepository } {
  const sondas = buildRepoDoble();
  const tarifaRepo = buildTarifaRepo(opciones.tarifa === undefined ? TARIFA : opciones.tarifa);
  return {
    autenticar: async () => ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }),
    cotizacionService: new CotizacionOrdenService(sondas.repo, tarifaRepo),
    sondas,
    tarifaRepo,
  };
}

const FUENTE_RUTA = codigoSinComentarios("app/api/ordenes/api-key/cotizacion/route.ts");

// ---------------------------------------------------------------------------------------
// Utilidades de inspeccion del JSON de salida
// ---------------------------------------------------------------------------------------

type Hoja = { ruta: string; valor: unknown };

/** Aplana el JSON de la respuesta a pares `ruta -> valor` (hojas). */
function hojas(valor: unknown, ruta = ""): Hoja[] {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => hojas(v, `${ruta}[${i}]`));
  if (valor !== null && typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) =>
      hojas(v, ruta === "" ? k : `${ruta}.${k}`),
    );
  }
  return [{ ruta, valor }];
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * La forma FORMATEADA que este canal servia hasta la ficha 319 (2026-08-28): simbolo,
 * miles agrupados y coma decimal, con los tres caracteres LEIDOS de `monedaConfig`
 * (escribirlos a mano aqui seria el hardcode de contexto que R36 prohibia).
 *
 * Ya NO es lo que se sirve: sobrevive como el DETECTOR de la regresion. Si alguien
 * devolviera el formateo al contrato, el barrido de mas abajo lo caza.
 */
const IMPORTE_FORMATEADO = new RegExp(
  `^-?${escapar(monedaConfig.simbolo)}\\d{1,3}(${escapar(monedaConfig.separadorMiles)}\\d{3})*` +
    `${escapar(monedaConfig.separadorDecimal)}\\d{2}$`,
);

/**
 * Un numero crudo de escala 2 servido como texto: `"2500.00"`, `"-1578.00"`. Desde la
 * ficha 319 esta ES la forma del contrato, y no la forma prohibida que era antes.
 */
const CRUDO_ESCALA_2 = /^-?\d+\.\d{2}$/;

const NOMBRES_DE_IMPORTE = ["flete", "iva", "comision", "ivaComision", "total"];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------------
// 1. Autenticacion y titularidad (R1-R4)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — autenticacion (R1/R2/R3/R4)", () => {
  it("devuelve 401 sin header Authorization, y no consulta tarifa ni geografia (R1)", async () => {
    const spyAuth = vi.fn(async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult);
    const { sondas, tarifaRepo, cotizacionService } = depsReales();
    const req = new Request(RUTA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordenes: [filaOk()] }),
    });

    const res = await handleCotizacionApi(req, { autenticar: spyAuth, cotizacionService });

    expect(res.status).toBe(401);
    // R1: el header ausente llega al autenticador como `null` (no como cadena vacia).
    expect(spyAuth).toHaveBeenCalledWith(null);
    // Y lo que R1 exige de verdad: NI tarifa NI geografia. El 401 se decide antes de que
    // exista una tienda de la que resolver nada.
    expect(tarifaRepo.resolveTarifas).not.toHaveBeenCalled();
    expect(sondas.invocados).toEqual([]);
  });

  it("una key inexistente devuelve el MISMO 401 que la ausencia de key (R2)", async () => {
    const sinKey = await handleCotizacionApi(
      new Request(RUTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenes: [filaOk()] }),
      }),
      deps({ status: "unauthenticated" }, espiaService()),
    );
    const keyFantasma = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk()] }, SECRETO),
      deps({ status: "unauthenticated" }, espiaService()),
    );

    expect(sinKey.status).toBe(401);
    expect(keyFantasma.status).toBe(401);
    // Misma SHAPE y mismo MENSAJE: desde fuera, "no mandaste key" y "esa key no existe" son
    // indistinguibles, que es justo lo que impide enumerar keys validas contra este borde.
    expect(await keyFantasma.json()).toEqual(await sinKey.json());
  });

  it("devuelve 403 cuando el usuario dedicado de la key no esta activo (R3)", async () => {
    const service = espiaService();
    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk()] }, SECRETO),
      deps({ status: "forbidden" }, service),
    );

    expect(res.status).toBe(403);
    // Un 403 no cotiza: el service ni se invoca.
    expect(service.cotizar).not.toHaveBeenCalled();
  });

  it("ignora un tiendaId del cuerpo y cotiza siempre contra el dueño de la key (R4)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    const res = await handleCotizacionApi(
      reqConBearer(
        {
          // Tres intentos de suplantar al dueño, en el cuerpo y en cada fila.
          tiendaId: "tienda-ajena",
          usuarioId: "otro-usuario",
          ordenes: [filaOk({ tienda_id: "tienda-ajena", tarifa_id: "tarifa-ajena" })],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    // La tarifa se resuelve SIEMPRE contra el actor de la key, nunca contra el cuerpo. Desde la
    // 274 lo que viaja es el PAR (tienda, zona), y la mitad `tienda` sigue saliendo del actor.
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: KEY_ACTOR.usuarioId, zonaId: "z1" },
    ]);
    const paresPedidos = vi.mocked(tarifaRepo.resolveTarifas).mock.calls.flatMap(([pares]) => [
      ...pares,
    ]);
    expect(paresPedidos.every((par) => par.tiendaId === KEY_ACTOR.usuarioId)).toBe(true);
    expect(paresPedidos.some((par) => par.tiendaId === "tienda-ajena")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// 2. Entrada (R6/R7/R8)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — entrada (R6/R7/R8)", () => {
  it("devuelve 422 con fieldErrors ante un cuerpo no-JSON y ante un schema invalido (R6)", async () => {
    const service = espiaService();
    const noJson = new Request(RUTA, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
      body: "{ no-json",
    });

    const res1 = await handleCotizacionApi(
      noJson,
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    const body1 = (await res1.json()) as {
      code: string;
      details?: { fieldErrors?: Record<string, string[]> };
    };
    expect(res1.status).toBe(422);
    expect(body1.code).toBe("VALIDATION_ERROR");
    expect(body1.details?.fieldErrors?.ordenes).toBeDefined();

    // Schema invalido: `ordenes` no es un array de filas.
    const res2 = await handleCotizacionApi(
      reqConBearer({ ordenes: "una fila" }, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    const body2 = (await res2.json()) as {
      code: string;
      details?: { fieldErrors?: Record<string, string[]> };
    };
    expect(res2.status).toBe(422);
    expect(body2.code).toBe("VALIDATION_ERROR");
    expect(body2.details?.fieldErrors?.ordenes?.length).toBeGreaterThan(0);

    // Ni una fila se cotiza en ninguno de los dos casos.
    expect(service.cotizar).not.toHaveBeenCalled();
  });

  it("acepta el MISMO cuerpo que POST /carga sin recortarlo (R7)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;
    // Cuerpo COMPLETO de la carga por API key: campos obligatorios alli que aqui no aportan al
    // precio, mas los dos parametros de lote (`name`, `download_type`). El punto entero de la
    // feature es que el integrador no tenga que recortar nada.
    const res = await handleCotizacionApi(
      reqConBearer(
        {
          name: "lote-de-prueba",
          download_type: "consolidate",
          ordenes: [
            filaOk({
              destinatario: "Ana Solís",
              telefono: "099999999",
              producto: "Caja de té",
              notas: "dejar en recepción",
            }),
          ],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { cotizadas: number; filas: { resultado: string }[] };
    expect(body.cotizadas).toBe(1);
    expect(body.filas[0].resultado).toBe("cotizada");
  });

  it("422 con lote vacio y con lote por encima de MAX_CHUNK_ROWS (R8)", async () => {
    const service = espiaService();
    const vacio = await handleCotizacionApi(
      reqConBearer({ ordenes: [] }, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    expect(vacio.status).toBe(422);

    const excedido = await handleCotizacionApi(
      reqConBearer(
        { ordenes: Array.from({ length: cargaMasivaConfig.MAX_CHUNK_ROWS + 1 }, () => filaOk()) },
        SECRETO,
      ),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    expect(excedido.status).toBe(422);

    // Ninguno de los dos llega a cotizar ni una fila.
    expect(service.cotizar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// 3. Tarifa ausente (R13/R16)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — tarifa ausente (R13/R16, feature 274/R35)", () => {
  it("409 con mensaje explicito cuando NINGUNA fila del lote resuelve tarifa, sin filas (R35)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({ tarifa: null });
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk(), filaOk({ num_remision: "REM-0002" })] }, SECRETO),
      cotizacionDeps,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    // R35: el MISMO body que hoy. No se re-describe aqui: se compara contra el shape que el
    // propio serializador de errores de la app produce para ese conflicto.
    expect(body).toEqual(new ConflictError(MSG_COTIZACION_SIN_TARIFA).toShape());
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toBe(MSG_COTIZACION_SIN_TARIFA);
    // Sin filas y sin NI UN importe: el 409 es la inversion deliberada del gap D1/R8 de la 98.
    expect(body).not.toHaveProperty("filas");
    expect(body).not.toHaveProperty("totales");
    expect(JSON.stringify(body)).not.toContain(monedaConfig.simbolo);
    // Feature 274: el orden se INVIRTIO. La geografia se resuelve PRIMERO (sin zona no hay par
    // que consultar), asi que las tres lecturas geograficas SI ocurren antes del 409. Lo que
    // sigue sin ocurrir es lo unico que importaba: emitir un importe.
    expect(new Set(sondas.invocados)).toEqual(new Set(LECTURAS_PERMITIDAS));
  });

  it("el mensaje del 409 no contiene key, hash ni datos de la fila (R16)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({ tarifa: null });
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer(
        {
          ordenes: [
            filaOk({ destinatario: "Ana Solís", telefono: "099999999", hashKey: HASH_FALSO }),
          ],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );

    const crudo = JSON.stringify(await res.json());
    for (const secreto of [SECRETO, HASH_FALSO, "Ana Solís", "099999999", "REM-0001"]) {
      expect(crudo).not.toContain(secreto);
    }
    // Es una constante sin interpolacion: esa es su garantia, no una limpieza posterior.
    expect(MSG_COTIZACION_SIN_TARIFA).not.toMatch(/\$\{|key|hash/i);
  });
});

// ---------------------------------------------------------------------------------------
// 4. Contrato de salida 200 (R21/R34/R46/R51/R56)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — respuesta 200 (R21/R34/R46/R51/R56)", () => {
  it("200 con la fila sin cobertura marcada y el resto cotizado (R21)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer(
        { ordenes: [filaOk(), filaSinCobertura(), filaOk({ num_remision: "REM-0003" })] },
        SECRETO,
      ),
      cotizacionDeps,
    );

    // Exito PARCIAL: una fila mala no tumba el lote (mismo comportamiento que la carga).
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      cotizadas: number;
      conError: number;
      filas: {
        fila: number;
        resultado: string;
        costos?: unknown;
        errores?: Record<string, string[]>;
      }[];
      errores: {
        fila: number;
        resultado: string;
        costos?: unknown;
        errores: Record<string, string[]>;
      }[];
    };
    expect(body.total).toBe(3);
    expect(body.cotizadas).toBe(2);
    expect(body.conError).toBe(1);
    // 2026-08-31: las dos listas. `filas` trae SOLO lo cotizado —la fila mala ni aparece— y el
    // fallo se lee directo en `errores`, sin recorrer el lote ramificando por `resultado`.
    expect(body.filas.map((f) => f.fila)).toEqual([1, 3]);
    expect(body.filas.map((f) => f.resultado)).toEqual(["cotizada", "cotizada"]);
    expect(body.errores.map((f) => f.fila)).toEqual([2]);
    // R22: la fila en error NO trae costos; la cotizada NO trae errores.
    expect(body.errores[0].costos).toBeUndefined();
    expect(body.errores[0].errores.distrito).toEqual(["distrito no encontrado en el canton"]);
    expect(body.filas[0].errores).toBeUndefined();
  });

  it("la respuesta trae total, cotizadas, conError y el indice 1-based por fila (R46)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer(
        {
          ordenes: [
            filaOk(),
            filaSinCobertura(),
            filaOk({ distrito: "Centro", num_remision: "" }),
          ],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );

    const body = (await res.json()) as {
      total: number;
      cotizadas: number;
      conError: number;
      filas: { fila: number; numRemision: string | null }[];
      errores: { fila: number; numRemision: string | null }[];
    };
    expect(body.total).toBe(3);
    expect(body.cotizadas + body.conError).toBe(body.total);
    // 1-BASED y en el orden del array recibido: es lo unico que le permite al integrador
    // correlacionar cada resultado con la fila de su archivo. Desde el 2026-08-31 el indice
    // sobrevive al reparto en dos listas —es justo lo que lo hace util—: la fila 2 no
    // desaparece, se lee en `errores` con su numero intacto.
    expect(body.filas.map((f) => f.fila)).toEqual([1, 3]);
    expect(body.errores.map((f) => f.fila)).toEqual([2]);
    expect(body.filas[0].numRemision).toBe("REM-0001");
    expect(body.errores[0].numRemision).toBe("REM-0002");
    // R9: sin `num_remision` -> `null` explicito, nunca ausente.
    expect(body.filas[1].numRemision).toBeNull();
  });

  // 2026-08-31 — LA RESPUESTA NO AGREGA EL LOTE. El bloque `totales` sumaba cada fila
  // cotizada en el escenario entregado Y en el devuelto: dos compilados bajo "100% entregas" y
  // "100% rechazos", premisas que ningun lote real cumple, servidos donde se lee un precio.
  it("la respuesta NO trae bloque totales: la cotizacion es por orden", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk(), filaSinCobertura()] }, SECRETO),
      cotizacionDeps,
    );

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("totales");
    // La forma completa del sobre: tres contadores y las DOS listas por fila, nada mas.
    expect(Object.keys(body).sort()).toEqual([
      "conError",
      "cotizadas",
      "errores",
      "filas",
      "total",
    ]);
    // Y los contadores de la raiz siguen cuadrando con las filas.
    expect(body.cotizadas).toBe(1);
    expect(body.conError).toBe(1);
    expect((body.cotizadas as number) + (body.conError as number)).toBe(body.total);
  });

  // 2026-08-31 — EL VALOR SOBRE EL QUE SE COTIZA VIAJA EN LA RESPUESTA. Todo el desglose se
  // deriva de el, y la puerta lo redondea al colon para que el precio prometido sea el que se
  // cobrara (ficha 305): sin publicarlo, quien manda centimos no puede cuadrar la comision.
  it("cada fila cotizada publica el monto sobre el que se cotizo, ya redondeado", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer(
        {
          ordenes: [
            filaOk(),
            filaOk({ monto_cobrar: "11898.81", num_remision: "REM-0003" }),
            filaOk({ monto_cobrar: "", num_remision: "REM-0004" }),
          ],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { filas: { montoCobrar: string }[] };
    // El tercero es el cero EXPLICITO: la base que de verdad uso la comision, no una ausencia.
    expect(body.filas.map((f) => f.montoCobrar)).toEqual(["25900.00", "11899.00", "0.00"]);
  });

  it("ese caso responde 200, no 409 (R56: ninguna fila cotizable)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaSinCobertura(), filaSinCobertura()] }, SECRETO),
      cotizacionDeps,
    );

    // La distincion que fija R56: SI hay tarifa (por eso no es 409); lo que no hay es
    // cobertura. Un 409 aqui le diria al integrador que su cuenta no puede cotizar.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      cotizadas: number;
      conError: number;
      filas: Record<string, unknown>[];
    };
    expect(body.cotizadas).toBe(0);
    expect(body.conError).toBe(body.total);
    // Sin agregado del lote y sin filas cotizadas, la respuesta no lleva NI UN importe: ni
    // siquiera un cero, que seria indistinguible de un envio gratis.
    expect(body).not.toHaveProperty("totales");
    expect(body.filas.every((f) => !("costos" in f))).toBe(true);
  });

  it("cada importe aparece una sola vez y solo CRUDO, ningun campo formateado (R34, enmendada por la 319)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer(
        { ordenes: [filaOk(), filaOk({ distrito: "Centro", num_remision: "REM-0003" })] },
        SECRETO,
      ),
      cotizacionDeps,
    );

    const body = await res.json();
    const todas = hojas(body);

    // (a) Todo campo que se LLAMA como un importe DENTRO de un escenario es un string
    // money-safe CRUDO. El filtro por escenario no es cosmetico: el `total` de la raiz es
    // un CONTADOR de filas, no dinero, y confundirlos seria pedirle forma de importe.
    const importes = todas.filter(
      (h) =>
        /\.(entregado|devuelto)\./.test(h.ruta) &&
        NOMBRES_DE_IMPORTE.includes(h.ruta.split(".").pop()!),
    );
    expect(importes.length).toBeGreaterThan(0);
    for (const h of importes) {
      expect(typeof h.valor, h.ruta).toBe("string");
      expect(h.valor as string, h.ruta).toMatch(CRUDO_ESCALA_2);
    }

    // (b) NINGUNA hoja del JSON viaja FORMATEADA, en ninguna ruta y con cualquier nombre.
    // La ficha 319 invierte el SENTIDO de esta mitad —antes se prohibia el crudo, hoy se
    // prohibe el formateado— pero no su PROPOSITO, que es el que firmo A3 y sigue en pie:
    // cada importe existe en UNA sola forma, nunca en dos que se desincronizan. Asi se caza
    // un `fleteFormateado` "de cortesia" colado en paralelo al crudo.
    for (const h of todas) {
      if (typeof h.valor === "string") {
        expect(IMPORTE_FORMATEADO.test(h.valor), `${h.ruta} = ${h.valor}`).toBe(false);
        expect(h.valor.includes(monedaConfig.simbolo), `${h.ruta} = ${h.valor}`).toBe(false);
      }
      // Y ningun importe viaja como NUMBER: los unicos numeros del contrato son contadores.
      if (typeof h.valor === "number") {
        expect(Number.isInteger(h.valor), `${h.ruta} = ${h.valor}`).toBe(true);
      }
    }

    // (c) Cada concepto aparece UNA sola vez por escenario: nada de `flete` + `flete_raw`.
    const rutas = todas.map((h) => h.ruta);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  it("ni la key ni su hash aparecen en la respuesta, y la ruta no loguea el header (R49)", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk()] }, SECRETO),
      cotizacionDeps,
    );
    const crudo = JSON.stringify(await res.json());
    expect(crudo).not.toContain(SECRETO);
    expect(crudo).not.toContain(HASH_FALSO);
    expect(crudo.toLowerCase()).not.toContain("authorization");
    expect(crudo.toLowerCase()).not.toContain("bearer");

    // ESTRUCTURAL: la ruta no escribe NI UNA linea de log. Un `console.*` en este handler es
    // el unico sitio desde el que la key podria escaparse a los logs de plataforma, porque es
    // el unico que tiene el header en la mano.
    expect(FUENTE_RUTA).not.toMatch(/console\.\w+\(/);
    expect(FUENTE_RUTA).not.toMatch(/logger|captureMessage|captureException/);
  });
});

// ---------------------------------------------------------------------------------------
// 5. Lectura pura (T13.1/T13.2/T13.3 — R43/R44/R45)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — lectura pura (R43/R44/R45)", () => {
  /** Un lote representativo: filas cotizadas, una sin cobertura y una fila invalida. */
  async function cotizarLoteRepresentativo() {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales();
    const res = await handleCotizacionApi(
      reqConBearer(
        {
          ordenes: [
            filaOk(),
            filaOk({ distrito: "Centro", num_remision: "REM-0003" }),
            filaSinCobertura(),
            { provincia: "", canton: "", distrito: "", monto_cobrar: "no-es-un-numero" },
          ],
        },
        SECRETO,
      ),
      cotizacionDeps,
    );
    return { res, sondas, tarifaRepo };
  }

  it("T13.1 — una cotizacion no invoca ningun metodo de escritura del repositorio (R43)", async () => {
    const { res, sondas } = await cotizarLoteRepresentativo();
    expect(res.status).toBe(200);

    // (a) La lista nombrada, metodo a metodo.
    for (const metodo of METODOS_ESCRITURA) {
      expect(sondas.invocados, `se invoco ${metodo}`).not.toContain(metodo);
    }
    // (b) Y la afirmacion fuerte: NADA fuera de las tres lecturas geograficas. Asi tambien
    // queda cubierto el metodo de escritura que alguien añada mañana a `IOrdenRepository`.
    const fuera = sondas.invocados.filter(
      (m) => !(LECTURAS_PERMITIDAS as readonly string[]).includes(m),
    );
    expect(fuera).toEqual([]);
    expect(new Set(sondas.invocados)).toEqual(new Set(LECTURAS_PERMITIDAS));

    // (c) Estructural: ni orden, ni lote de carga, ni historial, ni wallet, ni notificacion
    // estan siquiera al alcance del borde.
    expect(FUENTE_RUTA).not.toMatch(
      /OrdenHistorialRepository|WalletMovimientoRepository|WalletTiendaMovimientoRepository|NotificacionRepository|notificar/,
    );
    expect(FUENTE_RUTA).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert)/);
  });

  it("T13.2 — no consume ningun num_guia (R44)", async () => {
    const { res, sondas } = await cotizarLoteRepresentativo();
    expect(sondas.invocados).not.toContain("generarGuiaLote");
    expect(sondas.invocados).not.toContain("createManyOrdenesConGuia");

    // Y la contrapartida visible: el contrato de salida no tiene NI UN campo de guia. Si lo
    // tuviera, seria la señal de que algo la consumio.
    const crudo = JSON.stringify(await res.json());
    expect(crudo).not.toMatch(/numGuia|num_guia/);
  });

  it("T13.3 — no escribe ninguna fila de auditoria (R45)", async () => {
    const { res, sondas } = await cotizarLoteRepresentativo();
    expect(res.status).toBe(200);

    // D3 (firmada): lectura pura, SIN RASTRO. El unico rastro por orden que este repo tiene es
    // el historial (`orden_historial`) y sus escrituras derivadas; ninguna se invoca.
    for (const metodo of ["transicionarAyuda", "incrementarIntentoContacto", "update"]) {
      expect(sondas.invocados).not.toContain(metodo);
    }
    // Ni el borde importa nada que sepa escribir un rastro.
    expect(FUENTE_RUTA).not.toMatch(/Historial|Auditoria|audit/i);
  });
});

// ---------------------------------------------------------------------------------------
// 6. Estructural del borde (T8: criterio de hecho)
// ---------------------------------------------------------------------------------------

describe("cotizacion por API key — el borde no calcula ni consulta (T8)", () => {
  it("la ruta no contiene queries Prisma, ni .toFixed(, ni un if sobre 'tiene api key'", async () => {
    // Sin queries: el borde no conoce la DB (regla de capas de `docs/architecture.md`).
    expect(FUENTE_RUTA).not.toMatch(/prisma\.\$?\w*\.(findMany|findFirst|findUnique|count|raw)/);
    expect(FUENTE_RUTA).not.toMatch(/\$queryRaw|\$executeRaw/);
    // Sin `.toFixed(`: el diente 2 de la guardia 230 barre `app/**` entero y esta ruta entra en
    // el barrido. El dinero llega YA serializado desde `lib/`.
    expect(FUENTE_RUTA).not.toContain(".toFixed(");
    // R5: despues de autenticar, un `if (tieneApiKey)` seria codigo muerto e inalcanzable.
    expect(FUENTE_RUTA).not.toMatch(/tieneApiKey|hasApiKey|tieneKey/i);
    expect(FUENTE_RUTA).not.toMatch(/if\s*\([^)]*apiKey[^)]*\)/i);
  });

  it("declara el runtime nodejs y el presupuesto de 60 s", () => {
    expect(FUENTE_RUTA).toMatch(/export const runtime = "nodejs";/);
    expect(FUENTE_RUTA).toMatch(/export const maxDuration = 60;/);
  });
});

// ---------------------------------------------------------------------------------------
// 7. Feature 274 (T7.3) — tarifa por par (tienda, zona) y criterio de lote (design §3.6)
// ---------------------------------------------------------------------------------------

/** Fila cubierta de OTRA zona (`z3`), tambien no-central. */
function filaOtraZona(overrides: Record<string, string> = {}): Record<string, string> {
  return filaOk({ distrito: "Santa Ana", num_remision: "REM-0009", ...overrides });
}

describe("cotizacion por API key — tarifa por zona (feature 274, R32-R36)", () => {
  it("R32 dos filas en zonas distintas devuelven importes distintos, con UNA sola consulta", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({
      tarifa: { z1: TARIFA, z3: TARIFA_Z3 },
    });
    void sondas;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk(), filaOtraZona()] }, SECRETO),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filas: { resultado: string; costos?: { entregado: Record<string, string> } }[];
    };
    expect(body.filas.map((f) => f.resultado)).toEqual(["cotizada", "cotizada"]);
    // Las dos filas son no-centrales: leen la misma columna. Lo unico que las separa es la
    // ZONA, asi que dos importes iguales aqui significarian que la tarifa volvio a resolverse
    // por la tienda sola.
    expect(body.filas[0].costos?.entregado.flete).not.toBe(body.filas[1].costos?.entregado.flete);
    expect(body.filas[0].costos?.entregado.flete).toBe("2500.00");
    expect(body.filas[1].costos?.entregado.flete).toBe("4000.00");
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledTimes(1);
  });

  it("R33 si todas las filas resuelven: 200, todas cotizadas y conError 0", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({
      tarifa: { z1: TARIFA, z3: TARIFA_Z3 },
    });
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk(), filaOtraZona(), filaOk({ num_remision: "REM-0003" })] }, SECRETO),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cotizadas: number;
      conError: number;
      filas: { resultado: string; errores?: Record<string, string[]> }[];
      errores: unknown[];
    };
    expect(body.filas.map((f) => f.resultado)).toEqual(["cotizada", "cotizada", "cotizada"]);
    expect(body.cotizadas).toBe(3);
    expect(body.conError).toBe(0);
    expect(body.filas.some((f) => f.errores !== undefined)).toBe(false);
    // Sin fallos, `errores` es una lista VACIA y no una clave ausente.
    expect(body.errores).toEqual([]);
  });

  it("R34 lote mixto: 200, la fila sin tarifa en error y sin clave costos, y la otra con su precio intacto", async () => {
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({
      // `z1` resuelve; `z3` no tiene ninguna tarifa en ningun nivel de la cascada.
      tarifa: { z1: TARIFA, z3: null },
    });
    void sondas;
    void tarifaRepo;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaOk(), filaOtraZona()] }, SECRETO),
      cotizacionDeps,
    );

    // 200, no 409: una fila del lote SI resolvio (design §3.6).
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      cotizadas: number;
      conError: number;
      filas: {
        fila: number;
        numRemision: string | null;
        resultado: string;
        costos?: Record<string, unknown>;
        errores?: Record<string, string[]>;
      }[];
      errores: {
        fila: number;
        numRemision: string | null;
        resultado: string;
        costos?: Record<string, unknown>;
        errores: Record<string, string[]>;
      }[];
    };

    expect(body.filas[0].resultado).toBe("cotizada");
    // R38: el canal de error POR FILA que ya existia, con la clave `tarifa` y el literal unico.
    // Desde el 2026-08-31 se lee en la lista hermana, con su contenido intacto.
    expect(body.errores).toEqual([
      {
        fila: 2,
        numRemision: "REM-0009",
        resultado: "error",
        errores: { tarifa: [MSG_FILA_SIN_TARIFA] },
      },
    ]);
    // AUSENCIA de la clave `costos`, no un `costos` en cero: el JSON serializado no la trae.
    expect("costos" in body.errores[0]).toBe(false);
    // Y la fila degradada no se cuela entre las que tienen precio.
    expect(body.filas.map((f) => f.fila)).toEqual([1]);

    expect(body.conError).toBe(1);
    expect(body.cotizadas).toBe(1);
    expect(body.cotizadas + body.conError).toBe(body.total);

    // Sin agregado del lote: el unico precio que viaja es el de la fila que resolvio.
    expect(body).not.toHaveProperty("totales");
    expect(body.filas[0].costos).toBeDefined();
  });

  it("R36 un lote entero sin cobertura responde 200 con todas las filas en error, aunque NO haya tarifa alguna", async () => {
    // El caso que decide bien o mal la implementacion ingenua: aqui no hay ni una tarifa, pero
    // tampoco hay una sola fila que llegue a pedirla. Un 409 le diria al integrador que su
    // cuenta no puede cotizar cuando lo que fallaron fueron sus direcciones.
    const { sondas, tarifaRepo, ...cotizacionDeps } = depsReales({ tarifa: null });
    void sondas;

    const res = await handleCotizacionApi(
      reqConBearer({ ordenes: [filaSinCobertura(), filaSinCobertura()] }, SECRETO),
      cotizacionDeps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      cotizadas: number;
      conError: number;
      filas: { errores?: Record<string, string[]> }[];
    };
    expect(body.cotizadas).toBe(0);
    expect(body.conError).toBe(2);
    // Ni agregado ni importes: la respuesta no trae un solo numero de dinero.
    expect(body).not.toHaveProperty("totales");
    expect(JSON.stringify(body)).not.toMatch(/\d+\.\d{2}/);
    // Y el diagnostico que recibe el integrador es el CORRECTO: geografia, no tarifa.
    for (const f of body.filas) {
      expect(f.errores?.tarifa).toBeUndefined();
      expect(f.errores?.distrito).toBeDefined();
    }
    // Ni se consulta la tarifa: no hay un solo par que pedir.
    expect(tarifaRepo.resolveTarifas).not.toHaveBeenCalled();
  });
});
