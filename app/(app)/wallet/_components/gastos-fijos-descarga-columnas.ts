/**
 * Feature 170 (T D.3, design §3/§7) — columnas de EXPORT de las plantillas de gasto fijo.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las columnas del panel, cuyo `render`
 * devuelve un `Badge` y dos botones (R7).
 *
 * MONEY-SAFE: el monto mensual se emite como el STRING que devolvió el servidor, TAL CUAL,
 * sin `parseFloat`/`Number` y sin el símbolo de colón de `money` (presentación).
 *
 * Lo que NO sale: `id` (uuid interno, R23) y los campos del ciclo (`periodicidadUnidad`,
 * `periodicidadCantidad`, `fechaCobro`, `createdAt`, `updatedAt`): el DTO los trae, pero la
 * TABLA no los muestra, y R24 prohíbe emitir lo que el listado no enseña. Si se quisieran en
 * el archivo, la salida coherente es añadir la columna al panel primero.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

import { estadoPlantillaGastoFijo } from "./gasto-fijo-estado-label";

/** Columnas del archivo, en el orden de la pantalla: las tres de datos del panel (la
 * cuarta, "Acciones", son botones: no es un dato). */
export const COLUMNAS_DESCARGA_GASTOS_FIJOS: DescargaColumna[] = [
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "monto", encabezado: "Monto mensual" },
  { clave: "estado", encabezado: "Estado" },
];

/**
 * Proyecta una plantilla de gasto fijo a una fila de export con valores CRUDOS (R7). El
 * estado sale como la MISMA etiqueta legible que pinta el badge (R8), no como `true`/`false`.
 *
 * `activa === true` y no `activa` a secas: bajo la guardia de datos sensibles el DTO es una
 * sonda (siempre truthy), y la comparación estricta deja el `false` a la vista en el test de
 * columnas en vez de depender de la veracidad del proxy.
 */
export function filaDescargaGastoFijo(plantilla: GastoFijoPlantillaDTO): DescargaFila {
  return {
    concepto: plantilla.concepto,
    monto: plantilla.monto, // STRING tal cual (money-safe): sin parseo, sin símbolo
    estado: estadoPlantillaGastoFijo(plantilla.activa === true),
  };
}
