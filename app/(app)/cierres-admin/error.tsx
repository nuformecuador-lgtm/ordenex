"use client";

import { AppPage } from "@/components/shared/AppPage";
import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Feature 365 — LA RED DE LA PANTALLA DONDE SE MUEVE EL DINERO.
 *
 * Es la UNICA seccion con frontera propia, y no por importancia simbolica: es la unica donde el
 * consejo por defecto —«probá de nuevo»— NO es evidentemente inocuo.
 *
 * ── EL HECHO QUE OBLIGA A CAMBIAR EL TEXTO
 * Esta pantalla aprueba y rechaza cierres. Sus acciones ya capturan su propio error y avisan por
 * `toast` (`CierresAdminModule`), asi que un fallo de la accion NO llega aqui. Lo que SI llega es
 * un fallo al RENDERIZAR, y el render se dispara tambien con el `router.refresh()` que va
 * DESPUES de una aprobacion correcta. O sea: esta pantalla puede aparecer con el cierre ya
 * resuelto.
 *
 * Por eso aqui NO se escribe «no se guardo nada»: seria exactamente el tipo de tranquilizante
 * que esta ficha viene a prohibir —una afirmacion comoda que no podemos sostener—. Se dice lo
 * que si es cierto y es accionable: antes de repetir, mirá como quedo. Y el boton de reintentar
 * es justo lo que permite mirarlo, porque recarga los cierres del servidor.
 *
 * El resto de secciones no necesita esto: en un listado, repetir la carga no puede duplicar nada.
 */
export default function ErrorDeCierres({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppPage
      title="No pudimos cargar los cierres"
      description="Falló al preparar la pantalla de cierres del día."
    >
      <ErrorState
        error={error}
        reset={reset}
        titulo="Antes de repetir una aprobación, mirá cómo quedó"
        descripcion="El fallo ocurrió al mostrar la pantalla, y eso también puede pasar justo después de guardar. Volvé a cargar los cierres y revisá el estado del que estabas resolviendo antes de aprobarlo o rechazarlo otra vez."
        etiquetaReintentar="Volver a cargar los cierres"
      />
    </AppPage>
  );
}
