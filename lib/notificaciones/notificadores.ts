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
import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { INotificacionRepository } from "@/lib/interfaces/repositories/INotificacionRepository";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import {
  emitirCargaMasivaTerminada,
  emitirCierreDiaPorAprobar,
  emitirPostulacionPendiente,
  type CargaMasivaContexto,
  type CierrePorAprobarContexto,
  type PostulacionContexto,
} from "@/lib/notificaciones/emitir";

/**
 * R25: ejecuta el productor y ABSORBE cualquier fallo, dejandolo registrado con el nombre de
 * la operacion. No es un `catch` vacio (docs/conventions.md): el error se loggea con contexto;
 * lo que no se hace es propagarlo al usuario, porque la operacion de negocio ya termino bien.
 */
export async function emitirBestEffort(
  operacion: string,
  emitir: () => Promise<unknown>,
  logger: ErrorLogger = defaultLogger,
): Promise<void> {
  try {
    await emitir();
  } catch (error) {
    logger.logError(new Error(`notificacion "${operacion}" fallo (best-effort)`, { cause: error }));
  }
}

/** Firma del notificador de postulacion pendiente (R23/R25). */
export type PostulacionNotificador = (ctx: PostulacionContexto) => Promise<void>;
/** Firma del notificador de cierre por aprobar (R24/R25). */
export type CierreNotificador = (ctx: CierrePorAprobarContexto) => Promise<void>;
/** Firma del notificador de carga masiva terminada (R22/R25). */
export type CargaMasivaNotificador = (ctx: CargaMasivaContexto) => Promise<void>;

/**
 * DEFAULT de los tres services: no hace nada. Un service construido sin cablear su notificador
 * —tipicamente un doble de test— no toca la base ni emite nada, sin necesidad de husmear el
 * entorno. El composition root es el responsable de inyectar el notificador real.
 */
export const notificadorNoOp: PostulacionNotificador &
  CierreNotificador &
  CargaMasivaNotificador = async () => {};

/**
 * Construye el repositorio real. Aislado en una funcion para que los tests del camino REAL
 * puedan ejercitar `notificar*Con(repoDoble)` sin tocar `getPrismaClient`.
 */
function repoReal(): INotificacionRepository {
  return new NotificacionRepository(getPrismaClient());
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

// Bindings de PRODUCCION. Solo el composition root los importa. Resuelven el repositorio en el
// momento de la emision (no al importar el modulo), para no abrir una conexion por el hecho de
// que alguien importe este archivo.
export const notificarPostulacionPendienteReal: PostulacionNotificador = async (ctx) =>
  notificarPostulacionPendienteCon(repoReal())(ctx);

export const notificarCierreDiaPorAprobarReal: CierreNotificador = async (ctx) =>
  notificarCierreDiaPorAprobarCon(repoReal())(ctx);

export const notificarCargaMasivaTerminadaReal: CargaMasivaNotificador = async (ctx) =>
  notificarCargaMasivaTerminadaCon(repoReal())(ctx);
