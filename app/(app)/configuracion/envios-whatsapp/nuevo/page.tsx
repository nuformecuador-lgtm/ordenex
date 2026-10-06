import Link from "next/link";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { EnvioForm } from "../_components/EnvioForm";
import { cargarDatosFormulario } from "../_components/cargar-formulario";

/**
 * Ficha 474 (T10.3, R1, R11, R15) — crear un envío. Solo `maestro`; nace APAGADO (lo dice la
 * insignia «Se guarda apagado» del formulario, como la maqueta).
 */
export default async function NuevoEnvioWhatsappPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Nuevo envío">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }
  const datos = await cargarDatosFormulario();
  return (
    <AppPage title="Nuevo envío" description="Envíos automáticos › Nuevo">
      <Link
        href="/configuracion/envios-whatsapp"
        className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline"
      >
        ← Volver a envíos automáticos
      </Link>
      <EnvioForm envio={null} {...datos} />
    </AppPage>
  );
}
