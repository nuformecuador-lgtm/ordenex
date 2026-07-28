"use server";

// ============================================================================
// ⚠️  ARCHIVO TEMPORAL DE PRUEBA — BORRAR ANTES DE MERGEAR A `dev`  ⚠️
// ============================================================================
//
// QUE ES: un atajo para disparar A MANO el drenador de la cola de jobs
// (feature 90) desde la UI, sin esperar al Vercel Cron ni armar un `curl` con
// el `CRON_SECRET`. Existe SOLO para verificar en local que la cola funciona.
//
// POR QUE EXISTE: en produccion el unico disparador es el Vercel Cron cada
// minuto (`* * * * *`). En local no hay cron, y llamar al endpoint por HTTP es
// incomodo porque exige el header `Authorization: Bearer <CRON_SECRET>`.
//
// COMO BORRARLO (3 pasos, ninguno deja rastro):
//   1. borrar este archivo;
//   2. borrar `app/(app)/ordenes/_components/_TmpProbarJobsButton.tsx`;
//   3. quitar el bloque marcado `TEMPORAL` de `app/(app)/ordenes/page.tsx`.
// Nada mas del repo lo referencia: un `grep -r "_tmp-probar-jobs\|_TmpProbar"`
// debe quedar VACIO despues de borrarlo.
//
// QUE NO ES: no es parte de la feature 90 ni de su spec, no tiene requisito
// asociado, no tiene tests y NO debe ganarlos. Si esto sobrevive a la rama de
// pruebas, es un bug de bookkeeping, no una funcionalidad.
//
// NOTA DE SEGURIDAD: reusa `handleProcesarJobs`, el MISMO handler del cron, y
// le inyecta el secreto por `getSecret` en vez de leerlo del entorno. El
// `CRON_SECRET` real NUNCA se envia al cliente ni se lee aqui: el token que se
// pasa es un valor local que solo compara consigo mismo. Aun asi, la action
// exige rol `maestro`, igual que las demas acciones de `/ordenes`.
// ============================================================================

import { RolValue } from "@prisma/client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { handleProcesarJobs } from "@/app/api/cron/procesar-jobs/route";

export interface ProbarJobsResultado {
  ok: boolean;
  mensaje: string;
  conteos?: unknown;
}

export async function probarDrenarJobs(): Promise<ProbarJobsResultado> {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== RolValue.maestro) {
    return { ok: false, mensaje: "Solo el maestro puede disparar la cola." };
  }

  // Token ficticio: se inyecta como "esperado" y como "provisto", asi la
  // comparacion de `handleProcesarJobs` pasa sin tocar el `CRON_SECRET` real.
  const token = "tmp-local-probar-jobs";
  const req = new Request("http://local/tmp/procesar-jobs", {
    headers: { authorization: `Bearer ${token}` },
  });

  const res = await handleProcesarJobs(req, { getSecret: () => token });
  const body: unknown = await res.json();

  if (res.status !== 200) {
    return { ok: false, mensaje: `El drenador respondio ${res.status}.`, conteos: body };
  }
  return { ok: true, mensaje: "Cola drenada.", conteos: body };
}
