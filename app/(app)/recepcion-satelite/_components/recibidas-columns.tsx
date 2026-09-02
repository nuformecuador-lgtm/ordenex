"use client";

// FICHA 349 (2026-09-01) — LAS COLUMNAS DE «Órdenes de la bodega» SON LAS DE `/ordenes`.
//
// ─── QUÉ HACE ESTE MÓDULO, EN UNA LÍNEA ────────────────────────────────────────────────────
//
// Toma `ordenesColumns` TAL CUAL y le quita, POR IDENTIFICADOR, las columnas que leen un dato
// que el alcance `zona` no recibe. NO DECLARA NI UNA DEFINICIÓN DE COLUMNA. Ni un encabezado,
// ni un `render`, ni un `minWidth`.
//
// ─── POR QUÉ, Y QUÉ ARREGLA ────────────────────────────────────────────────────────────────
//
// Hasta hoy este archivo escribía a mano trece columnas que espejaban «el estilo» de
// `ordenes-columns.tsx`. Espejar no es compartir: la central llegó a diecinueve columnas y ésta
// se quedó en trece, el Estado se pintaba como TEXTO donde la central pinta un chip, y nada se
// puso rojo por ello. Es el mismo defecto que el backend acaba de retirar de la capa de datos
// —había TRES listas paralelas para una sola fila— visto desde la pantalla.
//
// Lo que lo hace posible sin un solo `as`: desde la 349 la fila de esta pantalla
// (`RecepcionSateliteDTO` = `FilaBodegaSatelite`) es un SUBTIPO ESTRICTO de `OrdenListItemDTO`,
// y `render: (row: T) => ReactNode` es contravariante en su parámetro bajo
// `strictFunctionTypes`. El día que el contrato deje de cumplirlo, la línea del `return` deja
// de compilar — que es exactamente lo que se quiere. Un cast aquí sería la costura por la que
// las dos pantallas volverían a divergir sin que el compilador dijera nada. Mismo mecanismo,
// misma razón y mismo precedente que `columnasDetalle` en `/monitoreo` (feature 260/R26).
//
// ─── LO QUE SE GANA, Y NO ES DECORACIÓN ────────────────────────────────────────────────────
//
// «Estado» pasa a ser el `EstatusBadge` de `/ordenes` (el chip con su variante semántica), y
// aparecen «Mensajero», «Fecha de creación» y «Tiempo», que la fila ya trae desde la 349.
//
// El chip pierde el sufijo « de <zona>» que esta pantalla componía (feature 33/R9). No se
// pierde el dato: la ZONA de cada orden viaja en su propia columna, que está tres celdas más
// allá. Es la misma decisión —y por el mismo motivo— que ya tomó el archivo descargable de
// esta misma pantalla en la 170/R8: «la zona ya viaja en su propia columna y repetirla en el
// estado convierte un dato en dos».
//
// ─── POR QUÉ `ordenesColumns` Y NO `ordenesColumnsReprogramada` ────────────────────────────
//
// La variante añade «Liberada el», que es el día para el que quedó reprogramada la orden: en
// `/ordenes` pertenece a la pestaña acotada al estado `reprogramada`. Este listado MEZCLA cinco
// estados y `reprogramada` NO es ninguno de ellos (`ESTADOS_BODEGA_SATELITE`), así que la
// columna hablaría de algo que aquí no se lista. Medido contra la base local el 2026-09-01: de
// las 6 filas del listado satélite, 0 tienen reprogramación vigente. Mismo criterio y mismo
// precedente que `/monitoreo` (feature 260/R45), el otro listado de estados mezclados.
//
// ─── QUÉ NO PUEDE APARECER EN ESTE ARCHIVO ─────────────────────────────────────────────────
//
// Una definición de columna. Ni una. Si alguien vuelve a escribirlas a mano —que es el defecto
// que esta ficha cierra— se pone rojo en `tests/unit/components/recibidas-columns.test.tsx`,
// que comprueba las dos mitades: que cada columna montada es EL MISMO OBJETO que declaró
// `ordenesColumns`, y que la fuente de este módulo no contiene ni un `value:`.

import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";
import type { Column } from "@/components/shared/DataTable";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

/**
 * Los ids de `ordenesColumns` que leen un campo que `recortarPorAlcance(fila, "zona")` RETIRA
 * en la capa de datos (`CAMPOS_SOLO_ALCANCE_GLOBAL`, `lib/types/recorte-alcance-orden.ts`):
 *
 *   · `flete`       lee `fleteConIva`;
 *   · `comision`    lee `comisionConIva`;
 *   · `fulfillment` lee `relaciones.tienda.tarifa.fulfillment`.
 *
 * Se retiran como COLUMNA y nunca como VALOR, por la razón que ya escribió la 260/R15: sin
 * esto `PriceLabel` convertiría el hueco en `₡0,00`, que se lee como «esta orden no paga
 * flete» — una afirmación FALSA, y eso es peor que enseñar la cifra. El test lo demuestra
 * pintando las tres sobre una fila ya recortada, en vez de darlo por sabido.
 *
 * `montoCobrar` NO está, y es la decisión de la 260/R17: ese importe se muestra en los DOS
 * alcances y el satélite ya lo veía en esta misma pantalla.
 *
 * Es la MISMA lista que declara `/monitoreo` para el mismo alcance. Se escribe aquí en vez de
 * importarse de allí porque este módulo entra en el bundle de CLIENTE y el guardia del bundle
 * recorre los imports sin distinguir `import type`: traerse `detalle-columnas` arrastraría
 * `lib/types/tablero-dia` y con él la ruta `→ lib/analytics/alcance → lib/auth/acceso-total`.
 * Que las dos declaraciones no puedan divergir lo ata el test, que compara ambas.
 */
export const COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA: readonly string[] = [
  "flete",
  "fulfillment",
  "comision",
];

/**
 * Columnas de DATOS del listado «Órdenes de la bodega» del `adminSatelite`.
 *
 * La columna «Seleccionar» y la de «Incidente» NO viven aquí: las compone el módulo padre
 * (`SateliteOrdenesListado`), que es la fuente de verdad de la selección y de la regla de
 * disponibilidad del incidente — igual que `OrdenesModule` antepone su checkbox en `/ordenes`.
 */
export function recibidasColumns(): Column<RecepcionSateliteDTO>[] {
  return ordenesColumns.filter(
    (columna) => !COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA.includes(columna.id),
  );
}
