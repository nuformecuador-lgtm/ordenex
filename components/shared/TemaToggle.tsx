"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTema } from "@/providers/TemaProvider";
import {
  anuncioTema,
  ETIQUETA_TEMA_SIN_RESOLVER,
  ETIQUETAS_TEMA,
  etiquetaAccesibleTema,
  resolverTemaDelSistema,
  siguienteTema,
} from "@/lib/tema/tema";

/**
 * Feature 211 — el interruptor de tema del encabezado.
 *
 * DOS ESTADOS, NO TRES (decisión humana, 2026-08-14): «Claro» y «Oscuro». «Sistema» salió
 * de la lista porque era una posición del ciclo que se veía IDÉNTICA a otra —quien tiene
 * el SO en oscuro pasaba por «Sistema» y «Oscuro» sin ver cambiar nada, y el botón parecía
 * roto—. El sistema sigue decidiendo el ARRANQUE de quien nunca eligió (lo resuelve el CSS,
 * ver `lib/tema/tema.ts`); lo que ya no hace es ocupar un sitio en el interruptor.
 *
 * EL ESTADO NO RESUELTO (`tema === null`) es el HTML que llega del servidor antes de que
 * el cliente monte: no se sabe cuál de los dos está pintando el CSS. Dura un instante y
 * NUNCA se ve como un estado estable, pero hay que renderizar algo honesto mientras tanto:
 * los dos iconos, con `dark:` decidiendo cuál se ve —el mismo mecanismo que ya pinta la
 * página, así que acierta siempre y sin JS— y un nombre accesible que no promete un estado
 * concreto. En cuanto `TemaProvider` resuelve, el control pasa a su forma normal.
 *
 * Accesibilidad:
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
  const resuelto = tema !== null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        // Sin resolver se consulta al navegador en el momento del clic: para entonces
        // `matchMedia` ya responde, así que la primera pulsación va al tema contrario del
        // que se está VIENDO, no al contrario de una suposición.
        onClick={() => establecer(siguienteTema(tema ?? resolverTemaDelSistema()))}
        aria-label={resuelto ? etiquetaAccesibleTema(tema) : ETIQUETA_TEMA_SIN_RESOLVER}
        data-tema-actual={tema ?? "sistema"}
        className="cursor-pointer bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        {resuelto ? (
          <>
            {tema === "oscuro" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            <span className="hidden sm:inline">{ETIQUETAS_TEMA[tema]}</span>
          </>
        ) : (
          <>
            <Sun aria-hidden="true" className="dark:hidden" />
            <Moon aria-hidden="true" className="hidden dark:block" />
            <span className="hidden sm:inline dark:sm:hidden">{ETIQUETAS_TEMA.claro}</span>
            <span className="hidden dark:sm:inline">{ETIQUETAS_TEMA.oscuro}</span>
          </>
        )}
      </Button>
      <span
        aria-live="polite"
        aria-atomic="true"
        data-tema-anuncio=""
        className="sr-only"
      >
        {resuelto ? anuncioTema(tema) : ""}
      </span>
    </>
  );
}
