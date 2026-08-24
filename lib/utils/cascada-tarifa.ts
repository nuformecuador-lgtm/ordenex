/**
 * Feature 274 (design §2.1, R1-R8) — la cascada de resolucion de tarifa, en UN solo sitio.
 *
 * POR QUE existe este modulo y no una funcion privada de cada repositorio: hasta ahora el
 * listado de ordenes y la liquidacion del cierre de dia resolvian la tarifa con reglas
 * distintas, asi que podian MOSTRAR una fila y FACTURAR otra. R8/R21 exigen que las cuatro
 * superficies (listado, cierre, carga via API y cotizacion) obtengan la misma fila para el
 * mismo par (tienda, zona) en el mismo instante. Con la regla escrita aqui, esa coincidencia
 * es estructural: no hay dos implementaciones que puedan divergir.
 *
 * Modulo PURO: sin imports de `@prisma/client` ni de nada de HTTP. `whereCascada` devuelve un
 * objeto plano estructuralmente compatible con `Prisma.TarifaWhereInput`, para que la regla se
 * pueda testear sin cliente generado y sin base.
 *
 * La cascada (R1), por orden de prioridad:
 *   nivel 1  tienda_id = T AND zona_id = Z   (lo mas especifico)
 *   nivel 2  tienda_id = T AND zona_id IS NULL
 *   nivel 3  tienda_id IS NULL AND zona_id = Z
 * y si ninguno tiene fila, `null` (R2). La fila global (NULL, NULL) NO es un cuarto nivel.
 */

/** Par a resolver. En `orden`, `tiendaId` y `zonaId` son NOT NULL; otras superficies pueden
 *  no conocer la zona, y entonces solo alcanzan el nivel 2 (R6). */
export interface ParTarifa {
  tiendaId: string;
  zonaId: string | null;
}

/** Clave estable de un par, para indexar el Map del batch. `|` no aparece en un uuid. */
export function clavePar(par: ParTarifa): string {
  return `${par.tiendaId}|${par.zonaId ?? ""}`;
}

/** Fila candidata, en lo minimo que la regla necesita ver. */
export interface FilaCascada {
  tiendaId: string | null;
  zonaId: string | null;
}

/**
 * 1 = tienda+zona · 2 = tienda, zona NULL · 3 = zona, tienda NULL · null = no aplica.
 * La fila global (NULL, NULL) devuelve `null`: NO es un cuarto nivel (R2).
 * Un par con `zonaId === null` solo puede alcanzar el nivel 2 (R6): sin zona no hay con que
 * comparar los niveles 1 y 3, y una fila de otra zona no es "la de este par".
 */
export function nivelDeCascada(fila: FilaCascada, par: ParTarifa): 1 | 2 | 3 | null {
  if (fila.tiendaId === par.tiendaId) {
    if (par.zonaId !== null && fila.zonaId === par.zonaId) return 1;
    if (fila.zonaId === null) return 2;
    return null;
  }
  if (fila.tiendaId === null && par.zonaId !== null && fila.zonaId === par.zonaId) return 3;
  return null;
}

/**
 * Elige, para cada par pedido, la candidata de menor nivel. Determinista y sin `createdAt`
 * (R5): con el UNIQUE (zona_id, tienda_id) NULLS NOT DISTINCT no puede haber dos filas del
 * mismo nivel para el mismo par, asi que el ganador no depende del orden de entrada y no hace
 * falta desempatar por fecha (por eso una fila de nivel 2 mas reciente NO le gana a la de
 * nivel 1, R3).
 *
 * Devuelve una entrada por CADA par pedido, indexada por `clavePar`, con `null` cuando ninguna
 * candidata aplica (R2/R7). `filas` puede traer filas de pares que nadie pidio —la rama 1 de
 * `whereCascada` es un producto cartesiano—: se descartan aqui.
 */
export function elegirPorCascada<T extends FilaCascada>(
  filas: readonly T[],
  pares: readonly ParTarifa[],
): Map<string, T | null> {
  const resultado = new Map<string, T | null>();

  for (const par of pares) {
    const clave = clavePar(par);
    if (resultado.has(clave)) continue; // pares duplicados: una sola entrada

    let ganadora: T | null = null;
    let mejorNivel: 1 | 2 | 3 | null = null;

    for (const fila of filas) {
      const nivel = nivelDeCascada(fila, par);
      if (nivel === null) continue;
      if (mejorNivel === null || nivel < mejorNivel) {
        mejorNivel = nivel;
        ganadora = fila;
      }
    }

    resultado.set(clave, ganadora);
  }

  return resultado;
}

/** Deduplica conservando el orden de primera aparicion (el `where` es reproducible). */
function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)];
}

/**
 * `where` de Prisma para traer, en UNA query, todas las candidatas de N pares (R7).
 *
 * Tres ramas, una por nivel. La rama de nivel 1 es un producto cartesiano `tiendas × zonas`,
 * asi que puede traer filas de pares que nadie pidio: `elegirPorCascada` las descarta en
 * memoria. Es sobre-lectura declarada y acotada (design §2.1); a cambio se conserva una sola
 * consulta.
 *
 * Casos borde:
 * - `pares` vacio -> `{ OR: [] }` (nadie pidio nada; el llamador no deberia consultar).
 * - `zonas` vacio (todos los pares sin zona) -> se omiten las ramas 1 y 3, que sin zona no
 *   pueden casar con nada (R6).
 *
 * Nota sobre el tipo de retorno: el design §2.1 escribe `tiendaId?: string | { in: string[] }`
 * (sin `null`) y a la vez pide la rama 3 con `tiendaId: null`. Se admite `null` tambien en
 * `tiendaId` —igual que en `zonaId`— porque sin eso la rama 3 de la propia cascada no
 * compila; sigue siendo estructuralmente compatible con `Prisma.TarifaWhereInput`
 * (`tienda_id` es nullable desde la 273).
 */
export function whereCascada(pares: readonly ParTarifa[]): {
  OR: Array<{
    tiendaId?: string | { in: string[] } | null;
    zonaId?: string | { in: string[] } | null;
  }>;
} {
  if (pares.length === 0) return { OR: [] };

  const tiendas = unicos(pares.map((p) => p.tiendaId));
  const zonas = unicos(pares.flatMap((p) => (p.zonaId === null ? [] : [p.zonaId])));

  if (zonas.length === 0) {
    return { OR: [{ tiendaId: { in: tiendas }, zonaId: null }] };
  }

  return {
    OR: [
      { tiendaId: { in: tiendas }, zonaId: { in: zonas } }, // nivel 1
      { tiendaId: { in: tiendas }, zonaId: null }, // nivel 2
      { tiendaId: null, zonaId: { in: zonas } }, // nivel 3
    ],
  };
}
