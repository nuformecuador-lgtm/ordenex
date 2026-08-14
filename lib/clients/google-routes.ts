// Feature 92 (seguimiento) — cliente HTTP de la Google Routes API (`computeRoutes`). Toma
// la secuencia que YA decidio Route Optimization y pide la polilinea que la dibuja.
//
// ⚠️ `optimizeWaypointOrder` VA EN FALSE, A PROPOSITO. Routes sabe reordenar waypoints por
// su cuenta, y activarlo aqui haria que la ruta dibujada NO fuera la ruta persistida: el
// mensajero veria en el mapa un orden distinto al de su lista de paradas. El orden lo decide
// UN solo componente (Route Optimization) y este cliente lo obedece.
//
// MISMAS TRES INVARIANTES QUE `google-route-optimization.ts`:
//  1. `fetch` y proveedor de token INYECTABLES: los tests no tocan la red.
//  2. Zod EN EL BORDE, sin `passthrough`.
//  3. Ningun MENSAJE DE ERROR cita token, URL ni coordenadas. (La TRAZA de diagnostico si
//     imprime coordenadas: es el override consciente de `lib/logging/optimizer-log.ts`.)
//
// AUTENTICACION: el mismo `TokenProvider` que la optimizacion, asi que hereda el selector
// ADC/WIF/JWT sin saber cual esta activo. Routes tambien aceptaria una API key, pero usar
// dos credenciales distintas para dos llamadas de la misma feature es justo lo que hace que
// un despliegue funcione a medias.
import { z } from "zod";
import type { RoutingPreference } from "@/lib/config/route-optimization";
import type {
  IRoutesClient,
  TrazarRutaInput,
  TrazarRutaOutcome,
} from "@/lib/interfaces/external/IRoutesClient";
import { optlog, opterror, describirToken, cronometro } from "@/lib/logging/optimizer-log";

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Nombre de la operacion citado en los errores. Sin URL, sin token, sin coordenadas. */
const OPERACION = "trazar ruta";

/**
 * Routes exige `X-Goog-FieldMask`: sin el, responde 400. Se piden SOLO los tres campos que
 * se consumen. Pedir `*` traeria, entre otras cosas, los pasos de navegacion con sus
 * instrucciones y coordenadas — mucho mas dato personal circulando para nada.
 */
const FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";

/**
 * Tope de paradas INTERMEDIAS que admite una peticion de `computeRoutes`. Es un limite del
 * proveedor, no una decision nuestra. La optimizacion admite hasta `RUTA_MAX_PARADAS` (100
 * por defecto), asi que una ruta larga puede ordenarse entera y NO poder dibujarse de una
 * sola vez; en ese caso se omite el trazado en vez de dibujar una ruta parcial que
 * contradiga la lista de paradas.
 */
const MAX_INTERMEDIOS = 25;

/** `duration` viaja como string de protobuf: `"1234s"`. */
const DURACION_RE = /^(\d+(?:\.\d+)?)s$/;

const rutaSchema = z.object({
  distanceMeters: z.number().nonnegative().optional(),
  duration: z.string().optional(),
  polyline: z.object({ encodedPolyline: z.string().optional() }).optional(),
});

const respuestaSchema = z.object({
  routes: z.array(rutaSchema).optional(),
});

export interface GoogleRoutesClientOpts {
  /** Proveedor del `access_token` OAuth2. El mismo que usa la optimizacion. */
  getToken: () => Promise<string>;
  /** Timeout de la llamada en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red. */
  fetchImpl?: typeof fetch;
  /**
   * Preferencia de trafico. Default `TRAFFIC_UNAWARE`, que es tambien el default de Google:
   * omitir el campo y mandarlo explicitamente producen la MISMA ruta y el MISMO precio. Se
   * manda explicito para que el body logueado diga con que se pidio, sin tener que recordar
   * cual era el default del proveedor.
   */
  routingPreference?: RoutingPreference;
}

/** Convierte `"1234s"` a segundos. Cualquier otra forma -> `null`, nunca `NaN`. */
function parsearDuracion(duration: string | undefined): number | null {
  if (duration === undefined) return null;
  const m = DURACION_RE.exec(duration);
  return m === null ? null : Number.parseFloat(m[1]);
}

/** Envuelve un punto en la forma `Waypoint` que espera Routes. */
function waypoint(p: { lat: number; lng: number }) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

export class GoogleRoutesClient implements IRoutesClient {
  private readonly getToken: () => Promise<string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly routingPreference: RoutingPreference;

  constructor(opts: GoogleRoutesClientOpts) {
    this.getToken = opts.getToken;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.routingPreference = opts.routingPreference ?? "TRAFFIC_UNAWARE";
  }

