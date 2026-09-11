// Feature 146 (design §4.5) — NOTIFICADORES BEST-EFFORT de los productores que corren
// FUERA de una transaccion (carga masiva, postulacion y cierre por aprobar).
//
// Por que best-effort y no transaccional: los tres van DESPUES de una operacion de negocio ya
// persistida (una carga de cientos de ordenes, una postulacion con documentos ya subidos a
// Storage, un cierre guardado). Una notificacion perdida no puede invalidar ninguna de esas
// tres (R25). El unico productor transaccional es el del rechazo, que vive DENTRO del `tx`
// del choke point y donde el try/catch ni siquiera es representable (design §4.1).
//
// CABLEADO (importante): el DEFAULT del constructor de los tres services es el notificador
// NO-OP de abajo, y los notificadores REALES se inyectan EXPLICITAMENTE en el composition root
// (las Server Actions y los route handlers que construyen esos services en produccion). No al
// reves. Asi:
//   - una suite que construya un service sin inyectar obtiene el no-op POR CONSTRUCCION, y
//     nunca puede escribir en la base —que en este repo es COMPARTIDA con produccion—;
//   - el camino REAL queda testeable de verdad: se inyecta `notificar*Real` con un repositorio
//     doble y se verifica que emite (ver `notificacion-notificadores-reales.test.ts`).
// Ninguna rama de este archivo depende de `process.env`: apagar una emision segun el entorno
// seria una falla silenciosa en cuanto una variable se filtrara a un preview.
import type { ErrorLogger } from "@/lib/errors";
import { emitirBestEffort } from "@/lib/notificaciones/best-effort";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { INotificacionRepository } from "@/lib/interfaces/repositories/INotificacionRepository";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
// FICHA 410: las cuatro piezas del canal de push. Solo las usa `repoReal()`.
import { conPushWeb } from "@/lib/notificaciones/notificacion-repo-con-push";
import { PushNotificacionReader } from "@/lib/repositories/PushNotificacionReader";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { pushConfigurado } from "@/lib/config/push";
import {
  emitirCargaMasivaTerminada,
  emitirCierreDiaPorAprobar,
  emitirCierreDiaRechazado,
  emitirCierreDiaVencido,
  emitirDevolucionesRepresadas,
  emitirDiaRepartoCorregido,
  emitirGastoFijoCobroPendiente,
  emitirGeocodificacionCaida,
  emitirMensajeroBloqueado,
  emitirNovedadesSinGestionar,
  emitirPostulacionPendiente,
  emitirPostulacionRecursoPendiente,
  emitirWebhookSuscripcionPausada,
  type CargaMasivaContexto,
  type CierrePorAprobarContexto,
  type CierreRechazadoContexto,
  type CierreVencidoContexto,
  type DevolucionesRepresadasContexto,
  type DiaRepartoCorregidoContexto,
  type GastoFijoCobroPendienteContexto,
  type GeocodificacionCaidaContexto,
  type MensajeroBloqueadoContexto,
  type NovedadesSinGestionarContexto,
  type PostulacionContexto,
  type PostulacionRecursoContexto,
  type WebhookSuscripcionPausadaContexto,
} from "@/lib/notificaciones/emitir";

/**
 * R25: la envoltura best-effort. Vive desde la ficha 410 en `lib/notificaciones/best-effort.ts`
 * —el decorador del canal de push la necesita y este archivo importa al decorador, asi que dejarla
 * aqui cerraba un ciclo— y se RE-EXPORTA para que ningun importador cambie.
 */
export { emitirBestEffort };

/** Firma del notificador de postulacion pendiente (R23/R25). */
export type PostulacionNotificador = (ctx: PostulacionContexto) => Promise<void>;
/** Firma del notificador de cierre por aprobar (R24/R25). */
export type CierreNotificador = (ctx: CierrePorAprobarContexto) => Promise<void>;
/** Firma del notificador de carga masiva terminada (R22/R25). */
export type CargaMasivaNotificador = (ctx: CargaMasivaContexto) => Promise<void>;
/** Feature 253 (D6). Firma del notificador de postulacion de vehiculo/bodega pendiente. */
export type PostulacionRecursoNotificador = (ctx: PostulacionRecursoContexto) => Promise<void>;
/** Feature 262 (D7, R46/R49). Firma del notificador de «te corrigieron el dia de una orden». */
export type DiaRepartoCorregidoNotificador = (ctx: DiaRepartoCorregidoContexto) => Promise<void>;
/** Feature 271 (R38/R39). Firma del notificador de «tu cierre del dia vencio». Lo usa el CORTE. */
export type CierreVencidoNotificador = (ctx: CierreVencidoContexto) => Promise<void>;
/** Feature 271 (R40/R41/R42). Firma del notificador de «quedaste bloqueado por cierres». */
export type MensajeroBloqueadoNotificador = (ctx: MensajeroBloqueadoContexto) => Promise<void>;
/**
 * FICHA 412 (R1/R6). Firma del notificador de «tu cierre del dia fue RECHAZADO». Lo usa el RECHAZO
 * del admin (`CierresAdminService`), y es el UNICO aviso del sistema que dice esa palabra: hasta
 * hoy el mensajero leia el mismo texto que por un cierre vencido.
 */
