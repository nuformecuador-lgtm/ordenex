import { describe, it, expect, vi } from "vitest";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  CargaViaApiOrden,
  CargaViaApiResult,
  CargaViaApiRow,
  CargaViaApiSummary,
  IBulkOrdenService,
} from "@/lib/interfaces/services/IBulkOrdenService";
import type { IEtiquetasDescargaService } from "@/lib/interfaces/services/IEtiquetasDescargaService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";
import { etiquetasConfig } from "@/lib/config/etiquetas";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { exigirCobertura } from "@/lib/pdf/etiquetas-fuente-registro";
import { ajustarBloque, ErrorEtiquetaNoCabe } from "@/lib/pdf/etiquetas-ajuste";

// Feature 136 (T3.1) — cableado del PDF de etiquetas en el endpoint de carga por
// API. Se inyectan fakes de `autenticar`, `bulkService`, `descargaService` y
// `manifiestoService` (feature 155: el borde tambien emite el manifiesto del lote): sin
// DB, sin Storage, sin red. Cubre R10/R12/R13/R16/R17 + el tope de BLOQ-1.
//
// Feature 141 (T28): la ruta ya no habla con `EtiquetasLotePdfService` directamente, sino
// con `EtiquetasDescargaService` (genera segun `download_type` y persiste la URL). Las
// aserciones heredadas de la 136 se conservan TAL CUAL sobre el modo `consolidate` (default),
// que es justo la garantia de compatibilidad hacia atras (R53).

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okSummary(overrides: Partial<CargaViaApiSummary> = {}): CargaViaApiSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [
      { fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "por_recolectar_en_tienda", numGuia: 1042 },
    ],
    // 2026-08-31: las filas que fallan viajan en su propia lista. Aqui no falla ninguna.
    errores: [],
    ordenes: [
      { id: "ord-1", numRemision: "REM-1", numGuia: 1042, estado: "por_recolectar_en_tienda", costoEnvio: "3.92", fulfillment: "0.00" },
    ],
    cargaId: "33333333-3333-4333-8333-333333333333", // feature 141/R39
    ...overrides,
  };
}

function fakeBulk(summary: CargaViaApiSummary): IBulkOrdenService {
  return {
    cargarMasiva: vi.fn(),
    // Feature 155/R24: el resultado del service lleva la bifurcacion resuelta del lote.
    cargarViaApi: vi
      .fn()
      .mockResolvedValue({
        status: "ok",
        summary,
        manifiestoOrdenIds: ["ord-1"],
      } satisfies CargaViaApiResult),
  };
}

function fakeEtiquetas(
  overrides: Partial<IEtiquetasDescargaService> = {},
): IEtiquetasDescargaService {
  return {
    generarYPersistir: vi.fn().mockResolvedValue({
      consolidado: { url: "https://signed.example/pdf?token=abc", expiraEnSegundos: 3600 },
      porOrden: new Map(),
    }),
    ...overrides,
  };
}

