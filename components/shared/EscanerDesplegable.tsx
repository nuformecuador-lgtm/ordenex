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

// El envoltorio ÚNICO de toda tarjeta de escaneo del producto (`EscanerGuiaCard` y
// compañía): recepción en origen, en bodega central, en satélite, recogida del mensajero y
// recolección en tienda. Nació en `/ordenes` como `ReceptorDesplegable` y se promovió aquí
// el 2026-07-31, porque el motivo por el que existe no es de aquella pantalla:
//
//   El panel se MONTA y DESMONTA con la animación (no queda oculto por CSS) a propósito:
//   mientras está dentro vive `QrScanner`, y dejarlo montado significaría la cámara
//   ENCENDIDA detrás de un panel invisible — en un teléfono, en la calle. Base UI mantiene
//   el panel hasta que termina la animación de salida, así que se puede cerrar con
//   animación y aun así apagar la cámara al final.
//
// De paso resuelve lo estético: la tarjeta es alta (cámara + número de guía) y desplegada
// se come la pantalla del listado que la acompaña.
//
// Arranca SIEMPRE plegado, sin excepción por pantalla: es decisión del humano del
// 2026-07-31, tomada sobre la alternativa de una prop `defaultOpen`. Así la cámara nunca
// arranca encendida y el gesto es el mismo en toda la app. Si vuelve a aparecer una prop
// para abrirlo de entrada, vuelve el problema que esto cierra.
//
// No sabe de dominio: el acto lo nombra cada superficie con `label`/`labelAbierto`
// ("Recolectar en tienda", "Recoger paquete", "Recibir paquete"…). Son OBLIGATORIOS a
// propósito — con un valor por defecto, una pantalla heredaba en silencio el vocabulario
// de otra ("recibir" donde en realidad se recolecta).

export interface EscanerDesplegableProps {
  /** Texto del disparador plegado. Nombra el ACTO de esta superficie. */
  label: string;
  /** Texto del disparador desplegado. */
  labelAbierto: string;
  /** Acciones que acompañan al disparador, alineadas al lado contrario. */
  acciones?: ReactNode;
  /** La tarjeta de escaneo propiamente dicha. */
  children: ReactNode;
  className?: string;
}

export function EscanerDesplegable({
  label,
  labelAbierto,
  acciones,
  children,
  className,
}: Readonly<EscanerDesplegableProps>) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Collapsible
      open={abierto}
      onOpenChange={setAbierto}
      className={cn("group/escaner w-full", className)}
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
            className="transition-transform duration-200 group-data-[open]/escaner:rotate-180 motion-reduce:transition-none"
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