export type CierreRechazadoNotificador = (ctx: CierreRechazadoContexto) => Promise<void>;
/**
 * FICHA 333 (E2, R29/R33/R34). Firma del notificador de «quedan cobros de gasto fijo por
 * aprobar». Lo usa el CRON de gastos fijos, al final de su corrida.
 */
export type GastoFijoCobroPendienteNotificador = (
  ctx: GastoFijoCobroPendienteContexto,
) => Promise<void>;
/**
 * FICHA 403 (R9/R10/R11). Firma del notificador de «un webhook lleva fallando y sus reintentos se
 * espaciaron». Lo usa el DRENADOR DE LA COLA, en cada fallo mientras la suscripcion este pausada.
 */
export type WebhookSuscripcionPausadaNotificador = (
  ctx: WebhookSuscripcionPausadaContexto,
) => Promise<void>;
/**
 * FICHA 401 (R7/R8/R12). Firma del notificador de «el servicio de mapas esta rechazando nuestras
 * peticiones». Lo usa `GeocodeSaludService`, desde la rama de configuracion del job de
 * geocodificacion — es decir, dentro de la corrida del CRON de la cola.
 */
export type GeocodificacionCaidaNotificador = (
  ctx: GeocodificacionCaidaContexto,
) => Promise<void>;
/**
 * FICHA 409 (R35/R62). Firma del notificador de «tienes N novedades sin gestionar». Lo usa el CRON
 * `avisos-diarios`, a las 07:00 CR, UNA VEZ POR TIENDA Y POR DIA.
 */
export type NovedadesSinGestionarNotificador = (
  ctx: NovedadesSinGestionarContexto,
) => Promise<void>;
/**
 * FICHA 409 (R47/R62). Firma del notificador de «N ordenes esperan volver a su tienda». Lo usa el
 * mismo cron, UNA VEZ POR AMBITO (zona o global) Y POR DIA.
 */
export type DevolucionesRepresadasNotificador = (
  ctx: DevolucionesRepresadasContexto,
) => Promise<void>;

/**
 * DEFAULT de los tres services: no hace nada. Un service construido sin cablear su notificador
 * —tipicamente un doble de test— no toca la base ni emite nada, sin necesidad de husmear el
 * entorno. El composition root es el responsable de inyectar el notificador real.
 */
export const notificadorNoOp: PostulacionNotificador &
  CierreNotificador &
  CargaMasivaNotificador &
  PostulacionRecursoNotificador &
  DiaRepartoCorregidoNotificador &
  CierreVencidoNotificador &
  MensajeroBloqueadoNotificador &
  CierreRechazadoNotificador &
  GastoFijoCobroPendienteNotificador &
  WebhookSuscripcionPausadaNotificador &
  GeocodificacionCaidaNotificador &
  NovedadesSinGestionarNotificador &
  DevolucionesRepresadasNotificador = async () => {};

/**
 * Construye el repositorio real. Aislado en una funcion para que los tests del camino REAL
 * puedan ejercitar `notificar*Con(repoDoble)` sin tocar `getPrismaClient`.
 *
 * ⚠️ FICHA 410 (design §6) — ESTA ES LA UNICA LINEA QUE CABLEA EL CANAL DE PUSH, Y ESO ES TODO EL
 * DISEÑO. `conPushWeb` devuelve un `INotificacionRepository` que delega todo y, despues de un
 * `crear` que de verdad inserto, evalua elegibilidad, toma el cupo del dia y encola el trabajo.
 * Como los DOCE `notificar<X>Real` de mas abajo resuelven su repositorio por aqui, los doce quedan
 * cableados de una vez y un productor nuevo lo hereda sin acordarse de nada.
 *
 * NO se inyecta un notificador de push en cada productor (alternativa A1 del design). Ese patron es
 * el que produjo aqui DOS de siete notificadores muertos con la suite entera en verde: cada
 * productor tenia que acordarse, y el que se olvidaba no rompia nada. Aqui hay UN punto de fallo en
 * vez de doce, y ese punto lo vigila `tests/unit/guards/push-cableado-unico.guardia.test.ts`:
 * devolver el repositorio SIN decorar, o escribir un productor que construya el suyo por su cuenta,
 * pone la guardia ROJA (R51).
 *
 * Sin claves VAPID el decorador no encola nada y no lanza (R30): `pushConfigurado()` se evalua en
 * cada `crear`, no al importar, para que rotar o dar de alta las claves no exija reiniciar.
 */
