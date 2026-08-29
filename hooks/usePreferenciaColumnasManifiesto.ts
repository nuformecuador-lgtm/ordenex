"use client";

import {
  usePreferenciaColumnas,
  type UsePreferenciaColumnasResult,
} from "@/hooks/usePreferenciaColumnas";
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import { claveColumnas, claveDeColumnaManifiesto } from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";
import type { XlsxColumn } from "@/lib/utils/xlsx-template";

/**
 * Feature 194, generalizada por la ficha 314 (design §5): este hook es hoy un ENVOLTORIO que
 * fija las tres cosas propias del ámbito manifiesto —su clave por flujo, su catálogo y su
 * accesor de clave— sobre el hook genérico. La maquinaria (lectura, saneo, orden efectivo,
 * escritura, sincronización entre superficies) vive en `hooks/usePreferenciaColumnas.ts` y en
 * `lib/columnas/preferencia-columnas.ts`.
 *
 * La firma pública NO cambia: `visibles`, `clavesVisibles`, `alternar` y `restablecer` siguen
 * significando lo mismo. Lo que se AÑADE es `mover` (314/R21: reordenar aplica al componente
 * entero y a todos sus usos, manifiesto incluido) y `ordenadas`, que es lo que el selector
 * pinta —marcadas y desmarcadas— para poder mover una columna oculta (R25).
 */
export type UsePreferenciaColumnasManifiestoResult =
  UsePreferenciaColumnasResult<XlsxColumn>;

export function usePreferenciaColumnasManifiesto(
  flujo: ManifiestoFlujo,
): UsePreferenciaColumnasManifiestoResult {
  return usePreferenciaColumnas(
    claveColumnas(flujo),
    COLUMNAS_MANIFIESTO,
    claveDeColumnaManifiesto,
  );
}
