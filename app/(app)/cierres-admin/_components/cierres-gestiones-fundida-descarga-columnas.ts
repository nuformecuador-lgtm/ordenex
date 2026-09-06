/**
 * Feature 230 (T3.1, design §6) — la HOJA FUNDIDA: las columnas y la proyección del archivo
 * DETALLADO de cierres, una fila por GESTIÓN, cruzando los cierres de varios mensajeros.
 *
 * **Una sola declaración para las DOS pantallas** (R26). Los dos puntos de entrada —los cierres
 * del día de `cierres-admin` y los cierres de bodega del maestro— cubren conjuntos DISJUNTOS
 * (design §2.6) y cada uno llama a su propia Server Action, pero las 29 columnas y la función
 * que las puebla son estas, y solo estas: dos declaraciones «iguales» son dos declaraciones que
 * divergen a la primera columna nueva.
 *
 * **29 columnas** (D6/D8/D9, `design.md §6`, más las tres de medios de pago que sustituyeron a la
 * celda única «Método», el fulfillment congelado, las dos FECHAS del pedido del 2026-09-05, y
 * menos el par partido del flete de devolución). Las doce primeras se
 * pueblan SIEMPRE; las diecisiete restantes son específicas del resultado de la fila y, cuando no
 * aplican, la celda queda VACÍA —`null`, nunca el «—» de pantalla ni un relleno— y la columna NO
 * se omite (R9/R10/R46). Que la hoja tenga celdas vacías es el coste que el humano vio y aceptó
 * al pedir UN archivo en vez de cinco (D3); ver la cabecera de
 * `cierre-gestiones-descarga-columnas.ts`, que sigue explicando por qué allí son cinco.
 *
 * ── LAS DOS FECHAS NUEVAS, Y LA TERCERA QUE NO EXISTE (pedido humano del 2026-09-05) ──────
 *
 * El encargo fue «la fecha de la gestión y la fecha de asignación», con la sospecha de que la
 * de asignación y el «para hoy o para mañana» eran el mismo dato. **Se midió contra producción
 * antes de escribir una línea, y salieron TRES hechos que deciden estas columnas:**
 *
 *  1. `orden.asignado_at` y `orden.fecha_reparto` son **el mismo dato**: el día de `asignado_at`
 *     coincide con `fecha_reparto` en **1.063 de 1.063** gestiones medidas (100 %).
 *  2. La **fecha de gestión NO** coincide con ellas: difiere en **312 de 1.063** (**29 %**). Es
 *     un dato distinto y es el que faltaba de verdad.
 *  3. `asignado_at` y `fecha_reparto` **no son históricos: se pisan y se borran.** Se
 *     sobrescriben en cada reasignación, se anulan al deshacer una asignación, al liberar la
 *     orden a una bodega satélite y al aprobar el cierre de una orden sin gestionar. De ahí que
 *     266 gestiones dieran una «asignación» POSTERIOR a su propia gestión: son órdenes con
 *     varias gestiones (2,8 de media) donde el campo ya se había pisado.
 *
 * **Por eso NO hay —ni debe haber— una columna «Fecha de asignación».** Sería una tercera
 * columna con el contenido de la segunda (idénticas en el 100 % de lo medido) y peor fiabilidad
 * (un instante que se reescribe, frente a un día que al menos se lee como lo que es). Esto está
 * escrito aquí y no en un `progress/` porque la tentación de «completar la pareja» vuelve cada
 * pocos meses y el archivo es donde se mira. Si algún día hace falta el historial de
 * asignaciones, el sitio es `orden_historial`, que sí es inmutable — no una columna que se pisa.
 *
 * Y de ahí también que **`diaReparto` pueda venir vacío y eso esté BIEN**: la celda vacía dice
 * «esta orden ya no conserva su día de reparto», que es la verdad. Rellenarla con la fecha del
 * cierre inventaría un dato que nadie escribió.
 *
 * **NO HAY COLUMNA DE EVIDENCIA, en ningún resultado** (D8, R40/R41). No es que quede vacía: se
 * retiró entera, y el DTO que la alimenta tampoco trae nada de evidencia —ni la URL firmada ni
 * un booleano derivado—, así que no hay campo que mañana pueda convertirse en columna por
 * descuido. `TIENE_EVIDENCIA_*` y `tieneEvidencia` siguen intactos en el módulo de las cinco
 * descargas por sección, que son suyos y no se retiran (R3).
 *
 * **Tampoco salen el estado del cierre ni su destino** (D9, R12): son datos del grano CIERRE y
 * se quedan en la descarga general, que es la que los tiene.
 *
 * Módulo PURO (R48/R49): sin React y sin DOM, en su propio `*-descarga-columnas.ts` para que
 * `columnas-sensibles.guardia.test.ts` lo descubra por convención.
 *
 * MONEY-SAFE (R43/R44): todo monto es el STRING del snapshot TAL CUAL. Aquí no hay `parseFloat`,
 * ni `Number`, ni `toFixed`, ni aritmética, ni el símbolo de colón de `money()`: el archivo lo
 * consume una hoja de cálculo, no una persona.
 *
 * SIN IDENTIFICADORES INTERNOS (R42): el identificador de negocio de la fila es `numRemision`.
 */
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { DescargaCelda, DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  CAUSA_INCIDENTE_COL,
  COMISION_CON_IVA_LABEL,
  FLETE_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  FULFILLMENT_COL,
  INDEMNIZACION_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  INGRESO_TOTAL_COL,
  MONTO_COBRAR_COL,
  PAGO_MENSAJERO_COL,
  RECHAZO_MANUAL_BADGE_LABEL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
  RESULTADO_FILA_LABEL,
} from "./cierre-labels";
import { CLAVE_MEDIO_PAGO, montoPorMetodo } from "./desglose-pago";
import { COLUMNAS_MEDIOS_PAGO } from "./medios-pago-descarga-columnas";