function repoReal(): INotificacionRepository {
  const prisma = getPrismaClient();
  return conPushWeb(new NotificacionRepository(prisma), {
    lector: new PushNotificacionReader(prisma),
    canal: new PushSuscripcionRepository(prisma),
    cola: new JobRepository(prisma),
    hayCanal: pushConfigurado,
  });
}

// ---------------------------------------------------------------------------
// Camino REAL, parametrizado por repositorio (testeable) + su binding a produccion.
// ---------------------------------------------------------------------------

/** R23/R25: emite el aviso de postulacion pendiente contra `repo`, absorbiendo su fallo. */
export function notificarPostulacionPendienteCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): PostulacionNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "postulacion_mensajero_pendiente",
      () => emitirPostulacionPendiente(repo, ctx),
      logger,
    );
  };
}

/** R24/R25: emite el aviso de cierre por aprobar contra `repo`, absorbiendo su fallo. */
export function notificarCierreDiaPorAprobarCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): CierreNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "cierre_dia_por_aprobar",
      () => emitirCierreDiaPorAprobar(repo, ctx),
      logger,
    );
  };
}

/** R22/R25: emite el aviso de carga masiva terminada contra `repo`, absorbiendo su fallo. */
export function notificarCargaMasivaTerminadaCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): CargaMasivaNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "carga_masiva_terminada",
      () => emitirCargaMasivaTerminada(repo, ctx),
      logger,
    );
  };
}

/**
 * Feature 253 (D6)/R25: emite el aviso de postulacion de recurso pendiente contra `repo`,
 * absorbiendo su fallo. BEST-EFFORT y no transaccional, por la misma razon que sus tres hermanos:
 * corre DESPUES de que la fila ya este persistida, y un aviso perdido no puede invalidar una
 * postulacion que la persona ya dio por enviada. Al reves seria mucho peor: que la campana
 * decidiera si se registra o no lo que alguien escribio en la landing.
 */
export function notificarPostulacionRecursoPendienteCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): PostulacionRecursoNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "postulacion_recurso_pendiente",
      () => emitirPostulacionRecursoPendiente(repo, ctx),
      logger,
    );
  };
}

/**
 * Feature 262 (D7)/R49: emite el aviso de «te corrigieron el dia de una orden» contra `repo`,
 * absorbiendo su fallo.
 *
 * BEST-EFFORT Y FUERA DE LA TRANSACCION, y aqui el motivo NO es comodidad (design §15.5, A22):
 * dentro de una transaccion de Postgres un error de sentencia aborta la transaccion ENTERA —lo dice
 * el propio choke point del historial—, asi que un aviso caido REVERTIRIA una correccion legitima y
 * devolveria la orden al estado inalcanzable del que esta ficha existe para sacarla. La direccion
 * segura del error es la contraria: LA CORRECCION MANDA, EL AVISO ES CORTESIA. Un aviso perdido
 * degrada exactamente al comportamiento de antes de la feature —el mensajero se entera porque el
 * boton deja de estar gris—; una correccion revertida deja el paquete atrapado.
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO con
 * la operacion y su causa.
 */
export function notificarDiaRepartoCorregidoCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): DiaRepartoCorregidoNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "dia_reparto_corregido",
      () => emitirDiaRepartoCorregido(repo, ctx),
      logger,
    );
  };
}

/**
 * FEATURE 271 (R38/R39/R47) — emite «tu cierre del dia vencio» contra `repo`, absorbiendo su fallo.
 *
 * BEST-EFFORT Y NO NEGOCIABLE: lo llama el CRON del corte diario, que es money-critical y corre sin
 * nadie mirando. Un aviso caido no puede tumbar la corrida ni dejar un cierre a medias — el corte ya
 * escribio su transaccion cuando esto se ejecuta. La direccion segura del error es esa: EL CORTE
 * MANDA, EL AVISO ES CORTESIA.
 */
export function notificarCierreDiaVencidoCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): CierreVencidoNotificador {
  return async (ctx) => {
    await emitirBestEffort("cierre_dia_vencido", () => emitirCierreDiaVencido(repo, ctx), logger);
  };
}

