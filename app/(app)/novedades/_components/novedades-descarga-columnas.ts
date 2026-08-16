/**
 * Columnas de EXPORT del listado de NOVEDADES (las devoluciones de la tienda del adminTienda).
 *
 * El archivo publica lo que la PANTALLA enseña, ni más ni menos. Las cards de `/novedades`
 * pintan la guía (o su placeholder), la remisión, el destinatario con sus botones de contacto,
 * la dirección y la ubicación, el producto, el monto que se iba a cobrar, la causa de devolución
 * y los intentos de entrega; eso es exactamente lo que sale aquí. Publicar por el archivo un dato
 * que la pantalla oculta sería saltarse la decisión de la pantalla por la puerta de atrás.
 *
 * Lo que NO viaja, y por qué:
 *  - `id`/`latitud`/`longitud`: uuid interno y coordenadas de geocodificación, ruido para quien
 *    abre la hoja y sin lectura posible fuera de la app.
 *  - `tiendaNombre`: esta pantalla es la de una sola tienda —la del actor—, así que la columna
 *    repetiría el mismo valor en todas las filas.
 *  - `estatusValue`: todas las órdenes del listado están devueltas; la señal es la CAUSA.
 *
 * El TELÉFONO sí viaja: la pantalla lo usa (los botones de WhatsApp y Llamar salen de él) y es
 * justo el dato con el que la tienda retoma una devolución fuera de la app. El archivo se arma en
 * el navegador de quien ya está viendo esos teléfonos y no se sube a ningún sitio.
 *
 * Módulo PURO: sin React ni DOM. Valores CRUDOS (`null` es celda vacía, no el «—» de
 * presentación); la causa sale como ETIQUETA ES, nunca como el slug del enum.
 */
import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { NovedadDTO } from "@/lib/types/novedad";

/** Nombre de la hoja, base del nombre de archivo y nombre accesible del control. */
export const TITULO_DESCARGA_NOVEDADES = "Novedades";

/** Texto de la celda cuando la orden no tiene causa vigente registrada (mismo que la card). */
export const SIN_CAUSA_REGISTRADA = "Sin causa registrada";

export const COLUMNAS_DESCARGA_NOVEDADES: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "telefono", encabezado: "Teléfono" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "ubicacion", encabezado: "Ubicación" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "montoCobrar", encabezado: "Monto a cobrar" },
  { clave: "causa", encabezado: "Causa de devolución" },
  { clave: "intentos", encabezado: "Intentos de entrega" },
];

/** Jerarquía geográfica en una línea, misma composición que el resto de los archivos. */
function ubicacion(novedad: NovedadDTO): string | null {
  const partes = [
    novedad.zonaNombre,
    novedad.provinciaNombre,
    novedad.cantonNombre,
    novedad.distritoNombre,
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length === 0 ? null : partes.join(" · ");
}

/**
 * Proyecta una novedad a su fila del archivo. La guía es NULLABLE (se asigna en «Generar guía»):
 * sin ella la celda queda VACÍA, no con el placeholder que la card pinta en pantalla —un texto de
 * presentación en una hoja de cálculo estorba a quien filtra u ordena por esa columna—.
 *
 * `intentosEntrega` es opcional en el contrato pero el servicio SIEMPRE lo emite: el `?? 0`
 * conserva ese `0`, que es un dato («ningún intento»), no un hueco.
 */
export function filaDescargaNovedad(novedad: NovedadDTO): DescargaFila {
  return {
    numGuia: novedad.numGuia,
    numRemision: novedad.numRemision,
    destinatario: novedad.destinatario,
    telefono: novedad.telefonoDest,
    direccion: novedad.direccion,
    ubicacion: ubicacion(novedad),
    producto: novedad.producto,
    montoCobrar: novedad.montoCobrar,
    causa: novedad.causa ? CAUSA_DEVOLUCION_LABEL[novedad.causa] : SIN_CAUSA_REGISTRADA,
    intentos: novedad.intentosEntrega ?? 0,
  };
}
