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

/** Las CUATRO columnas del detalle, en orden (design §5.5). */
export const COMPOSICION_DETALLE_COLUMNAS = {
  fecha: "Fecha",
  concepto: "Concepto",
  detalle: "Detalle",
  importe: "Importe",
} as const;

/** R25: una fila sin movimientos lo dice; no se deja una tabla muda. */
export const COMPOSICION_DETALLE_VACIO =
  "No hay movimientos de este concepto en el periodo que estás viendo.";

/** R26: el fallo se cuenta DENTRO de la fila, y el resto de la tarjeta sigue en pie. */
export const COMPOSICION_DETALLE_ERROR =
  "No se pudieron cargar los movimientos de esta fila. Volvé a abrirla en un momento.";

/**
 * R1/R2/R5 — el rotulo de las dos filas de egreso que la ficha 339 saca de «Otros gastos de
 * Ordenex», con la MISMA voz plural que sus vecinas de la columna («Gastos fijos», «Sueldos»,
 * «Indemnizaciones»).
 *
 * `Record` TOTAL sobre `WalletEgresoNombrado`: el dia que un concepto mas gane fila, el build
 * no compila hasta que alguien decida como se llama en pantalla — que es exactamente la red que
 * impide que un egreso vuelva a caer en un cubo sin nombre.
 *
 * R3 — «Ajustes (egreso)» es el concepto que el dialogo «Registrar movimiento» le PROMETE al
 * usuario por `nombreEnElLibro` («Ajuste (egreso)», de `CATEGORIA_LABEL.egreso_ajuste`): quien
 * registro un gasto a mano lo encuentra aqui por su nombre en vez de dentro del cubo. Se
 * escribe a mano y NO se deriva de `CATEGORIA_LABEL` a proposito: derivarlo dejaria el test de
 * R3 comparando el rotulo contra su propia fuente, es decir, siempre verde.
 */
export const EGRESO_NOMBRADO_LABEL: Record<WalletEgresoNombrado, string> = {
  egreso_pago_mensajero: "Pagos a mensajeros",
  egreso_ajuste: "Ajustes (egreso)",
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
