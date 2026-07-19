// Feature 91 (design §3) — cliente HTTP de la Google Geocoding API. PRIMER cliente HTTP
// saliente server-side del repo.
//
// TRES INVARIANTES DE ESTE ARCHIVO:
//
// 1. `fetch` INYECTABLE (`fetchImpl`, patron de `carga-masiva-chunks.ts`): los tests
//    ejercitan los nueve desenlaces sin tocar la red y sin credencial.
// 2. La respuesta se valida con ZOD EN EL BORDE (docs/architecture.md §2). No se castea:
//    una forma inesperada produce error de integracion (R19), no un `undefined` silencioso
//    que acabe escribiendo NaN en la orden.
// 3. LA CREDENCIAL VA COMO QUERY PARAM (`key=...`) porque la Geocoding API no acepta
//    cabecera de autorizacion. Consecuencia OBLIGATORIA: la URL NUNCA aparece en un
//    mensaje de error ni en un log (R31). Los mensajes citan la OPERACION y el ESTADO,
//    jamas la URL, la credencial ni la direccion (que es dato personal).
import { z } from "zod";
import type { GeocodeOutcome, IGeocodeClient } from "@/lib/interfaces/external/IGeocodeClient";

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/** Nombre de la operacion citado en los errores. Sin URL, sin credencial, sin direccion. */
const OPERACION = "geocodificar direccion";

/**
 * R19: la respuesta no cumple el contrato del proveedor. El mensaje identifica la
 * OPERACION y nada mas: ni la credencial, ni la URL, ni la direccion consultada.
 */
export class GeocodeRespuestaInvalidaError extends Error {
  constructor(detalle: string) {
    super(`${OPERACION}: respuesta del proveedor con forma inesperada (${detalle})`);
    this.name = "GeocodeRespuestaInvalidaError";
  }
}

// Contrato MINIMO que consumimos. `.passthrough()` implicito: campos extra del proveedor
// no rompen (Google amplia sin avisar); lo que se exige es lo que se lee.
const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const resultSchema = z.object({
  geometry: z.object({
    location: locationSchema,
    location_type: z.string(),
  }),
});

const respuestaSchema = z.object({
  status: z.string(),
  results: z.array(resultSchema).optional(),
});

export interface GoogleGeocodeClientOpts {
  apiKey: string;
  /** Timeout de la llamada en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

export class GoogleGeocodeClient implements IGeocodeClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GoogleGeocodeClientOpts) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async geocodificar(query: string): Promise<GeocodeOutcome> {
    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set("address", query);
    url.searchParams.set("key", this.apiKey);

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Fallo de RED o timeout -> transitorio (R23). El detalle NO incluye la URL (que
      // lleva la credencial) ni la direccion: solo la operacion.
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    // HTTP 5xx -> transitorio (R23). 4xx distinto de 200 tampoco trae cuerpo util.
    if (respuesta.status >= 500) {
      return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      throw new GeocodeRespuestaInvalidaError("cuerpo no es JSON");
    }

    const parsed = respuestaSchema.safeParse(json);
    if (!parsed.success) {
      // R19: forma inesperada. Se cita el campo que falla, NUNCA el valor (podria
      // arrastrar la direccion o la credencial en un eco del proveedor).
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new GeocodeRespuestaInvalidaError(`campos invalidos: ${campos}`);
    }

    return this.traducir(parsed.data);
  }

  /**
   * Traduce el `status` del proveedor al vocabulario de dominio. NO decide politica: la
   * tabla de desenlace (completar vs lanzar) vive en `GeocodificacionService` (design §5).
   */
  private traducir(data: z.infer<typeof respuestaSchema>): GeocodeOutcome {
    switch (data.status) {
      case "OK": {
        const primero = data.results?.[0];
        if (primero === undefined) {
          // `OK` sin resultados incumple el contrato del proveedor (R19).
          throw new GeocodeRespuestaInvalidaError("status OK sin results");
        }
        return {
          status: "ok",
          latitud: primero.geometry.location.lat,
          longitud: primero.geometry.location.lng,
          precision: primero.geometry.location_type,
          crudo: primero,
        };
      }
      case "ZERO_RESULTS":
        return { status: "sin_resultados" };
      case "INVALID_REQUEST":
        return { status: "consulta_invalida" };
      case "REQUEST_DENIED":
        return {
          status: "config_invalida",
          detalle: `${OPERACION}: el proveedor rechazo la peticion (REQUEST_DENIED)`,
        };
      case "OVER_QUERY_LIMIT":
      case "UNKNOWN_ERROR":
        return { status: "transitorio", detalle: `${OPERACION}: ${data.status}` };
      default:
        // Estado NUEVO del proveedor: se trata como transitorio (reintentable) en vez de
        // completar el job en silencio. El nombre del estado no es PII.
        return { status: "transitorio", detalle: `${OPERACION}: estado ${data.status}` };
    }
  }
}
