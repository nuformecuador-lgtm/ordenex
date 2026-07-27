// Feature 146 (design §4.5) — NOTIFICADORES BEST-EFFORT de los productores que corren
// FUERA de una transaccion (carga masiva, postulacion y cierre por aprobar).
//
// Por que best-effort y no transaccional: los tres van DESPUES de una operacion de negocio ya
// persistida (una carga de cientos de ordenes, una postulacion con documentos ya subidos a
// Storage, un cierre guardado). Una notificacion perdida no puede invalidar ninguna de esas
// tres (R25). El unico productor transaccional es el del rechazo, que vive DENTRO del `tx`
// del choke point y donde el try/catch ni siquiera es representable (design §4.1).
import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import { getPrismaClient } from "@/lib/db/prisma-client";
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

/**
 * GUARDA DE SEGURIDAD DE TESTS. Los tres notificadores son el DEFAULT del constructor de sus
 * services (`PostulacionMensajeroService`, `CierreDiaService`, `BulkOrdenService`), y las
 * suites unitarias existentes los construyen SIN inyectar nada. Sin esta guarda, un `pnpm test`
 * ejecutado con `DATABASE_URL` en el entorno escribiria notificaciones reales en la base, que
 * en este repo es COMPARTIDA con produccion. Los tests de esta feature inyectan su propio
 * notificador, asi que la guarda no oculta ningun comportamiento bajo prueba.
 */
function enTest(): boolean {
  return process.env.VITEST !== undefined || process.env.NODE_ENV === "test";
}

function repoReal(): NotificacionRepository {
  return new NotificacionRepository(getPrismaClient());
}

/** Firma del notificador de postulacion pendiente, inyectable en el service (R23/R25). */
export type PostulacionNotificador = (ctx: PostulacionContexto) => Promise<void>;

export const notificarPostulacionPendienteReal: PostulacionNotificador = async (ctx) => {
  if (enTest()) return;
  await emitirBestEffort("postulacion_mensajero_pendiente", () =>
    emitirPostulacionPendiente(repoReal(), ctx),
  );
};

/** Firma del notificador de cierre por aprobar, inyectable en el service (R24/R25). */
export type CierreNotificador = (ctx: CierrePorAprobarContexto) => Promise<void>;

export const notificarCierreDiaPorAprobarReal: CierreNotificador = async (ctx) => {
  if (enTest()) return;
  await emitirBestEffort("cierre_dia_por_aprobar", () =>
    emitirCierreDiaPorAprobar(repoReal(), ctx),
  );
};

/** Firma del notificador de carga masiva terminada, inyectable en el service (R22/R25). */
export type CargaMasivaNotificador = (ctx: CargaMasivaContexto) => Promise<void>;

export const notificarCargaMasivaTerminadaReal: CargaMasivaNotificador = async (ctx) => {
  if (enTest()) return;
  await emitirBestEffort("carga_masiva_terminada", () =>
    emitirCargaMasivaTerminada(repoReal(), ctx),
  );
};
