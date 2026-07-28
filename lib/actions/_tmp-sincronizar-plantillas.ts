"use server";

// ============================================================================
// ⚠️  ARCHIVO TEMPORAL DE PRUEBA — BORRAR ANTES DE MERGEAR A `dev`  ⚠️
// ============================================================================
//
// QUE ES: un atajo para disparar A MANO la sincronizacion de plantillas de
// WhatsApp (Meta -> local) desde la UI del mensajero, sin esperar al Vercel
// Cron de 24 h ni armar un `curl` con el `CRON_SECRET`. Solo para verificar.
//
// COMO BORRARLO (3 pasos, ninguno deja rastro):
//   1. borrar este archivo;
//   2. borrar `app/(app)/mis-asignaciones/_components/_TmpSincronizarPlantillasButton.tsx`;
//   3. quitar el bloque marcado `TEMPORAL` de `app/(app)/mis-asignaciones/page.tsx`.
// Un `grep -r "_tmp-sincronizar-plantillas\|_TmpSincronizarPlantillas"` debe
// quedar VACIO despues de borrarlo.
//
// NO es parte de ninguna feature ni spec, NO tiene requisito asociado, NO tiene
// tests y NO debe ganarlos.
//
// NOTA DE SEGURIDAD: reusa `handleSyncPlantillas`, el MISMO handler del cron, y
// le inyecta el secreto por `getSecret` (token local que solo se compara consigo
// mismo). El `CRON_SECRET` real NUNCA se lee aqui ni viaja al cliente. Exige
// sesion activa.
// ============================================================================

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { handleSyncPlantillas } from "@/app/api/cron/sync-plantillas-whatsapp/route";

export interface SincronizarPlantillasResultado {
  ok: boolean;
  mensaje: string;
  conteos?: unknown;
}

export async function probarSincronizarPlantillas(): Promise<SincronizarPlantillasResultado> {
  const actor = await resolveActorFromSession();
  if (!actor) return { ok: false, mensaje: "Sesión requerida." };

  // Token ficticio: se inyecta como "esperado" y como "provisto", asi la
  // comparacion de `handleSyncPlantillas` pasa sin tocar el `CRON_SECRET` real.
  const token = "tmp-local-sync-plantillas";
  const req = new Request("http://local/tmp/sync-plantillas-whatsapp", {
    headers: { authorization: `Bearer ${token}` },
  });

  const res = await handleSyncPlantillas(req, { getSecret: () => token });
  const body: unknown = await res.json();

  if (res.status !== 200) {
    return { ok: false, mensaje: `La sincronizacion respondio ${res.status}.`, conteos: body };
  }
  return { ok: true, mensaje: "Sincronización ejecutada.", conteos: body };
}
