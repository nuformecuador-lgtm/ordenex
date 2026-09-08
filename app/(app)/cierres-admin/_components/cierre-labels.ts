/**
 * Feature 170 (tanda E) — etiquetas de texto de los cierres, en un módulo PURO.
 *
 * Todas estas constantes vivían en `cierre-detalle-shared.tsx`, que importa `Card`, `Badge`,
 * `Modal` y `DataTable`. Los módulos de columnas de export tienen que ser puros (design §3:
 * «sin React, sin DOM»), así que se PROMOVIERON aquí SIN EDITAR NI UN TEXTO —misma operación
 * que hizo la tanda B con `usuario-estado-label` y `ROL_LABELS`— y `cierre-detalle-shared`
 * las RE-EXPORTA: ningún consumidor de los que ya existían cambia una línea.
 *
 * Que el archivo descargado y la pantalla digan lo mismo (R8/R24) es cierto porque leen del
 * MISMO sitio, no porque hoy coincidan dos literales escritos en dos archivos.
 */
import type { MetodoPagoValue } from "@prisma/client";

import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
export const RESULTADO_LABEL: Record<CierreResultado, string> = {
  entregada: "Entregadas",
  reprogramada: "Reprogramadas",
  devuelta: "Devueltas",
  rechazada: "Rechazadas",
  incidente: "Incidentes", // feature 158/R18
};

/**
 * Feature 230 (T1.3, design §6.1) — el resultado de UNA gestion, en SINGULAR.
 *
 * `RESULTADO_LABEL` esta en plural porque nombra la SECCION de la pantalla («Entregadas»). La
 * hoja fundida emite una celda POR FILA, y una fila es una gestion: «Entregada».
 *
 * Es un segundo mapa y NO una derivacion del primero (nada de quitarle la «s»): las dos formas
 * son textos de interfaz, i18n-ready, y una regla morfologica del castellano incrustada en el
 * codigo se rompe en el primer idioma —o en el primer resultado— que no la cumpla.
 *
 * R45 exige que la celda sea SIEMPRE esta etiqueta y jamas el value del enum.
 */
export const RESULTADO_FILA_LABEL: Record<CierreResultado, string> = {
  entregada: "Entregada",
  reprogramada: "Reprogramada",
  devuelta: "Devuelta",
  rechazada: "Rechazada",
  incidente: "Incidente",
};

export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};

export const ESTADO_LABEL: Record<CierreEstado, string> = {
  solicitado: "Solicitado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  vencido: "Vencido", // feature 41: etiqueta minima; el tratamiento diferenciado (R20) lo hace frontend_dev
};

/**
 * FICHA 386 — los nombres de las DOS listas en que `/cierres-admin` parte los cierres del día:
 * las pestañas «Pendientes» y «Resueltos».
 *
 * Vivían como literales privados de `CierresAdminModule`. Salen aquí —el módulo PURO de textos
 * de cierres, y por el mismo motivo por el que salió `DESTINO_TIPO_LABEL`— porque desde esta
 * ficha los necesita un SEGUNDO archivo: `FiltrosCierresBarra` agrupa las opciones del filtro de
 * estado por la lista en la que ese estado aparece, y el rótulo de cada grupo tiene que ser LA
 * MISMA palabra que el usuario lee en la pestaña. Dos literales iguales escritos en dos archivos
 * se separan en cuanto alguien renombre una pestaña, y entonces el filtro mandaría al usuario a
 * una lista que ya no se llama así.
 *
 * ⚠️ NO son los nombres de las pestañas de las pantallas de BODEGA (`CierresBodegaAdminModule`
 * dice «Pendientes»/«Resueltos» pero `ConsolidacionBodegaModule` dice «A consolidar»/
 * «Solicitados»): esos siguen siendo suyos, porque parten otro conjunto por otro criterio.
 */
export const TAB_PENDIENTES_LABEL = "Pendientes";
export const TAB_RESUELTOS_LABEL = "Resueltos";

/**
 * Destino de un cierre. Estaba DUPLICADA palabra por palabra en `CierresAdminModule` y en
 * `CierreDiaModule`; los dos la leen ahora de aquí, que es lo que hace cierto que el archivo
 * y las dos pantallas digan lo mismo (R8).
 */
export const DESTINO_TIPO_LABEL: Record<CierreDestinoTipo, string> = {
  bodega_central: "Bodega central",
  bodega_satelite: "Bodega satélite",
};

