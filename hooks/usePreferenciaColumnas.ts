"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  clavesVisiblesEnOrden,
  columnasEnOrden,
  guardar,
  leerCrudo,
  moverClave,
  ordenEfectivo,
  sanearPreferencia,
  type DireccionMovimiento,
} from "@/lib/columnas/preferencia-columnas";

// Ficha 314 (design §5) — la preferencia de columnas como fuente EXTERNA a React, para
// CUALQUIER ámbito. Es el hook que la feature 194 escribió para el manifiesto con la clave y
// el catálogo por parámetro; su razonamiento se conserva entero:
//
// POR QUÉ `useSyncExternalStore` Y NO `useState` + efecto
// -------------------------------------------------------
// `localStorage` no existe en el servidor y los botones que consumen este hook TAMBIÉN se
// renderizan allí. Leer la preferencia en el primer render daría discrepancia de hidratación
// en el dispositivo que tenga columnas ocultas; leerla en un efecto con `setState` es justo lo
// que prohíbe la regla `react-hooks/set-state-in-effect`. Mismo precedente vivo:
// `hooks/usePreferenciaSonido.ts`.
//
// POR QUÉ EL SNAPSHOT ES EL STRING CRUDO Y NO UN ARRAY
// -----------------------------------------------------
// `useSyncExternalStore` compara el snapshot POR IDENTIDAD. Si `getSnapshot` devolviera las
// columnas derivadas, cada llamada construiría un array NUEVO, React lo vería distinto del
// anterior en cada render y entraría en BUCLE INFINITO. Por eso el snapshot es lo único
// estable que hay: el string tal cual quedó en el almacenamiento. Las derivaciones van en
// `useMemo` sobre ese string, que sí puede reconstruir arrays sin realimentar la suscripción.
//
// `getServerSnapshot` devuelve `null`: en servidor no se lee almacenamiento y `null` significa
// "sin preferencia" ⇒ todas las columnas visibles, en el orden del catálogo (R16).

/**
 * Evento propio: `storage` NO se dispara en la pestaña que escribió, y R32 exige que dos
 * superficies vivas del mismo ámbito se sincronicen sin recargar.
 *
 * UN SOLO NOMBRE PARA TODOS LOS ÁMBITOS (design §5). Un cambio en órdenes despierta también al
 * hook del manifiesto, que relee SU clave, obtiene el mismo string y `useSyncExternalStore` no
 * re-renderiza (compara strings por valor). Es un despertar barato, y evita un registro de
 * eventos por ámbito. El nombre viejo (`ordenex:manifiesto-columnas-cambio`) no persistía en
 * ningún sitio —es un evento en memoria, no un dato guardado—, así que renombrarlo no rompe
 * nada de lo que hay escrito en el navegador de nadie.
 */
export const EVENTO_COLUMNAS_CAMBIO = "ordenex:columnas-cambio";

/** En servidor no hay preferencia que leer. `null` = sin preferencia, sin discrepancia. */
function instantaneaServidor(): null {
  return null;
}

/** Notifica a todas las superficies vivas de esta pestaña y de las demás (R32). */
function anunciarCambio(): void {
  window.dispatchEvent(new Event(EVENTO_COLUMNAS_CAMBIO));
}

/**
 * Sin ámbito se devuelve `publicadas` TAL CUAL, la misma instancia, y no una copia (R33).
 *
 * No es un ahorro de memoria: es una PROPIEDAD que ya dependía de esto y que se midió romperse.
 * `ExportarVistaFinanciera` (feature 184) mantiene a propósito UNA instancia estable de su array
 * de columnas y la REESCRIBE EN SITIO desde `obtenerFilas`, en el mismo tick en que el generador
 * la va a leer, porque el juego de columnas de ese archivo depende de la FORMA del importe y esa
 * forma solo se conoce cuando llega el DTO — un `setState` llegaría un render tarde y el archivo
 * saldría con las columnas anteriores. Una copia derivada en un `useMemo` sobre la identidad del
 * array NUNCA se recalcula (la identidad no cambia: cambia el contenido), así que devolver una
 * copia dejaba salir la columna «Neto» vacía en las métricas que no la publican. Lo cazó
 * `tests/components/descarga/AnaliticaFinancieraExport.test.tsx`.
 *
 * Consecuencia declarada: ese patrón —mutar en sitio el array de columnas— es incompatible con
 * declarar un ámbito, porque con ámbito sí hay que derivar. Hoy ninguna tabla hace las dos cosas;
 * la que quiera ámbito tendrá que dejar de mutar.
 */
function sinAmbito<T>(publicadas: readonly T[]): T[] {
  return publicadas as T[];
}

export interface UsePreferenciaColumnasResult<T> {
  /** TODAS las publicadas, en el orden efectivo. Es lo que pinta el selector (R18-R25). */
  ordenadas: T[];
  /** Las marcadas, en el orden efectivo. Es lo que sale en el archivo (R4, R5, R20). */
  visibles: T[];
  /** Las claves de `visibles`, que es lo que consumen los generadores. */
  clavesVisibles: string[];
  /** Oculta la columna si es visible, la muestra si está oculta. Guard de mínimo (R7). */
  alternar: (clave: string) => void;
  /** Mueve la columna un puesto. No-op en los extremos (R22, R23); nunca toca `ocultas` (R24). */
  mover: (clave: string, direccion: DireccionMovimiento) => void;
  /** Deja todas marcadas y en el orden del catálogo: borra las DOS listas (R8). */
  restablecer: () => void;
}