function reqConBearer(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/carga", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const BODY = { ordenes: [{ num_remision: "REM-1", destinatario: "Ana", telefono: "099" }] };

// Feature 155/R24: doble del servicio de manifiesto. Este archivo NO prueba el manifiesto
// (eso vive en `ordenes-api-key-carga.route.test.ts`), solo necesita que el borde no intente
// construir el service real —con Prisma— en un test sin base.
const manifiestoStub = {
  armar: vi.fn().mockResolvedValue({ status: "ok", filas: [], omitidas: [] }),
} as unknown as IManifiestoService;

function depsOk(bulk: IBulkOrdenService, etiquetas: IEtiquetasDescargaService): CargaApiDeps {
  return {
    autenticar: async () => ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    bulkService: bulk,
    descargaService: etiquetas,
    manifiestoService: manifiestoStub,
  };
}

/**
 * Summary de un lote de `n` ordenes creadas, todas con `num_guia` asignado (es el
 * escenario de la carga por API: guia en el acto). Sirve para ejercitar el tope de
 * etiquetas por PDF sin construir ningun PDF de verdad.
 */
function summaryDeLoteGrande(n: number): CargaViaApiSummary {
  const ordenes: CargaViaApiOrden[] = Array.from({ length: n }, (_, i) => ({
    id: `ord-${i + 1}`,
    numRemision: `REM-${i + 1}`,
    numGuia: 1000 + i,
    estado: "en_ruta_bodega_central",
    costoEnvio: "3.92",
    fulfillment: "0.00",
  }));
  const filas: CargaViaApiRow[] = ordenes.map((o, i) => ({
    fila: i + 1,
    numRemision: o.numRemision,
    resultado: "creada",
    estatus: o.estado,
    numGuia: o.numGuia,
  }));
  return {
    total: n,
    creadas: n,
    duplicadas: 0,
    conError: 0,
    filas,
    errores: [],
    ordenes,
    cargaId: "33333333-3333-4333-8333-333333333333", // feature 141/R39
  };
}

describe("carga API + etiquetas PDF (feature 136)", () => {
  it("incluye etiquetasPdf con url y TTL cuando se crean ordenes (R10/R17)", async () => {
    const etiquetas = fakeEtiquetas();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(okSummary()), etiquetas));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toEqual({
      url: "https://signed.example/pdf?token=abc",
      expiraEnSegundos: 3600,
    });
    // El service recibe los ids de las ordenes creadas y el actor de la tienda.
    expect(etiquetas.generarYPersistir).toHaveBeenCalledWith({
      modo: "consolidate", // feature 141/R43: default
      cargaId: "33333333-3333-4333-8333-333333333333",
      ordenIds: ["ord-1"],
      actor: KEY_ACTOR,
    });
  });

  it("etiquetasPdf trae { error } y responde 200 cuando el service lanza (R12)", async () => {
    const etiquetas = fakeEtiquetas({
      generarYPersistir: vi.fn().mockRejectedValue(new Error("storage caido")),
    });
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(okSummary()), etiquetas));
    // La carga NO se revierte: 200 con el fallo VISIBLE, no null.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toHaveProperty("error");
    expect(typeof json.etiquetasPdf.error).toBe("string");
    expect(json.etiquetasPdf.error).not.toContain(SECRETO);
    // Los campos del summary siguen presentes (carga commiteada).
    expect(json.creadas).toBe(1);
    expect(json.ordenes[0].numGuia).toBe(1042);
  });

  it("etiquetasPdf es null cuando el service no halla etiqueta imprimible (R14)", async () => {
    const etiquetas = fakeEtiquetas({
      generarYPersistir: vi.fn().mockResolvedValue({ consolidado: null, porOrden: new Map() }),
    });
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(okSummary()), etiquetas));
    const json = await res.json();
    expect(json.etiquetasPdf).toBeNull();
    expect(etiquetas.generarYPersistir).toHaveBeenCalledTimes(1);
  });

  it("etiquetasPdf es null cuando no se crea ninguna orden (R13)", async () => {
    const summary = okSummary({ total: 1, creadas: 0, duplicadas: 1, conError: 0, ordenes: [] });
    const etiquetas = fakeEtiquetas();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(summary), etiquetas));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toBeNull();
    // Sin ordenes creadas NO se toca el orquestador (no Storage).
    expect(etiquetas.generarYPersistir).not.toHaveBeenCalled();
  });

  it("mantiene 401 sin key sin generar PDF (R16)", async () => {
    const etiquetas = fakeEtiquetas();
    const deps: CargaApiDeps = {
      autenticar: async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult,
      bulkService: fakeBulk(okSummary()),
      descargaService: etiquetas,
      manifiestoService: manifiestoStub,
    };
    const res = await handleCargaApi(reqConBearer(BODY), deps);
    expect(res.status).toBe(401);
    expect(etiquetas.generarYPersistir).not.toHaveBeenCalled();
  });

  it("mantiene 403 con key sin permiso sin generar PDF (R16)", async () => {
    const etiquetas = fakeEtiquetas();
    const deps: CargaApiDeps = {
      autenticar: async () => ({ status: "forbidden" }) as ApiKeyAuthResult,
      bulkService: fakeBulk(okSummary()),
      descargaService: etiquetas,
      manifiestoService: manifiestoStub,
    };
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), deps);
    expect(res.status).toBe(403);
    expect(etiquetas.generarYPersistir).not.toHaveBeenCalled();
  });

  // BLOQ-1 — el caso que faltaba. Antes del tope, un lote asi intentaba rendir
  // miles de paginas DESPUES de commitear las ordenes: la function moria por
  // OOM/timeout (no es excepcion JS, el try/catch no lo ve) y el integrador
  // perdia los `num_guia`. Ahora la respuesta es 200 con el summary intacto.
  it("lote por encima del tope: 200 con los num_guia intactos y etiquetasPdf { error } (BLOQ-1/R12)", async () => {
    const tope = etiquetasConfig.MAX_ETIQUETAS_POR_PDF;
    const n = tope + 1;
    const summary = summaryDeLoteGrande(n);
    const etiquetas = fakeEtiquetas();

    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      depsOk(fakeBulk(summary), etiquetas),
    );

    // 1. La carga NO se rompe: 200, nunca 500/504.
    expect(res.status).toBe(200);
    const json = await res.json();

    // 2. Los `num_guia` de las ordenes creadas llegan INTACTOS (lo que se perdia).
    expect(json.creadas).toBe(n);
    expect(json.ordenes).toHaveLength(n);
    expect(json.ordenes.map((o: { numGuia: number }) => o.numGuia)).toEqual(
      summary.ordenes.map((o) => o.numGuia),
    );
    expect(json.filas).toHaveLength(n);

    // 3. El fallo es VISIBLE y explicativo (R12): dice el tope y que las ordenes
    //    si se crearon, para que el integrador no reintente y las duplique.
    expect(json.etiquetasPdf).toHaveProperty("error");
    expect(json.etiquetasPdf.error).toContain(String(tope));
    expect(json.etiquetasPdf.error).toContain("num_guia");
    expect(json.etiquetasPdf.error).not.toContain(SECRETO);

    // 4. Y sobre todo: NO se intento generar nada. El trabajo que no se arranca
    //    no puede tumbar la function.
    expect(etiquetas.generarYPersistir).not.toHaveBeenCalled();
  });

  it("lote justo EN el tope: si genera el PDF (BLOQ-1, borde del limite)", async () => {
    const tope = etiquetasConfig.MAX_ETIQUETAS_POR_PDF;
    const etiquetas = fakeEtiquetas();

    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      depsOk(fakeBulk(summaryDeLoteGrande(tope)), etiquetas),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toEqual({
      url: "https://signed.example/pdf?token=abc",
      expiraEnSegundos: 3600,
    });
    expect(etiquetas.generarYPersistir).toHaveBeenCalledTimes(1);
  });

  it("no loguea el mensaje crudo del error: podria traer datos de la orden (design §8)", async () => {
    // El render recibe destinatario/direccion/telefono; si jspdf/qrcode/bwip-js
    // fallan, ese texto puede acabar en el mensaje del error y de ahi en el log.
    const PII = "AnaDestinatario";
    const DIRECCION = "Calle Falsa 123";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const etiquetas = fakeEtiquetas({
        generarYPersistir: vi
          .fn()
          .mockRejectedValue(new Error(`no se pudo dibujar ${PII}, ${DIRECCION}`)),
      });

      const res = await handleCargaApi(
        reqConBearer(BODY, SECRETO),
        depsOk(fakeBulk(okSummary()), etiquetas),
      );

      expect(res.status).toBe(200);
      const logueado = spy.mock.calls.map((args) => JSON.stringify(args)).join(" ");
      expect(logueado).not.toContain(PII);
      expect(logueado).not.toContain(DIRECCION);
      expect(logueado).not.toContain(SECRETO);
      // Pero el fallo SI se registra (con el tipo del error, para diagnosticar).
      expect(spy).toHaveBeenCalled();
      expect(logueado).toContain("etiquetas-pdf-lote");
      expect(logueado).toContain("Error");
    } finally {
      spy.mockRestore();
    }
  });

  it("preserva los campos existentes del summary (R17)", async () => {
    const etiquetas = fakeEtiquetas();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(okSummary()), etiquetas));
    const json = await res.json();
    for (const campo of ["total", "creadas", "duplicadas", "conError", "filas", "ordenes"]) {
      expect(json).toHaveProperty(campo);
    }
    expect(json.total).toBe(1);
    expect(json.filas[0].numGuia).toBe(1042);
    expect(json.ordenes[0].costoEnvio).toBe("3.92");
  });
});

