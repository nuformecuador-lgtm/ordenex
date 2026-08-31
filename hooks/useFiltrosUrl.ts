"use client";

// Feature 335 (T2.1) — la unica pieza de la ficha que toca `next/navigation`.
//
// Envuelve la lectura de la query string y el `router.replace` de «Limpiar todo» para que
// los canonicos compartidos (`BuscadorFiltros`, `FilterComponent`) no conozcan al router.
// Todo lo que sabe de FORMATO vive en `lib/utils/filtros-url.ts`, que es puro.

import { useCallback, useMemo } from "react";

import * as navegacion from "next/navigation";

import { queryTrasLimpiar, type LectorParams } from "@/lib/utils/filtros-url";

type Enrutador = ReturnType<typeof navegacion.useRouter>;

export interface FiltrosUrl {
  /** Vacio si `activo === false` o si no hay fuente de params en el entorno (R24). */
  params: LectorParams;
  /** Borra de la URL SOLO las claves indicadas, conservando las ajenas (R19-R22). */
  borrarParams: (claves: readonly string[]) => void;
}

/**
 * R24 — el hook DEBE sobrevivir a un entorno sin App Router. Hay tres modos de fallo
 * distintos y todos estan medidos, no supuestos:
 *
 * 1. **el hook no existe en el modulo**: media docena de tests del repo mockean
 *    `next/navigation` PARCIALMENTE, con solo `useRouter`
 *    (`tests/unit/components/ordenes-listado-buscador.test.tsx:18`,
 *    `tests/components/descarga/SateliteDescarga.test.tsx:58`,
 *    `tests/components/paginacion/SatelitePaginacion.test.tsx:88`,
 *    `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx:80`). Ahi
 *    `useSearchParams` y `usePathname` son `undefined` y llamarlos revienta. Por eso el
 *    modulo se importa como NAMESPACE y cada hook se comprueba antes de invocarlo: un
 *    `import { useSearchParams }` fallaria antes incluso de poder defenderse.
 * 2. **el hook devuelve `null`**: `useSearchParams()` fuera de un provider devuelve
 *    `null` en vez de lanzar (verificado en
 *    `node_modules/next/dist/client/components/navigation.js`).
 * 3. **el hook LANZA**: `useRouter()` sin provider tira
 *    `invariant expected app router to be mounted`.
 *
 * De ahi el `try`/`catch` alrededor de las tres llamadas. A simple vista parece un hook
 * condicional, y no lo es: el modulo `next/navigation` que se resuelve es FIJO durante
 * toda la vida del componente, asi que si lanza, lanza SIEMPRE en el mismo punto y el
 * numero de hooks de React consumidos no varia entre renders. Los `useMemo`/`useCallback`
 * de abajo quedan fuera del `try` y se ejecutan siempre.
 */
export function useFiltrosUrl(activo: boolean): FiltrosUrl {
  let paramsUrl: URLSearchParams | null = null;
  let ruta: string | null = null;
  let enrutador: Enrutador | null = null;

  try {
    // Las tres llamadas van dentro del `try` a proposito (ver el comentario de arriba): el
    // modulo resuelto es fijo, asi que se consumen siempre en el mismo orden y con el
    // mismo corte; no es una rama que cambie entre renders. `react-hooks/rules-of-hooks`
    // no protesta por esto —comprobado con `pnpm exec eslint` sobre este archivo—, asi que
    // no lleva ningun `eslint-disable`: el dia que la regla se endurezca, el aviso debe
    // salir y obligar a releer este razonamiento, no quedar silenciado de antemano.
    paramsUrl = navegacion.useSearchParams?.() ?? null;
    ruta = navegacion.usePathname?.() ?? null;
    enrutador = navegacion.useRouter?.() ?? null;
  } catch {
    // R24: sin fuente de params nos comportamos como si la URL viniera vacia. No hay nada
    // que registrar: en produccion este catch no se alcanza y en test es el escenario
    // esperado.
  }

  // Estabilizar la referencia importa: el objeto vacio se pasa a los canonicos y no debe
  // recrearse en cada render.
  const params = useMemo<LectorParams>(
    () => (activo && paramsUrl !== null ? paramsUrl : new URLSearchParams()),
    [activo, paramsUrl],
  );

  const borrarParams = useCallback(
    (claves: readonly string[]) => {
      // R23: desactivado, la URL no se toca. Sin router o sin ruta, no-op silencioso
      // (R24): no tener donde navegar no es un error del consumidor.
      if (!activo || enrutador === null || ruta === null) return;
      const cadena = queryTrasLimpiar(params, claves);
      // Patron copiado de `TableroDiaModule.cerrarDetalle`: se SUSTITUYE la entrada del
      // historial y no se mueve el scroll (R21, R22).
      enrutador.replace(cadena ? `${ruta}?${cadena}` : ruta, { scroll: false });
    },
    [activo, enrutador, ruta, params],
  );

  return { params, borrarParams };
}
