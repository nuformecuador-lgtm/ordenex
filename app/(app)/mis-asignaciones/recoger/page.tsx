import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

import { RecogerModule } from "../_components/RecogerModule";
import { ChatDelMensajero } from "../_components/chat/ChatDelMensajero";

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

  // Feature 111/R12/R14 -> FEATURE 271: el DETALLE del bloqueo, derivado server-side por la
  // regla N/V. Con el mensajero BLOQUEADO el módulo muestra el aviso —que dice cuántos cierres
  // arrastra y cuál toca primero— y oculta los controles de recogida (defensa suave; el backend
  // R25 rechaza igual). El listado sigue visible en solo-visualización. Si la acción degrada,
  // baja `SIN_BLOQUEO`: un fallo de lectura no deja al mensajero sin trabajar.
  const estado = await estadoBloqueoMensajero();
  const bloqueo = estado.status === "ok" ? estado.bloqueo : SIN_BLOQUEO;

  return (
    <AppPage
      title="Por recoger"
      description="Órdenes asignadas pendientes de recoger"
    >
      <RecogerModule porRecoger={result.porRecoger} bloqueo={bloqueo} />
      {/* ⭑ FICHA 430 (SF-001, punto 3) — EL CHAT, TAMBIÉN AQUÍ.
          Ésta es la pantalla donde vive lo que acaban de asignarle: cuando le llega un lote a las
          ocho de la noche, el mensajero tiene CERO órdenes en Reparto —esa pantalla es la de los
          paquetes que ya lleva encima— y entra por aquí. Dejar el chat sólo allí lo habría abierto
          justo donde nadie lo iba a buscar.
          Va junto al módulo y no dentro, igual que `KpisMensajero` en Reparto: `RecogerModule` es
          la pantalla de recoger y no tiene por qué saber del chat. Y recibe las TRES listas —no
          sólo `porRecoger`— porque la lista de contactos es UNA sola para las dos pantallas: si
          aquí faltaran las que ya lleva encima, el distintivo de sin leer diría un número distinto
          en cada una y cada pantalla escondería los pendientes de la otra.
          ⛔ No añade ninguna acción sobre la orden: desde aquí se conversa, no se recoge. */}
      <ChatDelMensajero
        porGestionar={result.porGestionar}
        conAyuda={result.conAyuda}
        porRecoger={result.porRecoger}
      />
    </AppPage>
  );
}
