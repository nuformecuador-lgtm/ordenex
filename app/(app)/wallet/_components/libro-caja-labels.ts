import { PANEL_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import type { AQuienDTO } from "@/lib/types/libro-caja-autoria";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

// FICHA 458-E (TE.1/TE.2, design §5.2; R54–R57, R59) — los textos del libro de la caja (`/wallet`).
// Fuera del JSX (docs/conventions). Ninguno lleva un identificador interno (H6): la cuenta de «A
// quién» viaja con su id SOLO para el `href` del enlace (D1), nunca se pinta.

/** Los encabezados del libro, en su orden de pantalla (design §5.2). */
export const LIBRO_CAJA_COLUMNA = {
  fecha: "Fecha",
  movimiento: "Movimiento y motivo",
  aQuien: "A quién",
  monto: "Monto",
  registro: "Registró",
  ver: "Ver",
} as const;

/** R54 — el filtro Todo / Entra / Sale. `todo` = sin filtro de dirección. */
export type DireccionFiltro = "todo" | WalletMovimientoTipo;

export const FILTRO_DIRECCION = {
  /** Nombre accesible del grupo. */
  nombre: "Filtrar por dirección del dinero",
  opciones: [
    { valor: "todo", etiqueta: "Todo" },
    { valor: "ingreso", etiqueta: "Entra" },
    { valor: "egreso", etiqueta: "Sale" },
  ] as const satisfies readonly { valor: DireccionFiltro; etiqueta: string }[],
} as const;

/** Lo que dice la celda de «A quién» y de «Registró» mientras se lee o si la lectura falló. */
export const AUTORIA_CELDA = {
  cargando: "Cargando…",
  error: "No se pudo leer",
  sinDato: PANEL_TEXTO.sinDato,
} as const;

/**
 * Nombre accesible del enlace de «A quién»: EMPIEZA por el texto visible (el nombre de la cuenta,
 * «Label in Name») y dice adónde lleva.
 */
export const ENLACE_ESTADO_CUENTA = {
  tienda: (texto: string) => `${texto} · estado de cuenta de la tienda`,
  mensajero: (texto: string) => `${texto} · estado de cuenta del mensajero`,
} as const;

/**
 * R56 — el estado de cuenta de la cuenta de «A quién» (design §5: `/wallet/tiendas/[tiendaId]` y
 * `/wallet/mensajeros/[mensajeroId]`, rutas de la 458-D). El uuid va SOLO en la dirección (D1).
 */
export function hrefEstadoCuenta(cuenta: NonNullable<AQuienDTO["cuenta"]>): string {
  const base = cuenta.tipo === "tienda" ? "/wallet/tiendas" : "/wallet/mensajeros";
  return `${base}/${encodeURIComponent(cuenta.id)}`;
}

/**
 * R56 — el texto de «A quién» de una fila: la MISMA composición que el panel «Ver» (458-C), para que
 * la columna y el detalle digan lo mismo. «Ordenex» en el aporte; «—» en una fila anterior sin
 * anotación; «Tania · a Facebook» en el pago de un gasto de una tienda.
 */
export function textoAQuien(a: AQuienDTO): string {
  if (a.esOrdenex) return PANEL_TEXTO.esOrdenex;
  if (a.nombre === null) return PANEL_TEXTO.sinDato;
  return a.beneficiario === null ? a.nombre : `${a.nombre} · ${PANEL_TEXTO.aTercero(a.beneficiario)}`;
}