/** FEATURE 271 (R40/R41/R42/R47): emite «quedaste bloqueado» contra `repo`, absorbiendo su fallo. */
export function notificarMensajeroBloqueadoCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): MensajeroBloqueadoNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "mensajero_bloqueado_por_cierres",
      () => emitirMensajeroBloqueado(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 412 (R1/R4) — emite «tu cierre del dia fue RECHAZADO» contra `repo`, absorbiendo su fallo.
 *
 * BEST-EFFORT Y FUERA DE LA TRANSACCION DEL RECHAZO, y el motivo no es comodidad: en Postgres un
 * error de sentencia aborta la transaccion ENTERA, asi que un aviso caido REVERTIRIA un rechazo
 * legitimo y el admin veria un error por algo que ya ocurrio. EL RECHAZO MANDA, EL AVISO ES
 * CORTESIA (R4).
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO
 * con el nombre de la operacion y su causa.
 *
 * R16: ni el nombre de la operacion ni el contexto llevan el MOTIVO del rechazo -texto libre de un
 * humano, que puede traer un telefono o un monto-, ni guia, ni remision, ni persona.
 */
export function notificarCierreDiaRechazadoCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): CierreRechazadoNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "cierre_dia_rechazado",
      () => emitirCierreDiaRechazado(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 333 (E2, R29/R33) — emite «quedan N cobros de gasto fijo por aprobar» contra `repo`,
 * absorbiendo su fallo.
 *
 * BEST-EFFORT Y FUERA DE LA TRANSACCION, y aqui el motivo no es comodidad: lo llama el CRON de
 * gastos fijos, que es MONEY-CRITICAL y corre a las 00:00 CR sin nadie mirando. Cuando esto se
 * ejecuta, los egresos y los cobros pendientes de la corrida YA estan escritos y commiteados; un
 * aviso caido no puede tumbar la corrida ni dejarlos a medias. La direccion segura del error es
 * esa: LA CORRIDA MANDA, EL AVISO ES CORTESIA (R33).
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO
 * con el nombre de la operacion y su causa.
 */
export function notificarGastoFijoCobroPendienteCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): GastoFijoCobroPendienteNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "gasto_fijo_cobro_pendiente",
      () => emitirGastoFijoCobroPendiente(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 403 (R9/R10/R11) — emite «un webhook lleva fallando y sus reintentos se espaciaron» contra
 * `repo`, absorbiendo su fallo.
 *
 * BEST-EFFORT Y FUERA DE CUALQUIER TRANSACCION, y el motivo no es comodidad: lo llama el DRENADOR
 * DE LA COLA, que procesa un lote de 10 jobs por corrida y corre sin nadie mirando. Cuando esto se
 * ejecuta, la entrega ya fallo y el contador ya esta escrito; un aviso caido no puede tumbar la
 * corrida ni dejar sin procesar los otros nueve jobs del lote. La direccion segura del error es
 * esa: LA CORRIDA MANDA, EL AVISO ES CORTESIA (R11).
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO con
 * el nombre de la operacion y su causa.
 *
 * R13: ni el nombre de la operacion ni el contexto llevan la URL o el secreto — el contexto solo
 * tiene un id de owner y una fecha.
 */
export function notificarWebhookSuscripcionPausadaCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): WebhookSuscripcionPausadaNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "webhook_suscripcion_pausada",
      () => emitirWebhookSuscripcionPausada(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 401 (R7/R8/R11) — emite «el servicio de mapas esta rechazando nuestras peticiones» contra
 * `repo`, absorbiendo su fallo.
 *
 * BEST-EFFORT Y FUERA DE TODA TRANSACCION, y aqui el motivo no es comodidad: lo llama el DRENADOR
 * de la cola, que sirve a nueve tipos de job y corre cada minuto sin nadie mirando. El aviso sale
 * en la rama en la que el job de geocodificacion ya se dio por fallido; un aviso caido no puede
 * cambiar ese desenlace ni tumbar el resto del lote. LA COLA MANDA, EL AVISO ES CORTESIA (R11).
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO
 * con el nombre de la operacion y su causa.
 */
export function notificarGeocodificacionCaidaCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): GeocodificacionCaidaNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "geocodificacion_caida",
      () => emitirGeocodificacionCaida(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 409 (T3.3, R35/R60) — emite «tienes N novedades sin gestionar» contra `repo`, absorbiendo
 * su fallo.
 *
 * BEST-EFFORT Y POR DESTINATARIO, y aqui el motivo no es comodidad: lo llama el CRON
 * `avisos-diarios`, que recorre TODAS las tiendas con novedades y corre a las 07:00 CR sin nadie
 * mirando. Envolver CADA emision es lo que impide que una tienda que falle se lleve por delante a
 * las demas ni tumbe la corrida (R60). LA CORRIDA MANDA, EL AVISO ES CORTESIA.
 *
 * Y no es un `catch` vacio (`docs/conventions.md`): `emitirBestEffort` deja el fallo REGISTRADO
 * con el nombre de la operacion y su causa.
 *
 * R44: ni el nombre de la operacion ni el contexto llevan PII — el contexto solo tiene un id de
 * tienda, un numero de dias, un plazo y una fecha.
 */
export function notificarNovedadesSinGestionarCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): NovedadesSinGestionarNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "novedades_sin_gestionar",
      () => emitirNovedadesSinGestionar(repo, ctx),
      logger,
    );
  };
}

