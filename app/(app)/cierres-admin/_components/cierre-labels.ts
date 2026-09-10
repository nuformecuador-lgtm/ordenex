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
// FICHA 408 — los dos módulos del vocabulario de la causa de devolución. Los DOS son PUROS
// (sin React, sin DOM), así que este archivo lo sigue siendo. El precedente de importar
// etiquetas desde `mis-asignaciones/_components` está escrito en `cierre-detalle-shared.tsx`
// (`CAUSA_INCIDENTE_LABEL`), y el vocabulario es el aprobado el 2026-07-15 (feature 73).
import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

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

// ---------------------------------------------------------------------------
// FICHA 395 (2026-09-08) — LAS TRES CASCADAS DEL CIERRE DE **MENSAJERO**.
//
// El detalle del cierre de mensajero —el que se mira todos los días— enseñaba «Pago a tienda»
// y «Total Ordenex» sueltos e invitaba a restarlos. Esa resta NO da: los dos números no salen
// de la misma bolsa. El humano se confundió leyendo su propia pantalla y lo dijo así: «si yo
// me confundo, no quiero imaginar los operarios».
//
// Estas constantes viven aquí, en el módulo PURO, por el mismo motivo que las de la 393: es la
// puerta única del texto de los cierres, y `cierre-detalle-shared` las re-exporta.
//
// ⚠️ NO se toca ni un rótulo de los que ya existían. `PAGO_TIENDA_LABEL` sigue diciendo «Pago a
// tienda» y sigue significando `pagoTienda`; `INGRESO_BODEGA_RECHAZOS_LABEL` sigue siendo el de
// esta superficie —en un cierre de MENSAJERO la bodega puede ser la central, así que
// `GANA_BODEGA_SATELITE_LABEL` sería falso aquí—. Lo que la ficha añade son los nombres de lo
// que ANTES NO TENÍA NOMBRE.
// ---------------------------------------------------------------------------

/**
 * FICHA 395 — el resultado de la PARTICIÓN: lo que le queda a la tienda EN TOTAL.
 *
 * Rima con `GANA_BODEGA_SATELITE_LABEL` («Gana la bodega satélite») a propósito: mismo verbo,
 * misma forma, misma familia de preguntas. Y NO se reusa `PARA_LA_TIENDA_LABEL` («Para la
 * tienda»), que en el cierre de BODEGA nombra `pagoTienda`: darle aquí un segundo significado
 * haría que la misma etiqueta valiera dos cifras distintas según por qué pantalla se entre, que
 * es exactamente el defecto que la 393 cerró (R24).
 *
 * Elección de redacción del `frontend_dev`; el encargo la escribió «La tienda gana», con el
 * mismo verbo y el orden invertido.
 */
export const GANA_LA_TIENDA_LABEL = "Gana la tienda";

/**
 * FICHA 395 — la frase que impide confundirlo con «Pago a tienda». Las dos notas son un PAR y
 * se leen juntas: una dice «no es lo que se le paga hoy», la otra «no es lo que gana en total».
 */
export const GANA_LA_TIENDA_NOTA =
  "Lo recaudado menos todo lo que Ordenex le factura, incluido el flete por rechazo. No es lo que se le paga hoy.";

/** FICHA 395 — la otra mitad del par: por qué el pago de hoy no es lo que la tienda gana. */
export const PAGO_TIENDA_HOY_NOTA =
  "Es lo que se le paga de este dinero hoy. No es lo que gana en total: el flete por rechazo se le cobra aparte.";

/**
 * FICHA 395 — qué significa que la tienda gane un NEGATIVO. Mismo criterio que
 * `PARA_LA_CENTRAL_NEGATIVO_NOTA`: un «−₡3.400» sin explicación en una pantalla de dinero es
 * peor que no tener el número.
 */
export const GANA_LA_TIENDA_NEGATIVO_NOTA =
  "Ordenex le factura más de lo que se recaudó en este cierre: a la tienda no le queda nada y pasa a deber la diferencia.";

/** FICHA 395 — de qué se compone la línea puente, dicho sin jerga contable. */
export const COBRADO_SOBRE_RECAUDADO_NOTA =
  "Flete + IVA y comisión + IVA de lo que sí se entregó: sale del dinero que el mensajero recaudó.";