// --- Encabezados propios de la fundida (texto separado de la lógica, i18n-ready) ---
//
// Los tres primeros nombran datos que NINGUNA de las cinco descargas por sección tenía que
// nombrar: el archivo era de UN cierre y de UNA sección, así que el mensajero iba en el NOMBRE
// del archivo, la fecha era la del cierre abierto y el resultado, el de la sección. Al cruzar
// cierres, sin estas tres columnas las filas no se distinguen (R7/R8).
//
// Los dos de FECHA son del pedido del 2026-09-05 y su porqué está en la cabecera. `FECHA_GESTION_COL`
// tiene gemela en las descargas por sección y en la del mensajero (allí se declara aparte, porque
// esas hojas no importan de aquí); `DIA_REPARTO_COL` es solo de la fundida — es el único camino
// cuyo DTO trae `orden.fecha_reparto`.
/** Dueño del cierre al que pertenece la gestión (R8). */
export const MENSAJERO_COL = "Mensajero";
/** Día calendario de SOLICITUD del cierre, que es por el que el conjunto se ordena (R11). */
export const FECHA_CIERRE_COL = "Fecha del cierre";
/**
 * Día calendario en que se REGISTRÓ la gestión (`gestion_orden.created_at`). Distinta de la del
 * cierre en el 29 % de los casos medidos; ver la cabecera.
 */
export const FECHA_GESTION_COL = "Fecha de gestión";
/**
 * Día para el que la orden estaba repartida (`orden.fecha_reparto`), el «para hoy o para
 * mañana». Puede venir VACÍA y es legítimo; ver la cabecera.
 */
export const DIA_REPARTO_COL = "Día de reparto";
/** Resultado de la gestión de esta fila, en singular y como etiqueta legible (R7/R45). */
export const RESULTADO_COL = "Resultado";

/**
 * Identificador de ÁMBITO de la preferencia de columnas de ESTA hoja (314/R10).
 *
 * UNO SOLO para las dos pantallas, y es lo correcto: `cierres-admin` y los cierres de bodega
 * cubren conjuntos disjuntos de gestiones, pero descargan la MISMA hoja con las MISMAS columnas
 * (R26). Un ámbito por pantalla partiría la preferencia de un solo juego de columnas en dos, y
 * quien ocultara «Indemnización» en una la seguiría viendo en la otra sin entender por qué.
 *
 * Se declara junto a las columnas —como los otros dieciséis— y se ASIGNA en un único módulo, el
 * control de descarga de cierres. `tests/unit/descarga/ambito-columnas.guardia.test.ts` vigila
 * que ningún identificador se repita en dos módulos, y por eso la asignación no puede
 * duplicarse en las dos pantallas.
 *
 * Su selector OCULTA pero NO REORDENA: el orden de estas 29 columnas es el agrupado que hace
 * legible la hoja (ver §6 abajo), y quien monta el selector lo declara con
 * `permitirReordenar={false}`.
 */
