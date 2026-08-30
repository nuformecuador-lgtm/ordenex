import { fechaLegible } from "@/lib/utils/dia-reparto-textos";

/**
 * FICHA 333 (G1, design §7) — EL VOCABULARIO VISIBLE de la cola de cobros de gasto fijo por
 * aprobar.
 *
 * Módulo PURO: sin React, sin `Intl` y **sin leer ningún reloj**. Los textos viven aquí y no
 * dentro del componente por la misma regla que `wallet-labels.ts` y `dia-reparto-textos.ts`
 * (`docs/conventions.md`: textos de UI fuera del componente), y porque los mensajes de resultado
 * se leen en dos sitios —el panel los dispara, el test los afirma— y con los literales repartidos
 * acabarían diciendo cosas distintas.
 *
 * ⚠️ AQUÍ NO SE FORMATEA NINGÚN MONTO. El importe se pinta con `money(...)` sobre el STRING que
 * mandó el servidor (R43): este módulo sólo pone en palabras el período y la fecha de generación,
 * que son texto y no dinero.
 */

/** El nombre accesible de la sección: por él la encuentra quien navega por regiones. */
export const COBROS_PENDIENTES_SECCION = "Cobros de gasto fijo por aprobar";

/** El título VISIBLE de la tarjeta. Es el mismo que el de la región, a propósito. */
export const COBROS_PENDIENTES_TITULO = COBROS_PENDIENTES_SECCION;

/**
 * Lo que la tarjeta explica en una línea (R37): que ese dinero **no ha salido** de la caja y que
 * espera una decisión. Voseo, sin siglas y sin nombrar ninguna tabla ni ningún estado interno.
 */
export const COBROS_PENDIENTES_DESCRIPCION =
  "Nadie los cobró todavía: el dinero sigue en la caja y esperan tu decisión.";

/** Encabezados de las columnas de la cola, en el orden en que se leen. */
export const COBROS_PENDIENTES_COLUMNA = {
  concepto: "Concepto",
  periodo: "Período",
  monto: "Monto",
  generadoEl: "Generado el",
  acciones: "Acciones",
} as const;

/** Las dos decisiones, con el texto que llevan los botones de cada fila (R40). */
export const COBRO_ACCION = {
  aprobar: "Aprobar",
  rechazar: "Rechazar",
} as const;

/** Lo que dice la tabla cuando la cola se vacía mientras se mira (R38 lo resuelve fuera). */
export const COBROS_PENDIENTES_VACIO = "No queda ningún cobro esperando decisión.";

/**
 * El texto de la insignia de la cabecera (R41). Recibe el `total` **del servidor**, nunca el
 * largo del array pintado: `items` viene recortado por el tope del dominio, así que si algún día
 * hubiera más filas de las que caben, este número lo dice y la pantalla no miente.
 */
export function totalPorAprobarTexto(total: number): string {
  return total === 1 ? "1 por aprobar" : `${total} por aprobar`;
}

const PERIODO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO_MES = /^\d{4}-\d{2}$/;

/** Lo que `fechaLegible` pone entre el día y el mes; sirve para recortar el día. */
const SEPARADOR_DIA_MES = " de ";

/**
 * El período de un cobro, EN PALABRAS: `"2026-08"` → «agosto de 2026»; `"2026-08-29"` → «29 de
 * agosto de 2026». Lo que no tenga ninguna de las dos formas se devuelve TAL CUAL, mismo criterio
 * que `fechaLegible`: recortar a ciegas algo que no es un período produce basura con pinta de dato.
 *
 * CON AÑO SIEMPRE: la cola mezcla plantillas mensuales y semanales, y un cobro atrasado puede
 * cruzar el año. «Agosto» a secas sería ambiguo justo en la fila que más importa.
 *
 * ⚠️ EL NOMBRE DEL MES SALE DE `fechaLegible`, y no de una tabla escrita aquí. La única tabla de
 * meses del repo vive en `lib/utils/dia-reparto-textos.ts` y no se exporta; copiarla sería la
 * segunda copia que diverge a la primera corrección. Para el período mensual se le pasa el día 1
 * y se recorta el día, que es una operación de TEXTO: ningún reloj entra en este módulo.
 */
export function periodoCobroLegible(periodo: string): string {
  const anio = periodo.slice(0, 4);
  if (PERIODO_DIA.test(periodo)) return `${fechaLegible(periodo)}${SEPARADOR_DIA_MES}${anio}`;
  if (!PERIODO_MES.test(periodo)) return periodo;
  const conDiaUno = fechaLegible(`${periodo}-01`);
  const corte = conDiaUno.indexOf(SEPARADOR_DIA_MES);
  if (corte === -1) return periodo;
  const mes = conDiaUno.slice(corte + SEPARADOR_DIA_MES.length);
  return `${mes}${SEPARADOR_DIA_MES}${anio}`;
}