/**
 * @param clave clave de almacenamiento del ámbito. `null` ⇒ la tabla no declara ámbito: el
 * hook devuelve `publicadas` intacto y sus escrituras son no-op (R33). Se llama SIEMPRE —
 * condicionar la llamada sería el error—, y por eso R33 no necesita bifurcar a quien lo usa.
 * @param publicadas catálogo de columnas de ese ámbito. El hook no lo conoce ni lo cuenta (R35).
 * @param claveDe accesor de la clave. Decláralo a NIVEL DE MÓDULO, nunca inline: la identidad
 * de esta función es dependencia de los `useMemo` de abajo.
 */
export function usePreferenciaColumnas<T>(
  clave: string | null,
  publicadas: readonly T[],
  claveDe: (columna: T) => string,
): UsePreferenciaColumnasResult<T> {
  // `useCallback` sin dependencias: si `suscribir` cambiara de identidad en cada render, React
  // se re-suscribiría sin parar. La clave no entra aquí porque los dos eventos son globales.
  const suscribir = useCallback((alCambiar: () => void) => {
    window.addEventListener(EVENTO_COLUMNAS_CAMBIO, alCambiar);
    window.addEventListener("storage", alCambiar);
    return () => {
      window.removeEventListener(EVENTO_COLUMNAS_CAMBIO, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);

  const obtenerCrudo = useCallback(() => leerCrudo(clave), [clave]);

  const crudo = useSyncExternalStore(
    suscribir,
    obtenerCrudo,
    instantaneaServidor,
  );

  const clavesPublicadas = useMemo(
    () => publicadas.map(claveDe),
    [publicadas, claveDe],
  );

  const ordenadas = useMemo(
    () =>
      clave === null
        ? sinAmbito(publicadas)
        : columnasEnOrden(
            publicadas,
            ordenEfectivo(crudo, clavesPublicadas),
            claveDe,
          ),
    [clave, crudo, publicadas, clavesPublicadas, claveDe],
  );

  const clavesVisibles = useMemo(
    () => clavesVisiblesEnOrden(crudo, clavesPublicadas),
    [crudo, clavesPublicadas],
  );

  const visibles = useMemo(
    () =>
      clave === null
        ? sinAmbito(publicadas)
        : columnasEnOrden(publicadas, clavesVisibles, claveDe),
    [clave, publicadas, clavesVisibles, claveDe],
  );

  const alternar = useCallback(
    (columna: string) => {
      if (clave === null) return; // sin ámbito no se lee ni se escribe (R33)
      // Se recalcula desde el ALMACENAMIENTO, no desde el render: dos superficies vivas del
      // mismo ámbito (R32) pueden haber escrito entre medias.
      const preferencia = sanearPreferencia(
        leerCrudo(clave),
        clavesPublicadas,
      );
      const { ocultas, orden } = preferencia;

      if (ocultas.includes(columna)) {
        guardar(clave, {
          ocultas: ocultas.filter((oculta) => oculta !== columna),
          orden,
        });
        anunciarCambio();
        return;
      }

      // Clave que no corresponde a ninguna columna publicada: no hay nada que ocultar.
      if (!clavesPublicadas.includes(columna)) return;

      // R7: la última columna visible no se puede ocultar. La UI ya la presenta
      // deshabilitada; este guard cubre la carrera entre dos superficies vivas.
      if (clavesPublicadas.length - ocultas.length <= 1) return;

      guardar(clave, { ocultas: [...ocultas, columna], orden });
      anunciarCambio();
    },
    [clave, clavesPublicadas],
  );

  const mover = useCallback(
    (columna: string, direccion: DireccionMovimiento) => {
      if (clave === null) return;
      const crudoVigente = leerCrudo(clave);
      const { ocultas } = sanearPreferencia(crudoVigente, clavesPublicadas);
      // Se mueve sobre el orden EFECTIVO —el catálogo ya enmendado—, no sobre la lista parcial
      // guardada: si no, mover una columna que el usuario nunca ordenó no tendría vecinas.
      const movido = moverClave(
        ordenEfectivo(crudoVigente, clavesPublicadas),
        columna,
        direccion,
      );
      // R22/R23: en los extremos no hay movimiento, y tampoco escritura.
      if (movido === null) return;

      // R24: `ocultas` viaja INTACTA. Mover no marca ni desmarca nada.
      guardar(clave, { ocultas, orden: movido });
      anunciarCambio();
    },
    [clave, clavesPublicadas],
  );

  const restablecer = useCallback(() => {
    if (clave === null) return;
    // R8: se borran las DOS listas. Con `orden` vacío, `guardar` escribe exactamente
    // `{"ocultas":[]}`, que es el literal que la feature 194 dejó como contrato.
    guardar(clave, { ocultas: [], orden: [] });
    anunciarCambio();
  }, [clave]);

  return { ordenadas, visibles, clavesVisibles, alternar, mover, restablecer };
}
