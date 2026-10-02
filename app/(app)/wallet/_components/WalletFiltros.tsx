import type { AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";
import { BUSQUEDA_LIBRO_MIN_CHARS } from "@/lib/config/libro-wallet";
import { ORDEN_LIBRO_POR_DEFECTO } from "@/components/shared/wallet/zonas-filtros-labels";

// Feature 42 (T12, R20) — los filtros del libro de la caja: tipo, categoría y rango de fechas.
//
// FICHA 463 (T7, design §5.2) — los filtros se PARTEN EN DOS NIVELES y este archivo deja de pintar
// nada: es el ÚNICO sitio que traduce los filtros de la caja a un input de borde.
//
//  - **Zona de la wallet** (`FiltrosWallet`): el periodo y «A quién». Mueven TODA la wallet —resumen,
//    composición, desglose, detalle de una fila de la composición— y el libro. La pinta
//    `WalletFiltrosCaja.tsx`, encima de las cifras.
//  - **Zona del libro** (`FiltrosLibro`): Entra/Sale, la categoría, el término y el orden. Filtran
//    SOLO el libro y su descarga (R9/R12). La pinta `LibroCajaBarra.tsx`, encima de la tabla.
//
// El componente de una sola banda que vivía aquí (con su borrador, «Aplicar» y «Limpiar» al pie del
// libro) se retiró: movía las cifras con filtros que el usuario leía como del libro.

/**
 * Los filtros de la caja tal como los entiende un borde de CIFRAS (`listarMovimientosSchema`): tipo,
 * categoría, periodo y «A quién». Lo usan la composición y el detalle de una fila, que desde la 463
 * reciben SIEMPRE tipo y categoría vacíos (`filtrosDeWallet`): las cifras no se filtran por la zona
 * del libro (R12).
 */
export interface WalletFiltrosValue {
  tipo: string;
  categoria: string;
  desde: string;
  hasta: string;
  /**
   * FICHA 458-E (R59) — «A quién»: la tienda, el mensajero o el nombre anotado elegido en el selector.
   * Ausente = todos. Es el `valor` que dio el servidor, tal cual (viaja, no se pinta: H6).
   */
  aQuien?: AQuienFiltro;
}

export const FILTROS_VACIOS: WalletFiltrosValue = {
  tipo: "",
  categoria: "",
  desde: "",
  hasta: "",
};

/**
 * Ficha 339 (T5.6, design §5.4) — los filtros traducidos al input de un borde, con los vacíos FUERA.
 * Una cadena vacía no es «no filtres»: sería un filtro que no filtra nada… o un `validation_error`,
 * según el campo.
 */
export function inputDeFiltros(filtros: WalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  // FICHA 458-E (R59): la MISMA clave en todos los bordes de la caja y en los conceptos.
  if (filtros.aQuien) input.aQuien = filtros.aQuien;
  return input;
}

/** FICHA 463 — la zona de la WALLET: lo que mueve toda la caja (R3). */
export interface FiltrosWallet {
  desde: string;
  hasta: string;
  aQuien?: AQuienFiltro;
}

/** FICHA 463 — la zona del LIBRO: lo que filtra solo el libro (R5). */
export interface FiltrosLibro {
  /** `ingreso` / `egreso`; vacío = Todo. */
  tipo: string;
  categoria: string;
  /** El término YA recortado y con el mínimo cumplido, o vacío (sin búsqueda). */
  termino: string;
  sortDir: DireccionOrden;
}

export const FILTROS_WALLET_VACIOS: FiltrosWallet = { desde: "", hasta: "" };

/** R34 — se entra sin filtros del libro y en «Más recientes». */
export const FILTROS_LIBRO_INICIALES: FiltrosLibro = {
  tipo: "",
  categoria: "",
  termino: "",
  sortDir: ORDEN_LIBRO_POR_DEFECTO,
};

/**
 * R12 — los filtros de las CIFRAS: solo la zona de la wallet. Tipo y categoría van vacíos a propósito,
 * así que `inputDeFiltros` los deja fuera y el borde de las cifras nunca los recibe.
 */
export function filtrosDeWallet(fw: FiltrosWallet): WalletFiltrosValue {
  return { ...FILTROS_VACIOS, desde: fw.desde, hasta: fw.hasta, ...(fw.aQuien ? { aQuien: fw.aQuien } : {}) };
}

/** R12/R14 — el input de resumen, desglose y detalle de fila: sin tipo, categoría, término ni orden. */
export function inputDeWallet(fw: FiltrosWallet): Record<string, unknown> {
  return inputDeFiltros(filtrosDeWallet(fw));
}

/**
 * R8/R9/R42 — el input del LIBRO (paginado y descarga): la zona de la wallet + la del libro. El término
 * solo viaja con el mínimo cumplido (el borde rechaza uno más corto) y el orden solo cuando no es el
 * de por defecto: «Más recientes» es lo que el borde aplica sin que nadie lo pida (R34), así que no
 * mandarlo es pedir exactamente eso.
 */
export function inputDeLibro(fw: FiltrosWallet, fl: FiltrosLibro): Record<string, unknown> {
  const input = inputDeFiltros({ ...filtrosDeWallet(fw), tipo: fl.tipo, categoria: fl.categoria });
  const termino = fl.termino.trim();
  if (termino.length >= BUSQUEDA_LIBRO_MIN_CHARS) input.q = termino;
  if (fl.sortDir !== ORDEN_LIBRO_POR_DEFECTO) {
    input.sortBy = "fecha";
    input.sortDir = fl.sortDir;
  }
  return input;
}

/** ¿Hay algún filtro de la zona del libro puesto (sin contar el orden)? */
export function hayFiltrosDeLibro(fl: FiltrosLibro): boolean {
  return fl.tipo !== "" || fl.categoria !== "" || fl.termino !== "";
}
