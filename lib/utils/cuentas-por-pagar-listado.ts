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
//
// ACTUALIZACION (chore de la deuda de la 170, Q-L4): la busqueda pasa a IGNORAR LOS ACENTOS.
// Es una decision del LEADER, declarada en `progress/chore_deuda_170.md`, y se implementa AQUI
// —el unico sitio donde el criterio esta escrito— para que la pagina y la descarga no puedan
// discrepar. Ya no reproduce el filtro de cliente de T L.1, que era accent-sensible; ese filtro
// dejo de existir cuando T M.1 llevo la descarga al servidor. La desviacion respecto de la letra
// de R45 esta medida caso a caso en `tests/unit/services/wallet-cuentas-paginado.test.ts`.

/** Lo minimo que una fila necesita para filtrarse y ordenarse: el nombre y su desempate. */
export interface FilaCuentaPorPagar {
  mensajeroId: string;
  mensajeroNombre: string;
}

/**
 * Plegado de acentos: descompone cada letra en NFD y descarta las marcas diacriticas
 * combinantes, asi que `á`/`Á`/`ä` caen todas en `a` y `ñ` en `n`.
 *
 * Por que ESTA forma y no una de las otras dos que ya viven en el repo:
 *
 *  - NO se reusa `normalizarTerminoBusqueda` (`lib/utils/busqueda-orden.ts`, feature 169): aquel
 *    es el ESPEJO en TypeScript de un `translate()` con un mapa explicito de 48 caracteres,
 *    escrito asi porque su contraparte la calcula POSTGRES en una columna generada e indexada.
 *    Aqui no hay columna, ni indice, ni SQL: el filtro corre entero en Node (§ el comentario de
 *    `filtrarPorBusquedaMensajero`). Copiar la restriccion de un espejo que no existe seria
 *    plegar MENOS caracteres sin ganar nada a cambio.
 *  - NO se reusa `normalizeName` (`lib/utils/normalize.ts`): pliega los acentos igual, pero
 *    ademas recorta y COLAPSA LOS ESPACIOS INTERIORES. Eso es un segundo cambio de
 *    comportamiento —«del  carmen» pasaria a casar «del carmen»— que nadie ha pedido. El
 *    cambio decidido es el de los acentos y solo ese.
 */
function plegarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * El texto de busqueda, normalizado: `trim()` + plegado de acentos + `toLowerCase()`. Un texto
 * vacio (o de solo espacios) significa «sin filtro».
 *
 * **La busqueda IGNORA LOS ACENTOS, y es una decision del LEADER tomada en el chore de la deuda
 * de la 170** (`progress/chore_deuda_170.md`), no una consecuencia de esta implementacion.
 *
 * Lo que habia antes, y por que se cambia: T L.1 conservo `toLowerCase()` a secas porque R45 le
 * pedia el MISMO conjunto que producia el filtro de cliente, y aquel no plegaba acentos. El
 * efecto es que hoy el resultado depende de como se teclee el nombre: buscar «Ramirez» no
 * encuentra a «Ramírez» y buscar «jose» no encuentra a «José Pérez». En español eso es un
 * defecto, no una propiedad: quien busca no sabe con que acentos esta escrito el registro.
 *
 * Que NO cambia, y por eso el cambio es acotado: el recorte de extremos, el `includes` (subcadena
 * en cualquier posicion), los espacios interiores y el trato de `%` y `_` como TEXTO. Sigue sin
 * haber comodines.
 */
export function normalizarBusquedaMensajero(texto: string | undefined): string {
  return plegarAcentos((texto ?? "").trim()).toLowerCase();
}

/**
 * Casa un nombre contra un texto YA normalizado. Subcadena en cualquier posicion
 * (`includes`), no prefijo: buscar «mensajera» encuentra a «Ana Mensajera».
 *
 * El nombre se pliega con la MISMA funcion que el texto tecleado. Que las dos caras usen el
 * mismo plegado no es estetica: si solo se plegara una, «Ramírez» dejaria de encontrarse a si
 * mismo — el fallo clasico de una busqueda insensible a acentos mal cableada.
 */
export function coincideBusquedaMensajero(nombre: string, busquedaNormalizada: string): boolean {
  if (busquedaNormalizada === "") return true;
  return plegarAcentos(nombre).toLowerCase().includes(busquedaNormalizada);
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
