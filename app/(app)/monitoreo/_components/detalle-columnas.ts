// FEATURE 260 (F1) — LAS COLUMNAS DEL DETALLE DEL TABLERO DEL DIA.
//
// R14, R16, R20, R22, R23, R24, R25, R26, R27, R45.
//
// ─── QUE HACE ESTE MODULO, EN UNA LINEA ────────────────────────────────────────────────────
//
// Toma el modulo de columnas del LISTADO DE ORDENES tal cual, le añade la unica columna que el
// listado no tiene —«Resultado del dia»—, quita las que leen un dato que el alcance `zona` no
// puede ver, y pone delante las cinco que el humano fijo. NO DECLARA NI UNA DEFINICION DE
// COLUMNA MAS. Las 19 se leen de `ordenesColumns`.
//
// ─── POR QUE SE DERIVA Y NO SE ENUMERA (R26) ───────────────────────────────────────────────
//
// La solucion obvia seria escribir aqui la lista de columnas que se quieren. Es la trampa: dos
// listas paralelas que divergen en cuanto `/ordenes` cambie, y ninguna se pone roja. Aqui solo
// se declara lo que NO SE PUEDE derivar —el ORDEN de cinco ids y la EXCLUSION de tres—, las dos
// por identificador; el conjunto base sale de `ordenesColumns`. Consecuencia buscada: cuando el
// listado gane o pierda una columna, el detalle la gana o la pierde sin tocar este archivo.
//
// Y las dos declaraciones que quedan fallan RUIDOSO: `tests/unit/components/detalle-columnas.
// test.tsx` afirma que cada id de `PRIMERAS` y cada id de `COLUMNAS_SOLO_ALCANCE_GLOBAL` existe
// de verdad entre las columnas montadas. Sin eso, un rename en `/ordenes` dejaria la columna al
// final —o sin recortar— en silencio.
//
// ─── POR QUE `ordenesColumns` Y NO `ordenesColumnsReprogramada` (R45) ──────────────────────
//
// La variante trae ademas «Liberada el», que es el dia para el que quedo reprogramada la orden:
// pertenece a la pestaña acotada al estado `reprogramada`. El detalle del dia MEZCLA estados,
// asi que esa columna estaria vacia en casi todas las filas y diria algo distinto en cada una.
//
// ─── POR QUE NINGUNA COLUMNA TRAE UNA ACCION (R21) ─────────────────────────────────────────
//
// Medido sobre las 19: todas son funcion pura de la fila o acceso por clave. El checkbox de
// seleccion y la columna «Acciones» NO viven en `ordenesColumns` — los antepone `OrdenesModule`.
// Montar este modulo no puede, por construccion, traer una accion a una pantalla de lectura.
//
// ─── LA MITAD DE PANTALLA DEL RECORTE POR ALCANCE (R14/R15) ────────────────────────────────
//
// La otra mitad —que el dato no viaje— vive en `recortarPorAlcance` (`lib/types/tablero-dia`).
// Hacen falta LAS DOS: sin la del servidor el dato llega al navegador aunque no se pinte y se
// lee con un `View source`; sin esta, `PriceLabel` convierte el hueco en `₡0`, que se lee como
// «esta orden no paga flete» — una afirmacion FALSA, y eso es peor que enseñar la cifra. Lo
// retirado se retira como COLUMNA, nunca como VALOR. Que ninguna de las dos mitades pueda
// desaparecer sola lo ata `tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts`.
//
// ─── QUE NO PUEDE HABER EN ESTE ARCHIVO ────────────────────────────────────────────────────
//
// Cae dentro del arbol censado de la feature (`app/(app)/monitoreo/**`): ni un hex, ni una
// utilidad de paleta cruda de Tailwind, ni el nombre de la variante interna del `Badge`, ni un
// par `-soft`/`-strong` armado a mano, ni un literal de tamaño de pagina, ni un identificador
// que empiece por `sumar`, ni la lectura del papel del actor. El alcance llega YA RESUELTO
// desde el servidor y aqui solo se consume su respuesta.

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";
import type { Column } from "@/components/shared/DataTable";
import type { AlcanceTableroDia, OrdenDetalleDia } from "@/lib/types/tablero-dia";

/** Id de la UNICA columna propia del detalle (R22). La declara este modulo y nadie mas. */
export const COLUMNA_RESULTADO_ID = "resultadoDelDia";

/** Su encabezado. Constante y no literal repetido: deja la puerta abierta a i18n. */
export const COLUMNA_RESULTADO_LABEL = "Resultado del día";