/** FICHA 395 — de qué resta sale el neto de Ordenex, en el idioma de quien la hace. */
export const NETO_ORDENEX_NOTA =
  "Lo que Ordenex facturó menos el pago al mensajero y menos el ingreso de bodega por rechazos.";

/** FICHA 395 — qué significa un neto NEGATIVO: no es un fallo, es una pérdida del cierre. */
export const NETO_ORDENEX_NEGATIVO_NOTA =
  "Ordenex pagó más de lo que facturó en este cierre: ese neto es una pérdida, no una ganancia.";

/**
 * FICHA 395 — EL TIEMPO VERBAL DEL CARGO DEL FLETE POR RECHAZO, y es una trampa real.
 *
 * El cargo se escribe en el saldo de la tienda **al APROBAR** el cierre (`WalletTiendaFeedService`,
 * dentro de la transacción de `CierresAdminRepository.resolverCierre`). Medido contra producción
 * el 2026-09-08: de 37 cierres aprobados con rechazos, los 37 lo tienen; los `solicitado` y el
 * `vencido`, ninguno. Escribir «se le cargó» en un cierre que todavía no se aprueba es MENTIRA, y
 * el cierre que abrió esta ficha estaba «Vencido».
 *
 * Cuál de las tres se pinta NO se infiere del estado a ojo: `fleteRechazoYaCobradoATienda` viaja
 * ya resuelto del servidor —exige aprobado Y flete por rechazo mayor que cero— y el `estado` sólo
 * distingue «todavía no» de «ya no».
 *
 * Se dice «al saldo de la tienda» y no «a su wallet»: «Saldo a favor» y «Cargos de Ordenex» es lo
 * que la tienda lee en su propia pantalla (`mi-wallet-labels`). Elección del `frontend_dev`.
 */
export const FLETE_RECHAZO_YA_COBRADO_NOTA =
  "Ya se le cargó al saldo de la tienda: ese cargo se hace al aprobar el cierre.";
export const FLETE_RECHAZO_AUN_NO_COBRADO_NOTA =
  "Todavía no se le ha cargado al saldo de la tienda: ese cargo se hace al aprobar el cierre.";
export const FLETE_RECHAZO_NO_SE_COBRARA_NOTA =
  "Este cierre se rechazó, así que ese cargo no se le hizo a la tienda ni se le va a hacer.";

/**
 * FICHA 395 — los títulos de las dos cascadas que la ficha ESTRENA. La primera —la partición—
 * reusa `CASCADA_DUENO_TITULO` («De quién es el dinero»): es literalmente la misma pregunta que
 * responde en el cierre de bodega, y estrenar un segundo título para ella sería dar dos nombres a
 * la misma sección según por qué pantalla se entre.
 */
export const CASCADA_FACTURA_TIENDA_TITULO = "Lo que Ordenex le factura a la tienda";
export const CASCADA_NETO_ORDENEX_TITULO = "Lo que le queda a Ordenex";

// ---------------------------------------------------------------------------
// FICHA 396 (2026-09-08) — DE QUÉ TIENDA ES CADA PARTE DEL «PAGO A TIENDA».
//
// ⚠️ NO ES UNA CORRECCIÓN DE DINERO. El dinero ya estaba bien: `wallet_tienda_movimiento` lleva
// los movimientos separados por tienda desde siempre, cada uno con sus propias cifras. A nadie se
// le paga mal. Lo que faltaba es que la PANTALLA dijera de quién es cada parte.
//
// El cierre es del MENSAJERO, no de la tienda: un mensajero reparte para quien le toque ese día,
// así que un cierre puede llevar órdenes de varias tiendas —medido en producción el 2026-09-08:
// de 56 cierres, 39 tienen UNA y 17 tienen DOS—. Hasta esta ficha «Pago a tienda» era la SUMA de
// todas ellas y no lo decía en ninguna parte: quien lo leía creía estar viendo lo de *una*.
//
// Estas constantes viven aquí, en el módulo PURO, por el mismo motivo que las de la 393 y la 395:
// es la puerta única del texto de los cierres, y las necesitan DOS pantallas —el detalle del
// mensajero y, cuando llegue su tanda, el de bodega—. Dos literales iguales escritos en dos
// archivos se separan en cuanto alguien renombre uno.
//
// ⚠️ NO se toca ni un rótulo de los que ya existían. `PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y
// `PARA_LA_TIENDA_LABEL` siguen diciendo y significando exactamente lo mismo (R18).
// ---------------------------------------------------------------------------

