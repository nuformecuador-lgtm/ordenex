import type { ReactNode } from "react";
import { ChartColumn } from "lucide-react";

import { AppPage } from "@/components/shared/AppPage";
import { EmptyState } from "@/components/shared/EmptyState";

export interface AnaliticaShellProps {
  /** Barra de filtros (rango, zona, tienda, mensajero). La enchufa la 131. */
  filtros?: ReactNode;
  /** Paneles del tablero operativo. Los enchufa la 131. */
  operativo?: ReactNode;
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
 * Región "financiero" (D6): NO se declara aquí a propósito. El punto de
 * extensión para la feature 132 son estos TRES pasos mecánicos, y solo esos:
 *   1) añadir `financiero?: ReactNode` a `AnaliticaShellProps`;
 *   2) añadir una `<section aria-label="Tablero financiero">` debajo de la
 *      región operativa, en la misma pila vertical;
 *   3) su placeholder `EmptyState` a juego con los de abajo.
 * No se deja hoy una prop muerta ni una región vacía "por si acaso": en un
 * portal donde el dinero es sensible, una región financiera visible y vacía es
 * peor que no tenerla — sugiere una cifra que no existe y expone una sección
 * de plata a roles que ni siquiera deberían saber que existe el panel.
 */
export function AnaliticaShell({
  filtros,
  operativo,
}: Readonly<AnaliticaShellProps>) {
  return (
    <AppPage
      title="Analítica"
      description="Panel de indicadores del negocio. Los paneles se irán activando por entregas."
    >
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
    </AppPage>
  );
}
