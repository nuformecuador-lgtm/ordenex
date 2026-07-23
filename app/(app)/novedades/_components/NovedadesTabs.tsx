"use client";

import { TabsGroup } from "@/components/shared/TabsGroup";

import { NovedadesModule, type NovedadesModuleProps } from "./NovedadesModule";
import {
  RechazosSlaModule,
  type RechazosSlaModuleProps,
} from "./RechazosSlaModule";

// Feature 102 (T12, design §6.2 / Q3) — envoltorio de pestañas de `/novedades`. Sin ítem de menú
// nuevo: la superficie de "Rechazadas por SLA" vive como una PESTAÑA de solo-lectura junto a la de
// órdenes en devolución, dentro de una pantalla que la tienda ya visita. Los dos paneles son
// componentes privados que reciben sus datos por props (el Server Component padre ya validó rol
// `adminTienda` y pre-fetch de la página 1). `keepMounted`: cada panel tiene su propia paginación
// por Server Action, que debe sobrevivir al cambio de pestaña. Etiquetas i18n-ready.

const TAB_NOVEDADES_LABEL = "En devolución";
const TAB_RECHAZOS_SLA_LABEL = "Rechazadas por plazo vencido";
const TABS_ARIA_LABEL = "Vistas de novedades";

export interface NovedadesTabsProps {
  novedades: NovedadesModuleProps;
  rechazosSla: RechazosSlaModuleProps;
}

export function NovedadesTabs({ novedades, rechazosSla }: NovedadesTabsProps) {
  return (
    <TabsGroup
      ariaLabel={TABS_ARIA_LABEL}
      keepMounted
      items={[
        {
          value: "novedades",
          label: TAB_NOVEDADES_LABEL,
          content: <NovedadesModule {...novedades} />,
        },
        {
          value: "rechazos-sla",
          label: TAB_RECHAZOS_SLA_LABEL,
          content: <RechazosSlaModule {...rechazosSla} />,
        },
      ]}
    />
  );
}
