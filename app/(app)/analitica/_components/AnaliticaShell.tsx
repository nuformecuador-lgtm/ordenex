import type { ReactNode } from "react";
import { ChartColumn } from "lucide-react";

import { AppPage } from "@/components/shared/AppPage";
import { EmptyState } from "@/components/shared/EmptyState";

export interface AnaliticaShellProps {
  /**
   * Bloque que va PRIMERO, por encima de los filtros. Es un slot más: si no
   * llega, no se renderiza nada — ni envoltorio, ni estado vacío. No emite
   * `<section aria-label>` a propósito, para que las regiones de esta página
   * sigan siendo exactamente las que R20 de la 129 y R6/R7 de la 132 congelaron.
   */
  destacado?: ReactNode;
  /** Barra de filtros (rango, zona, tienda, mensajero). La enchufa la 131. */
  filtros?: ReactNode;
  /** Paneles del tablero operativo. Los enchufa la 131. */
  operativo?: ReactNode;
  /**
   * Paneles del tablero financiero. Los enchufa la 132 SOLO para los roles que
   * satisfacen `esAccesoTotal(rol)`. Si no llega, la región no existe (R7).
   */
  financiero?: ReactNode;
}

/**
 * Feature 129: shell PURO del tablero de analítica — contrato de props (slots)
 * que rellenan las features siguientes de la cadena. Sin `"use client"`, sin
 * fetch, sin cálculo (R23): todo su contenido llega por props.
 *
 * Quién enchufa cada slot:
 * - La 130 aporta los componentes de gráfica (bloques de presentación puros).
 * - La 131 cablea las Server Actions y pasa esos componentes por `filtros` y
 *   `operativo` (`<AnaliticaShell filtros={...} operativo={...} />`), sin tocar
 *   este archivo.
 * - La 133 recorta por rol pasando `undefined` (o directamente omitiendo la
 *   prop) en los casos donde ese rol no debe ver el panel.
 *
 * Región "financiero" (D6): la declara la feature 132, siguiendo el punto de
 * extensión que la 129 dejó escrito aquí. De sus TRES pasos mecánicos se
 * aplican los dos primeros —la prop `financiero?: ReactNode` y la
 * `<section aria-label="Tablero financiero">` debajo de la región operativa,
 * en la misma pila vertical— y se DESVÍA del tercero.
 *
 * DESVIACIÓN DECLARADA del paso (3) «su placeholder `EmptyState` a juego con
 * los de abajo»: no hay placeholder. Si la prop no llega, la región no se
 * renderiza en absoluto. El motivo es el razonamiento que el propio comentario
 * de la 129 escribió dos líneas más abajo y que contradice a su paso (3): «en
 * un portal donde el dinero es sensible, una región financiera visible y vacía
 * es peor que no tenerla — sugiere una cifra que no existe y expone una sección
 * de plata a roles que ni siquiera deberían saber que existe el panel». Es
 * además lo que exigen R2 y R7 de la 132: los roles sin `esAccesoTotal(rol)` no
 * deben ver ni la región, ni su encabezado, ni un estado vacío en su lugar, y
 * derivarlo de la ausencia de contenido evita depender de que cada llamador se
 * acuerde de omitir la prop. Las regiones "Filtros" y "Tablero operativo"
 * conservan su `EmptyState`: ahí el vacío anuncia una entrega pendiente, no
 * dinero oculto.
 */
export function AnaliticaShell({
  destacado,
  filtros,
  operativo,
  financiero,
}: Readonly<AnaliticaShellProps>) {
  return (
    <AppPage
      title="Analítica"
      description="Panel de indicadores del negocio. Los paneles se irán activando por entregas."
    >
      {destacado}
      <section aria-label="Filtros" className="flex flex-col gap-4">
        {filtros ?? (
          <EmptyState
            icon={ChartColumn}
            title="Los filtros llegan en una entrega posterior"
            description="Todavía no hay controles de rango, zona, tienda ni mensajero para este panel."
          />
        )}
      </section>
      <section aria-label="Tablero operativo" className="flex flex-col gap-4">
        {operativo ?? (
          <EmptyState
            icon={ChartColumn}
            title="El tablero operativo llega en una entrega posterior"
            description="Todavía no hay datos ni gráficas cableadas para este panel."
          />
        )}
      </section>
      {financiero ? (
        <section
          aria-label="Tablero financiero"
          className="flex flex-col gap-4"
        >
          {financiero}
        </section>
      ) : null}
    </AppPage>
  );
}