// --- Feature 141 (R52): el tope corta ANTES de empezar, en AMBOS modos ---

describe("tope de etiquetas en modo individual (feature 141/R52)", () => {
  it("lote por encima del tope con download_type=individual: 200, sin generar y con el motivo visible", async () => {
    const tope = etiquetasConfig.MAX_ETIQUETAS_POR_PDF;
    const summary = summaryDeLoteGrande(tope + 1);
    const etiquetas = fakeEtiquetas();

    const req = new Request("http://localhost/api/ordenes/api-key/carga", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
      body: JSON.stringify({ ...BODY, download_type: "individual" }),
    });
    const res = await handleCargaApi(req, depsOk(fakeBulk(summary), etiquetas));

    expect(res.status).toBe(200);
    const json = await res.json();
    // Ni un solo PDF: el trabajo que no se arranca no puede desbordar la function.
    expect(etiquetas.generarYPersistir).not.toHaveBeenCalled();
    expect(json.etiquetasPdf.error).toContain(String(tope));
    expect(json.downloadType).toBe("individual");
    // Las ordenes conservan su num_guia y quedan SIN downloadUrl (columna NULL).
    expect(json.ordenes).toHaveLength(tope + 1);
    expect(json.ordenes.every((o: { downloadUrl: string | null }) => o.downloadUrl === null)).toBe(
      true,
    );
  });
});

