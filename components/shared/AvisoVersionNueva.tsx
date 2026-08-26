"use client";

import { useState } from "react";
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
 * ## Tres cosas que se decidieron MIRANDO EL DAÑO, no el diseño (B1 de la revision)
 *
 * 1. **Va ARRIBA, no abajo.** La primera version era `fixed bottom-0` y en el panel del
 *    mensajero caia justo encima de **"Guardar gestion"**: el pulgar apunta a guardar y toca
 *    "Actualizar ahora". Un aviso no puede compartir sitio con la accion principal de la
 *    pantalla, y en esta app las acciones viven abajo.
 * 2. **Se puede quitar.** "Ahora no" lo retira hasta la proxima carga. Sin salida, un aviso
 *    fijo es un obstaculo.
 * 3. **El texto NO promete.** Decia *"Tu trabajo en pantalla no se pierde"* y eso era falso:
 *    la deteccion de trabajo en curso cubre lo que se declara y lo que se ve en el DOM, no
 *    "todo". Ahora dice lo unico que es seguro: que actualizar RECARGA.
 */

export interface AvisoVersionNuevaProps {
  /** Textos por props: el dia que entre i18n, este componente no cambia. */
  titulo?: string;
  descripcion?: string;
  etiquetaBoton?: string;
  etiquetaDescartar?: string;
}

export function AvisoVersionNueva({
  titulo = "Hay una versión nueva de Ordenex",
  descripcion = "Actualizar recarga la pantalla. Hazlo cuando hayas terminado lo que tengas a medias.",
  etiquetaBoton = "Actualizar ahora",
  etiquetaDescartar = "Ahora no",
}: AvisoVersionNuevaProps) {
  const { seAvisa, actualizar } = useActualizacionPwa();
  const [descartado, setDescartado] = useState(false);

  if (!seAvisa || descartado) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      {/* `role="status"` y no el `role="alert"` que trae `Alert` por defecto: no es una urgencia
          que deba interrumpir al lector de pantalla a mitad de frase, es una oferta que puede
          esperar al siguiente hueco. */}
      <Alert
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-md shadow-lg"
      >
        <RefreshCw aria-hidden="true" />
        <AlertTitle>{titulo}</AlertTitle>
        <AlertDescription>{descripcion}</AlertDescription>
        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDescartado(true)}
          >
            {etiquetaDescartar}
          </Button>
          <Button type="button" size="sm" onClick={actualizar}>
            {etiquetaBoton}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
