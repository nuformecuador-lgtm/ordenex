"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useInstalarPwa } from "@/hooks/useInstalarPwa";

// Feature 164 — boton de instalar la PWA. Se pinta SOLO cuando el navegador ha ofrecido
// instalar: si ya esta instalada, si no cumple los criterios o si el navegador no soporta el
// evento (Safari, Firefox), no hay boton. Nunca un boton que no lleva a ninguna parte.

export interface InstalarPwaButtonProps {
  /** Oculta el texto y deja solo el icono. Útil en cabeceras estrechas. */
  soloIcono?: boolean;
  className?: string;
}

export function InstalarPwaButton({
  soloIcono = false,
  className,
}: InstalarPwaButtonProps) {
  const { disponible, instalar } = useInstalarPwa();

  if (!disponible) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size={soloIcono ? "icon" : "sm"}
      onClick={() => void instalar()}
      // El nombre accesible va SIEMPRE completo, tambien en la variante de solo icono.
      aria-label="Instalar la aplicación"
      className={className}
    >
      <Download aria-hidden="true" />
      {soloIcono ? null : "Instalar"}
    </Button>
  );
}