/**
 * Feature 282 (T24, R28) — El fallo por COBERTURA usa el canal que ya existe.
 *
 * El generador lanza si el texto del monto trae un caracter que el subconjunto
 * embebido no cubre, en vez de imprimir la etiqueta con el simbolo perdido. Lo
 * que aqui se comprueba es que ese error viaja por el camino best-effort que la
 * feature 136 ya tenia —HTTP 200, `etiquetasPdf: { error }`, carga NO revertida
 * y `num_guia` intactos— y no por uno nuevo.
 *
 * El error NO se inventa: se produce llamando a la funcion real de cobertura con
 * un simbolo fuera del subconjunto. Un `new Error("lo que sea")` probaria el
 * canal pero no que este fallo entre por el.
 */
describe("R28 — un caracter no cubierto falla VISIBLE por el canal best-effort", () => {
  function errorDeCobertura(): Error {
    try {
      // U+20B9 (rupia india) no esta en el subconjunto cp1252 + colon.
      exigirCobertura(fuenteEtiqueta, "₹18.000", "Monto a cobrar");
    } catch (e) {
      return e as Error;
    }
    throw new Error("la comprobacion de cobertura no lanzo: R28 estaria muerto");
  }

  it("HTTP 200, etiquetasPdf { error } y la carga NO revertida", async () => {
    const fallo = errorDeCobertura();
    expect(fallo.message).toContain("U+20B9");

    const etiquetas = fakeEtiquetas({
      generarYPersistir: vi.fn().mockRejectedValue(fallo),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      depsOk(fakeBulk(okSummary()), etiquetas),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toHaveProperty("error");
    expect(typeof json.etiquetasPdf.error).toBe("string");
    // La carga sigue commiteada y los num_guia intactos: el PDF es best-effort.
    expect(json.creadas).toBe(1);
    expect(json.ordenes[0].numGuia).toBe(1042);
    // Y lo que NO puede pasar: entregar una URL de etiqueta con el importe roto.
    expect(json.etiquetasPdf).not.toHaveProperty("url");
  });
});

/**
 * Feature 350 (T11, R7) — LA ETIQUETA QUE NO CABE, POR EL MISMO CANAL.
 *
 * El error se construye llamando al motor REAL (`ajustarBloque` con un alto
 * imposible + el `throw` que hace el dibujo), no con un `new Error("lo que
 * sea")`: eso probaria el canal pero no que ESTE fallo entre por el. Es el mismo
 * criterio con el que la 282 construyo su caso de cobertura.
 */
describe("R7 — una etiqueta que NO CABE falla VISIBLE por el canal best-effort", () => {
  const NUM_GUIA_QUE_NO_CABE = 19887906;

  function errorDeNoCabe(): ErrorEtiquetaNoCabe {
    // Se comprueba primero que el motor de verdad rechaza este caso: si algun
    // dia dejara de rechazarlo, este test tiene que enterarse en vez de seguir
    // afirmando sobre un error inventado.
    const bloque = ajustarBloque(
      [{ texto: "D".repeat(400), factorCuerpo: 1, cuerpoMinimoPt: 7 }],
      88,
      1,
      13,
      7,
      (t, pt) => t.length * pt * 0.1,
    );
    expect(bloque.cabe, "el ajuste ya no rechaza un bloque imposible").toBe(false);
    return new ErrorEtiquetaNoCabe(
      NUM_GUIA_QUE_NO_CABE,
      "100x100",
      "bloque de destino",
      "necesita 41,5 mm y hay 29,4 mm",
    );
  }

  it("HTTP 200, etiquetasPdf { error } NOMBRANDO la guia y la carga NO revertida", async () => {
    const etiquetas = fakeEtiquetas({
      generarYPersistir: vi.fn().mockRejectedValue(errorDeNoCabe()),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      depsOk(fakeBulk(okSummary()), etiquetas),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toHaveProperty("error");
    // R7: el fallo es VISIBLE y ademas dice de que orden se trata. Sin el
    // num_guia, el integrador no puede corregir el dato que lo provoco.
    expect(json.etiquetasPdf.error).toContain(String(NUM_GUIA_QUE_NO_CABE));
    expect(json.etiquetasPdf.error).toMatch(/no cabe/i);
    // La carga sigue commiteada y los num_guia intactos.
    expect(json.creadas).toBe(1);
    expect(json.ordenes[0].numGuia).toBe(1042);
    // Y lo que NO puede pasar: entregar una URL de etiqueta con un dato cortado.
    expect(json.etiquetasPdf).not.toHaveProperty("url");
  });

  it("el log lleva el mensaje entero (num_guia incluido) y NINGUN dato de la orden", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const etiquetas = fakeEtiquetas({
        generarYPersistir: vi.fn().mockRejectedValue(errorDeNoCabe()),
      });
      await handleCargaApi(
        reqConBearer(BODY, SECRETO),
        depsOk(fakeBulk(okSummary()), etiquetas),
      );
      const registrado = JSON.stringify(spy.mock.calls);
      expect(registrado).toContain(String(NUM_GUIA_QUE_NO_CABE));
      // El mensaje de este error es seguro POR CONSTRUCCION: numeros y nombres
      // de bloque, nunca el texto de la direccion ni del destinatario.
      expect(registrado).not.toContain("Del super");
      expect(registrado).not.toContain("REM-1");
    } finally {
      spy.mockRestore();
    }
  });
});
