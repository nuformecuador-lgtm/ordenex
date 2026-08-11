"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import {
  columnasVisibles,
  guardarOcultas,
  leerCrudoColumnas,
  sanearOcultas,
} from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";
import type { XlsxColumn } from "@/lib/utils/xlsx-template";

// Feature 194 (design §4, §10) — la preferencia de columnas como fuente EXTERNA a React.
//
// POR QUE `useSyncExternalStore` Y NO `useState` + efecto
// -------------------------------------------------------
// `localStorage` no existe en el servidor y el botón de manifiesto que consume este hook
// TAMBIEN se renderiza allí. Leer la preferencia en el primer render daría discrepancia de
// hidratación en el dispositivo que tenga columnas ocultas; leerla en un efecto con `setState`
// es justo lo que prohíbe la regla `react-hooks/set-state-in-effect`. Es el mismo razonamiento
// —y el mismo precedente vivo— de `hooks/usePreferenciaSonido.ts:10-18`.
//
// POR QUE EL SNAPSHOT ES EL STRING CRUDO Y NO UN ARRAY (design §4 y §10, primer riesgo)
// -------------------------------------------------------------------------------------
// `useSyncExternalStore` compara el snapshot POR IDENTIDAD. Si `getSnapshot` devolviera
// `columnasVisibles(...)`, cada llamada construiría un array NUEVO, React lo vería distinto del
// anterior en cada render y entraría en bucle infinito de re-render. Por eso el snapshot es lo
// único estable que hay: el string tal cual quedó en el almacenamiento (`leerCrudoColumnas`).
// La derivación a `XlsxColumn[]` va en un `useMemo` sobre ese string, que sí puede reconstruir
// el array sin realimentar la suscripción.
//
// `getServerSnapshot` devuelve `null`: en servidor no se lee almacenamiento y `null` significa
// "sin preferencia" -> todas las columnas visibles (R17).

/** Evento propio: `storage` NO se dispara en la pestaña que escribió (R18). */
export const EVENTO_COLUMNAS_CAMBIO = "ordenex:manifiesto-columnas-cambio";

/**
 * En servidor no hay preferencia que leer. `null` = sin preferencia = todas visibles (R17),
 * sin discrepancia de hidratación.
 */
function instantaneaServidor(): null {
  return null;
}

/** Notifica a todas las superficies vivas de esta pestaña y de las demás (R18). */
function anunciarCambio(): void {
  window.dispatchEvent(new Event(EVENTO_COLUMNAS_CAMBIO));
}

export interface UsePreferenciaColumnasManifiestoResult {
  /** Subconjunto de `COLUMNAS_MANIFIESTO`, SIEMPRE en el orden publicado (R8). */
  visibles: XlsxColumn[];
  /** Las `key` de `visibles`, que es lo que consume `buildManifiestoXlsx` (design §0/D5). */
  clavesVisibles: string[];
  /** Oculta la columna si es visible, la muestra si está oculta. Guard de mínimo (R12). */
  alternar: (key: string) => void;
  /** Deja todas las columnas publicadas visibles (R6). */
  restablecer: () => void;
}

export function usePreferenciaColumnasManifiesto(
  flujo: ManifiestoFlujo,
): UsePreferenciaColumnasManifiestoResult {
  // `useCallback` con `[flujo]`: si `suscribir` cambiara de identidad en cada render, React
  // se re-suscribiría sin parar. Depende de `flujo` porque cada flujo tiene su propia clave.
  const suscribir = useCallback((alCambiar: () => void) => {
    window.addEventListener(EVENTO_COLUMNAS_CAMBIO, alCambiar);
    window.addEventListener("storage", alCambiar);
    return () => {
      window.removeEventListener(EVENTO_COLUMNAS_CAMBIO, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);

  const obtenerCrudo = useCallback(() => leerCrudoColumnas(flujo), [flujo]);

  const crudo = useSyncExternalStore(
    suscribir,
    obtenerCrudo,
    instantaneaServidor,
  );

  const visibles = useMemo(
    () => columnasVisibles(crudo, COLUMNAS_MANIFIESTO),
    [crudo],
  );

  const clavesVisibles = useMemo(
    () => visibles.map((columna) => columna.key),
    [visibles],
  );

  const alternar = useCallback(
    (key: string) => {
      // Se recalcula desde el almacenamiento, no desde el render: dos superficies vivas del
      // mismo flujo (R18) pueden haber escrito entre medias.
      const ocultas = sanearOcultas(
        leerCrudoColumnas(flujo),
        COLUMNAS_MANIFIESTO,
      );

      if (ocultas.includes(key)) {
        guardarOcultas(
          flujo,
          ocultas.filter((clave) => clave !== key),
        );
        anunciarCambio();
        return;
      }

      // Clave que no corresponde a ninguna columna publicada: no hay nada que ocultar.
      if (!COLUMNAS_MANIFIESTO.some((columna) => columna.key === key)) return;

      // R12: la última columna visible no se puede ocultar. La UI ya la presenta
      // deshabilitada (D-B); este guard cubre la carrera entre dos superficies vivas.
      if (COLUMNAS_MANIFIESTO.length - ocultas.length <= 1) return;

      guardarOcultas(flujo, [...ocultas, key]);
      anunciarCambio();
    },
    [flujo],
  );

  const restablecer = useCallback(() => {
    guardarOcultas(flujo, []);
    anunciarCambio();
  }, [flujo]);

  return { visibles, clavesVisibles, alternar, restablecer };
}
