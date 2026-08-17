"use client";

import { useState, type ReactNode } from "react";
import { User, Warehouse } from "lucide-react";

import { SegmentedToggle } from "@/components/shared/SegmentedToggle";

import { PanelConmutado } from "./PanelConmutado";

/**
 * Pedido humano del 2026-08-16 — la pantalla de cierres se divide en dos: BODEGA y MENSAJERO.
 *
 * Hasta hoy las dos mitades vivían apiladas: quien entraba se encontraba la consolidación (o la
 * cola de bodegas, según su rol) y, scrolleando, los cierres del día de los mensajeros. Son dos
 * trabajos distintos —uno decide sobre bodegas enteras, el otro sobre el día de una persona— y
 * casi nunca se hacen a la vez.
 *
 * EL CONMUTADOR ES EL DEL PORTAL DEL MENSAJERO, literalmente el mismo componente
 * (`SegmentedToggle`, extraído de `VistaCardsToggle`), no uno parecido. Era la parte explícita
 * del pedido y es la que evita que dentro de un mes haya dos controles segmentados con dos
 * aspectos.
 *
 * LOS DOS PANELES SIGUEN MONTADOS (ver `PanelConmutado`): cada mitad lleva su paginación y sus
 * lecturas, y alternar no puede costarlas.
 *
 * SI SOLO HAY UNA MITAD, NO HAY PESTAÑAS. Un rol que no ve la sección de bodega —o un
 * pre-fetch de bodega que no respondió `ok`, que la página trata como «esta sección no se
 * muestra»— se encuentra los cierres del día directamente, sin un conmutador de una sola
 * opción, que no conmuta nada y solo añade un clic.
 */

const TAB_BODEGA = "bodega";
const TAB_MENSAJERO = "mensajero";
type TabCierres = typeof TAB_BODEGA | typeof TAB_MENSAJERO;

const ETIQUETA_BODEGA = "Bodega";
const ETIQUETA_MENSAJERO = "Mensajero";
/** Nombre accesible del conmutador. Propio: la pantalla monta varios segmentados anidados. */
const TOGGLE_LABEL = "Tipo de cierre";

export interface CierresTabsProps {
  /**
   * La mitad de BODEGA: la consolidación del `adminSatelite` o la cola de bodegas del maestro,
   * según el rol. `null` si a este actor no le toca ninguna de las dos.
   */
  bodega: ReactNode;
  /** La mitad de MENSAJERO: los cierres del día del alcance. Siempre hay. */
  mensajero: ReactNode;
}

export function CierresTabs({ bodega, mensajero }: Readonly<CierresTabsProps>) {
  // Arranca en MENSAJERO, y no en la mitad que agrupa a la otra. Dos motivos, y el segundo es
  // el que decide: (a) es lo que esta pantalla dice ser —su título y su descripción hablan de
  // «cada cierre solicitado por tus mensajeros»—, y (b) es lo que se veía primero antes de
  // haber pestañas, así que quien ya usaba la pantalla no tiene que aprender un clic nuevo para
  // llegar a lo mismo. La mitad de bodega es la que se consulta de vez en cuando; ésta es la
  // que se atiende todos los días.
  const [tab, setTab] = useState<TabCierres>(TAB_MENSAJERO);

  if (!bodega) return <>{mensajero}</>;

  return (
    <div className="flex flex-col gap-6">
      <SegmentedToggle
        options={[
          { valor: TAB_BODEGA, etiqueta: ETIQUETA_BODEGA, Icono: Warehouse },
          { valor: TAB_MENSAJERO, etiqueta: ETIQUETA_MENSAJERO, Icono: User },
        ]}
        valor={tab}
        onChange={setTab}
        ariaLabel={TOGGLE_LABEL}
        className="self-start"
      />

      <PanelConmutado activo={tab === TAB_BODEGA} ariaLabel={ETIQUETA_BODEGA}>
        {bodega}
      </PanelConmutado>
      <PanelConmutado activo={tab === TAB_MENSAJERO} ariaLabel={ETIQUETA_MENSAJERO}>
        {mensajero}
      </PanelConmutado>
    </div>
  );
}
