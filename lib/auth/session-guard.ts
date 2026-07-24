import { getPrismaClient } from "@/lib/db/prisma-client";
import { SessionRepository } from "@/lib/repositories/SessionRepository";

/**
 * Comprueba que un id de sesion corresponde a una sesion REAL y utilizable.
 * Pensado para el middleware, que hasta la feature 78 solo miraba que la cookie
 * `session` existiera: cualquiera con `document.cookie = "session=x"` pasaba el
 * guard.
 *
 * "Utilizable" son dos condiciones, no una:
 *  1. la sesion existe en la DB y no expiro (`findValidById`, R23a feature 6);
 *  2. el usuario dueno sigue en estado `activo`.
 *
 * El punto 2 no es redundante: `AuthService.login` ya exige `activo` para EMITIR
 * la sesion (R13), pero un usuario desactivado/bloqueado DESPUES del login se
 * quedaba dentro hasta que su sesion expirara. Revalidar aqui lo saca en el
 * siguiente request.
 *
 * Devuelve un booleano a proposito: el middleware solo decide pasar o no. Quien
 * necesite el rol usa `resolveActorFromSession()`.
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const session = await new SessionRepository(prisma).findValidById(sessionId);
  if (!session) return false;

  const usuario = await prisma.usuario.findUnique({
    where: { id: session.userId },
    select: { estado: true },
  });

  return usuario?.estado === "activo";
}
