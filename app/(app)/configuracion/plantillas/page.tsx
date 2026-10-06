import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarPlantillas } from "@/lib/actions/plantillas";
import { listarInformesWhatsapp } from "@/lib/actions/envios-whatsapp";
import { plantillasConfig } from "@/lib/config/plantillas";

import {
  PlantillasModule,
  type PlantillasPageData,
} from "./_components/PlantillasModule";

/**
 * Página de plantillas de mensaje (Server Component, feature 107). Autoriza
 * server-side igual que `/configuracion/api`: SOLO el rol `maestro` (R3);
 * cualquier otro rol o sesión ausente NO renderiza el módulo, solo un aviso de
 * sin permiso. Pre-carga en el servidor la primera página del listado y la pasa
 * al módulo cliente como `initialData`; si la pre-carga no es `ok`, cae a un
 * listado vacío en vez de fallar.
 */
export default async function PlantillasPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Plantillas">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }

  // Ficha 474 (T10.1): el catálogo de informes viaja por la action, no por import (arrastra jspdf).
  const [res, inf] = await Promise.all([
    listarPlantillas({
      page: 1,
      pageSize: plantillasConfig.DEFAULT_PAGE_SIZE,
    }),
    listarInformesWhatsapp(),
  ]);
  const informes =
    inf.status === "ok"
      ? inf.informes.map((i) => ({
          clave: i.clave,
          nombre: i.nombre,
          generaDocumento: i.generaDocumento,
          variables: i.variables,
        }))
      : [];

  const data: PlantillasPageData =
    res.status === "ok"
      ? { items: res.items, total: res.total, pageSize: res.pageSize }
      : { items: [], total: 0, pageSize: plantillasConfig.DEFAULT_PAGE_SIZE };

  return (
    <AppPage
      title="Plantillas"
      description="Plantillas de mensaje con campos variables"
    >
      <PlantillasModule initialData={data} informes={informes} />
    </AppPage>
  );
}
