import { AppPage } from "@/components/shared/AppPage";

import { PostulacionesPendientesPanel } from "./PostulacionesPendientesPanel";

/**
 * Dashboard del admin maestro (feature 23, R5). Server Component al estilo de
 * `AdminTiendaDashboard` (feature 26): compone el shell (`AppPage`) y, como
 * unico bloque funcional, el panel de postulaciones pendientes. No obtiene
 * datos sensibles por props; el panel cliente consume las Server Actions de la
 * feature 22 (que autorizan por rol en el backend).
 *
 * NADA de entregas vive aqui. La barra de filtros se fue a la pagina de analitica (pedido
 * humano del 2026-08-17) y el encabezado «Entregas» que quedaba encima del panel —un
 * contenedor sin cuerpo, solo titulo— se retiro por pedido humano del 2026-08-20.
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
