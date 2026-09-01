"use server";

// FICHA 347 — EL BORDE del detalle orden por orden del dinero de un producto.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus hermanas: es una lectura
// INTERNA de esta aplicacion, y `docs/architecture.md` reserva los route handlers para webhooks
// y API publica.
//
// LOS PASOS, Y EL ORDEN ES EL CONTRATO:
//
//  1. **validar con zod** (`.strict()`). Si no valida, NO se consulta la base y NO se resuelve el
//     alcance (R73): una entrada malformada tampoco puede servir para sondear permisos.
//  2. **preparar la consulta** con `prepararConsultaProductos`, que es la MISMA puerta que usa
//     la tabla: parsear → rango → alcance → intersecar → concesion de dinero. Aqui NO se
//     resuelve alcance por cuenta propia y NO se escribe ni un literal de rol.
//  3. **delegar en el servicio**, que aplica el guard del dinero antes de tocar la base.
//
// ⚠ EL `tienda_id` NO ES UN AGUJERO, y esta es la linea que hay que leer antes de tocar nada:
// entra COMO UNA FACETA MAS del filtro de la seccion, o sea por la puerta que
// `recortarFiltroConteoEntregas` YA interseca con el alcance del actor. Una tienda ajena produce
// `filtro_fuera_de_alcance` → `forbidden` (R44), NO un resultado vacio; y la tienda concedida
// acaba en el `WHERE` de SQL (R43/R7). Cero codigo de permisos nuevo, y ninguna segunda puerta a
// la misma frontera multi-tenant.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { DineroProductosRepository } from "@/lib/repositories/DineroProductosRepository";
import { DetalleDineroProductoService } from "@/lib/services/DetalleDineroProductoService";
import {
  detalleDineroProductoSchema,
  type ResultadoDetalleDineroProducto,
} from "@/lib/types/dinero-productos";

/**
 * Con que nombre aparece esta lectura en la auditoria. PROPIO y distinto al de la tabla: si
 * compartieran nombre, una denegacion no diria cual de las dos puertas se toco.
 */
const ID_AUDITORIA = "detalle_dinero_producto";

export interface DetalleDineroProductoDeps {
  readonly service?: Pick<DetalleDineroProductoService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado. */
  readonly now?: () => Date;
}

/**
 * Las ordenes que componen las cifras de dinero de UNA fila de la tabla de productos.
 *
 * `raw` es `{ filtro, producto_clave, page?, pageSize? }`. El `filtro` es el MISMO contrato que
 * el resto de la seccion de entregas y lleva `tienda_id` con EXACTAMENTE una tienda: la de la
 * fila que se abrio.
 *
 * ⚠ AQUI VIVIA UN `@sin-superficie`, y se BORRO con la tarea F5 de esta misma ficha: la accion
 * ya tiene consumidor de produccion. La cadena es
 * `ProductosTabla` → `renderExpanded` → `DineroProductoDetalle` → `dinero-producto-swr` → aqui.
 * La anotacion no se deja «por si acaso»: `superficie-de-uso.guardia` falla tambien cuando una
 * anotacion sobrevive a su motivo, y con razon — una excepcion que sobrevive a su causa es
 * basura que crece hasta que nadie lee ninguna.
 */
export async function consultarDetalleDineroProducto(
  raw: unknown,
  deps: DetalleDineroProductoDeps = {},
): Promise<ResultadoDetalleDineroProducto> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());

  // 1. R73 — la validacion PRIMERO, y sin actor todavia: ni base ni alcance.
  const parseado = detalleDineroProductoSchema.safeParse(raw);
  if (!parseado.success) {
    return {
      status: "validation_error",
      fieldErrors: parseado.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const actor = await (deps.getActor ?? resolveActorFromSession)();

  // 2. La MISMA puerta que la tabla. El `tienda_id` de la fila viaja DENTRO de `filtro`.
  const preparada = prepararConsultaProductos(parseado.data.filtro, actor, now());
  if (preparada.status === "validation_error") {
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }
  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, actor, raw);
  }

  // 3. El servicio, que vuelve a aplicar el guard del dinero antes de tocar la base.
  const service = deps.service ?? new DetalleDineroProductoService(
    new DineroProductosRepository(getPrismaClient()),
  );
  const resultado = await service.consultar(preparada.consulta, {
    productoClave: parseado.data.producto_clave,
    page: parseado.data.page,
    pageSize: parseado.data.pageSize,
  });

  if (resultado.status === "forbidden") {
    // El dinero esta prohibido para este rol. Se audita con el MISMO motivo que usa el
    // catalogo, y al cliente le llega un `forbidden` pelado.
    return denegar(logger, "metrica_prohibida", actor, raw);
  }
  return resultado;
}

/**
 * Registra el denegado y responde. Punto UNICO de respuesta negativa.
 *
 * `sin_sesion` sale como `unauthenticated` y todo lo demas como `forbidden`: «no sabemos quien
 * eres» se arregla volviendo a entrar y «no puedes» no. El MOTIVO concreto se queda en el log
 * (R10) — al cliente seria una pista sobre el modelo de permisos: sabria si le falta la sesion,
 * si su rol no existe o si la tienda que pidio no es suya.
 *
 * `describirDenegado` es quien SANEA la linea: del filtro crudo solo sobreviven las listas de
 * ids del contrato, asi que ni PII, ni ids ajenos, ni contenido de sesion llegan al canal de
 * auditoria.
 */
function denegar(
  logger: ErrorLogger,
  motivo: MotivoDenegacion,
  actor: ActorAnalitica | null,
  raw: unknown,
): { readonly status: "unauthenticated" } | { readonly status: "forbidden" } {
  logger.logError(describirDenegado({ motivo, actor, metricaId: ID_AUDITORIA, filtro: raw }));
  return motivo === "sin_sesion" ? { status: "unauthenticated" } : { status: "forbidden" };
}
