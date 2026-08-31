// Feature 267 (T7, design §4.1/§4.2) — EL CASCARON HTTP de la analitica por el canal de API key.
//
// `GET /api/ordenes/api-key/analitica?metricas=<id>[,<id>...]|all&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
// con `Authorization: Bearer ordx_...`.
//
// LOS TRES PARAMETROS SON OPCIONALES desde el 2026-08-31, y `GET .../analitica` a secas es una
// llamada valida: sin `metricas` se sirven TODAS las publicables, y sin fechas se sirve el
// HISTORICO COMPLETO (`desde` >= el horizonte del historial, `hasta` <= hoy). Un parametro
// presente pero vacio (`?metricas=&desde=`) cuenta como ausente. Los dos significados viven en
// `lib/api/analitica-api-key-metricas.ts` y `lib/api/analitica-api-key-rango.ts`, no aqui.
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
import { resolverRangoApiKey } from "@/lib/api/analitica-api-key-rango";

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
 * publica» y para «no existe». Por eso este schema no exige NADA de `metricas` mas alla de que
 * sea una cadena: la FORMA la valida `resolverMetricasPedidas`, que tampoco mira el catalogo.
 *
 * ⚠ ENMIENDA DEL 2026-08-31 — LAS TRES CLAVES SON OPCIONALES. La decision P3 (2026-08-23) hacia
 * obligatorios `desde` y `hasta` con este argumento: «asi el rango de una respuesta nunca depende
 * de cuando se llamo». El argumento era bueno para los ATAJOS que se rechazaron entonces (`7d`,
 * `30d`, «este mes»), y sigue siendolo: NO se ha anadido ninguno. Lo que se admite ahora es la
 * AUSENCIA, que no es un atajo sino el caso base de un integrador que quiere el historico entero
 * y no tiene por que saber en que fecha empezo la operacion. Que significa cada ausencia se
 * decide en `resolverRangoApiKey` (`lib/api/analitica-api-key-rango.ts`), en un solo sitio y con
 * el reloj inyectado; aqui solo se lee la query.
 *
 * Las tres claves siguen SIENDO EXACTAMENTE ESTAS —`.strict()` intacto— y las fechas que SI
 * llegan se validan igual: fecha CALENDARIO REAL con `esFechaCalendarioValida` —la misma funcion
 * que la 257—, que hace el round-trip que caza `2026-02-31` (V8 la rueda al 3 de marzo en
 * silencio) y `2026-13-01`. No se escribe un regex nuevo y no hay presets.
 *
 * Lo que este schema NO valida, tambien a proposito: el rango invertido (267/R25), que aplica
 * `analiticaFiltroSchema` (`lib/analytics/filters.ts`) sobre el filtro que se construye abajo,
 * con `path: ["hasta"]`. El TOPE de 366 dias ya no aplica a este canal (ver
 * `prepararConsultaAnalitica`): un historico completo no cabe en el, y el techo existia para
 * proteger a una grafica que este canal no tiene.
 */
const analiticaQuerySchema = z
  .object({
    metricas: z.string().optional(),
    desde: z
      .string()
      .refine(esFechaCalendarioValida, { message: "Fecha invalida (formato YYYY-MM-DD)." })
      .optional(),
    hasta: z
      .string()
      .refine(esFechaCalendarioValida, { message: "Fecha invalida (formato YYYY-MM-DD)." })
      .optional(),
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
    //
    // 2026-08-31 — UN PARAMETRO VACIO ES UN PARAMETRO AUSENTE, para las tres claves. `?desde=`
    // no es «una fecha mal escrita»: es un cliente que construyo la URL con una variable sin
    // valor, y el 422 que devolvia antes le decia «fecha invalida» sobre algo que nunca escribio.
    // Se decide UNA vez aqui, en la lectura, para que las tres claves se comporten igual y para
    // que ni el schema ni `resolverMetricasPedidas` tengan que distinguir vacio de ausente.
    const sp = new URL(req.url).searchParams;
    const raw: Record<string, string> = {};
    const leer = (clave: "metricas" | "desde" | "hasta") => {
      const valor = sp.get(clave)?.trim();
      if (valor !== undefined && valor !== "") raw[clave] = valor;
    };
    leer("metricas");
    leer("desde");
    leer("hasta");
    const parsed = analiticaQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors }); // -> 422
    }

    // 2-bis. P4-bis — LA LISTA DEL LOTE. El 422 sale con la clave publica `metricas`, la misma
    // que llego en la query, para que el integrador sepa que corregir sin adivinar.
    // Sin `metricas` la cadena que se resuelve es la VACIA, que significa «todas» (regla 0 de
    // `resolverMetricasPedidas`): la ausencia no se traduce aqui a `all` con un literal, para que
    // el significado de «no pedi ninguna» viva en un solo sitio y tenga sus tests.
    const metricas = resolverMetricasPedidas(parsed.data.metricas ?? "");
    if (!metricas.ok) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { metricas: [metricas.mensaje] },
      }); // -> 422
    }

    // 3. EL BORDE CONSTRUYE EL FILTRO INTERNO (design §4.2): no lo recibe. `desde`/`hasta` del
    // contrato publico se traducen aqui a `EntradaRango.personalizado`, el vocabulario de la
    // 135. Consecuencia buscada: el filtro que viaja no tiene NI UN campo que el integrador
    // pudiera haber elegido mas alla de las dos fechas.
    //
    // 2026-08-31 — las fechas que faltan las pone `resolverRangoApiKey`, con EL MISMO reloj que
    // usara el borde para todo el lote. Leer aqui un `new Date()` propio abriria la unica grieta
    // que R48 cerro: el rango podria cruzar la medianoche de Costa Rica entre este `raw` y el
    // instante con el que se resuelve la consulta, y la respuesta ecoaria un rango que no es el
    // que se sirvio.
    const ahora = deps.analitica?.now?.() ?? new Date();
    const rango = resolverRangoApiKey(
      { desde: parsed.data.desde, hasta: parsed.data.hasta },
      ahora,
    );
    const salida = await consultarAnaliticaIntegrador(
      {
        actor: auth.actor,
        metricaIds: metricas.ids,
        raw: { rango: "personalizado", desde: rango.desde, hasta: rango.hasta },
      },
      { ...deps.analitica, now: () => ahora },
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
        // ⚠ ENMIENDA 2026-08-24 — la proyeccion tambien DECIDE QUE DIAS SE PUBLICAN: el dia en
        // curso y los que caen bajo el horizonte del historial se OMITEN de `data`. Por eso un
        // `200` con `data: []` es una respuesta correcta y NO hay que tratarla aqui como un caso
        // raro: el rango que se devuelve sigue siendo el eco de lo que se pidio, sin recortar
        // (ver la cabecera de `lib/api/analitica-api-key-dto.ts`).
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
