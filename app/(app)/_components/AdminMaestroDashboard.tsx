import { AppPage } from "@/components/shared/AppPage";
import { ContenedorSeccion } from "@/components/shared/ContenedorSeccion";

import { PostulacionesPendientesPanel } from "./PostulacionesPendientesPanel";

/**
 * Dashboard del admin maestro (feature 23, R5). Server Component al estilo de
 * `AdminTiendaDashboard` (feature 26): compone el shell (`AppPage`) y, como
 * unico bloque funcional, el panel de postulaciones pendientes. No obtiene
 * datos sensibles por props; el panel cliente consume las Server Actions de la
 * feature 22 (que autorizan por rol en el backend).
 *
 * Encima de ese panel va el contenedor «Entregas». Es presentacion pura: no pinta cuerpo
 * mientras no reciba hijos, asi que hoy solo aporta su encabezado.
 *
 * La BARRA DE FILTROS de entregas NO vive aqui (pedido humano del 2026-08-17): su sitio es
 * la pagina de analitica. Este componente vuelve a no tener mas bloque funcional que el
 * panel de postulaciones.
 */
const TITULO_ENTREGAS = "Entregas";

export function AdminMaestroDashboard() {
  return (
    <AppPage
      title="Panel maestro"
      description="Postulaciones de mensajeros pendientes"
    >
      <ContenedorSeccion titulo={TITULO_ENTREGAS} />
      <PostulacionesPendientesPanel />
    </AppPage>
  );
}