export const AMBITO_DESCARGA_GESTIONES_FUNDIDA = "cierres-gestiones";

/**
 * Las 29 columnas de la hoja fundida, en el orden decidido (`design.md §6`), con las tres de
 * MEDIOS DE PAGO donde antes iba la celda única «Método» y las dos FECHAS del pedido del
 * 2026-09-05 junto a la del cierre.
 *
 * Las dos nuevas van EN TERCERA Y CUARTA POSICIÓN, pegadas a «Fecha del cierre», y no al final:
 * quien abre la hoja lee las tres fechas de un vistazo y ahí es donde la diferencia entre ellas
 * salta (que es todo el punto de haberlas añadido). Ninguna columna existente cambia de orden
 * relativo — las aserciones literales de `cierres-gestiones-fundida-descarga-columnas.test.ts`
 * lo atornillan.
 *
 * Los encabezados que ya existían se LEEN de `cierre-labels` y no se teclean: es lo que hace
 * cierto que la pantalla y el archivo digan lo mismo, en vez de que hoy coincidan dos literales
 * escritos en dos archivos.
 */
export const COLUMNAS_DESCARGA_GESTIONES_FUNDIDA: DescargaColumna[] = [
  // --- 1-12: se pueblan SIEMPRE (salvo `diaReparto`, que puede venir vacío: ver cabecera) ---
  { clave: "mensajero", encabezado: MENSAJERO_COL },
  { clave: "fechaCierre", encabezado: FECHA_CIERRE_COL },
  { clave: "fechaGestion", encabezado: FECHA_GESTION_COL },
  { clave: "diaReparto", encabezado: DIA_REPARTO_COL },
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "ubicacion", encabezado: "Ubicación" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "resultado", encabezado: RESULTADO_COL },
  // --- 13-29: específicas del resultado; vacías donde no aplican (R10) ---
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "recibido", encabezado: "Recibido" },
  ...COLUMNAS_MEDIOS_PAGO,
  { clave: "nuevaFecha", encabezado: "Nueva fecha" },
  { clave: "origenRechazo", encabezado: RECHAZO_ORIGEN_COL },
  { clave: "causa", encabezado: CAUSA_INCIDENTE_COL },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "fleteConIva", encabezado: FLETE_CON_IVA_LABEL },
  { clave: "comisionConIva", encabezado: COMISION_CON_IVA_LABEL },
  { clave: "fleteDevolucionConIva", encabezado: FLETE_DEV_CON_IVA_LABEL },
  { clave: "ingresoTotal", encabezado: INGRESO_TOTAL_COL },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
  { clave: "indemnizacion", encabezado: INDEMNIZACION_COL },
];

/**
 * Las diecisiete claves ESPECÍFICAS, en el orden en que se declaran arriba. Es la lista de la que
 * sale el «todas vacías» de partida: cada resultado enciende las suyas y las demás quedan
 * vacías, en vez de que cada rama tenga que acordarse de apagar dieciséis.
 */
const CLAVES_ESPECIFICAS = [
  "montoCobrar",
  "fulfillment",
  "recibido",
  CLAVE_MEDIO_PAGO.efectivo,
  CLAVE_MEDIO_PAGO.SINPE,
  CLAVE_MEDIO_PAGO.transferencia,
  "nuevaFecha",
  "origenRechazo",
  "causa",
  "motivo",
  "fleteConIva",
  "comisionConIva",
  "fleteDevolucionConIva",
  "ingresoTotal",
  "pagoMensajero",
  "ingresoBodega",
  "indemnizacion",
] as const;

type ClaveEspecifica = (typeof CLAVES_ESPECIFICAS)[number];

