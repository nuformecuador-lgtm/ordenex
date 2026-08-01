import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  listarIncidentes,
  listarHistoricoIncidentesPaginado,
} from "@/lib/actions/incidentes";

import { IncidentesAdminModule } from "./_components/IncidentesAdminModule";

/**
 * Feature 158 (T2.8, Q-I — camino del ADMIN): PÁGINA PROPIA de la cola de incidentes. La
 * decisión del humano fue página aparte y no una sección dentro de «Cierres», porque un
 * incidente no es un cierre y mezclarlos obligaría a que la pantalla de cierres cargue una
 * entidad ajena. Precedente de forma: `cierres-admin` (38).
 *
 * El rol se resuelve SOLO server-side (`resolveActorFromSession`, patrón 33/36/37/38):
 * cualquier rol distinto de acceso total (`maestro`/`admin`) o `adminSatelite` —o sin sesión—
 * NO ve el módulo (`notFound`). La entrada del menú (`lib/auth/menu-visibility.ts`) sólo decide
 * qué se MUESTRA; la defensa real es este `notFound` más el alcance server-side del service
 * (R48), que además acota por zona al `adminSatelite`.
 *
 * Los datos sensibles se pre-fetch AQUÍ y bajan por props al módulo cliente
 * (`docs/architecture.md`: el padre valida permisos, el hijo no fetchea).
 */
export default async function IncidentesPage() {
  const actor = await resolveActorFromSession();
  if (!actor || (!esAccesoTotal(actor.rol) && actor.rol !== "adminSatelite")) {
    notFound(); // R48
  }

  // Feature 170 — FASE 2 (T I.2, R40): el listado compuesto sigue trayendo la cola, el aviso
  // de «sin zona» y el alcance; el HISTÓRICO llega como PÁGINA 1 y su total (R41), no como
  // array entero. El input va vacío: los defaults los pone el schema del dominio.
  const [result, historicoResult] = await Promise.all([
    listarIncidentes(),
    listarHistoricoIncidentesPaginado({}),
  ]);
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo
  if (historicoResult.status !== "ok") notFound(); // defensa en profundidad

  return (
    <AppPage
      title="Incidentes"
      description="Revisá los paquetes reportados como dañados, perdidos o robados y decidí si se indemnizan"
    >
      <IncidentesAdminModule
        pendientes={result.pendientes}
        historico={{
          items: historicoResult.items,
          total: historicoResult.total,
          pageSize: historicoResult.pageSize,
        }}
        sinZona={result.sinZona}
      />
    </AppPage>
  );
}
