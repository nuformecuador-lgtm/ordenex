import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";

import { RecogerModule } from "../_components/RecogerModule";

/**
 * Pantalla POR RECOGER del rol `mensajero` (2026-07-31, decisión del humano): la otra
 * mitad del portal, sacada de `/mis-asignaciones` para que el escáner deje de quedar
 * enterrado bajo el panel de reparto. Monta el escáner/input de recogida y el listado de
 * las órdenes en `por_recoger`, con el mismo buscador de guías que Reparto.
 *
 * Lee la MISMA action que Reparto (`listarMisAsignaciones`) y se queda solo con
 * `porRecoger`: no hay contrato nuevo ni un segundo origen de verdad que pueda divergir.
 * Gate de rol server-side idéntico (R9/R12): la defensa real es este `notFound`.
 */
export default async function RecogerPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "mensajero") notFound(); // R9/R12

  const result = await listarMisAsignaciones();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // Feature 111/R12/R14: con el mensajero BLOQUEADO el módulo muestra el aviso y oculta
  // los controles de recogida (defensa suave; el backend R1/R4 rechaza igual). El listado
  // sigue visible en solo-visualización.
  const bloqueo = await estadoBloqueoMensajero();
  const bloqueado = bloqueo.status === "ok" && bloqueo.bloqueado;

  return (
    <AppPage
      title="Por recoger"
      description="Órdenes asignadas pendientes de recoger"
    >
      <RecogerModule porRecoger={result.porRecoger} bloqueado={bloqueado} />
    </AppPage>
  );
}
