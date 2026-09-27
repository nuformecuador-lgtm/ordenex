import type { WalletEgresoNombrado } from "@/lib/types/wallet";

/**
 * Ficha 339 (T5.1, design §5.2/§5.5/§5.7) — textos del DETALLE de una fila de la tarjeta
 * «Como se compone la ganancia de Ordenex» y de las dos filas de egreso que la ficha saca del
 * cubo anonimo.
 *
 * Modulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente, e
 * i18n-ready — nada de literales incrustados en el JSX. Los nombres accesibles son FUNCIONES y
 * no literales para que el nombre de la fila siga siendo un parametro el dia que haya i18n, en
 * vez de una concatenacion suelta dentro del render.
 *
 * ⚠️ NINGUNA constante de este archivo se llama `PAGINACION_*_LABEL`, y no es capricho de
 * estilo (design §6): `tests/components/paginacion/paginacion-transversal.test.tsx` barre `app/`
 * buscando `export const PAGINACION_[A-Z0-9_]*LABEL`, exige que todo archivo que declare una
 * este en el censo de los TRECE listados del Anexo III de la ficha 170 y cierra con un
 * `toHaveLength(13)`. Este desplegable NO es un listado del Anexo III —es el detalle de UNA
 * fila, igual que el desglose de una tienda, que por el mismo motivo tampoco esta en ese
 * censo—, asi que bautizar aqui esa constante pondria una guardia ajena en rojo con
 * «14 recibido / 13 esperado» por un motivo falso.
 */

/**
 * Las CUATRO columnas del detalle, en orden (design §5.5), mas la cabecera con la que esas
 * tres primeras viajan JUNTAS en un telefono (`movimiento`).
 *
 * `movimiento` no es una quinta columna: es el nombre de la MISMA informacion cuando la
 * pantalla no da para repartirla en tres. Vive aqui, y no como literal dentro del componente,
 * por el mismo motivo que sus vecinas —`docs/conventions` manda los textos de UI fuera del
 * JSX, i18n-ready—. Por que existe, medido en Chromium a 390x844: con las cuatro columnas la
 * tabla pedia 309 px en un hueco de 284 y el IMPORTE, que es la ultima, se quedaba 25 px fuera
 * del area visible: «₡1.700» se leia «₡1.70». Dinero cortado no es un defecto de estetica.
 */
export const COMPOSICION_DETALLE_COLUMNAS = {
  fecha: "Fecha",
  concepto: "Concepto",
  detalle: "Detalle",
  importe: "Importe",
  movimiento: "Movimiento",
} as const;

/** R25: una fila sin movimientos lo dice; no se deja una tabla muda. */
export const COMPOSICION_DETALLE_VACIO =
  "No hay movimientos de este concepto en el periodo que estás viendo.";

/** R26: el fallo se cuenta DENTRO de la fila, y el resto de la tarjeta sigue en pie. */
export const COMPOSICION_DETALLE_ERROR =
  "No se pudieron cargar los movimientos de esta fila. Volvé a abrirla en un momento.";

/**
 * R1/R2/R5 — el rotulo de las dos filas de egreso que la ficha 343 saca de «Otros gastos de
 * Ordenex», con la MISMA voz plural que sus vecinas de la columna («Gastos fijos», «Sueldos»,
 * «Indemnizaciones»).
 *
 * `Record` TOTAL sobre `WalletEgresoNombrado`: el dia que un concepto mas gane fila, el build
 * no compila hasta que alguien decida como se llama en pantalla — que es exactamente la red que
 * impide que un egreso vuelva a caer en un cubo sin nombre.
 *
 * R3 — «Correcciones de caja (resta)» es el concepto que el dialogo «Registrar movimiento» le
 * PROMETE al usuario por `nombreEnElLibro` («Corrección de caja (resta)», de
 * `CATEGORIA_LABEL.egreso_ajuste`): quien registro una correccion a mano la encuentra aqui por su
 * nombre en vez de dentro del cubo. Se escribe a mano y NO se deriva de `CATEGORIA_LABEL` a
 * proposito: derivarlo dejaria el test de R3 comparando el rotulo contra su propia fuente, es
 * decir, siempre verde.
 *
 * Ficha 461 (HD3, design §7): los tres en la voz plural de la columna y desde Ordenex («Pagos de
 * Ordenex a mensajeros»); «Ajustes (egreso)» y «Pagos a mensajeros» quedan retirados con sus
 * singulares. El singular del libro de cada uno vive en `CATEGORIA_LABEL`.
 */
export const EGRESO_NOMBRADO_LABEL: Record<WalletEgresoNombrado, string> = {
  egreso_pago_mensajero: "Pagos de Ordenex a mensajeros",
  egreso_ajuste: "Correcciones de caja (resta)",
  // La fila de la anulacion de un cobro de Ordenex a una tienda (R27); en el libro, cada fila se
  // rotula «Cobro a una tienda anulado».
  egreso_reverso_cobro_tienda: "Cobros a una tienda anulados",
  // Ficha 458-B (design §2.3): las filas de la anulación de un cobro por rechazo; en el libro, cada
  // fila se rotula «Flete por rechazo cobrado a la tienda anulado» / «IVA del flete…».
  egreso_reverso_flete_devolucion: "Fletes por rechazo cobrados a una tienda anulados",
  egreso_reverso_iva_flete_devolucion: "IVA de fletes por rechazo cobrados a una tienda anulados",
};

/**
 * R10 — la PISTA de la fila «Otros gastos de Ordenex», que solo se pinta cuando el servidor dice
 * que ahi queda dinero (`hayOtrosEgresos`).
 *
 * Avisa sin gritar (Q3 de `requirements.md`, decision cerrada): no es un error ni una alarma, es
 * «entro dinero de un concepto que nadie ha decidido como se llama todavia». Tras esta ficha el
 * unico residuo posible es `egreso_gasto`, una categoria reservada sin escritores en el arbol:
 * si esta linea aparece en pantalla, alguien empezo a escribirla.
 */
export const OTROS_EGRESOS_PISTA =
  "Acá hay dinero de un concepto que esta tarjeta todavía no sabe nombrar. Abrí la fila para " +
  "ver de dónde viene.";

/**
 * R24 — nombres accesibles del desplegable de UNA fila, TODOS con el rotulo de SU fila dentro.
 *
 * No es adorno: la tarjeta tiene catorce filas que se abren y pueden estar varias abiertas a la
 * vez; catorce botones llamados «Ver detalle» y catorce paginaciones llamadas «Paginación» no
 * identificarian nada para quien navega con lector de pantalla.
 *
 * `abrir` CONTIENE el rotulo visible del boton, que es lo que exige «Label in Name»: el nombre
 * accesible no puede dejar fuera el texto que se ve.
 */
export const DETALLE_FILA_NOMBRE = {
  abrir: (fila: string) => `Ver los movimientos de ${fila}`,
  region: (fila: string) => `Movimientos de ${fila}`,
  tabla: (fila: string) => `Movimientos de ${fila}`,
  paginacion: (fila: string) => `Paginación de los movimientos de ${fila}`,
} as const;
