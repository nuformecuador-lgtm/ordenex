"use client";

import { ColumnasPopover } from "@/components/shared/ColumnasPopover";
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import {
  claveColumnas,
  claveDeColumnaManifiesto,
  etiquetaDeColumnaManifiesto,
} from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";

export interface ColumnasManifiestoPopoverProps {
  /** Flujo cuya preferencia se edita. Cada flujo tiene la suya (194/R14, R16). */
  flujo: ManifiestoFlujo;
}

/**
 * Selector de columnas del manifiesto. Desde la ficha 314 es un ENVOLTORIO sobre
 * `ColumnasPopover`, que es el mismo control que usa la descarga de listados: así reordenar
 * (314/R18-R25) llega aquí sin escribirlo dos veces (R21).
 *
 * Lo que este envoltorio fija —y conserva literalmente— es lo propio del ámbito manifiesto: su
 * clave de almacenamiento por flujo, su catálogo, el `aria-label` del disparador, el título del
 * popup y el formato de etiqueta `Etiqueta legible (clave_maquina)`. Son contrato de sus
 * pruebas, que siguen verdes sin tocarse.
 *
 * NO es código muerto: lo monta `DescargarManifiestoButton`.
 */
export function ColumnasManifiestoPopover({
  flujo,
}: Readonly<ColumnasManifiestoPopoverProps>) {
  return (
    <ColumnasPopover
      claveAlmacenamiento={claveColumnas(flujo)}
      publicadas={COLUMNAS_MANIFIESTO}
      claveDe={claveDeColumnaManifiesto}
      etiquetaDe={etiquetaDeColumnaManifiesto}
      titulo="Columnas del manifiesto"
      etiquetaDisparador="Elegir columnas del manifiesto"
    />
  );
}