/**
 * Feature 170 — FASE 2 (T I.2): destino LEGIBLE de un cierre (tipo + zona), la línea que
 * pintan la columna «Destino» y la celda del archivo.
 *
 * Estaba escrita tres veces con el mismo texto: en `CierresAdminModule`, en
 * `cierres-admin-descarga-columnas` y —al partir el histórico en su propio componente— habría
 * llegado a cuatro. Sale aquí, junto al mapa del que depende, por el mismo motivo que salió
 * `DESTINO_TIPO_LABEL`: que la pantalla y el archivo no puedan decir cosas distintas (R8).
 */
export function destinoCierre(cierre: {
  destinoTipo: CierreDestinoTipo;
  destinoZonaNombre: string;
}): string {
  return `${DESTINO_TIPO_LABEL[cierre.destinoTipo] ?? cierre.destinoTipo} · ${cierre.destinoZonaNombre}`;
}

// --- Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready) ---
export const PAGO_MENSAJERO_COL = "Pago mensajero";
// --- Feature 56: etiquetas del ingreso de bodega por rechazos (texto separado, i18n-ready) ---
export const INGRESO_BODEGA_RECHAZOS_COL = "Ingreso bodega";
// --- Feature 102 (R9): marca por fila del ORIGEN de un rechazo ---
export const RECHAZO_ORIGEN_COL = "Origen";
export const RECHAZO_SLA_BADGE_LABEL = "Automático";
export const RECHAZO_MANUAL_BADGE_LABEL = "Manual";
// --- Desglose del ingreso de Ordenex por orden (texto separado, i18n-ready) ---
export const MONTO_COBRAR_COL = "A cobrar";
// Monto FIJO de fulfillment de la tarifa CONGELADA del cierre (2026-08-19). No es un concepto
// derivado: no se suma al «Total Ordenex» ni a las wallets. Vacío en los cierres anteriores a
// la columna `cierre_detail.tarifa_fulfillment`.
export const FULFILLMENT_COL = "Fulfillment";
// Conceptos AGRUPADOS (cada uno con su IVA incluido): así se leen en tablas y paneles.
export const FLETE_CON_IVA_LABEL = "Flete + IVA";
export const COMISION_CON_IVA_LABEL = "Comisión + IVA";
export const FLETE_DEV_CON_IVA_LABEL = "Flete por rechazo + IVA";
export const INGRESO_TOTAL_COL = "Total Ordenex";
// --- Feature 158 (R34/R9/R19): columnas propias del grupo `incidente` (texto i18n-ready) ---
export const CAUSA_INCIDENTE_COL = "Causa";
export const INDEMNIZACION_COL = "Indemnización";

// ---------------------------------------------------------------------------
// Feature 393 (R33, design §5) — las DOS CASCADAS del cierre de bodega.
//
// Viven aquí, en el módulo PURO, y no en `cierre-detalle-shared.tsx`, por el mismo motivo que
// las de la tanda E: el archivo de la descarga necesita `PARA_LA_CENTRAL_LABEL` y no puede
// arrastrar `Card`/`Badge`/`DataTable`. Que la pantalla y el archivo digan lo mismo (R22/R23)
// es cierto porque leen del MISMO sitio, no porque hoy coincidan dos literales.
//
// TODAS estas constantes son SÓLO de las superficies del cierre de BODEGA. Las del cierre de
// mensajero (`INGRESO_BODEGA_RECHAZOS_LABEL`, `GANANCIA_LABEL`, `INGRESO_BRUTO_LABEL`,
// `PAGO_TIENDA_LABEL`) NO se tocan (R21/R30).
// ---------------------------------------------------------------------------

/** Rótulo y nombre accesible de la cascada A. Responde: ¿de quién es este dinero? */
export const CASCADA_DUENO_TITULO = "De quién es el dinero";
/**
 * Rótulo y nombre accesible de la cascada B. Responde: ¿cuánto le entrega esta bodega a la
 * central? Es la única de las dos que alcanza al `adminSatelite` (R39).
 */
export const CASCADA_CENTRAL_TITULO = "Lo que va a la central";

/** Resultado de la cascada A: lo que le queda a la tienda de lo que se recaudó. */
export const PARA_LA_TIENDA_LABEL = "Para la tienda";

