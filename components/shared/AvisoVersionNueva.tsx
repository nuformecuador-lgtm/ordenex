"use client";

import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActualizacionPwa } from "@/hooks/useActualizacionPwa";

/**
 * Feature 284 — aviso de "hay una version nueva", con boton.
 *
 * Decision del humano (2026-08-25), en contra de lo que proponia el spec: el service worker
 * nuevo NO toma el control solo; el usuario ve este aviso y decide cuando recargar.
 *
 * Y de esa decision cuelga la parte delicada, que vive en `useActualizacionPwa`: la recarga
 * NO puede llevarse una gestion a medio hacer. Por eso el aviso ni siquiera se pinta mientras
 * haya trabajo en curso -- un formulario empezado, un dialogo abierto, el escaner con la
 * camara encendida--: espera, y aparece cuando el usuario termina.
 *
 * `role="status"` y no el `role="alert"` que trae `Alert` por defecto: no es una urgencia que
 * deba interrumpir al lector de pantalla a mitad de frase, es una oferta que puede esperar al
 * siguiente hueco.
 */

export interface AvisoVersionNuevaProps {
  /** Textos por props: el dia que entre i18n, este componente no cambia. */
  titulo?: string;
  descripcion?: string;
  etiquetaBoton?: string;
}

export function AvisoVersionNueva({
  titulo = "Hay una versión nueva de Ordenex",
  descripcion = "Recarga cuando quieras para usarla. Tu trabajo en pantalla no se pierde: el aviso solo aparece cuando no tienes nada a medias.",
  etiquetaBoton = "Actualizar ahora",
}: AvisoVersionNuevaProps) {
  const { seAvisa, actualizar } = useActualizacionPwa();

  if (!seAvisa) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <Alert
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-md shadow-lg"
      >
        <RefreshCw aria-hidden="true" />
        <AlertTitle>{titulo}</AlertTitle>
        <AlertDescription>{descripcion}</AlertDescription>
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" onClick={actualizar}>
            {etiquetaBoton}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
