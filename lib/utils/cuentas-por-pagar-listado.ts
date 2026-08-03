// Feature 170 — FASE 2 (T L.1, R45/R51) — las dos reglas del LISTADO «Cuentas por pagar a
// mensajeros»: por que texto casa una fila y en que orden salen. Declaradas UNA vez.
//
// Hasta hoy la busqueda por nombre vivia dentro de un `useMemo` de `CuentasPorPagarTable.tsx`
// (`filtrados`, :84-88) y se resolvia en el navegador sobre el dataset entero. Al paginar, esa
// busqueda dejaria de ver el conjunto: el usuario buscaria solo dentro de lo que tiene en
// pantalla. Mudarla al servidor es R45, y R45 exige que para el MISMO texto el conjunto sea el
// MISMO — asi que la regla se escribe aqui, en un modulo puro que el repositorio usa y que la
// descarga de T L.2 podra reusar sin volver a escribirla. Dos escrituras del mismo criterio en
// dos capas es exactamente como una fila se cae de un listado sin que nadie lo note.
//
// Modulo PURO (`lib/utils/`): sin Prisma, sin React, sin Next. Hermano de
// `lib/utils/colas-cierre.ts` (T I.1) y `lib/utils/estados-bodega-satelite.ts` (T K.1).

/** Lo minimo que una fila necesita para filtrarse y ordenarse: el nombre y su desempate. */
export interface FilaCuentaPorPagar {
  mensajeroId: string;
  mensajeroNombre: string;
}

/**
 * El texto de busqueda, normalizado EXACTAMENTE como lo hacia el navegador: `trim()` +
 * `toLowerCase()`. Un texto vacio (o de solo espacios) significa «sin filtro».
 *
 * Se conserva `toLowerCase()` a secas, SIN quitar acentos, porque asi se comporta la pantalla
 * hoy: buscar «jose» no encuentra a «José». Volverlo insensible a acentos seria una mejora
 * defendible, pero seria un CAMBIO de comportamiento y R45 pide lo contrario — el mismo
 * conjunto que producia el filtro de cliente.
 */
export function normalizarBusquedaMensajero(texto: string | undefined): string {
  return (texto ?? "").trim().toLowerCase();
}

/**
 * Casa un nombre contra un texto YA normalizado. Subcadena en cualquier posicion
 * (`includes`), no prefijo: buscar «mensajera» encuentra a «Ana Mensajera».
 */
export function coincideBusquedaMensajero(nombre: string, busquedaNormalizada: string): boolean {
  if (busquedaNormalizada === "") return true;
  return nombre.toLowerCase().includes(busquedaNormalizada);
}

/** Aplica la busqueda por nombre a un conjunto de filas. Sin texto, devuelve el conjunto. */
export function filtrarPorBusquedaMensajero<T extends FilaCuentaPorPagar>(
  filas: readonly T[],
  busqueda: string | undefined,
): T[] {
  const q = normalizarBusquedaMensajero(busqueda);
  if (q === "") return [...filas];
  return filas.filter((f) => coincideBusquedaMensajero(f.mensajeroNombre, q));
}

/**
 * Orden del listado: por NOMBRE del mensajero, con `mensajeroId` de desempate.
 *
 * **DESVIACION declarada de R51**, la misma —y por el mismo motivo— que T I.1 declaro en
 * «Saldos de tiendas»: este listado NO tiene hoy criterio de ordenacion que conservar. Sale de
 * un `groupBy` sin `orderBy`, cuyo orden Postgres no garantiza ni estable entre llamadas.
 * Paginar exige un orden TOTAL o dos paginas se solapan y una fila se cae entre ellas — y aqui
 * la fila que se cae es una cuenta por pagar que alguien tiene que liquidar.
 *
 * Se elige el NOMBRE porque es el identificador de negocio de la fila (es la unica columna que
 * no es dinero, y es justo por lo que la pantalla busca) y porque deja este listado con el
 * MISMO criterio que su pantalla hermana, «Saldos de tiendas».
 */
export function ordenarCuentasPorPagar<T extends FilaCuentaPorPagar>(filas: readonly T[]): T[] {
  return [...filas].sort(
    (a, b) =>
      a.mensajeroNombre.localeCompare(b.mensajeroNombre) ||
      a.mensajeroId.localeCompare(b.mensajeroId),
  );
}
