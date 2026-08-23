// Feature 267 (T7, design §4.1/§4.2) — EL CASCARON HTTP de la analitica por el canal de API key.
//
// `GET /api/ordenes/api-key/analitica?metricas=<id>[,<id>...]|all&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
// con `Authorization: Bearer ordx_...`.
//
// QUE HACE ESTE ARCHIVO, Y NADA MAS: bearer, query, status y JSON. Los cuatro pasos de la
// analitica (actor -> preparar -> auditar el denegado -> consultar) viven en
// `lib/api/analitica-integrador.ts`, que es el hermano de `lib/actions/analitica-operativa.ts`
// para el canal publico.
//
// ⚠ POR QUE ESTE HANDLER NO NOMBRA NI EL SERVICIO NI EL REPOSITORIO DE ANALITICA, y no es
// estilo: la guardia de frontera de 126/R1 (`operativa-frontera.guardia.test.ts`) prohibe
// mencionar el servicio operativo, sus repositorios y la Server Action desde CUALQUIER archivo
// de `app/api`, y esa prohibicion se conserva INTACTA en esta feature (decision P6 del
// 2026-08-23). Lo unico que se estrecha es la OTRA guardia —la que prohibia que un archivo de
// `app/api` se LLAMARA `analitica` (`tablero-operativo-frontera.guardia.test.ts`)—, que pasa a
// allowlist nominal de este unico camino. Es decir: la guardia de 126/R1 sigue verde DE VERDAD,
// no por casualidad. Si manana alguien "simplifica" este cascaron cableando aqui el servicio, se
// pone roja, y debe.
//
// ⚠ Y POR ESO `metricas` SE RESUELVE EN `lib/api/analitica-api-key-metricas.ts` (P4-bis):
// expandir `all` exige leer la lista blanca, que vive en `@/lib/analytics/**`, y la guardia de
// 134/R3 prohibe importar de ahi desde CUALQUIER archivo de `app/api` —tambien desde el camino
// nominalmente autorizado—. Este cascaron no nombra ni un modulo de analitica: pasa la cadena
// cruda y recibe la lista resuelta.
//
// ORDEN NORMATIVO, heredado de la 255 (`cotizacion/route.ts`) y exigido por 267/R23:
//   auth (401/403)  ->  query (422)  ->  preparar (403 | 422)  ->  servicio (200)
// La autenticacion va ANTES de mirar la query: un 422 que llegara antes que el 401 le diria a
// un desconocido que su fecha estaba mal formada, y eso ya es informacion.
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";
import {
  consultarAnaliticaIntegrador,
  type AnaliticaIntegradorDeps,
} from "@/lib/api/analitica-integrador";
import { proyectarRespuestaApiKey } from "@/lib/api/analitica-api-key-dto";
import { resolverMetricasPedidas } from "@/lib/api/analitica-api-key-metricas";

// El runtime de Node es OBLIGATORIO: Prisma y el hash de la API key no corren en edge.
export const runtime = "nodejs";

export interface AnaliticaApiKeyDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  /**
   * Se reenvia TAL CUAL al borde (`service`, `logger`, `now`). No hay un segundo gancho para
   * sustituir el borde entero a proposito: los tests que quieren ver «que filtro llega al
   * servicio» espian el `service`, que es literalmente donde llega.
   */
  analitica?: AnaliticaIntegradorDeps;
}

/**
 * 267/R27 — el schema declara TRES claves y ninguna mas.
 *
 * `metricas` es un `string` a secas y NO un `enum` de la lista blanca, y es una decision, no un
 * descuido (267/R16): si el borde rechazara con 422 las metricas no publicables, un tercero
 * podria SONDEAR desde fuera cuales existen en el catalogo comparando 422 contra 403. La lista
 * blanca la aplica `resolverAlcance`, que devuelve el MISMO 403 mudo para «existe pero no se
 * publica» y para «no existe». Por eso lo unico que este schema exige de `metricas` es que sea
 * una cadena no vacia: la FORMA la valida `resolverMetricasPedidas`, que tampoco mira el
 * catalogo.
 *
 * `desde` y `hasta` son AMBOS OBLIGATORIOS (decision P3 del 2026-08-23) y se validan como fecha
 * CALENDARIO REAL con `esFechaCalendarioValida` —la misma funcion que la 257—, que hace el
 * round-trip que caza `2026-02-31` (V8 la rueda al 3 de marzo en silencio) y `2026-13-01`. No se
 * escribe un regex nuevo, y no hay presets: el rango de una respuesta nunca depende de cuando se
 * llamo.
 *
 * Lo que este schema NO valida, tambien a proposito: el rango invertido (267/R25) y el tope de
 * ventana (267/R26). Los aplican los cuatro `.refine` de `analiticaFiltroSchema`
 * (`lib/analytics/filters.ts`) sobre el filtro que se construye abajo, con `path: ["hasta"]` en
 * los dos casos. Duplicarlos aqui seria una segunda copia del tope de 366 dias que un dia
 * diverge de `RANGO_TOPE_DIAS`.
 */
