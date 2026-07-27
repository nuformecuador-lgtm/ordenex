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
import type { IEtiquetasLotePdfService } from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import { etiquetasConfig } from "@/lib/config/etiquetas";

// Feature 136 (T3.1) — cableado del PDF de etiquetas en el endpoint de carga por
// API. Se inyectan fakes de `autenticar`, `bulkService` y `etiquetasService`: sin
// DB, sin Storage, sin red. Cubre R10/R12/R13/R16/R17 + el tope de BLOQ-1.

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okSummary(overrides: Partial<CargaViaApiSummary> = {}): CargaViaApiSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [
      { fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "en_ruta_bodega_central", numGuia: 1042 },
    ],
    ordenes: [
      { id: "ord-1", numRemision: "REM-1", numGuia: 1042, estado: "en_ruta_bodega_central", costoEnvio: "3.92" },
    ],
    cargaId: "33333333-3333-4333-8333-333333333333", // feature 141/R28
    ...overrides,
  };
}

function fakeBulk(summary: CargaViaApiSummary): IBulkOrdenService {
  return {
    cargarMasiva: vi.fn(),
    cargarViaApi: vi.fn().mockResolvedValue({ status: "ok", summary } satisfies CargaViaApiResult),
  };
}

function fakeEtiquetas(overrides: Partial<IEtiquetasLotePdfService> = {}): IEtiquetasLotePdfService {
  return {
    generarYAlmacenar: vi.fn().mockResolvedValue({
      path: "key-user-1/uuid.pdf",
      signedUrl: "https://signed.example/pdf?token=abc",
      expiraEnSegundos: 3600,
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

function depsOk(bulk: IBulkOrdenService, etiquetas: IEtiquetasLotePdfService): CargaApiDeps {
  return {
    autenticar: async () => ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    bulkService: bulk,
    etiquetasService: etiquetas,
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
    ordenes,
    cargaId: "33333333-3333-4333-8333-333333333333", // feature 141/R28
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
    expect(etiquetas.generarYAlmacenar).toHaveBeenCalledWith(["ord-1"], KEY_ACTOR);
  });

  it("etiquetasPdf trae { error } y responde 200 cuando el service lanza (R12)", async () => {
    const etiquetas = fakeEtiquetas({
      generarYAlmacenar: vi.fn().mockRejectedValue(new Error("storage caido")),
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
    const etiquetas = fakeEtiquetas({ generarYAlmacenar: vi.fn().mockResolvedValue(null) });
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(okSummary()), etiquetas));
    const json = await res.json();
    expect(json.etiquetasPdf).toBeNull();
    expect(etiquetas.generarYAlmacenar).toHaveBeenCalledTimes(1);
  });

  it("etiquetasPdf es null cuando no se crea ninguna orden (R13)", async () => {
    const summary = okSummary({ total: 1, creadas: 0, duplicadas: 1, conError: 0, ordenes: [] });
    const etiquetas = fakeEtiquetas();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), depsOk(fakeBulk(summary), etiquetas));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.etiquetasPdf).toBeNull();
    // Sin ordenes creadas NO se toca el orquestador (no Storage).
    expect(etiquetas.generarYAlmacenar).not.toHaveBeenCalled();
  });

  it("mantiene 401 sin key sin generar PDF (R16)", async () => {
    const etiquetas = fakeEtiquetas();
    const deps: CargaApiDeps = {
      autenticar: async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult,
      bulkService: fakeBulk(okSummary()),
      etiquetasService: etiquetas,
    };
    const res = await handleCargaApi(reqConBearer(BODY), deps);
    expect(res.status).toBe(401);
    expect(etiquetas.generarYAlmacenar).not.toHaveBeenCalled();
  });

  it("mantiene 403 con key sin permiso sin generar PDF (R16)", async () => {
    const etiquetas = fakeEtiquetas();
    const deps: CargaApiDeps = {
      autenticar: async () => ({ status: "forbidden" }) as ApiKeyAuthResult,
      bulkService: fakeBulk(okSummary()),
      etiquetasService: etiquetas,
    };
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), deps);
    expect(res.status).toBe(403);
    expect(etiquetas.generarYAlmacenar).not.toHaveBeenCalled();
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
    expect(etiquetas.generarYAlmacenar).not.toHaveBeenCalled();
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
    expect(etiquetas.generarYAlmacenar).toHaveBeenCalledTimes(1);
  });

  it("no loguea el mensaje crudo del error: podria traer datos de la orden (design §8)", async () => {
    // El render recibe destinatario/direccion/telefono; si jspdf/qrcode/bwip-js
    // fallan, ese texto puede acabar en el mensaje del error y de ahi en el log.
    const PII = "AnaDestinatario";
    const DIRECCION = "Calle Falsa 123";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const etiquetas = fakeEtiquetas({
        generarYAlmacenar: vi
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
