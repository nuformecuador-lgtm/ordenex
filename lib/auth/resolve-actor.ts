import { cookies } from "next/headers";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * Resuelve el actor autenticado desde la cookie de sesion (R18/R19 feature 6,
 * R10 feature 15): valida la sesion y resuelve el rol (RolValue) del usuario.
 * Devuelve null si no hay sesion valida. Compartido entre la Server Action de
 * ordenes (`lib/actions/ordenes.ts`) y el Route Handler de carga masiva
 * (`app/api/ordenes/carga-masiva/route.ts`), sin duplicar la lectura de
 * cookie/sesion (feature 15/T17).
 */
export async function resolveActorFromSession(): Promise<Actor | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const prisma = getPrismaClient();
  const session = await new SessionRepository(prisma).findValidById(sessionId);
  if (!session) return null;

  const usuario = await prisma.usuario.findUnique({
    where: { id: session.userId },
    include: { rol: true },
  });
  if (!usuario) return null;

  return { usuarioId: usuario.id, rol: usuario.rol.value };
}
