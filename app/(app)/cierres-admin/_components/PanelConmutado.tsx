"use client";

import type { ReactNode } from "react";

/**
 * Un panel de los que cuelgan de un conmutador segmentado: se queda MONTADO aunque no sea el
 * visible, y desaparece con el atributo `hidden`.
 *
 * POR QUÉ NO SE DESMONTA, que es la única decisión que hay aquí y no es obvia: cada listado de
 * esta pantalla lleva su propio estado —la página en la que va, el tamaño de página, el
 * `useSWR` que la sostiene—. Desmontarlo al cambiar de pestaña lo tiraría, así que volver a
 * «Resueltos» te devolvería a la página 1 después de haber navegado a la 7, y encima
 * dispararía otra lectura al servidor de una página que ya se había traído. Es el mismo motivo
 * por el que `TabsGroup` de este repo ofrece `keepMounted`, escrito aquí porque estos paneles
 * no usan aquella primitiva: el conmutador que el pedido humano del 2026-08-16 eligió es el
 * segmentado del portal del mensajero, que no trae paneles propios.
 *
 * `hidden` y no `display:none` por clase: quita el panel de la vista Y del árbol de
 * accesibilidad, así que un lector de pantalla no lee dos listados a la vez ni el foco puede
 * caer dentro del que no se está mirando. Es lo que hace que «esconder sin desmontar» no sea
 * una trampa para quien no ve la pantalla.
 *
 * LO QUE ESTO CUESTA, dicho para que nadie lo lea como gratis: los dos paneles montan sus
 * lecturas, así que la pantalla pide las dos páginas aunque solo se vea una. Es exactamente lo
 * que hacía antes de tener pestañas —las dos secciones estaban una debajo de otra— así que no
 * es un coste nuevo; lo que sí sería nuevo es el coste de perder el estado al alternar.
 */
export interface PanelConmutadoProps {
  /** `true` si es el panel que se está mirando. */
  activo: boolean;
  /** Nombre accesible del panel; el mismo texto de su pestaña. */
  ariaLabel: string;
  children: ReactNode;
}

export function PanelConmutado({
  activo,
  ariaLabel,
  children,
}: Readonly<PanelConmutadoProps>) {
  return (
    <div hidden={!activo} aria-label={ariaLabel} role="group">
      {children}
    </div>
  );
}
