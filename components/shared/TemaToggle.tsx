"use client";

import { Monitor, Moon, Sun, type LucideProps } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { useTema } from "@/providers/TemaProvider";
import {
  anuncioTema,
  ETIQUETAS_TEMA,
  etiquetaAccesibleTema,
  siguienteTema,
  type Tema,
} from "@/lib/tema/tema";

const ICONO: Record<Tema, ComponentType<LucideProps>> = {
  sistema: Monitor,
  claro: Sun,
  oscuro: Moon,
};

/**
 * Feature 211 — el interruptor de tema del encabezado.
 *
 * Cicla `sistema → claro → oscuro → sistema`. Vuelve al principio a propósito: si se
 * saltara `sistema`, quien lo pulsa una vez ya no podría delegar de nuevo en la
 * preferencia de su sistema operativo.
 *
 * Accesibilidad, porque con TRES estados un icono que cambia no alcanza:
 * - `<button>` nativo (vía la primitiva `Button`): foco y teclado sin nada añadido, con
 *   el anillo estándar de `DESIGN.md` (`focus-visible:ring-3 focus-visible:ring-ring/50`).
 * - Nombre accesible que dice en cuál estás Y a cuál vas («Tema: Claro. Cambiar a
 *   Oscuro.»), y que empieza por la etiqueta visible (WCAG 2.5.3, «Label in Name»).
 * - Etiqueta VISIBLE a partir de `sm`, para no depender de que se sepa qué significa una
 *   luna. Por debajo de `sm` el encabezado va justo de sitio y queda sólo el icono, que
 *   sigue teniendo su nombre accesible.
 * - Región viva que anuncia el estado YA aplicado: cambiar el `aria-label` de un botón
 *   enfocado no se re-anuncia de forma fiable en todos los lectores. Va con `aria-live`
 *   a secas y SIN `role="status"` a propósito: este control está en TODA página
 *   autenticada, y un `role="status"` permanente convierte en ambiguo el
 *   `getByRole("status")` de cualquier indicador de carga de la app (medido: rompía dos
 *   suites de otras features). `aria-live` es el mecanismo real; `role="status"` solo lo
 *   implica.
 *
 * Color: `text-foreground` sobre el tinte del encabezado, exactamente el mismo par que
 * el botón «Salir» de al lado, que la feature 208 midió en 11,94–13,76:1 en oscuro y
 * 12,77–13,76:1 en claro para los cinco roles.
 */
export function TemaToggle() {
  const { tema, establecer } = useTema();
  const Icono = ICONO[tema];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => establecer(siguienteTema(tema))}
        aria-label={etiquetaAccesibleTema(tema)}
        data-tema-actual={tema}
        className="cursor-pointer bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <Icono aria-hidden="true" />
        <span className="hidden sm:inline">{ETIQUETAS_TEMA[tema]}</span>
      </Button>
      <span
        aria-live="polite"
        aria-atomic="true"
        data-tema-anuncio=""
        className="sr-only"
      >
        {anuncioTema(tema)}
      </span>
    </>
  );
}
