/**
 * Feature 170 (T B.3, design §3/§7) — columnas de EXPORT del inventario de API keys.
 *
 * Es la tabla con más riesgo de la Tanda B, así que la lista de lo que NO sale va primero:
 *
 *  - **El secreto en claro.** No puede salir porque NO EXISTE en este camino: viaja una
 *    sola vez, en el retorno de generar/rotar (81/R18), y jamás vuelve a leerse (81/R19).
 *  - **`keyHash`.** El repositorio no lo proyecta (`LIST_SELECT`) y `ApiKeyListItem` no lo
 *    declara (82/R6). Aun así la guardia de datos sensibles lo comprueba sobre la fila
 *    proyectada (R21): la invariante se verifica, no se supone.
 *  - **El secreto de webhook.** Solo se revela una vez tras el alta; no vive en la fila del
 *    listado. La columna "Webhook" de la tabla es un BOTÓN que abre un modal y lee el estado
 *    bajo demanda (105/D2): no hay dato de webhook en la fila que exportar.
 *  - **`id` y `usuarioId`.** Uuid internos (R23). El identificador de NEGOCIO de una key es
 *    su `identificador`, que es el que sale.
 *
 * Lo que SÍ sale es exactamente lo que la tabla enseña (R24): identificador, prefijo,
 * usuario dedicado, tienda destino, fecha de creación y estado. La TIENDA DESTINO entra con
 * la feature 307, que es la que la puso en pantalla: R24 dice «lo que la tabla enseña», así
 * que añadir la columna a la tabla y no al archivo dejaría el export contando otra historia.
 * Sale el NOMBRE, nunca el `tiendaDestinoId` (uuid interno, R23). El PREFIJO no es secreto por construcción
 * (81/R17): son los primeros caracteres, lo mismo que ya se ve en pantalla, y sin el resto
 * del secreto no autoriza nada.
 *
 * Módulo PURO: sin React ni DOM (R7).
 */
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { ESTADO_API_KEY_LABEL } from "./api-key-estado-label";

/** Columnas emitidas por la descarga del inventario de API keys, en su orden de pantalla. */
export const COLUMNAS_DESCARGA_API_KEYS: DescargaColumna[] = [
  { clave: "identificador", encabezado: "Identificador" },
  { clave: "prefijo", encabezado: "Prefijo" },
  { clave: "usuarioDedicado", encabezado: "Usuario dedicado" },
  { clave: "tiendaDestino", encabezado: "Tienda destino" },
  { clave: "fechaCreacion", encabezado: "Fecha de creación" },
  { clave: "estado", encabezado: "Estado" },
];

/**
 * Fecha de creación como `YYYY-MM-DD` en el calendario de Costa Rica. El DTO tipa
 * `createdAt: Date`, pero según el borde de serialización puede llegar como string ISO
 * (misma coacción defensiva que `api-keys-columns`). Fecha inválida → celda vacía.
 *
 * NO se usa `toISOString().slice(0, 10)`: emitiría el día siguiente después de las 18:00 de
 * CR (off-by-one documentado en `lib/utils/fecha-cr`).
 */
function fechaCreacion(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : fechaCalendarioCR(d);
}

/**
 * Proyecta una API key del inventario a una fila de export con valores CRUDOS (R7).
 *
 * El prefijo sale TAL CUAL, sin el elipsis con que la tabla lo adorna: los puntos suspensivos
 * son presentación (dicen «esto sigue»), y en una celda se leerían como parte del valor.
 */
export function filaDescargaApiKey(apiKey: ApiKeyListItemDTO): DescargaFila {
  return {
    identificador: apiKey.identificador,
    prefijo: apiKey.keyPrefix,
    usuarioDedicado: apiKey.usuarioEmail,
    // Feature 307: `null` (sin tienda destino) -> celda vacía, no la cadena "null".
    tiendaDestino: apiKey.tiendaDestinoNombre,
    fechaCreacion: fechaCreacion(apiKey.createdAt),
    estado: ESTADO_API_KEY_LABEL[apiKey.estado] ?? apiKey.estado,
  };
}
