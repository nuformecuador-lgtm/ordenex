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

/**
 * Feature 265 (R1-R3, design §3.1) — LO QUE EL PROVEEDOR DICE CUANDO NO PUEDE SERVIR UNA
 * PARADA. Hasta la 265 estos tres campos ni se nombraban en el repo, asi que zod los tiraba
 * en el strip y una respuesta que explicaba el problema con precision llegaba al servicio
 * como «forma inesperada».
 *
 * TRES PROPIEDADES, NINGUNA DECORATIVA:
 *
 * 1. TODO OPCIONAL. Es la trampa proto3-json de la cabecera aplicada aqui: Google OMITE los
 *    campos con valor por defecto, asi que declarar `skippedShipments` obligatorio haria
 *    fallar el parseo de TODA respuesta sana —que son casi todas— (R2).
 * 2. LA FORMA INTERNA NO SE DECLARA, porque NO SE CONOCE: el log de produccion la trunco a
 *    `[Object]` y la unica via para verla (la traza) queda apagada. Declararla de memoria
 *    seria inventar (CLAUDE.md regla 6). Lo que se hace en su lugar esta en
 *    `extraerCodigosDeSalto`: reconocer CLAVES, no una forma.
 * 3. SIGUE SIN `.passthrough()` en la raiz. `routePolyline` es una traza de coordenadas, es
 *    decir PII. Lo que se anade son TRES CAMPOS NOMBRADOS, no una puerta abierta.
 *
 * ⚠️ `.catchall(z.unknown())` NO es `.passthrough()` disfrazado: se aplica a los elementos de
 * dos arrays cuyo contenido NO se lee salvo por el extractor de codigos, que solo deja pasar
 * literales en mayusculas. Nada de lo que caiga ahi llega a un mensaje, a la base ni a la UI.
 */
const objetoOpacoSchema = z.object({}).catchall(z.unknown());

const respuestaSchema = z.object({
  routes: z.array(routeSchema).optional(),
  skippedShipments: z.array(objetoOpacoSchema).optional(),
  validationErrors: z.array(objetoOpacoSchema).optional(),
  metrics: z
    .object({ skippedMandatoryShipmentCount: z.number().int().nonnegative().optional() })
    .optional(),
});

/** Un codigo de motivo: MAYUSCULAS, digitos y guion bajo. Nunca una frase, nunca un numero. */
const CODIGO = /^[A-Z][A-Z0-9_]{2,49}$/;

/** Tope de codigos citados. Un motivo no es un volcado: con tres se entiende el patron. */
const MAX_CODIGOS = 3;

/** Profundidad maxima del barrido. Acota el coste y evita ciclos por construccion. */
const PROFUNDIDAD_MAX = 3;

/**
 * Feature 265 (R7, R49) — CODIGOS DE MOTIVO DEL SALTO, si los hay.
 *
 * ═══ POR QUE ESTO RECONOCE CLAVES Y NO UNA FORMA ═══
 * R7 pide citar los codigos «DONDE la respuesta traiga codigos en un campo QUE EL CONTRATO
 * RECONOZCA». La forma interna de `skippedShipments` es DESCONOCIDA (P1 se quedo sin via:
 * la consulta de logs expira y la traza se apaga en esta misma release), asi que declarar
 * `reasons[].code` como si se supiera seria inventar un contrato. Lo que el contrato
 * reconoce, y lo dice aqui, es: UNA CLAVE LLAMADA `code` CUYO VALOR PARECE UN CODIGO.
 *
 * ═══ Y POR QUE EL FILTRO ES TAN ESTRECHO (R6, R32) ═══
 * Solo pasan cadenas que encajan en `CODIGO`. Eso deja fuera, por construccion, las tres
 * cosas que NO pueden salir de aqui: coordenadas (son numeros, y con punto y signo si vienen
 * como texto), identificadores (minusculas y guiones) y texto libre del proveedor (espacios).
 * Si el filtro no encuentra nada —el caso que HOY se espera, porque nadie ha visto la forma
 * real— el motivo se compone igual, sin hueco y sin `undefined` (R49).
 */
export function extraerCodigosDeSalto(items: readonly unknown[]): string[] {
  const encontrados = new Set<string>();

  const visitar = (valor: unknown, profundidad: number): void => {
    if (profundidad > PROFUNDIDAD_MAX || valor === null || typeof valor !== "object") return;
    if (Array.isArray(valor)) {
      for (const item of valor) visitar(item, profundidad + 1);
      return;
    }
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (clave.toLowerCase() === "code" && typeof v === "string" && CODIGO.test(v)) {
        encontrados.add(v);
      }
      visitar(v, profundidad + 1);
    }
  };

  for (const item of items) visitar(item, 0);
  return [...encontrados].sort().slice(0, MAX_CODIGOS);
}

/**
 * Feature 265 (R4-R7, R49) — el MOTIVO de un `sin_solucion`, compuesto con la regla de la
 * casa: se citan CAMPOS y CONTEOS, nunca valores.
 *
 * | Se puede citar                                   | No se puede citar                        |
 * | ------------------------------------------------ | ---------------------------------------- |
 * | el NOMBRE de un campo (`validationErrors`)        | cualquier coordenada                     |
 * | CONTEOS: cuantas servidas, cuantas enviadas (R5)  | indices de parada (llevan a un `ordenId`)|
 * | CODIGOS del proveedor, si los hay (R7)            | texto libre del proveedor (R6)           |
 * | si `validationErrors` esta PRESENTE (un booleano) | el contenido de `validationErrors`       |
 *
 * ⚠️ R49: SIN CODIGOS, EL MOTIVO SIGUE COMPLETO. El tramo de codigos no existe en vez de
 * existir vacio: nada de `motivos: undefined`, `motivos: []` ni un «(sin motivos)» de relleno.
 * Es el caso que HOY se espera, porque la forma interna de `skippedShipments` nunca se vio.
 */