/**
 * FICHA 396 — el título de la sección del desglose. Rima con `CASCADA_DUENO_TITULO` («De quién
 * es el dinero») a propósito: es la MISMA pregunta bajada un nivel, de «Ordenex o la tienda» a
 * «cuál de las tiendas». Dos preguntas de la misma familia, dos títulos de la misma forma.
 *
 * Elección de redacción del `frontend_dev`; el spec pedía que el texto existiera y saliera de una
 * constante (R3), no qué decía.
 */
export const DESGLOSE_POR_TIENDA_TITULO = "De qué tienda es cada parte";

/**
 * FICHA 396 (R1) — LA MARCA: dice que el importe de al lado es un total de VARIAS tiendas, y de
 * cuántas. Va pegada a los DOS agregados que el desglose parte —«Pago a tienda» y «Gana la
 * tienda»—, porque los dos engañan igual: un número solo, sin esta frase, se lee como si fuera
 * de una tienda. R1 sólo exige marcar el primero; marcar también el segundo es decisión del
 * `frontend_dev`, y el motivo es que marcar uno solo diría, por omisión, que el otro sí es de
 * una tienda.
 *
 * Es una FUNCIÓN y no una constante porque el número de tiendas es parte del texto (R1 exige
 * decir «de cuántas»). Sigue cumpliendo R3 —el texto sale de este módulo, no de un literal
 * tecleado en el componente— con el mismo patrón que ya usa `destinoCierre` aquí al lado.
 *
 * El cardinal SIEMPRE es 2 o más: con una sola tienda no se pinta nada (R2), así que el plural
 * no tiene ningún caso raro que cubrir.
 */
export function totalDeVariasTiendasNota(cuantasTiendas: number): string {
  return `Es el total de las ${cuantasTiendas} tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.`;
}

/**
 * FICHA 396 (R4) — LAS TRES CIFRAS DE UNA TIENDA. Y son TRES, no cuatro: R5 lo prohíbe, y la
 * tercera entró el 2026-09-08 por firma explícita del humano (Q7 del spec), no de paso.
 *
 * ⚠️ LOS DOS ÚLTIMOS TIENEN QUE SER IMPOSIBLES DE CONFUNDIR, y por eso dicen «hoy» y «en total»
 * con todas las letras: confundir lo que se le paga con lo que gana es exactamente el fallo que
 * la ficha 395 acaba de arreglar un nivel más arriba, y aquí se multiplica por el número de
 * tiendas. La diferencia entre las dos, por tienda, es el flete por rechazo + IVA de ESA tienda,
 * que se le cobra aparte contra su saldo (`DESGLOSE_POR_TIENDA_NOTA`).
 *
 * NO se reusan `PAGO_TIENDA_LABEL` («Pago a tienda») ni `GANA_LA_TIENDA_LABEL` («Gana la
 * tienda»): esos dos nombran los AGREGADOS del cierre entero, y darles aquí un segundo
 * significado —el de UNA tienda— haría que la misma etiqueta valiera dos cifras distintas en la
 * misma pantalla, que es el defecto que la 393 cerró (R24) y el que esta ficha viene a arreglar.
 * Dentro de la cascada de una tienda el sujeto ya ES esa tienda: el rótulo dice qué se le hace,
 * no a quién.
 *
 * Elección de redacción del `frontend_dev`.
 */
export const TIENDA_RECAUDADO_LABEL = "Recaudado de esta tienda";
export const TIENDA_PAGO_HOY_LABEL = "Se le paga hoy";
export const TIENDA_GANA_TOTAL_LABEL = "Gana en total";