/**
 * El día CR en que la corrida generó el cobro (`YYYY-MM-DD`), en palabras y con año: «29 de
 * agosto de 2026». Misma forma que la columna «Próximo cobro» de la tabla de plantillas, para
 * que las dos fechas de esta pantalla se lean igual.
 */
export function generadoElLegible(fecha: string): string {
  if (!PERIODO_DIA.test(fecha)) return fecha;
  return `${fechaLegible(fecha)}${SEPARADOR_DIA_MES}${fecha.slice(0, 4)}`;
}

/**
 * FICHA 333 (G4/G7, R55) — lo que la confirmación del borrado de una plantilla dice ANTES de que
 * el usuario acepte: **cuántos** cobros pendientes se van a cancelar, con el número delante.
 *
 * El cero tiene frase propia y no se calla: «no hay ninguno» es una respuesta, y dejar el hueco
 * en blanco haría indistinguibles «no hay» de «no se pudo leer», que es justo la distinción que
 * necesita quien está a punto de borrar algo irreversible.
 */
export function cobrosPendientesACancelarTexto(pendientes: number): string {
  if (pendientes === 0) return "No hay cobros pendientes que cancelar.";
  return pendientes === 1
    ? "Se cancelará 1 cobro pendiente de esta plantilla."
    : `Se cancelarán ${pendientes} cobros pendientes de esta plantilla.`;
}

/** Mientras se lee el número (R55: se pide AL ABRIR la confirmación, no antes). */
export const COBROS_PENDIENTES_CONTANDO = "Contando los cobros pendientes…";

/**
 * Y si la lectura falla, se dice — no se finge un cero. Un «0» inventado invitaría a borrar
 * creyendo que no hay nada que cancelar.
 */
export const COBROS_PENDIENTES_SIN_CONTAR =
  "No se pudo saber cuántos cobros pendientes tiene esta plantilla.";

/**
 * FICHA 333 (G4, R56) — lo que se anuncia DESPUÉS del borrado, con el número REALMENTE cancelado
 * que devuelve el servidor. Si entre la confirmación y la ejecución alguien aprobó o rechazó uno,
 * el número cambia y el aviso dice el que valió, no el que se prometió.
 */
export function plantillaEliminadaTexto(pendientesCancelados: number): string {
  // `> 0` y no `!== 0`: cubre el cero sin inventar una frase para un número que nadie espera.
  if (!(pendientesCancelados > 0)) return "Plantilla eliminada.";
  return pendientesCancelados === 1
    ? "Plantilla eliminada. Se canceló 1 cobro pendiente."
    : `Plantilla eliminada. Se cancelaron ${pendientesCancelados} cobros pendientes.`;
}

/**
 * LOS MENSAJES DE CADA FINAL, y el matiz de los dos primeros es el motivo de que vivan juntos.
 *
 * - `aprobado` — el camino normal: el egreso acaba de escribirse en el libro.
 * - `yaEstabaEnElLibro` (R19) — **no es un error**. Si alguien cambió el interruptor de la
 *   plantilla a mitad de período, el movimiento ya existía; el cobro se marca aprobado, se enlaza
 *   al que había y NO se cobra dos veces. Decir «cobro aprobado» a secas escondería que el dinero
 *   salió antes, y decir «error» sería falso.
 * - `yaDecidido` (R17/R18) — **tampoco es un error del usuario**: alguien decidió antes, o dos
 *   aprobaciones llegaron a la vez y el motor serializó. El tono es informativo, no de fallo.
 */
export const COBRO_MENSAJE = {
  aprobado: "Cobro aprobado: el egreso ya está en el libro de movimientos.",
  yaEstabaEnElLibro:
    "Ese cobro ya estaba en el libro: se marcó como aprobado y no se cobró dos veces.",
  rechazado: "Cobro rechazado: no salió nada de la caja.",
  yaDecidido: "Alguien decidió este cobro antes que vos. Se actualizó la lista.",
  noExiste: "Ese cobro ya no existe. Se actualizó la lista.",
  sinPermiso: "No tenés permiso para decidir cobros de gasto fijo.",
  sesionExpirada: "Tu sesión expiró. Iniciá sesión de nuevo.",
  noSePudo: "No se pudo procesar el cobro. Volvé a intentarlo.",
  errorCarga: "No se pudieron cargar los cobros de gasto fijo por aprobar.",
} as const;
