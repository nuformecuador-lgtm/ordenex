"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// El receptor de paquetes es una TARJETA alta (cámara + número de guía): desplegada
// encima de la tabla se comería la pantalla, así que vive plegada tras su disparador.
//
// El panel se MONTA y DESMONTA con la animación (no queda oculto por CSS) a propósito:
// mientras está dentro vive `QrScanner`, y dejarlo montado significaría la cámara
// encendida detrás de un panel invisible. Base UI mantiene el panel hasta que termina
// la animación de salida, así que se puede cerrar con animación y aun así apagar la
// cámara al final.

export interface ReceptorDesplegableProps {
  /** Texto del disparador plegado. */
  label?: string;
  /** Texto del disparador desplegado. */
  labelAbierto?: string;
  /** Acciones que acompañan al disparador, alineadas al lado contrario. */
  acciones?: ReactNode;
  /** El receptor propiamente dicho. */
  children: ReactNode;
  className?: string;
}

export function ReceptorDesplegable({
  label = "Recibir paquete",
  labelAbierto = "Ocultar receptor",
  acciones,
  children,
  className,
}: Readonly<ReceptorDesplegableProps>) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Collapsible
      open={abierto}
      onOpenChange={setAbierto}
      className={cn("group/receptor w-full", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CollapsibleTrigger
          render={<Button type="button" variant="outline" />}
        >
          <ScanLine aria-hidden="true" />
          {/* El texto se decide en JS, no ocultando uno de dos: asi el nombre
              accesible del boton es siempre exactamente el que se lee. */}
          {abierto ? labelAbierto : label}
          <ChevronDown
            aria-hidden="true"
            className="transition-transform duration-200 group-data-[open]/receptor:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        {acciones ? <div className="ms-auto flex gap-2">{acciones}</div> : null}
      </div>

      {/* `collapsible-panel` (globals.css) es quien anima: lee la altura medida que
          Base UI publica y la lleva a 0 en los dos extremos de la transicion. */}
      <CollapsibleContent className="collapsible-panel">
        <div className="pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