/**
 * FICHA 396 — la frase que impide leer las dos cifras de pago como un descuadre. Es el par
 * `PAGO_TIENDA_HOY_NOTA` / `GANA_LA_TIENDA_NOTA` de la 395 dicho UNA vez para todo el desglose:
 * repetir las dos notas dentro de cada tienda las convertiría en ruido justo donde hay que
 * leerlas, y con dos tiendas ya serían cuatro párrafos casi iguales.
 */
export const DESGLOSE_POR_TIENDA_NOTA =
  "«Se le paga hoy» y «Gana en total» no son la misma cifra: la diferencia es el flete por rechazo, que a la tienda se le cobra aparte, contra su saldo.";

/**
 * FICHA 396 (R17) — lo que el desglose NO reparte, dicho mientras se enseña el desglose.
 *
 * El pago al mensajero y el ingreso de bodega por rechazos son del cierre ENTERO y se quedan
 * agregados (R16, Q2): repartirlos exigiría inventar un criterio —¿por órdenes? ¿por importe?—
 * que nadie ha firmado, y un número repartido con un criterio inventado miente con precisión,
 * mientras que uno agregado y rotulado sólo calla. Sin esta frase, quien vea unas cifras
 * partidas por tienda y otras no supondría que el reparto está en alguna parte.
 */
export const DESGLOSE_NO_REPARTIDO_NOTA =
  "El pago al mensajero y el ingreso de bodega por rechazos son del cierre completo: no están repartidos entre las tiendas.";

/**
 * FICHA 396 (D2) — EL NOMBRE ACCESIBLE de la cascada de UNA tienda, y tiene que ser ÚNICO.
 *
 * ⚠️ EL NOMBRE DE LA TIENDA NO BASTA, y no es un caso teórico: el servidor agrupa por el
 * `tiendaId` congelado precisamente para que **dos tiendas homónimas no se fundan** (R7, atado
 * con un test contra Postgres real), así que dos cascadas pueden llegar con el MISMO nombre
 * visible y con dinero distinto. Dos regiones con el mismo nombre accesible dejan a quien navega
 * por landmarks sin manera de decir cuál es cuál — y el modal del cierre de BODEGA lo multiplica:
 * el desglose se monta una vez por mensajero incluido MÁS una para el agregado, así que la misma
 * tienda aparece varias veces a propósito.
 *
 * Por eso el nombre lleva DOS discriminantes:
 *  - la POSICIÓN dentro de su nivel («1 de 3»), que separa a dos homónimas del MISMO nivel y de
 *    paso dice cuántas hay. El orden es el que emitió el servidor (R8), no uno del navegador;
 *  - el CONTEXTO —«cierre de bodega», o el nombre del mensajero—, que separa el mismo nombre
 *    repetido en dos niveles del mismo modal.
 *
 * El `indice + 1` se hace AQUÍ, en el módulo de textos, y no en el componente: es el ordinal de
 * una frase, no un importe, y el componente del desglose no hace ni una operación (R14).
 *
 * El nombre VISIBLE de la cascada sigue siendo sólo el de la tienda: esto nombra la región para
 * quien no la ve, no añade texto a la pantalla.
 *
 * Elección de redacción del `frontend_dev`.
 */
export function nombreAccesibleDeTienda(
  tiendaNombre: string,
  indice: number,
  cuantasTiendas: number,
  contexto: string,
): string {
  return `${tiendaNombre} (${indice + 1} de ${cuantasTiendas}) · ${contexto}`;
}

// ---------------------------------------------------------------------------
// FICHA 408 (2026-09-10) — EL MOTIVO DE UN RECHAZO AUTOMÁTICO, EN CASTELLANO.
//
// El cron de plazos vencidos (feature 99) guarda el motivo como `escalado SLA <causa>`
// (`lib/services/DevolucionSlaService.ts`). Esa cadena es jerga de programador, lleva una sigla
// que este repo decidió no enseñar nunca y termina en el value inglés del enum. Se traduce AL
// PINTAR: el histórico de `gestion_orden.motivo` NO se toca —esas filas son evidencia— y el
// productor del texto tampoco.
//
// Vive aquí, en el módulo PURO, porque lo necesitan por igual la pantalla del admin, la del
// mensajero, el comprobante y las TRES descargas: que el archivo y la pantalla digan lo mismo es
// cierto porque leen del MISMO sitio, no porque hoy coincidan dos literales.
// ---------------------------------------------------------------------------

