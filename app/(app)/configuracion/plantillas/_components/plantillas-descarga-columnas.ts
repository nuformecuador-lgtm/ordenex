/**
 * Feature 170 (T B.3, design §3/§7) — columnas de EXPORT del listado de plantillas de mensaje.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de `buildPlantillasColumns`, cuyo
 * `render` devuelve `ReactNode` (insignia de estado, botones) — una hoja de cálculo solo
 * admite valores crudos (R7).
 *
 * Columnas: las TRES de datos que la tabla pinta (la cuarta, "Acciones", son botones).
 *
 * DIVERGENCIA DECLARADA con `tasks.md` T B.3, que proponía «nombre, canal, estado, fecha»:
 *  - «canal» NO EXISTE. `PlantillaListItem` no tiene ese campo y ninguna tabla lo lleva:
 *    hoy la única superficie de plantillas es WhatsApp. Inventar una columna con un literal
 *    constante sería inventar un dato.
 *  - «fecha» (`createdAt`) SÍ existe en el DTO, pero la TABLA NO LA MUESTRA, y R24 prohíbe
 *    emitir campos que el listado no enseñe en pantalla. Si se quiere en el archivo, la
 *    salida correcta es añadir la columna a la tabla primero.
 *  - «cuerpo» sí está en la tabla (truncado a 80 caracteres, con el texto completo en el
 *    `title`), así que sale — y sale ENTERO: truncar en el archivo sería entregar un dato
 *    a medias sin avisar.
 *
 * Lo que NO sale: `id` (uuid interno, R23), `templateId` (identificador de Meta, interno de
 * la integración, que la tabla no muestra — R24) y `variables` (derivado del cuerpo).
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";
import { ESTADO_PLANTILLA_LABEL } from "./plantilla-estado-label";

/** Columnas emitidas por la descarga del listado de plantillas, en su orden de pantalla. */
export const COLUMNAS_DESCARGA_PLANTILLAS: DescargaColumna[] = [
  { clave: "nombre", encabezado: "Nombre" },
  { clave: "estado", encabezado: "Estado" },
  { clave: "cuerpo", encabezado: "Cuerpo" },
];

/**
 * Proyecta una plantilla del listado a una fila de export con valores CRUDOS (R7). El
 * estado sale como su ETIQUETA LEGIBLE (R8), la misma que pinta la insignia; el `??` cae al
 * valor crudo si el enum ganara un valor sin etiqueta.
 */
export function filaDescargaPlantilla(plantilla: PlantillaListItemDTO): DescargaFila {
  return {
    nombre: plantilla.nombre,
    estado: ESTADO_PLANTILLA_LABEL[plantilla.estado] ?? plantilla.estado,
    cuerpo: plantilla.cuerpo,
  };
}
