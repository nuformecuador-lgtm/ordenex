// Feature 144 / Bloque A (design.md §A.7) — motor de DEPENDENCIAS DECLARADAS entre
// filtros. Funciones PURAS: sin React, sin estado, sin dominio.
//
// Regla dura del bloque A: este modulo NO puede saber que es una provincia, una zona
// ni una orden. Un filtro declara `dependsOn: "<key de otro filtro>"` y cada opcion
// suya trae `parentValue` = el valor del padre al que pertenece. Ese es TODO el
// vocabulario: el significado lo pone el consumidor.
//
// Los tipos son ESTRUCTURALES a proposito (no importan `FilterDef`): asi el motor se
// testea con filtros de fantasia y no arrastra la capa de React.

/** Opcion vista por el motor: su valor y, si el filtro depende de otro, su padre. */
export interface FilterDependencyOption {
  value: string;
  /**
   * Valor del filtro PADRE al que pertenece esta opcion. Solo lo leen los filtros que
   * declaran `dependsOn`. Una opcion SIN padre en un filtro dependiente no esta
   * asociada a ninguna seleccion del padre, asi que no se ofrece cuando el padre acota.
   */
  parentValue?: string;
}

/** Declaracion minima que el motor necesita de un filtro. */
export interface FilterDependencyDef<
  O extends FilterDependencyOption = FilterDependencyOption,
> {
  key: string;
  kind?: string;
  /** Clave de su UNICO padre (decision (m) del spec). */
  dependsOn?: string;
  options?: O[];
}

/** Seleccion agregada: una lista de valores por clave declarada. */
export type FilterDependencySelection = Record<string, string[]>;

function buscar<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  key: string,
): FilterDependencyDef<O> | undefined {
  return filters.find((f) => f.key === key);
}

/**
 * Opciones que un filtro OFRECE ahora mismo (R24, R25, R27):
 *
 * 1. sin `dependsOn`, con un `dependsOn` a una clave NO declarada, o dentro de un
 *    ciclo -> todas sus opciones (se comporta como filtro independiente);
 * 2. con `dependsOn: P` -> las opciones cuyo `parentValue` esta en la SELECCION
 *    EFECTIVA de `P` (que a su vez puede estar acotada por el abuelo: el acotamiento
 *    es transitivo y de profundidad arbitraria).
 */
export function opcionesVisibles<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  selection: FilterDependencySelection,
  key: string,
): O[] {
  return visiblesInterno(filters, selection, key, new Set());
}

function visiblesInterno<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  selection: FilterDependencySelection,
  key: string,
  enCurso: ReadonlySet<string>,
): O[] {
  const filtro = buscar(filters, key);
  if (!filtro) return [];
  const todas = filtro.options ?? [];
  // Guarda de ciclos: si volvemos a un filtro que ya esta en la cadena, se corta el
  // lazo tratandolo como independiente (mismo trato que R27) en vez de colgarse.
  if (enCurso.has(key)) return todas;
  const padreKey = filtro.dependsOn;
  if (!padreKey) return todas;
  if (!buscar(filters, padreKey)) return todas; // R27: padre no declarado
  const siguiente = new Set(enCurso);
  siguiente.add(key);
  const efectiva = efectivaInterna(filters, selection, padreKey, siguiente);
  return todas.filter(
    (o) => o.parentValue !== undefined && efectiva.has(o.parentValue),
  );
}

/**
 * Seleccion EFECTIVA de un filtro (R24): su propia seleccion cuando no esta vacia, o
 * el conjunto completo de sus opciones VISIBLES cuando lo esta. Esa segunda mitad es
 * lo que hace funcionar "padre marcado, hijo sin marcar, nieto acotado".
 */
export function seleccionEfectiva<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  selection: FilterDependencySelection,
  key: string,
): Set<string> {
  return efectivaInterna(filters, selection, key, new Set());
}

function efectivaInterna<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  selection: FilterDependencySelection,
  key: string,
  enCurso: ReadonlySet<string>,
): Set<string> {
  const propia = selection[key] ?? [];
  if (propia.length > 0) return new Set(propia);
  return new Set(
    visiblesInterno(filters, selection, key, enCurso).map((o) => o.value),
  );
}

/** Profundidad de la cadena de dependencias de un filtro (padres antes que hijos). */
function profundidad<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  key: string,
): number {
  let n = 0;
  let actual = buscar(filters, key);
  const vistos = new Set<string>([key]);
  while (actual?.dependsOn) {
    const padre = buscar(filters, actual.dependsOn);
    if (!padre || vistos.has(padre.key)) break;
    vistos.add(padre.key);
    actual = padre;
    n += 1;
  }
  return n;
}

/**
 * Poda (R26): elimina de cada filtro dependiente los valores que ya NO estan
 * ofrecidos, de forma TRANSITIVA (se recorre en orden topologico: padres antes que
 * hijos, de modo que el nieto se poda contra un hijo ya podado). Las claves que
 * quedan sin ningun valor desaparecen del resultado (R18).
 *
 * Es idempotente: podar dos veces da lo mismo que podar una.
 */
export function podarSeleccion<O extends FilterDependencyOption>(
  filters: readonly FilterDependencyDef<O>[],
  selection: FilterDependencySelection,
): FilterDependencySelection {
  const orden = [...filters].sort(
    (a, b) => profundidad(filters, a.key) - profundidad(filters, b.key),
  );
  const trabajo: FilterDependencySelection = { ...selection };
  for (const filtro of orden) {
    const valores = trabajo[filtro.key];
    if (!valores || valores.length === 0) continue;
    if (!filtro.dependsOn) continue; // sin padre no hay nada que acote
    const visibles = new Set(
      visiblesInterno(filters, trabajo, filtro.key, new Set()).map((o) => o.value),
    );
    trabajo[filtro.key] = valores.filter((v) => visibles.has(v));
  }
  const salida: FilterDependencySelection = {};
  for (const [clave, valores] of Object.entries(trabajo)) {
    if (valores.length > 0) salida[clave] = valores;
  }
  return salida;
}