/**
 * Lo que se le añade a la causa cuando la fila NO enseña el marcador de origen (R11).
 *
 * NO copia la frase de `RECHAZO_SLA_BADGE_NOTA`: si algún día los dos apareciesen juntos, no
 * sería un eco literal. Y no depende de ningún `title` para entenderse, que en táctil no existe.
 */
export const MOTIVO_RECHAZO_AUTOMATICO_COLA =
  "lo rechazó el sistema al vencerse el plazo de la devolución";

/**
 * Las TRES cadenas que el cron puede haber guardado, con su etiqueta en castellano.
 *
 * Se compone desde `CAUSA_DEVOLUCION_SEED` y no de una lista literal paralela: si el enum gana un
 * cuarto valor, esta tabla lo gana sola —y el `Record` exhaustivo de `CAUSA_DEVOLUCION_LABEL`
 * rompe el build si nadie le puso nombre—. Es un `Map` y no un objeto: la entrada es texto que
 * escribe una persona, y un objeto respondería a `"constructor"` o a `"__proto__"`.
 */
const ETIQUETA_POR_MOTIVO_AUTOMATICO: ReadonlyMap<string, string> = new Map(
  CAUSA_DEVOLUCION_SEED.map((causa) => [
    `escalado SLA ${causa}`,
    CAUSA_DEVOLUCION_LABEL[causa],
  ]),
);

/**
 * El motivo de una gestión, listo para pintarse. Función PURA: no toca la gestión ni nada más.
 *
 * `hayMarcadorDeOrigen`: ¿esta fila enseña el marcador «Automático»? Los DIECIOCHO puntos de
 * llamada —4 en `cierre-detalle-shared` + 4 en `cierre-gestiones-descarga-columnas` + 1 en
 * `cierre-factura` + 1 en `cierres-gestiones-fundida-descarga-columnas` + 4 en `CierreDiaModule`
 * + 4 en `cierre-dia-descarga-columnas`—
 * pasan SIEMPRE `gestion.esRechazoSla` —el mismo booleano que decide si el marcador se pinta—,
 * así que el llamador no decide nada y las dos cosas no pueden desincronizarse. En `/cierre-dia`
 * es siempre `false` (`CierreDiaRepository.ts`, decisión expresa de la 102): ahí no hay marcador
 * ni puede haberlo, y el texto del motivo es el ÚNICO portador de que el rechazo no fue suyo.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 * 1. **La igualdad es EXACTA contra la cadena completa**, no `startsWith`/`includes`/`toLowerCase`
 *    ni una expresión regular: el texto libre que escribe el mensajero es sagrado (R2) y
 *    cualquier emparejamiento laxo puede comérselo o deformarlo. Coste aceptado: una fila con un
 *    espacio de más saldría cruda — ninguna existe, todas las produce el mismo template literal.
 * 2. **`null` sigue siendo `null`, jamás `"—"`**: el guion es un marcador de PANTALLA y la
 *    descarga declara que una celda sin dato va VACÍA (R10 de la 170). Colapsarlo aquí metería un
 *    `"—"` dentro del Excel. El `?? "—"` se queda en el render, fuera de esta función.
 * 3. **Dos variantes y UN solo vocabulario**: donde el marcador acompaña al motivo, cada columna
 *    responde una pregunta distinta y la celda no repite lo que el marcador ya dice; donde no hay
 *    marcador, el texto tiene que sostenerse solo.
 */
export function motivoGestionLegible(
  motivo: string | null,
  hayMarcadorDeOrigen: boolean,
): string | null {
  if (motivo === null) return null;
  const etiqueta = ETIQUETA_POR_MOTIVO_AUTOMATICO.get(motivo);
  if (etiqueta === undefined) return motivo;
  return hayMarcadorDeOrigen ? etiqueta : `${etiqueta} · ${MOTIVO_RECHAZO_AUTOMATICO_COLA}`;
}