const analiticaQuerySchema = z
  .object({
    metricas: z.string().trim().min(1),
    desde: z
      .string()
      .refine(esFechaCalendarioValida, { message: "Fecha invalida (formato YYYY-MM-DD)." }),
    hasta: z
      .string()
      .refine(esFechaCalendarioValida, { message: "Fecha invalida (formato YYYY-MM-DD)." }),
  })
  .strict();

/**
 * Logica del endpoint, extraida para inyeccion de dependencias en tests (sin DB ni cookies).
 */
export async function handleAnaliticaApiKey(
  req: Request,
  deps: AnaliticaApiKeyDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. 267/R22/R23 — AUTENTICACION ANTES DE PARSEAR LA QUERY. Una key ausente y una key
    // inexistente producen el MISMO 401: las dos llegan aqui como `unauthenticated`, asi que
    // desde fuera son indistinguibles. La key existe pero su usuario dedicado no esta activo
    // -> 403. Ninguno de los dos caminos escribe la key en ningun sitio (267/R33): el unico
    // que la tuvo fue `extraerBearer`, y no la entrega a nadie mas que al autenticador.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // -> 403

    // 2. 267/R9/R27 — LECTURA CLAVE POR CLAVE, igual que `app/api/ordenes/api-key/route.ts`.
    // Volcar `Object.fromEntries(sp)` convertiria cualquier clave futura en entrada del schema,
    // que es justo lo que 106/R8 impide. Y aqui compra algo mas: `tienda_id`, `zona_id` y
    // `mensajero_id` NO SE LEEN, asi que no hay forma de que lleguen al filtro (267/R9/R37).
    // No se ignoran «por politica»: es que no existe la linea que los leeria.
    const sp = new URL(req.url).searchParams;
    const raw: Record<string, string> = {};
    if (sp.has("metricas")) raw.metricas = sp.get("metricas") ?? "";
    if (sp.has("desde")) raw.desde = sp.get("desde") ?? "";
    if (sp.has("hasta")) raw.hasta = sp.get("hasta") ?? "";
    const parsed = analiticaQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors }); // -> 422
    }

    // 2-bis. P4-bis — LA LISTA DEL LOTE. El 422 sale con la clave publica `metricas`, la misma
    // que llego en la query, para que el integrador sepa que corregir sin adivinar.
    const metricas = resolverMetricasPedidas(parsed.data.metricas);
    if (!metricas.ok) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { metricas: [metricas.mensaje] },
      }); // -> 422
    }

    // 3. EL BORDE CONSTRUYE EL FILTRO INTERNO (design §4.2): no lo recibe. `desde`/`hasta` del
    // contrato publico se traducen aqui a `EntradaRango.personalizado`, el vocabulario de la
    // 135. Consecuencia buscada: el filtro que viaja no tiene NI UN campo que el integrador
    // pudiera haber elegido mas alla de las dos fechas.
    const salida = await consultarAnaliticaIntegrador(
      {
        actor: auth.actor,
        metricaIds: metricas.ids,
        raw: { rango: "personalizado", desde: parsed.data.desde, hasta: parsed.data.hasta },
      },
      deps.analitica,
    );

    // 4. Traduccion del resultado de dominio a HTTP. `forbidden` sale MUDO —sin datos y sin
    // motivo— porque el motivo ya se registro en el log de auditoria dentro del borde
    // (267/R32): un integrador tiene que poder distinguir «prohibido» de «sin datos», pero no
    // tiene por que saber CUAL de los motivos fue.
    switch (salida.status) {
      case "ok":
        // 267/R31 — proyeccion explicita campo a campo. El objeto interno NUNCA se serializa
        // tal cual: un campo nuevo del contrato de la 126 no se publica solo. El sobre publica
        // el rango UNA vez y las series en el orden pedido (R45/R47/R48).
        //
        // El `switch` es exhaustivo a proposito: un estado nuevo del resultado de dominio debe
        // romper la compilacion, no caer en un `default` que responda 200.
        return proyectarRespuestaApiKey(salida.series);
      case "validation_error":
        // 267/R25/R26 — aqui aterrizan el rango invertido y el tope de ventana, con sus
        // `fieldErrors` en las MISMAS claves publicas (`desde`/`hasta`) que llegaron en la query.
        throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: salida.fieldErrors });
      case "forbidden":
        throw new ForbiddenError();
    }
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleAnaliticaApiKey(req);
}
