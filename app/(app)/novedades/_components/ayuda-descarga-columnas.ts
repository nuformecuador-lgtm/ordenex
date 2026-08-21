/**
 * Columnas de EXPORT de la pestaña «Ayuda solicitada»: las órdenes sobre las que un mensajero de
 * esta tienda pidió ayuda y siguen esperando respuesta (feature 236, T3.2 — D3/R37/R39).
 *
 * **Por qué existe este archivo y no se reusa el de novedades.** La regla estaba ya escrita en su
 * hermano: «el archivo publica lo que la PANTALLA enseña, ni más ni menos… publicar por el archivo
 * un dato que la pantalla oculta sería saltarse la decisión de la pantalla por la puerta de atrás».
 * Si la pantalla separa las dos poblaciones en dos pestañas, el archivo también. Hasta el
 * 2026-08-19 estas órdenes salían mezcladas en el archivo de devoluciones, con la columna «Causa de
 * devolución» diciendo **«Sin causa registrada»** sobre una orden que NUNCA se devolvió: eso no es
 * un hueco, es una afirmación falsa con formato de dato (R26/R39).
 *
 * **Coste de la migración: cero, y está medido.** El 2026-08-19 había `devuelta` = 0 y
 * `ayuda_tienda` = 0 en producción, sobre 141 órdenes vivas en 11 estatus
 * (`progress/medicion_236.md`): nadie tiene un archivo viejo que cambie de forma bajo los pies.
 *
 * Lo que cambia respecto del archivo de devoluciones, y sólo esto:
 *  - **NO existe la columna de causa** (R39). Ni con valor, ni vacía, ni anunciando su ausencia.
 *  - **SÍ viajan los INTENTOS DE CONTACTO**, que son la columna propia de esta pestaña: es el
 *    contador que la tienda sube con «+1 intento de contacto» mientras resuelve la ayuda, y el dato
 *    con el que sabe cuántas veces ya intentó llamar antes de decidir qué hacer con el paquete.
 *
 * Lo que NO viaja, con el mismo criterio que su hermano:
 *  - `id`/`latitud`/`longitud`: uuid interno y coordenadas de geocodificación, ruido para quien
 *    abre la hoja y sin lectura posible fuera de la app.
 *  - `tiendaNombre`: esta pantalla es la de una sola tienda —la del actor—, así que la columna
 *    repetiría el mismo valor en todas las filas.
 *  - `estatusValue`: todas las órdenes de esta pestaña están en el mismo estado; no informa.
 *  - **el cuerpo de las notas del hilo**: ni columna ni concatenación. Sería sacar de la app texto
 *    libre escrito por dos personas sobre un cliente, y nadie lo pidió (R47).
 *
 * El TELÉFONO sí viaja, con el razonamiento ya escrito para la otra descarga: la pantalla lo usa
 * (los botones de WhatsApp y Llamar salen de él) y es justo el dato con el que la tienda retoma el
 * caso fuera de la app. El archivo se arma en el navegador de quien ya está viendo esos teléfonos.
 *
 * Módulo PURO: sin React ni DOM. Valores CRUDOS (`null` es celda vacía, no el «—» de presentación).
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { NovedadDTO } from "@/lib/types/novedad";

/**
 * Nombre de la hoja, base del nombre de archivo y nombre accesible del control.
 *
 * D6, firmada por el humano el 2026-08-19: la pestaña se llama «Ayuda solicitada», y el archivo se
 * llama igual que la pestaña. NO «Ayuda a gestionar» (§F2 del diseño de la pila): «gestionar» es en
 * este repo el verbo del MENSAJERO —gestionar una orden es registrar su desenlace— y usarlo en la
 * pantalla de la tienda le atribuye un gesto que no es suyo.
 */
export const TITULO_DESCARGA_AYUDA = "Ayuda solicitada";

/**
 * SU SUPERFICIE (T4.2, cableada el 2026-08-19): el `DescargarDatasetButton` de la pestaña «Ayuda
 * solicitada», que las toma de `RECURSOS_POR_GRUPO.ayuda` en `NovedadesModule`. Aqui vivio una
 * anotacion `@sin-superficie` TRANSITORIA mientras la pantalla era otra tanda del mismo PR; se
 * retiro al cablearla, que es lo que la guardia `superficie-de-uso` exige de toda anotacion en
 * cuanto su motivo caduca.
 */
export const COLUMNAS_DESCARGA_AYUDA: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "telefono", encabezado: "Teléfono" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "ubicacion", encabezado: "Ubicación" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "montoCobrar", encabezado: "Monto a cobrar" },
  // La columna propia de esta pestaña. En el archivo de devoluciones no está.
  { clave: "intentosContacto", encabezado: "Intentos de contacto" },
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
 * Proyecta una orden en ayuda a su fila del archivo. La guía es NULLABLE (se asigna en «Generar
 * guía»): sin ella la celda queda VACÍA, no con el placeholder que la card pinta en pantalla —un
 * texto de presentación en una hoja de cálculo estorba a quien filtra u ordena por esa columna—.
 *
 * Los DOS contadores emiten su `0`, que es un valor CONOCIDO («nadie lo ha intentado todavía»), no
 * un dato ausente. `intentosContacto` es obligatorio en el contrato (el servicio lo emite siempre,
 * el cero incluido) y por eso viaja tal cual; `intentosEntrega` es opcional, así que el `?? 0`
 * conserva ese cero en vez de dejar la celda vacía.
 */
export function filaDescargaAyuda(novedad: NovedadDTO): DescargaFila {
  return {
    numGuia: novedad.numGuia,
    numRemision: novedad.numRemision,
    destinatario: novedad.destinatario,
    telefono: novedad.telefonoDest,
    direccion: novedad.direccion,
    ubicacion: ubicacion(novedad),
    producto: novedad.producto,
    montoCobrar: novedad.montoCobrar,
    intentosContacto: novedad.intentosContacto,
    intentos: novedad.intentosEntrega ?? 0,
  };
}
