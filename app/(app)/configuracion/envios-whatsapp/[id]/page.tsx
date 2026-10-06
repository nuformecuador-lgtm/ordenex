import Link from "next/link";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerEnvio } from "@/lib/actions/envios-whatsapp";

import { EnvioForm } from "../_components/EnvioForm";
import { cargarDatosFormulario } from "../_components/cargar-formulario";

/**
 * Ficha 474 (T10.3, R1, R11, R18–R21, R39) — editar un envío. Solo `maestro`. Un id que no existe
 * (o ya borrado) responde «no encontrado».
 */
export default async function EditarEnvioWhatsappPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Editar envío">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }
  const { id } = await params;
  const [r, datos] = await Promise.all([obtenerEnvio(id), cargarDatosFormulario()]);
  if (r.status !== "ok") notFound();
  return (
    <AppPage title={r.envio.nombre} description="Envíos automáticos › Editar">
      <Link
        href="/configuracion/envios-whatsapp"
        className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline"
      >
        ← Volver a envíos automáticos
      </Link>
      <EnvioForm envio={r.envio} {...datos} />
    </AppPage>
  );
}
