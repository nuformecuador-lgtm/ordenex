"use client";

import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * FEATURE 287 (T9 — R24/R25/R28/R29) — el panel de «se muestra UNA sola vez».
 *
 * **La maqueta esta DUPLICADA a proposito, y conviene saber por que antes de "arreglarlo".**
 * El molde original vive dentro de `UsuarioForm.tsx` (el alta, feature 25/R33), y ese archivo
 * es de la ficha 286: no se toca aqui (`design.md` §11 lo marca con un **NO**). Esta copia
 * calca su forma y su tono. Unificar las dos maquetas cuando la 286 aterrice es la **pregunta
 * abierta 4** de `specs/287-maestro-restablece-contrasena/requirements.md`, y el riesgo **RS5**
 * de su `design.md` §12.
 *
 * **Lo que este componente sostiene, y que no es cosmetica:**
 *
 *  - **La contrasena entra por props y no sale de aqui** (R24). No hay `localStorage`, ni
 *    `sessionStorage`, ni cookie, ni cache de SWR: el anfitrion la tiene en un `useState`
 *    efimero y la descarta al cerrar. Este archivo no persiste nada, en ningun almacen.
 *  - **No hay ninguna via de volver a pedirla** (R29). No recibe callback de recarga, no
 *    importa ninguna Server Action y NO conoce el id del usuario: aunque alguien quisiera,
 *    desde aqui no se puede pedir otra vez. Solo pinta lo que le dan.
 *  - **Nunca hay un campo donde ESCRIBIR una contrasena** (R25/A3). El input es `readOnly`:
 *    el maestro RESTABLECE, no FIJA. Esa distincion es la que sostiene la ficha entera.
 *
 * La mencion a `restablecerContrasenaUsuario` de esta cabecera es **deliberada**: mete este
 * archivo en el censo de `tests/unit/guards/contrasena-generada-superficie.guardia.test.ts`,
 * que descubre solo la UI del camino y le prohibe todo `console.*` (R23). Por aqui pasa una
 * contrasena en claro.
 */
export interface ContrasenaGeneradaPanelProps {
  /** La contrasena en claro, entregada UNA vez en la rama `ok` del resultado (R21). */
  contrasena: string;
  /**
   * Encabezado del panel. Lo pone el consumidor —es quien sabe a quien nombra— en vez de
   * estar cableado aqui; asi el mismo panel sirve para el alta y para el restablecimiento,
   * y el dia que haya i18n el texto no vive dentro del componente.
   */
  encabezado: ReactNode;
  /** id del input; permite mas de un panel en pantalla sin duplicar ids. */
  inputId?: string;
}

export function ContrasenaGeneradaPanel({
  contrasena,
  encabezado,
  inputId = "contrasena-generada",
}: Readonly<ContrasenaGeneradaPanelProps>) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    try {
      // `navigator.clipboard` no existe en contextos no seguros ni en algunos navegadores
      // embebidos. Nunca es un fallo duro: la contrasena sigue visible y seleccionable en
      // pantalla, que es la via que siempre funciona.
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(contrasena);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="contrasena-generada-panel">
      <p className="text-sm font-medium">{encabezado}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>Contraseña generada</Label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            readOnly
            value={contrasena}
            className="font-mono"
            aria-label="Contraseña generada"
          />
          <Button type="button" variant="outline" size="sm" onClick={copiar}>
            <Copy aria-hidden="true" />
            {copiada ? "Copiada" : "Copiar"}
          </Button>
        </div>
      </div>

      <p role="alert" className="text-sm text-destructive">
        Guárdala ahora: no se volverá a mostrar.
      </p>

      {/* El cambio de etiqueta del boton no lo anuncia ningun lector si no se le pide: esta
          region viva lo dice en voz alta sin ocupar sitio en pantalla. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiada ? "Contraseña copiada al portapapeles" : ""}
      </span>
    </div>
  );
}
