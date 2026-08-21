"use client";

import { TabsGroup } from "@/components/shared/TabsGroup";
import { GRUPOS_NOVEDAD, type GrupoNovedad } from "@/lib/types/novedad-grupo";

import { NovedadesModule, type NovedadesModuleProps } from "./NovedadesModule";
import { TEXTOS_POR_GRUPO } from "./novedad-grupo-textos";
import {
  RechazosSlaModule,
  type RechazosSlaModuleProps,
} from "./RechazosSlaModule";

// Feature 102 (T12, design §6.2 / Q3) — envoltorio de pestañas de `/novedades`. Sin ítem de menú
// nuevo: la superficie de "Rechazadas por plazo vencido" vive como una PESTAÑA de solo-lectura
// junto a las de novedades, dentro de una pantalla que la tienda ya visita. Los paneles son
// componentes privados que reciben sus datos por props (el Server Component padre ya validó rol
// `adminTienda` y pre-fetch de la página 1). `keepMounted`: cada panel tiene su propia paginación
// por Server Action, que debe sobrevivir al cambio de pestaña (R12). Etiquetas i18n-ready.
//
// ⚠️ FEATURE 236 (T4.1, design §5 — R1/R12/R13) — DE DOS PESTAÑAS A TRES, Y EL ORDEN NO SE ESCRIBE
// AQUÍ.
//
// Hasta el 2026-08-19 las órdenes sobre las que un mensajero pedía ayuda entraban MEZCLADAS en la
// pestaña «En devolución», porque el predicado del servidor era un `OR` de dos igualdades de
// estado. Ahora cada grupo tiene su predicado, su acción y su pestaña.
//
// **Las dos primeras salen de `GRUPOS_NOVEDAD`**, que es lo que fija su ORDEN (D6, firmada: la
// ayuda va PRIMERA porque alguien está esperando respuesta AHORA; una devolución no espera a nadie
// con esa urgencia — el precedente estaba escrito en esta misma pantalla). Que el orden viva junto
// al mapa de grupos, y no en este archivo, evita que la pantalla y la descarga los enumeren en
// órdenes distintos; y un grupo nuevo entra aquí SOLO, con sus textos ya exigidos por el typecheck.
//
// **La tercera NO es un grupo de novedad** y por eso se añade a mano: «Rechazadas por plazo
// vencido» (feature 102) tiene su propio servicio, su propio DTO y su propio predicado. Va al final
// porque es de solo-lectura: no hay nada que la tienda pueda hacer ahí.
//
// ⚠️ CONTRAPARTIDA DICHA AQUÍ Y NO DESCUBIERTA DESPUÉS: con `ayuda_tienda` = 0 y `devuelta` = 0
// medidos en producción el 2026-08-19, la pestaña de ENTRADA de esta pantalla va a estar vacía los
// primeros días. Por eso su estado vacío tiene requisito propio (R16) y texto firmado.

const TAB_RECHAZOS_SLA_LABEL = "Rechazadas por plazo vencido";
const TABS_ARIA_LABEL = "Vistas de novedades";

export interface NovedadesTabsProps {
  /**
   * Los datos ya pre-fetch de cada grupo, indexados por él. `Record` y no dos props sueltas: un
   * grupo nuevo en `GRUPOS_NOVEDAD` deja de compilar aquí hasta que la página traiga su lectura,
   * en vez de pintar una pestaña vacía sin que nadie se entere.
   */
  novedades: Record<GrupoNovedad, Omit<NovedadesModuleProps, "grupo">>;
  rechazosSla: RechazosSlaModuleProps;
}

export function NovedadesTabs({ novedades, rechazosSla }: NovedadesTabsProps) {
  return (
    <TabsGroup
      ariaLabel={TABS_ARIA_LABEL}
      keepMounted
      items={[
        ...GRUPOS_NOVEDAD.map((grupo) => ({
          value: grupo,
          label: TEXTOS_POR_GRUPO[grupo].pestana,
          content: <NovedadesModule grupo={grupo} {...novedades[grupo]} />,
        })),
        {
          value: "rechazos-sla",
          label: TAB_RECHAZOS_SLA_LABEL,
          content: <RechazosSlaModule {...rechazosSla} />,
        },
      ]}
    />
  );
}