/**
 * Qué columnas específicas puebla cada resultado (`design.md §6`, tabla de POBLADAS/VACÍAS).
 *
 * Cada lista es, columna por columna, la de la sección correspondiente del detalle de un cierre
 * MENOS la evidencia (D8): la hoja fundida no enseña nada que su sección no enseñe, que es la
 * lectura fiel de R24 de la feature 170.
 *
 * **El flete de devolución SE AGRUPA, y ahora también en la devuelta** (2026-08-19, revierte
 * D7): las dos —DEVUELTA y RECHAZADA— pueblan `fleteDevolucionConIva`, que es lo que las dos
 * tablas muestran desde este mismo cambio. El par partido (`fleteDevolucion` +
 * `ivaFleteDevolucion`) se retiró de la hoja: eran dos columnas para un importe que siempre se
 * lee sumado. El DTO los sigue trayendo por separado para el desglose de la fila desplegable.
 */
const ESPECIFICAS_POR_RESULTADO: Record<CierreResultado, readonly ClaveEspecifica[]> = {
  entregada: [
    "montoCobrar",
    "fulfillment",
    "recibido",
    CLAVE_MEDIO_PAGO.efectivo,
    CLAVE_MEDIO_PAGO.SINPE,
    CLAVE_MEDIO_PAGO.transferencia,
    "fleteConIva",
    "comisionConIva",
    "ingresoTotal",
    "pagoMensajero",
  ],
  reprogramada: ["montoCobrar", "fulfillment", "nuevaFecha", "motivo", "pagoMensajero"],
  devuelta: [
    "montoCobrar",
    "fulfillment",
    "motivo",
    "fleteDevolucionConIva",
    "ingresoTotal",
    "pagoMensajero",
  ],
  rechazada: [
    "montoCobrar",
    "fulfillment",
    "origenRechazo",
    "motivo",
    "fleteDevolucionConIva",
    "ingresoTotal",
    "pagoMensajero",
    "ingresoBodega",
  ],
  // Un incidente no paga al mensajero y no genera ingreso de bodega: esas dos quedan vacías.
  incidente: ["montoCobrar", "fulfillment", "causa", "motivo", "indemnizacion"],
};

/**
 * Jerarquía geográfica en una línea, con la MISMA composición que la columna «Ubicación» de la
 * pantalla y que las cinco descargas por sección. Los tramos vacíos se omiten; si no queda
 * ninguno, celda vacía.
 */
