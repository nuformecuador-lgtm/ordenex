import { fechaLegible } from "@/lib/utils/dia-reparto-textos";

/**
 * 💰 FICHA 337 (segunda mitad) — EL VOCABULARIO VISIBLE de la cola de cobros por rechazo desde
 * novedades.
 *
 * Módulo PURO: sin React, sin `Intl` y **sin leer ningún reloj**. Los textos viven aquí y no
 * dentro del componente por la misma regla que `wallet-labels.ts` y `cobro-gasto-fijo-labels.ts`
 * (`docs/conventions.md`: textos de UI fuera del componente), y porque los mensajes de resultado
 * se leen en dos sitios —el panel los dispara, el test los afirma— y con los literales repartidos
 * acabarían diciendo cosas distintas.
 *
 * ⚠️ AQUÍ NO SE FORMATEA NINGÚN MONTO Y NO SE SUMA NADA. Los dos importes se pintan con
 * `money(...)` sobre los STRING que mandó el servidor, en columnas separadas. No hay columna
 * «Total» a propósito: sumarlos sería la única operación de dinero de toda la ficha, y existiría
 * sólo para pintar una celda. El detalle del cierre enseña esos mismos dos conceptos por separado.
 */

/** El nombre accesible de la sección: por él la encuentra quien navega por regiones. */
export const COBROS_RECHAZO_SECCION = "Cobros por rechazo de tienda por aprobar";

/** El título VISIBLE de la tarjeta. Es el mismo que el de la región, a propósito. */
export const COBROS_RECHAZO_TITULO = COBROS_RECHAZO_SECCION;

/**
 * Lo que la tarjeta explica en una línea: qué es esto y que **todavía no se le cobró nada** a la
 * tienda. Voseo, sin siglas, sin nombrar ninguna tabla ni ningún estado interno, y sin la palabra
 * «flete de devolución» a secas —que no dice de dónde viene—.
 */
export const COBROS_RECHAZO_DESCRIPCION =
  "La tienda rechazó estas devoluciones desde novedades. Todavía no se le cobró nada: esperan tu decisión.";

/** Encabezados de las columnas de la cola, en el orden en que se leen. */
export const COBROS_RECHAZO_COLUMNA = {
  tienda: "Tienda",
  guia: "Guía",
  remision: "Remisión",
  flete: "Flete devuelto",
  iva: "IVA",
  generadoEl: "Rechazado el",
  acciones: "Acciones",
} as const;

/** Las dos decisiones, con el texto que llevan los botones de cada fila. */
export const COBRO_RECHAZO_ACCION = {
  aprobar: "Cobrar",
  rechazar: "No cobrar",
} as const;

/** Lo que dice la tabla cuando la cola se vacía mientras se mira. */
export const COBROS_RECHAZO_VACIO = "No queda ningún cobro esperando decisión.";

/**
 * El texto de la insignia de la cabecera. Recibe el `total` **del servidor**, nunca el largo del
 * array pintado: `items` viene recortado por el tope del dominio, así que si algún día hubiera más
 * filas de las que caben, este número lo dice y la pantalla no miente.
 */
export function totalPorCobrarTexto(total: number): string {
  return total === 1 ? "1 por aprobar" : `${total} por aprobar`;
}

const FECHA_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Lo que `fechaLegible` pone entre el día y el mes; aquí sólo sirve para pegar el año. */
const SEPARADOR_DIA_MES = " de ";

/**
 * El día CR en que la tienda rechazó (`YYYY-MM-DD`), en palabras y con año: «31 de agosto de
 * 2026». Misma forma que «Generado el» de la cola de gasto fijo, para que las dos fechas de esta
 * pantalla se lean igual.
 *
 * ⚠️ EL NOMBRE DEL MES SALE DE `fechaLegible`, y no de una tabla escrita aquí: la única tabla de
 * meses del repo vive en `lib/utils/dia-reparto-textos.ts`, y una segunda copia divergiría a la
 * primera corrección. Lo que no tenga forma de fecha se devuelve TAL CUAL, mismo criterio que
 * `fechaLegible`: recortar a ciegas produce basura con pinta de dato.
 */
export function rechazadoElLegible(fecha: string): string {
  if (!FECHA_DIA.test(fecha)) return fecha;
  return `${fechaLegible(fecha)}${SEPARADOR_DIA_MES}${fecha.slice(0, 4)}`;
}

/** Una orden sin número de guía asignado. El hueco se NOMBRA, no se deja en blanco. */
export const SIN_GUIA = "—";

/**
 * LOS MENSAJES DE CADA FINAL, y el matiz de varios de ellos es el motivo de que vivan juntos.
 *
 * - `aprobado` — el camino normal: los apuntes acaban de escribirse en la caja y en el libro de
 *   la tienda.
 * - `yaEstabaEnElLibro` — **no es un error**. Los dos libros son idempotentes por sus índices
 *   únicos, así que un reintento tras una caída a medias puede encontrar los apuntes ya escritos:
 *   el cobro se marca aprobado y NO se cobra dos veces. Decir «cobro aprobado» a secas escondería
 *   que el dinero ya estaba; decir «error» sería falso.
 * - `yaDecidido` — **tampoco es un error del usuario**: alguien decidió antes, o dos aprobaciones
 *   llegaron a la vez y el motor serializó. El tono es informativo, no de fallo.
 */
export const COBRO_RECHAZO_MENSAJE = {
  aprobado: "Cobro aprobado: ya está en la caja y en el libro de la tienda.",
  yaEstabaEnElLibro:
    "Ese cobro ya estaba en los libros: se marcó como aprobado y no se cobró dos veces.",
  rechazado: "Cobro descartado: no se le cobró nada a la tienda.",
  yaDecidido: "Alguien decidió este cobro antes que vos. Se actualizó la lista.",
  noExiste: "Ese cobro ya no existe. Se actualizó la lista.",
  sinPermiso: "No tenés permiso para decidir cobros por rechazo de tienda.",
  sesionExpirada: "Tu sesión expiró. Iniciá sesión de nuevo.",
  noSePudo: "No se pudo procesar el cobro. Volvé a intentarlo.",
  errorCarga: "No se pudieron cargar los cobros por rechazo de tienda.",
} as const;
