import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarEnvios } from "@/lib/actions/envios-whatsapp";

import { EnviosModule } from "./_components/EnviosModule";

const TITULO_ENVIOS = "Envíos automáticos";
const SIN_PERMISO_ENVIOS = "No tienes permiso para acceder a esta sección.";

/**
 * Ficha 474 (T10.3, R1) — `/configuracion/envios-whatsapp`: la lista de envíos automáticos por
 * WhatsApp. Server Component: el rol se resuelve SOLO en el servidor, como Plantillas (D1). Otro rol
 * o sin sesión → el aviso de «sin permiso» en lugar del módulo, y no se lee nada de envíos.
 *
 * Sin `actions` en el header: ahí el botón quedaba en la barra superior global, junto a fecha/tema/
 * Salir. «+ Nuevo envío» vive en la barra del propio módulo, como el botón de crear del resto de
 * Configuración, y con la lista vacía no aparece (allí manda «+ Crear el primero»).
 */
export default async function EnviosWhatsappPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "maestro") {
    return (
      <AppPage title={TITULO_ENVIOS}>
        <p role="alert" className="text-sm text-muted-foreground">
          {SIN_PERMISO_ENVIOS}
        </p>
      </AppPage>
    );
  }

  const r = await listarEnvios();
  return (
    <AppPage
      title={TITULO_ENVIOS}
      description="Mensajes de WhatsApp que Ordenex manda solo, a una hora fija o cuando pasa algo"    >
      <EnviosModule initialItems={r.status === "ok" ? r.items : []} />
    </AppPage>
  );
}