function ubicacion(gestion: CierreGestionDescargaDTO): string | null {
  const partes = [
    gestion.zonaNombre,
    gestion.provinciaNombre,
    gestion.cantonNombre,
    gestion.distritoNombre,
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length === 0 ? null : partes.join(" · ");
}

/** Las doce celdas que TODA fila lleva, sea cual sea su resultado. Valores CRUDOS. */
function celdasComunes(gestion: CierreGestionDescargaDTO): DescargaFila {
  return {
    mensajero: gestion.mensajeroNombre,
    fechaCierre: fechaDiaISO(gestion.cierreSolicitadoAt),
    // Las dos fechas nuevas llegan YA como día calendario `YYYY-MM-DD` del servidor, así que
    // aquí NO se les aplica `fechaDiaISO` ni ningún recorte: no hay nada que recortar, y pasar
    // un día por un extractor de días sugeriría que puede ser un instante, que es justo la
    // confusión que hizo falta evitar. `fechaCierre` sí lo necesita: ése viaja como ISO
    // completo desde antes de esta ficha y se emite como día, igual que en la pantalla.
    fechaGestion: gestion.fechaGestion,
    // `null` es una celda vacía legítima (ver cabecera): la orden perdió su día de reparto.
    diaReparto: gestion.diaReparto,
    numGuia: gestion.numGuia,
    numRemision: gestion.numRemision,
    destinatario: gestion.destinatario,
    direccion: gestion.direccion,
    ubicacion: ubicacion(gestion),
    producto: gestion.producto,
    tienda: gestion.tiendaNombre,
    // R45: SIEMPRE la etiqueta legible, JAMÁS el value del enum. El mapa es exhaustivo sobre
    // `CierreResultado`, así que no hay caída a un `?? gestion.resultado` que emitiera el slug.
    resultado: RESULTADO_FILA_LABEL[gestion.resultado],
  };
}

/**
 * Las diecisiete celdas específicas, TODAS derivadas, con independencia del resultado. Quién se
 * queda con cuáles lo decide `ESPECIFICAS_POR_RESULTADO`; aquí solo se calculan.
 *
 * Se calculan todas —y no solo las de la rama— por dos motivos. Uno: la derivación de cada celda
 * vive en UN sitio, en vez de repetirse en las ramas que la comparten (`montoCobrar` está en las
 * cinco, `motivo` en cuatro). Dos: la guardia de datos sensibles ejecuta esta proyección con una
 * SONDA que registra qué campo lee cada celda, y una rama que no se recorre es una lectura que
 * la guardia no vigila.
 */
function celdasEspecificas(
  gestion: CierreGestionDescargaDTO,
): Record<ClaveEspecifica, DescargaCelda> {
  const ingreso = gestion.ingresoOrdenex;
  const mediosPago = montoPorMetodo(gestion.pagos);
  return {
    // `null` cuando la orden no tenía tarifa vigente al solicitar (gap conocido de la feature
    // 69): celda VACÍA, que es lo que la pantalla enseña (R46).
    montoCobrar: ingreso ? ingreso.montoCobrar : null,
    // Monto FIJO de la tarifa CONGELADA (2026-08-19). No es un concepto derivado: no lo calcula
    // `derivarIngresoOrden` y no entra en `ingresoTotal`. Vacío si el cierre no lo congeló.
    fulfillment: ingreso?.tarifa?.fulfillment ?? null,
    recibido: gestion.montoRecibido,
    // Una columna POR MEDIO DE PAGO, money-safe: el STRING del snapshot tal cual. El medio sin
    // linea queda en `null` —celda VACIA (R10)—, que no es un cero.
    [CLAVE_MEDIO_PAGO.efectivo]: mediosPago.efectivo,
    [CLAVE_MEDIO_PAGO.SINPE]: mediosPago.SINPE,
    [CLAVE_MEDIO_PAGO.transferencia]: mediosPago.transferencia,
    nuevaFecha: gestion.fechaReprogramacion,
    // R45: la etiqueta del badge —«Automático» si lo escaló el cron de plazo vencido, «Manual»
    // si lo registró el mensajero—, nunca el booleano crudo.
    origenRechazo:
      gestion.esRechazoSla === true ? RECHAZO_SLA_BADGE_LABEL : RECHAZO_MANUAL_BADGE_LABEL,
    // R45: la causa sale como etiqueta legible; el slug del enum (`danado`) no se pinta nunca.
    causa: gestion.causaIncidente
      ? CAUSA_INCIDENTE_LABEL[gestion.causaIncidente] ?? gestion.causaIncidente
      : null,
    motivo: gestion.motivo,
    fleteConIva: ingreso ? ingreso.fleteConIva : null,
    comisionConIva: ingreso ? ingreso.comisionConIva : null,
    fleteDevolucionConIva: ingreso ? ingreso.fleteDevolucionConIva : null,
    ingresoTotal: ingreso ? ingreso.total : null,
    pagoMensajero: gestion.pagoMensajero,
    ingresoBodega: gestion.ingresoBodegaRechazo,
    // R47: `null` NO es cero. Es «todavía no se capturó» —el monto lo pone el admin al
    // aprobar—, y un 0 diría «no se indemniza», que es lo contrario.
    indemnizacion: gestion.indemnizacion,
  };
}

/**
 * Proyecta UNA gestión a UNA fila de la hoja fundida: las 29 claves declaradas, siempre las
 * mismas y siempre todas (R9), con las que no aplican a su resultado en VACÍO (R10).
 *
 * El `??` sobre `ESPECIFICAS_POR_RESULTADO` no es un caso de negocio: el mapa es exhaustivo
 * sobre `CierreResultado` y en producción siempre acierta. Está para que la guardia de datos
 * sensibles, que invoca esta función con una sonda —cuyo `resultado` no es ninguno de los
 * cinco—, siga viendo las diecisiete celdas específicas en vez de diecisiete nulos.
 */
export function filaDescargaGestionFundida(gestion: CierreGestionDescargaDTO): DescargaFila {
  const especificas = celdasEspecificas(gestion);
  const pobladas = ESPECIFICAS_POR_RESULTADO[gestion.resultado] ?? CLAVES_ESPECIFICAS;
  const fila: DescargaFila = { ...celdasComunes(gestion) };
  for (const clave of CLAVES_ESPECIFICAS) {
    fila[clave] = pobladas.includes(clave) ? especificas[clave] : null;
  }
  return fila;
}
