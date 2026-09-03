import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import {
  CATEGORIA_LABELS,
  ENTIDAD_LABELS,
  type HistorialAccionDTO,
} from "@/lib/types/historial-accion";

import { ACTOR_SISTEMA, fechaCR } from "./historial-acciones-columnas";

/**
 * FICHA 362 / T6.2 (design §4.6, R38) — columnas de EXPORT del registro de acciones.
 *
 * Modulo PURO: sin React ni DOM. Cada celda es `string | number | null` y nada mas.
 *
 * ⚠️ SIN `id`, SIN `entidadId` y SIN `loteId`, y no es una omision: `columnas-sensibles.guardia`
 * rechaza la forma uuid en una celda y los identificadores internos en clave o encabezado
 * (R38). `entidadId` ademas NO CRUZA el borde —el DTO no lo trae—, asi que aqui no habria ni
 * de donde sacarlo; se dice igual porque el dia que alguien lo anada al DTO, esta linea es la
 * que le recuerda por que no puede publicarlo. `loteId` si viaja en el DTO (agrupa los N
 * efectos de UN acto) y por eso su exclusion tiene que ser deliberada: es un uuid.
 *
 * LAS DIEZ SON LAS DE LA PANTALLA, en el mismo orden (`historial-acciones-columnas.tsx`).
 * Que el archivo y la tabla digan lo mismo no es cosmetico: quien audita compara los dos, y
 * dos versiones del mismo hecho no se pueden reconciliar.
 *
 * SIN SELECTOR DE COLUMNAS (`ambitoColumnas` de la 314): salen las diez, siempre. Es lo que
 * hacen las demas tablas que no lo declaran, y en un registro de auditoria una descarga
 * recortada por una preferencia guardada en el navegador es justo lo que no se quiere — el
 * archivo tiene que ser el mismo para todos.
 *
 * MONEY-SAFE (R6): `monto` se emite TAL CUAL, el STRING de escala 2 que mando el servidor.
 * Ni `Number(`, ni `parseFloat(`, ni `toFixed(`, ni el simbolo de moneda: es el mismo criterio
 * que `ordenes-descarga-columnas` (que emite `montoCobrar` crudo) y el que deja la celda
 * utilizable en una hoja de calculo.
 */
export const COLUMNAS_DESCARGA_HISTORIAL_ACCIONES: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "actor", encabezado: "Quién" },
  { clave: "rol", encabezado: "Rol" },
  { clave: "categoria", encabezado: "Categoría" },
  { clave: "accion", encabezado: "Qué" },
  { clave: "entidadTipo", encabezado: "Tipo" },
  { clave: "entidad", encabezado: "Sobre qué" },
  { clave: "monto", encabezado: "Importe" },
  { clave: "anterior", encabezado: "Valor anterior" },
  { clave: "nuevo", encabezado: "Valor nuevo" },
];

/**
 * Proyeccion de UNA fila del registro a su fila de export.
 *
 * `accionLabel` y `entidadEtiqueta` se copian tal cual: vienen CONGELADOS del servidor y
 * re-derivarlos volveria a atar el archivo al presente (R3/R4). La ausencia se emite como
 * `null` —y no como la raya de la pantalla—: una celda vacia en una hoja de calculo es
 * ordenable y filtrable; una raya es texto.
 */
export function filaDescargaHistorialAccion(fila: HistorialAccionDTO): DescargaFila {
  return {
    // R35: el instante, en el calendario y el reloj de Costa Rica. El MISMO formateador que
    // pinta la pantalla, para que las dos digan la misma hora.
    fecha: fechaCR(fila.fecha),
    // R36: sin actor es el SISTEMA, tambien en el archivo. Una celda vacia aqui se leeria
    // como un dato que falta.
    actor: fila.actorNombre ?? ACTOR_SISTEMA,
    rol: fila.actorRol === null ? null : ROL_LABELS[fila.actorRol],
    categoria: CATEGORIA_LABELS[fila.categoria],
    accion: fila.accionLabel,
    entidadTipo: ENTIDAD_LABELS[fila.entidadTipo],
    entidad: fila.entidadEtiqueta,
    monto: fila.monto,
    anterior: fila.valorAnterior,
    nuevo: fila.valorNuevo,
  };
}