  async trazar(input: TrazarRutaInput): Promise<TrazarRutaOutcome> {
    const { origen, paradasEnOrden } = input;

    optlog("client/routes — ENTRADA", {
      origen,
      paradasEnOrden: paradasEnOrden.map((p, i) => ({
        i,
        ordenId: p.ordenId,
        lat: p.lat,
        lng: p.lng,
      })),
      totalParadas: paradasEnOrden.length,
    });

    // Sin destino no hay ruta que dibujar. No es un fallo: es una ruta vacia.
    if (paradasEnOrden.length === 0) {
      optlog("client/routes — SALIDA: omitida (sin paradas)");
      return { status: "omitida", razon: "sin_paradas" };
    }

    // El ultimo punto es el DESTINO; los de en medio, `intermediates`. De ahi el -1.
    const intermedios = paradasEnOrden.length - 1;
    if (intermedios > MAX_INTERMEDIOS) {
      optlog("client/routes — SALIDA: omitida (mas intermedios de los que admite Routes)", {
        intermedios,
        maximo: MAX_INTERMEDIOS,
      });
      return { status: "omitida", razon: "demasiadas_paradas" };
    }

    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      opterror("client/routes — no se pudo obtener el token; no se llama al proveedor", error);
      // Se propaga TAL CUAL, igual que en la optimizacion: `RutaNoConfiguradoError` debe
      // llegar reconocible a quien decida si esto es un fallo o un "sin credencial".
      throw error;
    }

    const destino = paradasEnOrden[paradasEnOrden.length - 1];
    const body = {
      origin: waypoint(origen),
      destination: waypoint(destino),
      intermediates: paradasEnOrden.slice(0, -1).map(waypoint),
      travelMode: "DRIVE",
      routingPreference: this.routingPreference,
      polylineEncoding: "ENCODED_POLYLINE",
      // Ver la advertencia de la cabecera: el orden NO se toca aqui.
      optimizeWaypointOrder: false,
    };

    optlog("client/routes — POST computeRoutes", {
      url: ENDPOINT,
      fieldMask: FIELD_MASK,
      timeoutMs: this.timeoutMs,
      ...describirToken(token),
      body,
    });

    const medir = cronometro();
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-goog-fieldmask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      opterror("client/routes — fallo de red o timeout", error, { ms: medir() });
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    optlog("client/routes — respuesta HTTP", { status: respuesta.status, ms: medir() });

    if (respuesta.status === 401 || respuesta.status === 403) {
      optlog("client/routes — SALIDA: config_invalida", {
        status: respuesta.status,
        pista: "¿esta habilitada routes.googleapis.com en el proyecto?",
      });
      return {
        status: "config_invalida",
        detalle: `${OPERACION}: credencial rechazada (HTTP ${respuesta.status})`,
      };
    }
    if (respuesta.status === 429 || respuesta.status >= 500) {
      optlog("client/routes — SALIDA: transitorio", { status: respuesta.status });
      return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }
    if (!respuesta.ok) {
      // Un 400 aqui suele ser el FieldMask o un waypoint mal formado. NO se lanza: el
      // trazado es accesorio y no debe tumbar una optimizacion que ya salio bien.
      optlog("client/routes — SALIDA: peticion rechazada", { status: respuesta.status });
      return {
        status: "config_invalida",
        detalle: `${OPERACION}: el proveedor rechazo la peticion (HTTP ${respuesta.status})`,
      };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch (error) {
      opterror("client/routes — el cuerpo 2xx no es JSON", error);
      return { status: "transitorio", detalle: `${OPERACION}: cuerpo no es JSON` };
    }

    optlog("client/routes — respuesta cruda del proveedor", { json });

    const parsed = respuestaSchema.safeParse(json);
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      optlog("client/routes — SALIDA: respuesta invalida", { campos });
      return {
        status: "transitorio",
        detalle: `${OPERACION}: respuesta con forma inesperada (${campos})`,
      };
    }

    const ruta = parsed.data.routes?.[0];
    const encodedPolyline = ruta?.polyline?.encodedPolyline;
    if (encodedPolyline === undefined || encodedPolyline === "") {
      // Sin polilinea no hay nada que dibujar; devolver "ok" con una cadena vacia haria que
      // el consumidor pintara una ruta invisible y creyera que funciono.
      optlog("client/routes — SALIDA: omitida (el proveedor no devolvio polilinea)");
      return { status: "omitida", razon: "sin_polilinea" };
    }

    const distanciaM = ruta?.distanceMeters ?? null;
    const duracionS = parsearDuracion(ruta?.duration);
    optlog("client/routes — SALIDA: ok", {
      distanciaM,
      duracionS,
      polilineaChars: encodedPolyline.length,
      encodedPolyline,
    });
    return { status: "ok", encodedPolyline, distanciaM, duracionS };
  }
}
