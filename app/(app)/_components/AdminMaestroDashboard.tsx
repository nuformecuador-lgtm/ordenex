import { PageHeader } from "@/components/shared/PageHeader";
import { Container } from "@/components/shared/Container";

import { PostulacionesPendientesPanel } from "./PostulacionesPendientesPanel";

/**
 * Dashboard del admin maestro (feature 23, R5). Server Component al estilo de
 * `AdminTiendaDashboard` (feature 26): compone el encabezado (`PageHeader`) y,
 * como unico bloque funcional, el panel de postulaciones pendientes. No obtiene
 * datos sensibles por props; el panel cliente consume las Server Actions de la
 * feature 22 (que autorizan por rol en el backend).
 */
export function AdminMaestroDashboard() {
  return (
    <>
      <PageHeader
        title="Panel maestro"
        description="Postulaciones de mensajeros pendientes"
      />
      <Container>
        <PostulacionesPendientesPanel />
      </Container>
    </>
  );
}
