"use server";

// FICHA 345 — EL BORDE del analisis de productos.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus seis hermanas: es una
// lectura INTERNA de esta aplicacion, y `docs/architecture.md` reserva los route handlers para
// webhooks y API publica.
//
// LOS CUATRO PASOS EN ORDEN, y el orden ES el contrato: parsear -> resolver rango -> resolver
// alcance -> intersecar. Los hace `prepararConsultaProductos` y este archivo no repite ninguno.
// En particular NO resuelve alcance por su cuenta y NO escribe ningun literal de rol: la regla
// por rol vive en `ALCANCE_PRODUCTOS` (`lib/analytics/metrics.ts`) y su traduccion, en
// `lib/analytics/productos-consulta.ts`. Una segunda puerta a la misma frontera multi-tenant es
// como se abren los agujeros.
//
// ⚠ POR QUE ESTA ACCION NO REUSA `prepararConteoEntregas`, que es lo que hace la del desglose por
// status: porque el ALCANCE diverge. Alli un `adminSatelite` obtiene `{tipo:"zona"}` y aqui esta
// PROHIBIDO. Reusar el preparador seria conceder a ese rol una lectura que la decision humana le
// niega, y el compilador no lo diria.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { ConteoProductosRepository } from "@/lib/repositories/ConteoProductosRepository";
import { DineroProductosRepository } from "@/lib/repositories/DineroProductosRepository";
import { ConteoProductosService } from "@/lib/services/ConteoProductosService";
import type { ResultadoConteoProductos } from "@/lib/types/conteo-productos";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo —esta
 * cifra no vive ahi— pero `describirDenegado` exige uno para que la linea del log diga QUE se
 * intento leer. PROPIO y distinto al de las otras acciones a proposito: si compartieran nombre,
 * una denegacion no diria cual de las puertas se toco.
 */
const ID_AUDITORIA = "conteo_productos";

export interface ConteoProductosDeps {
  readonly service?: Pick<ConteoProductosService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado, sello incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): ConteoProductosService {
  const prisma = getPrismaClient();
  return new ConteoProductosService(
    new ConteoProductosRepository(prisma),
    // La MISMA cache que las otras seis lecturas vivas: mismo TTL de 15 min y mismo
    // kill-switch. Las entradas no se pisan porque la clave lleva prefijo propio
    // (`claveDeConteoProductos`), y desde la ficha 347 con sufijo de CONCESION DE DINERO:
    // sin el, un maestro dejaria el dinero en cache y el siguiente actor lo recibiria.
    crearConteoEntregasCacheDeNext(),
    // FICHA 347 — el segundo repositorio. Se PASA aqui, que es el composition root de esta
    // lectura: un servicio que lo importara por su cuenta no seria inyectable y el test que
    // cuenta llamadas (R5: con el dinero denegado NO se llama) no podria existir.
    new DineroProductosRepository(prisma),
    { now },
  );
}

/**
 * La UNICA lectura del analisis de productos.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que el resto de
 * la seccion de entregas: las seis facetas (`zona_id`, `provincia_id`, `canton_id`, `distrito_id`,
 * `tienda_id`, `mensajero_id`) y el rango opcional. El esquema es `.strict()`, asi que una clave
 * desconocida es un `validation_error` y NO un extra inocuo: **el alcance nunca entra por el
 * filtro** (R8).
 *
 * SUPERFICIE (ficha 345, B7): la dispara `ProductosTabla` a traves de `productos-swr.ts`. Aqui
 * vivio una anotacion `@sin-superficie` mientras el backend iba por delante del frontend; se
 * retiro al llegar el componente, que es justo lo que esa guardia exige —una excepcion que
 * sobrevive a su motivo es basura que crece hasta que nadie lee ninguna—.
 */
export async function consultarConteoProductos(
  raw: unknown,
  deps: ConteoProductosDeps = {},
): Promise<ResultadoConteoProductos> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConsultaProductos(raw, actor, now());

  if (preparada.status === "validation_error") {
    // R53 — sin consultar la base y sin auditar: no hay denegado que registrar, y una entrada
    // malformada tampoco puede servir para sondear permisos.
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }

  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, actor, raw);
  }

  const service = deps.service ?? construirServicio(now);
  const datos = await service.consultar(preparada.consulta);
  return { status: "ok", datos };
}

/**
 * Registra el denegado y responde. Punto UNICO de respuesta negativa.
 *
 * `sin_sesion` sale como `unauthenticated` y todo lo demas como `forbidden`: «no sabemos quien
 * eres» se arregla volviendo a entrar y «no puedes» no. El MOTIVO concreto se queda en el log
 * (R9) — al cliente seria una pista sobre el modelo de permisos: sabria si le falta la sesion, si
 * su rol no existe o si la tienda que pidio no es suya.
 *
 * `describirDenegado` es quien sanea la linea: del filtro crudo solo sobreviven las listas de ids
 * del contrato, asi que ni PII ni claves inventadas llegan al canal de auditoria.
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