/**
 * Resultado de la cascada B (D2′) — el número que el humano pidió el 2026-09-08.
 *
 * Dice **a dónde va** el dinero, que es lo que él describió, y RIMA con «Para la tienda»: dos
 * preguntas de la misma familia, dos rótulos de la misma forma, que es lo que hace que las dos
 * cascadas se lean como una sola historia.
 *
 * Descartado «Entrega a la central»: «entrega/entregada» es el desenlace de una gestión en esta
 * app y colisionaría en la misma pantalla que la tabla de entregadas. Descartado «Queda en
 * caja»: lo recaudado incluye SINPE y transferencia, así que no todo «queda en caja».
 *
 * Y NO se reusa `CENTRAL_DEBE_LABEL` (D6/A8): esa etiqueta ya significa algo muy concreto y
 * distinto —el pago a mensajeros que el efectivo no alcanzó a cubrir, en la pantalla de
 * consolidación, antes de solicitar—. Darle un segundo significado es exactamente lo que R24
 * prohíbe. El rótulo TAMPOCO cambia cuando el número sale negativo: una cifra, un nombre.
 */
export const PARA_LA_CENTRAL_LABEL = "Para la central";

/**
 * Resultado de la cascada A. NO es la «Ganancia» de hoy: aquella no resta el pago a la bodega
 * satélite, así que las dos sólo coinciden cuando ese pago es cero.
 */
export const NETO_ORDENEX_LABEL = "Neto de Ordenex";

/**
 * La LÍNEA PUENTE (R10): lo que Ordenex cobra sobre lo recaudado. Sin ella la cascada A enseña
 * «recaudado − facturado = para la tienda», que NO da en cuanto hay un rechazo.
 */
export const COBRADO_SOBRE_RECAUDADO_LABEL = "Cobrado sobre lo recaudado";

/** El mismo número que el «Ingreso bruto» del cierre de mensajero, dicho como lo dice quien lo lee. */
export const FACTURADO_ORDENEX_LABEL = "Lo que Ordenex facturó";

/**
 * `total_ingreso_bodega_rechazos` dicho desde el punto de vista de quien mira (R25, D3′), y con
 * el verbo que usó el humano: «menos lo que gana la satélite».
 *
 * SÓLO en las superficies del cierre de bodega: ahí la bodega responsable es SIEMPRE la
 * satélite. En un cierre de MENSAJERO la bodega puede ser la central, así que allí sigue
 * diciendo `INGRESO_BODEGA_RECHAZOS_LABEL` y no se toca.
 */
export const GANA_BODEGA_SATELITE_LABEL = "Gana la bodega satélite";

/** R26 — de qué resta sale «Para la central», en el idioma de quien la hace. */
export const PARA_LA_CENTRAL_NOTA =
  "Lo recaudado menos el pago a los mensajeros y menos lo que gana la bodega satélite por los rechazos.";

/**
 * R36 — qué significa que salga NEGATIVO. Sin esta nota, un «−₡3.400» en una pantalla de dinero
 * es peor que no tener el número. El caso no es teórico: medido contra producción el 2026-09-08,
 * 1 de 14 cierres de bodega ya lo tenía negativo.
 */
export const PARA_LA_CENTRAL_NEGATIVO_NOTA =
  "Los descuentos superan lo recaudado en este cierre: la satélite no entrega nada y la central pone la diferencia.";

/**
 * R37 — el caso MÁS frecuente, y distinto del negativo: «Para la central» puede ser positivo y
 * aun así la bodega no tener el efectivo para pagar. Medido: 2 de 14 cierres, el peor por −₡2.000.
 */
export const EFECTIVO_NO_CUBRE_NOTA =
  "El efectivo recaudado no cubre los descuentos: parte de lo recaudado entró por SINPE o transferencia.";

/**
 * R27 — que no se confunda con un movimiento de caja. `FUENTE_CAJA`
 * (`lib/utils/aporte-por-orden.ts`) es un catálogo TOTAL de las categorías del libro y no tiene
 * ninguna del ingreso de bodega; la ficha 56 lo declaró: sólo se calcula, se snapshotea y se
 * muestra.
 */
export const GANA_BODEGA_SATELITE_NOTA =
  "Lo que se le reconoce a la bodega satélite por los rechazos. No es un movimiento de caja registrado.";

/** R10 — por qué esa línea SUMA a lo facturado pero no se resta de lo recaudado. */
export const FLETE_RECHAZO_NO_DEDUCIBLE_NOTA =
  "Se le factura a la tienda, pero no sale de lo recaudado: un rechazo no cobra contra entrega.";