/**
 * R14 — los ids de `ordenesColumns` que leen un campo de `CAMPOS_SOLO_ALCANCE_GLOBAL`:
 *
 *   · `flete`       lee `fleteConIva`;
 *   · `comision`    lee `comisionConIva`;
 *   · `fulfillment` lee `relaciones.tienda.tarifa.fulfillment`.
 *
 * `montoCobrar` NO esta, y es la decision de R17: ese importe se muestra en los DOS alcances
 * —el satelite de zona ya lo ve en su propia pantalla de recepcion—, asi que retirarlo aqui
 * seria recortar por encima de lo que la puerta humana firmo.
 */
export const COLUMNAS_SOLO_ALCANCE_GLOBAL: readonly string[] = [
  "flete",
  "fulfillment",
  "comision",
];

/**
 * R23/R24 — EL ORDEN DE LAS CINCO PRIMERAS, declarado UNA vez y POR IDENTIFICADOR.
 *
 * No es una segunda lista de definiciones de columna: no hay aqui ni un encabezado ni un
 * `render`. Es la unica parte del resultado que no se puede derivar de `ordenesColumns`, porque
 * el orden del listado lo decide el listado y el del detalle lo decidio el humano.
 */
export const PRIMERAS: readonly string[] = [
  "numGuia",
  "estatus",
  COLUMNA_RESULTADO_ID,
  "destinatario",
  "direccion",
];

/**
 * R22/R27 — «Resultado del dia»: la ultima gestion vigente de esa orden HOY.
 *
 * Se etiqueta con `estatusLabel`, el MISMO mapa que el resto de la aplicacion: los cinco values
 * de `gestion_resultado` existen tambien como values del catalogo de estatus, asi que traducen
 * sin declarar un segundo mapa —que se quedaria atras en el siguiente cambio de catalogo y haria
 * que la misma orden se leyera distinta en dos pantallas—. Y su respaldo ya resuelve el `null`
 * como «—», que en este repo significa «relacion opcional que no resolvio», no «cero».
 *
 * Es TEXTO y no un chip a proposito: la columna «Estado» de al lado ya trae el chip del estatus
 * de la orden, y dos pastillas contiguas se leen como dos estados del mismo dato.
 */
function columnaResultadoDelDia(): Column<OrdenDetalleDia> {
  return {
    id: COLUMNA_RESULTADO_ID,
    value: COLUMNA_RESULTADO_LABEL,
    render: (orden) => estatusLabel(orden.resultadoDelDia),
  };
}

/**
 * Las columnas del detalle para un alcance ya resuelto por el servidor.
 *
 * Sobre la asignabilidad, que es lo que sostiene todo esto sin un solo `as`:
 * `Column<OrdenListItemDTO>[]` es asignable a `Column<OrdenDetalleDia>[]` porque la fila del
 * detalle es un SUBTIPO ESTRICTO de la del listado y `render: (row: T) => ReactNode` es
 * contravariante en su parametro bajo `strictFunctionTypes`. El dia que el contrato deje de
 * cumplirlo, esta linea deja de compilar — que es exactamente lo que se quiere: un cast aqui
 * seria la costura por la que las dos pantallas divergirian sin que el compilador dijera nada.
 */
export function columnasDetalle(alcance: AlcanceTableroDia): Column<OrdenDetalleDia>[] {
  // 1. las 19 del listado, tal cual, sin copiar ni una definicion   (R20/R26/R45)
  // 2. + la unica propia                                            (R22)
  const montadas: Column<OrdenDetalleDia>[] = [...ordenesColumns, columnaResultadoDelDia()];

  // 3. − las que leen un dato que este alcance no recibe            (R14)
  const permitidas =
    alcance === "global"
      ? montadas
      : montadas.filter((columna) => !COLUMNAS_SOLO_ALCANCE_GLOBAL.includes(columna.id));

  // 4. las de `PRIMERAS` delante y en ese orden; el resto, en el suyo nativo   (R23)
  return ordenarPorPrimeras(permitidas);
}

/**
 * Reordena SIN reconstruir: las columnas siguen siendo los mismos objetos que declaro
 * `ordenesColumns`. Un id de `PRIMERAS` que no exista entre las montadas no se inventa —se
 * ignora aqui y lo denuncia el test, que es donde un fallo asi tiene que dar la cara (R25)—.
 */
function ordenarPorPrimeras(
  columnas: readonly Column<OrdenDetalleDia>[],
): Column<OrdenDetalleDia>[] {
  const delante = PRIMERAS.map((id) => columnas.find((columna) => columna.id === id)).filter(
    (columna): columna is Column<OrdenDetalleDia> => columna !== undefined,
  );
  const yaColocadas = new Set(delante.map((columna) => columna.id));
  return [...delante, ...columnas.filter((columna) => !yaColocadas.has(columna.id))];
}
