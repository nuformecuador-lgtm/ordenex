// Feature 92 (design §3) — cliente HTTP de Google Cloud Route Optimization
// (`optimizeTours`). SEGUNDO cliente HTTP saliente del repo, tras `google-geocode.ts`, y
// el PRIMERO que se autentica con OAuth2 en vez de con una API key.
//
// TRES INVARIANTES DE ESTE ARCHIVO (heredados de `google-geocode.ts`):
//
// 1. `fetch` INYECTABLE: los tests ejercitan todos los desenlaces sin tocar la red y sin
//    credencial real.
// 2. La respuesta se valida con ZOD EN EL BORDE, SIN `passthrough`. Una forma inesperada
//    produce un error de integracion (R13), NUNCA una secuencia parcial o vacia que acabe
//    borrando el orden bueno que ya estaba persistido.
// 3. NINGUN mensaje de error cita el token, la URL, las coordenadas ni el `ordenId`
//    (R14). Los mensajes citan la OPERACION y el ESTADO. Las coordenadas de entrega son
//    dato personal: identifican el domicilio del destinatario.
//
// ⚠️ TRAMPA DE PROTO3-JSON, VERIFICADA CONTRA EL CONTRATO DEL PROVEEDOR: las APIs de
// Google basadas en protobuf OMITEN los campos con valor por defecto al serializar a JSON.
// Es decir, `"shipmentIndex": 0` NO APARECE en la respuesta. Leerlo como obligatorio haria
// fallar el parseo de TODA ruta que empiece por la primera parada — es decir, casi todas.
// Por eso `shipmentIndex` se declara OPCIONAL con default 0. NO "arreglar" esto marcandolo
// requerido.
import { z } from "zod";
import type {
  IRouteOptimizationClient,
  OptimizarInput,
  OptimizarOutcome,
} from "@/lib/interfaces/external/IRouteOptimizationClient";
import { optlog, opterror, describirToken, cronometro } from "@/lib/logging/optimizer-log";

const ENDPOINT_BASE = "https://routeoptimization.googleapis.com/v1/projects";

/** Nombre de la operacion citado en los errores. Sin URL, sin token, sin coordenadas. */
const OPERACION = "optimizar ruta";

/**
 * R13: la respuesta no cumple el contrato del proveedor (forma invalida, o una secuencia
 * que no cubre todas las paradas enviadas). El mensaje identifica la OPERACION y el
 * motivo estructural; NUNCA el token, la URL ni una coordenada.
 */
export class RutaRespuestaInvalidaError extends Error {
  constructor(detalle: string) {
    super(`${OPERACION}: respuesta del proveedor con forma inesperada (${detalle})`);
    this.name = "RutaRespuestaInvalidaError";
  }
}

/**
 * El proveedor rechazo la peticion con un 4xx que NO es 401/403 (tipicamente un 400 por
 * modelo mal formado). No es transitorio —reintentar no lo arregla— pero tampoco es
 * "credencial rota": merece un nombre propio para que el dead-letter sea legible.
 */
export class RutaPeticionRechazadaError extends Error {
  constructor(status: number) {
    super(`${OPERACION}: el proveedor rechazo la peticion (HTTP ${status})`);
    this.name = "RutaPeticionRechazadaError";
  }
}

// Contrato MINIMO que consumimos de `OptimizeToursResponse`. Zod hace STRIP por defecto:
// `metrics`, `routeCosts`, `routePolyline` y demas no sobreviven al parseo. NO anadir
// `.passthrough()`: la polilinea de la ruta es una traza de coordenadas, es decir PII.
const visitSchema = z.object({
  // Ver la trampa proto3-json de la cabecera: ausente == 0.
  shipmentIndex: z.number().int().nonnegative().optional(),
});

const routeSchema = z.object({
  visits: z.array(visitSchema).optional(),
});

const respuestaSchema = z.object({
  routes: z.array(routeSchema).optional(),
});

