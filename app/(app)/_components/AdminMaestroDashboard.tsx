import { AppPage } from "@/components/shared/AppPage";

import { PostulacionesPendientesPanel } from "./PostulacionesPendientesPanel";

/**
 * Dashboard del admin maestro (feature 23, R5). Server Component al estilo de
 * `AdminTiendaDashboard` (feature 26): compone el shell (`AppPage`) y, como
 * unico bloque funcional, el panel de postulaciones pendientes. No obtiene
 * datos sensibles por props; el panel cliente consume las Server Actions de la
 * feature 22 (que autorizan por rol en el backend).
 *
 * Aqui NO hay nada de entregas, y es a proposito: la BARRA DE FILTROS de entregas se movio
 * a la pagina de analitica por pedido humano del 2026-08-17, que es su sitio. Fuera del
 * shell, este dashboard no pinta mas que el panel de postulaciones.
 */
export function AdminMaestroDashboard() {
  return (
    <AppPage
      title="Panel maestro"
      description="Postulaciones de mensajeros pendientes"
    >
      <PostulacionesPendientesPanel />
    </AppPage>
  );
}