export function motivoSinSolucion(datos: {
  servidas: number;
  enviadas: number;
  codigos: readonly string[];
  conValidationErrors: boolean;
}): string {
  const partes = [`servidas ${datos.servidas} de ${datos.enviadas}`];
  if (datos.codigos.length > 0) partes.push(`motivos: ${datos.codigos.join(", ")}`);
  if (datos.conValidationErrors) partes.push("con validationErrors");
  return `${OPERACION}: paradas saltadas por el proveedor (${partes.join("; ")})`;
}

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
    // de R14 documentado en `lib/logging/optimizer-log.ts`.
    // ⏳ FEATURE 265 (2026-08-22, P7): esta linea NACE APAGADA. Hasta la 265 este comentario
    // decia «se apaga con RUTA_DEBUG_LOG=0» y esa frase caduco con la inversion del default:
    // hoy la traza solo se ENCIENDE, a proposito, con `RUTA_DEBUG_LOG=1`. Ver `activo()`.
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

    const saltadas = parsed.data.skippedShipments ?? [];
    const validacion = parsed.data.validationErrors ?? [];
    // R8: se deja escrito lo que el proveedor informo AUNQUE la respuesta sea utilizable. Una
    // respuesta que sirve y viene con avisos es la antesala de una que ya no sirve.
    if (saltadas.length > 0 || validacion.length > 0) {
      optlog("client/google — el proveedor informa saltos o errores de validacion", {
        skippedShipments: saltadas.length,
        // Solo la PRESENCIA (un booleano), nunca el contenido: puede traer texto libre del
        // proveedor citando el modelo enviado, que ES una lista de coordenadas de entrega.
        validationErrors: validacion.length > 0,
        skippedMandatoryShipmentCount:
          parsed.data.metrics?.skippedMandatoryShipmentCount ?? null,
      });
    }

    const traduccion = this.traducirSecuencia(parsed.data, paradas);
    if (traduccion.cubierta) {
      optlog("client/google — SALIDA: ok", {
        secuencia: traduccion.secuencia,
        totalParadas: traduccion.secuencia.length,
      });
      return { status: "ok", secuencia: traduccion.secuencia, fuente: "proveedor" };
    }

    // R4/R5/R7/R49 — el motivo NOMBRA LA CAUSA («paradas saltadas por el proveedor») y lleva
    // los CONTEOS. Nunca dice «forma inesperada»: eso describia un fallo que aqui no hubo.
    const detalle = motivoSinSolucion({
      servidas: traduccion.servidas,
      enviadas: traduccion.enviadas,
      codigos: extraerCodigosDeSalto(saltadas),
      conValidationErrors: validacion.length > 0,
    });
    optlog("client/google — SALIDA: sin_solucion (el proveedor no las sirvio todas)", {
      servidas: traduccion.servidas,
      enviadas: traduccion.enviadas,
    });
    return {
      status: "sin_solucion",
      detalle,
      servidas: traduccion.servidas,
      enviadas: traduccion.enviadas,
    };
  }

  /**
   * Reconstruye la secuencia de `ordenId` mapeando `shipmentIndex -> paradas[i].ordenId`.
   *
   * R13: cualquier desviacion estructural LANZA en vez de devolver una secuencia
   * incompleta. Persistir una secuencia parcial seria peor que no optimizar: borraria el
   * ultimo orden bueno y dejaria paradas fuera de la ruta sin que nadie se entere.
   *
   * ⏳ FEATURE 265 (2026-08-22) — LA PREMISA DE ABAJO QUEDA CADUCADA, NO LA REGLA.
   * El razonamiento del parrafo anterior sigue VIGENTE y es justo el motivo de la regla
   * nueva: una secuencia parcial no se persiste JAMAS. Lo que caduco es la premisa que
   * afirmaba que el proveedor no tenia motivo para saltarse paradas (la frase esta unas
   * lineas mas abajo, sin tocar). Medido: el 2026-08-21 Google respondio `routes: [{}]`,
   * seis paradas en `skippedShipments` y `metrics.skippedMandatoryShipmentCount = 6` para un
   * modelo cuyo origen estaba en otro pais. Consecuencia: ese caso ya NO lanza, devuelve el
   * desenlace `sin_solucion` y el compuesto ordena las paradas —TODAS— en local.
   * Puntero: `specs/265-optimizador-lee-al-proveedor`.
   *
   * Los otros TRES `throw` (sin `routes`, indice fuera de rango, indice repetido) NO se tocan:
   * en esos el proveedor no explico nada, y el contrato asumido aqui no seria el real.
   */
  private traducirSecuencia(
    data: z.infer<typeof respuestaSchema>,
    paradas: OptimizarInput["paradas"],
  ): { cubierta: true; secuencia: string[] } | { cubierta: false; servidas: number; enviadas: number } {
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
    //
    // ⏳ FEATURE 265 (2026-08-22) — LAS DOS PRIMERAS FRASES ESTAN CADUCADAS (ver la cabecera
    // del metodo). SI tiene motivo, y el 2026-08-21 lo tuvo. La tercera sigue siendo cierta y
    // es la que manda: la secuencia parcial NO se persiste. Lo que cambia es el remate — en
    // vez de lanzar «forma inesperada», se devuelve un desenlace que NOMBRA la causa y lleva
    // los conteos, y quien lo reciba ordena TODAS las paradas en local (R9, R10, R11).
    if (secuencia.length !== paradas.length) {
      return { cubierta: false, servidas: secuencia.length, enviadas: paradas.length };
    }
    return { cubierta: true, secuencia };
  }
}