export interface GoogleRouteOptimizationClientOpts {
  /** Proyecto GCP con el SKU habilitado. Forma parte de la URL, nunca de un mensaje. */
  projectId: string;
  /** Proveedor del `access_token` OAuth2 (`lib/auth/google-sa-token.ts`). */
  getToken: () => Promise<string>;
  /** Timeout de la llamada en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

export class GoogleRouteOptimizationClient implements IRouteOptimizationClient {
  private readonly projectId: string;
  private readonly getToken: () => Promise<string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GoogleRouteOptimizationClientOpts) {
    this.projectId = opts.projectId;
    this.getToken = opts.getToken;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async optimizar(input: OptimizarInput): Promise<OptimizarOutcome> {
    // El array de entrada ES la tabla de traduccion indice -> ordenId. El `ordenId` NO se
    // envia al proveedor: no hace falta y reduce lo que sale del sistema.
    const { origen, paradas } = input;

    // ⚠️ AQUI SE IMPRIMEN COORDENADAS DE ENTREGA (dato personal). Es el override consciente
    // de R14 documentado en `lib/logging/optimizer-log.ts`; se apaga con RUTA_DEBUG_LOG=0.
    optlog("client/google — ENTRADA", {
      projectId: this.projectId,
      origen,
      paradas: paradas.map((p, i) => ({ i, ordenId: p.ordenId, lat: p.lat, lng: p.lng })),
      totalParadas: paradas.length,
    });

    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      opterror("client/google — no se pudo obtener el token; no se llama al proveedor", error);
      // La credencial ausente (`RutaNoConfiguradoError`) y el fallo del endpoint de token
      // se propagan TAL CUAL: sus mensajes ya estan saneados en `google-sa-token.ts`.
      throw error;
    }

    const body = {
      model: {
        // Un shipment por parada, con UNA entrega. El indice en este array es la clave.
        shipments: paradas.map((p) => ({
          deliveries: [
            { arrivalWaypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } },
          ],
        })),
        // Un solo vehiculo que arranca en el origen. Esta feature NO hace reparto
        // multi-vehiculo (design §10, fuera de alcance).
        vehicles: [
          {
            startWaypoint: {
              location: { latLng: { latitude: origen.lat, longitude: origen.lng } },
            },
          },
        ],
      },
    };

    const url = `${ENDPOINT_BASE}/${this.projectId}:optimizeTours`;
    optlog("client/google — POST optimizeTours", {
      url,
      timeoutMs: this.timeoutMs,
      ...describirToken(token),
      body,
    });

    const medir = cronometro();
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      opterror("client/google — fallo de red o timeout", error, { ms: medir() });
      // R15: red o timeout -> transitorio. El detalle NO incluye la URL (lleva el
      // projectId) ni el cuerpo (lleva las coordenadas de entrega).
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    optlog("client/google — respuesta HTTP", { status: respuesta.status, ms: medir() });

    // R15: credencial, scope o facturacion rotos. Reintentar no lo arregla solo, pero se
    // propaga como error para que la cola lo haga VISIBLE en el dead-letter.
    if (respuesta.status === 401 || respuesta.status === 403) {
      optlog("client/google — SALIDA: config_invalida (credencial rechazada)", {
        status: respuesta.status,
        pista:
          "en WIF suele ser el principal del pool sin roles/iam.workloadIdentityUser, " +
          "o la SA sin roles/routeoptimization.editor",
      });
      return {
        status: "config_invalida",
        detalle: `${OPERACION}: credencial rechazada (HTTP ${respuesta.status})`,
      };
    }
    // R15: cuota agotada y errores de servidor -> transitorio, la cola aplica su backoff.
    if (respuesta.status === 429 || respuesta.status >= 500) {
      optlog("client/google — SALIDA: transitorio", { status: respuesta.status });
      return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }
    // Cualquier otro no-2xx (tipicamente 400 por modelo mal formado) es un fallo NUESTRO,
    // no del proveedor ni de la red: ruidoso a proposito, no se disfraza de transitorio.
    if (!respuesta.ok) {
      optlog("client/google — SALIDA: peticion rechazada (modelo mal formado?)", {
        status: respuesta.status,
      });
      throw new RutaPeticionRechazadaError(respuesta.status);
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch (error) {
      opterror("client/google — el cuerpo 2xx no es JSON", error);
      throw new RutaRespuestaInvalidaError("cuerpo no es JSON");
    }

    // Respuesta CRUDA, antes de que zod haga strip. Es la unica forma de ver los campos que
    // el contrato de aqui descarta (`metrics`, `routePolyline`) cuando algo no cuadra.
    optlog("client/google — respuesta cruda del proveedor", { json });

    const parsed = respuestaSchema.safeParse(json);
    if (!parsed.success) {
      // Se citan los CAMPOS que fallan, NUNCA sus valores (serian coordenadas).
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      optlog("client/google — SALIDA: respuesta invalida", { campos });
      throw new RutaRespuestaInvalidaError(`campos invalidos: ${campos}`);
    }

    const secuencia = this.traducirSecuencia(parsed.data, paradas);
    optlog("client/google — SALIDA: ok", { secuencia, totalParadas: secuencia.length });
    return { status: "ok", secuencia };
  }

  /**
   * Reconstruye la secuencia de `ordenId` mapeando `shipmentIndex -> paradas[i].ordenId`.
   *
   * R13: cualquier desviacion estructural LANZA en vez de devolver una secuencia
   * incompleta. Persistir una secuencia parcial seria peor que no optimizar: borraria el
   * ultimo orden bueno y dejaria paradas fuera de la ruta sin que nadie se entere.
   */
  private traducirSecuencia(
    data: z.infer<typeof respuestaSchema>,
    paradas: OptimizarInput["paradas"],
  ): string[] {
    const ruta = data.routes?.[0];
    if (ruta === undefined) {
      throw new RutaRespuestaInvalidaError("sin routes");
    }
    const visitas = ruta.visits ?? [];
    const secuencia: string[] = [];
    const vistos = new Set<number>();
    for (const visita of visitas) {
      // Trampa proto3-json (ver cabecera): ausente == 0.
      const indice = visita.shipmentIndex ?? 0;
      if (indice >= paradas.length) {
        throw new RutaRespuestaInvalidaError("shipmentIndex fuera de rango");
      }
      // Con solo `deliveries` hay UNA visita por shipment; un indice repetido significa
      // que el contrato asumido aqui no es el real.
      if (vistos.has(indice)) {
        throw new RutaRespuestaInvalidaError("shipmentIndex repetido");
      }
      vistos.add(indice);
      secuencia.push(paradas[indice].ordenId);
    }
    // El modelo enviado no lleva capacidades ni ventanas horarias: el proveedor no tiene
    // motivo para saltarse paradas. Si aun asi lo hace, la secuencia seria PARCIAL (R13).
    if (secuencia.length !== paradas.length) {
      throw new RutaRespuestaInvalidaError("la secuencia no cubre todas las paradas");
    }
    return secuencia;
  }
}
