// Feature 146 (design §4.5) — LA ENVOLTURA BEST-EFFORT de los avisos.
//
// ⚠️ POR QUE VIVE EN SU PROPIO ARCHIVO DESDE LA FICHA 410, y no dentro de `notificadores.ts` donde
// nacio: el decorador del canal de push (`notificacion-repo-con-push.ts`) la necesita, y
// `notificadores.ts` importa al decorador para cablearlo en `repoReal()`. Dejarla alli cerraba un
// ciclo de imports entre los dos modulos. `notificadores.ts` la RE-EXPORTA, asi que los veinte y
// pico importadores que ya existian no cambian ni una linea.
import { defaultLogger, type ErrorLogger } from "@/lib/errors";

/**
 * R25: ejecuta el productor y ABSORBE cualquier fallo, dejandolo registrado con el nombre de la
 * operacion. No es un `catch` vacio (`docs/conventions.md`): el error se loggea con contexto; lo
 * que no se hace es propagarlo al usuario, porque la operacion de negocio ya termino bien.
 *
 * Devuelve `void` a proposito: quien necesite CONTAR los fallos tiene que marcarlos por su cuenta
 * (lo hace `AvisosDiariosService`), porque un valor de retorno invitaria a ramificar sobre el y a
 * convertir un aviso perdido en una decision de negocio, que es justo lo contrario de esto.
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
