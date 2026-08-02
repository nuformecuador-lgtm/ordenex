/**
 * Feature 171 (T2.1, design §2.1/§2.2) — textos del DESGLOSE del dinero de UNA tienda
 * (`/wallet/tiendas`, vista de los roles de acceso total).
 *
 * Módulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente,
 * e i18n-ready — nada de literales incrustados en el JSX.
 *
 * Lo que este archivo NO hace es tan importante como lo que hace: **no redefine ninguna
 * etiqueta que ya exista**. Las de `tipo`, `concepto` y `origen`, y el helper `money`, se
 * REEXPORTAN de `/mi-wallet` (R20) y el estado del saldo de `saldo-tienda-signo-label`
 * (R13). Son el MISMO objeto, no una copia con los mismos valores: es el mismo ledger y la
 * misma tabla de saldos, y dos mapas paralelos divergirían en cuanto alguien tocara uno.
 * El precedente ya está vigente en `SaldosTiendasTable.tsx:8`, que lee `money` de allí.
 *
 * Lo ÚNICO propio de esta pantalla son los cuatro importes de la cabecera: el dinero de una
 * tienda no es el de un mensajero (a ella se le DEBE lo cobrado a sus clientes y se le
 * COBRAN los servicios), así que «Total devengado / Total pagado / Cuenta por pagar» no
 * aplica.
 */
export {
  CATEGORIA_TIENDA_LABEL,
  CATEGORIA_TIENDA_OPTIONS,
  ORIGEN_TIENDA_LABEL,
  TIPO_TIENDA_LABEL,
  money,
  origenLabel,
} from "../../../mi-wallet/_components/mi-wallet-labels";

export { SALDO_SIGNO_LABEL } from "./saldo-tienda-signo-label";

/**
 * Los CUATRO importes de la cabecera, en el orden de R7 — que es la fórmula leída de
 * izquierda a derecha: `saldo = a favor − cargos − pagado`.
 *
 * «Pagado a la tienda» hoy sale siempre en `0.00` porque ningún flujo emite `pago_tienda`
 * (lo emitirá la 172). Se muestra IGUAL: es un cero verdadero, leído de la categoría real
 * del libro, no un «no disponible». Si se plegara dentro de «cargos», el día que haya pagos
 * nadie podría distinguir *lo que te cobré* de *lo que ya te pagué* mirando esta pantalla.
 */
export const DESGLOSE_TIENDA_LABEL = {
  aFavor: "A favor de la tienda",
  aFavorHint: "COD recaudado y ajustes",
  cargos: "Cargos de Ordenex",
  cargosHint: "Fletes, comisión e IVA",
  pagado: "Pagado a la tienda",
  pagadoHint: "Lo ya entregado a la tienda",
  saldo: "Saldo a favor",
  saldoHint: "Lo que queda tras los cargos y los pagos",
} as const;

/** Cabeceras de la tabla de movimientos del desglose (mas reciente primero). */
export const DESGLOSE_TIENDA_COLUMNAS = {
  fecha: "Fecha",
  tipo: "Tipo",
  concepto: "Concepto",
  monto: "Monto",
  origen: "Origen",
} as const;

/**
 * Etiquetas de los filtros server-side del desglose (R18). Son cuatro y no tres: el ledger
 * de una tienda tiene siete categorías vivas —no las dos del mensajero— y «¿cuánto le cobré
 * de IVA de la comisión este mes?» no se responde sin filtrar por concepto.
 */
export const DESGLOSE_TIENDA_FILTRO_LABEL = {
  cierre: "Cierre",
  cierrePlaceholder: "ID del cierre",
  concepto: "Concepto",
  conceptoPlaceholder: "Todos los conceptos",
  desde: "Desde",
  hasta: "Hasta",
  aplicar: "Aplicar",
  limpiar: "Limpiar",
} as const;

/**
 * R4/R38 — nombres accesibles del desglose y de cada uno de sus controles, TODOS con el
 * nombre de la tienda dentro.
 *
 * No es adorno: la tabla admite varias filas abiertas a la vez, y tres formularios llamados
 * «Filtros del desglose» o tres botones llamados «Descargar» no identificarían nada para
 * quien navega con lector de pantalla. Son funciones (y no literales) para que el día que
 * haya i18n el nombre de la tienda siga siendo un parámetro y no una concatenación suelta
 * dentro del JSX.
 */
export const DESGLOSE_TIENDA_NOMBRE = {
  /** Nombre de la región desplegada y base del archivo de la descarga. */
  region: (tienda: string) => `Desglose de ${tienda}`,
  filtros: (tienda: string) => `Filtros del desglose de ${tienda}`,
  concepto: (tienda: string) => `Filtrar por concepto del desglose de ${tienda}`,
  tabla: (tienda: string) => `Movimientos del desglose de ${tienda}`,
  paginacion: (tienda: string) => `Paginación del desglose de ${tienda}`,
  /** Nombre del botón que despliega la fila, en la tabla de saldos. */
  expandir: (tienda: string) => `Ver desglose de ${tienda}`,
} as const;

/** R21: el conjunto filtrado sin movimientos se explica, no se deja una tabla muda. */
export const DESGLOSE_TIENDA_VACIO = "No hay movimientos que coincidan con los filtros.";

/** R5: el fallo se cuenta DENTRO de la fila, sin tumbar la tabla de saldos. */
export const DESGLOSE_TIENDA_ERROR = "No se pudo cargar el desglose de la tienda.";
