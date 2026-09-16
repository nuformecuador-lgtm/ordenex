/**
 * ⭑ FICHA 431 (T21) — textos de `/wallet/satelites`: el dinero consolidado que todavía no ha
 * llegado a la central.
 *
 * Módulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente, e
 * i18n-ready. Lo que lleva un dato dentro es una FUNCIÓN, no una concatenación en el JSX.
 *
 * Lo que este archivo NO hace es tan importante como lo que hace: **no redefine el vocabulario de
 * la conciliación**. «Pendiente de conciliar», «Recibido», «Recibido incompleto», «Monto recibido»
 * y «Falta por recibir» se REEXPORTAN de `cierre-labels`, que es donde la guardia de vocabulario
 * los ancla a mano. Son el MISMO objeto, no una copia con los mismos valores: la consolidación que
 * esta pantalla concilia es la misma que `/cierres-admin` enseña, y dos mapas paralelos
 * divergirían en cuanto alguien tocara uno. Mismo precedente que `desglose-tienda-labels`, que
 * reexporta los suyos de `/mi-wallet`.
 */
export {
  ESTADO_CONCILIACION_LABEL,
  ESTADO_CONCILIACION_VARIANT,
  FALTA_POR_RECIBIR_LABEL,
  MONTO_RECIBIDO_LABEL,
  PENDIENTE_CONCILIAR_LABEL,
  RECIBIDO_INCOMPLETO_LABEL,
  RECIBIDO_LABEL,
  SIN_CONCILIAR_LABEL,
  estadoConciliacionDe,
  hayFaltantePorRecibir,
  type EstadoConciliacion,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

/** El formateador compartido. Money-safe: NO convierte a número, sólo compone la cadena. */
export { money } from "@/lib/config/moneda";

/** Cabecera de la página. */
export const SATELITES_PAGINA = {
  titulo: "Wallet · Satélites",
  descripcion: "Dinero consolidado que todavía no ha llegado a la central",
} as const;

/**
 * ⚠️ LA NOTA QUE IMPIDE QUE ALGUIEN SUME ESTE NÚMERO A LA CAJA Y CUENTE DOS VECES.
 *
 * Va al pie de la tabla, visible y sin desplegable. El saldo de esta pantalla NO es un movimiento
 * de caja: ese dinero **ya entró** a la caja de Ordenex cuando se aprobó el cierre de cada
 * mensajero, y aquí sólo se dice DÓNDE ESTÁ FÍSICAMENTE. Sin la nota, un número de siete cifras
 * llamado «pendiente» dentro del módulo Wallet se lee como plata por cobrar, y quien la sume al
 * balance la habrá contado dos veces.
 */
export const SALDO_NO_ES_CAJA_TITULO = "El saldo no es un movimiento de caja.";
export const SALDO_NO_ES_CAJA_NOTA_A =
  "Ese dinero ya entró a la caja de Ordenex cuando se aprobó el cierre de cada mensajero. Lo que " +
  "esta pantalla dice es";
export const SALDO_NO_ES_CAJA_NOTA_DESTACADO = "dónde está físicamente";
export const SALDO_NO_ES_CAJA_NOTA_B =
  ": cuánto queda en manos de cada bodega esperando llegar a la central.";

/** Las tres tarjetas de cabecera, con su rótulo y la línea que explica de qué se compone. */
export const RESUMEN_SATELITES = {
  pendienteRotulo: "Pendiente de conciliar",
  /** «en 4 consolidaciones de 3 bodegas» — el importe solo no se puede perseguir. */
  pendienteDetalle: (consolidaciones: number, bodegas: number) =>
    `en ${consolidaciones} ${plural(consolidaciones, "consolidación", "consolidaciones")} ` +
    `de ${bodegas} ${plural(bodegas, "bodega", "bodegas")}`,
  pendienteVacio: "no queda nada por llegar",
  recibidoRotulo: "Recibido este mes",
  recibidoDetalle: (n: number) =>
    `${n} ${plural(n, "consolidación conciliada", "consolidaciones conciliadas")}`,
  diferenciaRotulo: "Con diferencia",
  diferenciaDetalle: (n: number) =>
    `${n} ${plural(n, "consolidación llegó incompleta", "consolidaciones llegaron incompletas")}`,
  diferenciaVacio: "todo lo recibido llegó completo",
} as const;

/** Columnas de la tabla de saldos. */
export const SALDOS_SATELITES_COLUMNAS = {
  bodega: "Bodega",
  pendiente: "Pendiente",
  masAntigua: "Más antigua sin conciliar",
  ultimaRecibida: "Última recibida",
} as const;

/** El conmutador «Con pendiente (N) / Todas (N)». */
export const SALDOS_SATELITES_FILTRO = {
  ariaLabel: "Bodegas satélite por estado del saldo",
  conPendiente: "Con pendiente",
  todas: "Todas",
} as const;

/**
 * La antigüedad de la consolidación más vieja sin conciliar (R21).
 *
 * ⚠️ **SIN UMBRAL, y es la decisión Q6 escrita en código.** Aquí no hay un `if (dias > N)` que
 * encienda nada: se dice cuánto lleva y se acabó. Un umbral que dispare algo sería el bloqueo que
 * esta ficha retira, volviendo por la puerta de atrás. La presión es visibilidad, no freno.
 *
 * `null` = no hay cola, que NO es lo mismo que `0` («la más vieja es de hoy»).
 */
export function antiguedadLabel(dias: number | null): string {
  if (dias === null) return "al día";
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/** Nombres accesibles de la tabla de saldos y de sus controles. */
export const SALDOS_SATELITES_NOMBRE = {
  tabla: "Saldos de bodegas satélite",
  paginacion: "Paginación de los saldos de bodegas satélite",
  /** Nombre del botón que despliega la fila. Es la columna «Ver» del diseño. */
  expandir: (bodega: string) => `Ver desglose de ${bodega}`,
} as const;

export const SALDOS_SATELITES_VACIO_CON_PENDIENTE =
  "Ninguna bodega satélite tiene efectivo pendiente de llegar a la central.";
export const SALDOS_SATELITES_VACIO_TODAS = "Todavía no hay bodegas satélite registradas.";
export const SALDOS_SATELITES_ERROR = "No se pudieron cargar los saldos de las bodegas satélite.";

/** El desglose de UNA bodega. */
export const DESGLOSE_SATELITE = {
  pendienteRotulo: "Pendiente de llegar",
  /** El aviso `warning` de la cabecera cuando alguna consolidación llegó incompleta. */
  diferenciaTitulo: (n: number) =>
    n === 1
      ? "Una consolidación llegó incompleta"
      : `${n} consolidaciones llegaron incompletas`,
  /**
   * La diferencia EXPLICADA: qué se declaró, qué llegó y qué pasa con lo que falta. Los tres
   * importes llegan como STRING del servidor y se pintan tal cual; aquí no se resta nada.
   */
  diferenciaDetalle: (declarado: string, recibido: string, falta: string) =>
    `Se consolidaron ${declarado} y se recibieron ${recibido}. La diferencia de ${falta} sigue ` +
    "contando como pendiente de esta bodega hasta que llegue o se corrija la marca.",
  /** Cuando hay más de una incompleta, el detalle habla del conjunto y no de una fila. */
  diferenciaDetalleVarias: (falta: string) =>
    `Entre todas falta por llegar ${falta}. Esa diferencia sigue contando como pendiente de esta ` +
    "bodega hasta que llegue o se corrija la marca.",
} as const;

/** Columnas del desglose. */
export const DESGLOSE_SATELITE_COLUMNAS = {
  consolidada: "Consolidada",
  declarado: "Declarado",
  recibido: "Recibido",
  estado: "Estado",
  conciliadoPor: "Conciliado por",
} as const;

/** Nombres accesibles del desglose, TODOS con el nombre de la bodega dentro: puede haber varias
 *  filas abiertas a la vez y tres tablas llamadas «Consolidaciones» no identificarían ninguna. */
export const DESGLOSE_SATELITE_NOMBRE = {
  region: (bodega: string) => `Desglose de ${bodega}`,
  tabla: (bodega: string) => `Consolidaciones de ${bodega}`,
  paginacion: (bodega: string) => `Paginación de las consolidaciones de ${bodega}`,
  filtro: (bodega: string) => `Consolidaciones de ${bodega} por estado`,
} as const;

export const DESGLOSE_SATELITE_FILTRO = {
  sinConciliar: "Sin conciliar",
  todas: "Todas",
} as const;

export const DESGLOSE_SATELITE_VACIO =
  "Esta bodega no tiene consolidaciones que mostrar.";
export const DESGLOSE_SATELITE_ERROR =
  "No se pudo cargar el desglose de esta bodega.";

/** Marcador de «sin dato» de la pantalla. NUNCA baja a una descarga (ahí la celda va vacía). */
export const SIN_DATO = "—";

/** Plural simple, con las dos formas escritas: nada de quitar la «s» por regla morfológica. */
function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}