/**
 * FICHA 409 (T3.3, R47/R60) — emite «N ordenes esperan volver a su tienda» contra `repo`,
 * absorbiendo su fallo. Mismo cron, mismo argumento que el de arriba: una zona que falle no puede
 * dejar sin aviso a las demas ni al ambito global.
 *
 * R54: el contexto no lleva PII — un ambito, unos dias y una fecha.
 */
export function notificarDevolucionesRepresadasCon(
  repo: INotificacionRepository,
  logger?: ErrorLogger,
): DevolucionesRepresadasNotificador {
  return async (ctx) => {
    await emitirBestEffort(
      "devoluciones_represadas",
      () => emitirDevolucionesRepresadas(repo, ctx),
      logger,
    );
  };
}

// Bindings de PRODUCCION. Solo el composition root los importa. Resuelven el repositorio en el
// momento de la emision (no al importar el modulo), para no abrir una conexion por el hecho de
// que alguien importe este archivo.
export const notificarPostulacionPendienteReal: PostulacionNotificador = async (ctx) =>
  notificarPostulacionPendienteCon(repoReal())(ctx);

export const notificarCierreDiaPorAprobarReal: CierreNotificador = async (ctx) =>
  notificarCierreDiaPorAprobarCon(repoReal())(ctx);

export const notificarCargaMasivaTerminadaReal: CargaMasivaNotificador = async (ctx) =>
  notificarCargaMasivaTerminadaCon(repoReal())(ctx);

export const notificarPostulacionRecursoPendienteReal: PostulacionRecursoNotificador = async (ctx) =>
  notificarPostulacionRecursoPendienteCon(repoReal())(ctx);

export const notificarDiaRepartoCorregidoReal: DiaRepartoCorregidoNotificador = async (ctx) =>
  notificarDiaRepartoCorregidoCon(repoReal())(ctx);

export const notificarCierreDiaVencidoReal: CierreVencidoNotificador = async (ctx) =>
  notificarCierreDiaVencidoCon(repoReal())(ctx);

export const notificarMensajeroBloqueadoReal: MensajeroBloqueadoNotificador = async (ctx) =>
  notificarMensajeroBloqueadoCon(repoReal())(ctx);

// FICHA 412 (R6/T5.3): resuelve su repositorio por `repoReal()` como sus doce hermanos, asi que
// hereda el cableado UNICO del canal de push (410 §6) sin hacer nada especial. NO construye
// `new NotificacionRepository(...)` por su cuenta: eso pondria roja la guardia de 410/R51.
export const notificarCierreDiaRechazadoReal: CierreRechazadoNotificador = async (ctx) =>
  notificarCierreDiaRechazadoCon(repoReal())(ctx);

export const notificarGastoFijoCobroPendienteReal: GastoFijoCobroPendienteNotificador = async (
  ctx,
) => notificarGastoFijoCobroPendienteCon(repoReal())(ctx);

export const notificarWebhookSuscripcionPausadaReal: WebhookSuscripcionPausadaNotificador = async (
  ctx,
) => notificarWebhookSuscripcionPausadaCon(repoReal())(ctx);

export const notificarGeocodificacionCaidaReal: GeocodificacionCaidaNotificador = async (ctx) =>
  notificarGeocodificacionCaidaCon(repoReal())(ctx);

export const notificarNovedadesSinGestionarReal: NovedadesSinGestionarNotificador = async (ctx) =>
  notificarNovedadesSinGestionarCon(repoReal())(ctx);

export const notificarDevolucionesRepresadasReal: DevolucionesRepresadasNotificador = async (ctx) =>
  notificarDevolucionesRepresadasCon(repoReal())(ctx);
