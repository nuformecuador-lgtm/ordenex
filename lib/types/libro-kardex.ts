import type { GestionResultado } from "@prisma/client";
import type { LimiteExcedidoDeHoja } from "@/lib/types/detalle-en-lote";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

/**
 * Ficha 468 (design §3–§4) — el contrato del LIBRO DE LA WALLET EN EXCEL: la hoja «Movimientos» como
 * KARDEX (saldo inicial, una fila por movimiento con su saldo corrido, totales y saldo final) y la hoja
 * «Detalle por guia» AGRUPADA (un bloque por guia, «Movimientos sin guia», «Diferencia sin repartir» y un
 * TOTAL GENERAL igual al de la hoja 1).
 *
 * Modulo de TIPOS: sin Prisma en runtime (`GestionResultado` es un union que se borra al compilar).
 *
 * Money-safe: todo importe cruza la frontera como STRING escala 2. TODO lo que es dinero —la columna de
 * cada fila, los saldos, los totales, los aportes, las diferencias— lo decide el SERVIDOR con
 * `Prisma.Decimal` (R54). El navegador solo COLOCA: no suma, no resta y no convierte (la unica conversion
 * a numero de Excel es `celdaMonto`, en el generador).
 *
 * Ningun campo es un identificador que se pinte: `movimientoId` es el ENLACE en memoria con la fila de la
 * hoja 1 (para su concepto y su detalle) y nunca va a una celda.
 */

/** Las columnas de monto (R1–R3, R9, R10). `cobrado_a_tiendas` SOLO existe en la caja. */
export type ColumnaDeMonto = "entra" | "sale" | "cobrado_a_tiendas";

/**
 * El importe de una fila puesto en SU columna (R9/R10): exactamente una. `monto` STRING escala 2; solo en
 * `cobrado_a_tiendas` puede ser negativo (el reverso de un cargo a tienda).
 */
export interface MontoEnColumna {
  columna: ColumnaDeMonto;
  monto: string;
}

/** Σ por columna (R8, R36, R44). `cobradoATiendas` es `null` fuera de la caja (la columna no existe). */
export interface TotalesPorColumna {
  entra: string;
  sale: string;
  cobradoATiendas: string | null;
}

/** Una fila de movimiento del kardex, ALINEADA POR INDICE con los movimientos que devuelve la lectura. */
export interface FilaKardexDTO {
  monto: MontoEnColumna;
  /**
   * R11/R12 — el saldo de la cuenta (o de la caja) ENTERA justo despues de este movimiento, sea cual sea
   * el filtro. En el estado de cuenta es el mismo `saldoCorrido` que pinta la pantalla.
   */
  saldo: string;
  /**
   * R18/R61 — cuantas guias (ordenes) componen el importe, para el «N guía(s)» del Detalle. `null` si el
   * movimiento no es repartible. Sale de los CONTEOS (sin leer ordenes) en «Solo los movimientos» y de
   * la hoja 2 en «Movimientos y detalle»: los dos con el MISMO `WHERE`, asi que la hoja 1 es identica en
   * los dos modos (R57).
   */
  ordenes: number | null;
}

export interface KardexDTO {
  /** R5/R13/R14 — el saldo al inicio del periodo (`"0.00"` en la caja sin fecha de inicio). */
  saldoInicial: string;
  /** R8/R13/R14 — el saldo al final del periodo. */
  saldoFinal: string;
  /** R8 — Σ de cada columna de monto sobre las filas de movimiento DEVUELTAS (con filtros, solo esas). */
  totales: TotalesPorColumna;
  /** R16 — la descarga lleva otros filtros ademas del periodo (concepto, a quien, chip, cierre, termino). */
  conOtrosFiltros: boolean;
  /** Las filas, en ORDEN CRONOLOGICO ASCENDENTE (R7), alineadas por indice con los movimientos. */
  filas: FilaKardexDTO[];
}

/** Una fila de concepto dentro de un bloque de guia (R35). */
export interface FilaDeConceptoDTO {
  /** El movimiento de la hoja 1 al que esta guia aporta (su concepto lo rotula el cliente). */
  movimientoId: string;
  /** ISO de `cierre_dia.solicitado_at` del cierre de ESE movimiento (la hoja pinta el dia de CR). */
  cierreFecha: string;
  /** Los resultados de las gestiones de esta orden en ese cierre. */
  resultados: GestionResultado[];
  /** El aporte, en la MISMA columna que el movimiento en la hoja 1 (negado si es un reverso de cargo). */
  monto: MontoEnColumna;
}

/** Un bloque de la hoja 2: la cabecera de una guia, sus filas de concepto y su total (R33–R39). */
export interface BloqueDeGuiaDTO {
  /** `null` = la orden nunca tuvo guia: la hoja dice «Sin guía · remisión <remision>» (R37). */
  guia: string | null;
  /** R39 — remision, destinatario, tienda y mensajero CONGELADOS en el cierre mas reciente de la guia. */
  remision: string;
  destinatario: string;
  /** `null` en las superficies de UNA tienda (la columna no existe). */
  tiendaNombre: string | null;
  /** `null` en `/mi-wallet` (R49) y en el estado de cuenta del mensajero (es su propia cuenta). */
  mensajeroNombre: string | null;
  /** R38 — ISO de los cierres de la guia, ascendentes y sin repetir. */
  cierres: string[];
  /** R38 — los resultados de sus gestiones en esos cierres, cierre a cierre (en el orden de `cierres`). */
  resultados: GestionResultado[];
  /** R35/R37 — por dia del cierre ascendente y, a igual dia, en el orden de la hoja 1. */
  filas: FilaDeConceptoDTO[];
  /** R36 — Σ de cada columna de monto en las filas del bloque. */
  total: TotalesPorColumna;
}

/** Una fila de la seccion «Movimientos sin guía» (R40–R43). */
export type FilaSinGuiaDTO =
  /** R40/R43 — un movimiento NO repartible, exactamente una vez, con su monto en su columna. */
  | { tipo: "movimiento"; movimientoId: string; motivo: MotivoSinReparto; monto: MontoEnColumna }
  /**
   * R41/R42 — lo que le falta a las guias de un movimiento repartible para llegar a su importe:
   * `monto` = movimiento − Σ guias, en la columna del movimiento. El detalle lo redacta el cliente con
   * `cierreFecha`, el concepto del movimiento, `montoMovimiento` y `sumaGuias`.
   */
  | {
      tipo: "diferencia";
      movimientoId: string;
      cierreFecha: string;
      montoMovimiento: string;
      sumaGuias: string;
      monto: MontoEnColumna;
    };

export interface DetallePorGuiaDTO {
  /** R33/R37 — por numero de guia ascendente; las sin guia al final, por remision. */
  bloques: BloqueDeGuiaDTO[];
  /** R40–R43 — los no repartibles en el orden de la hoja 1 y, tras cada repartible, su diferencia. */
  sinGuia: FilaSinGuiaDTO[];
  /**
   * R44/R45 — Σ de cada columna en las filas de concepto, las de «Movimientos sin guía» y las
   * diferencias (los «Total de la guía» NO entran). El servidor AFIRMA que es igual a `kardex.totales`.
   */
  totalGeneral: TotalesPorColumna;
}

/** La hoja 1 de la caja, «Solo los movimientos» (R53/R57/R61). */
export type LibroCajaKardexServiceResult =
  | { status: "ok"; items: WalletMovimientoDTO[]; total: number; kardex: KardexDTO }
  | { status: "limite_excedido"; hoja: "movimientos"; total: number; limite: number }
  | { status: "forbidden" };

/** Las dos hojas de la caja en UNA lectura (R26/R53). */
export type LibroCajaKardexConDetalleServiceResult =
  | { status: "ok"; items: WalletMovimientoDTO[]; total: number; kardex: KardexDTO; porGuia: DetallePorGuiaDTO }
  | LimiteExcedidoDeHoja
  | { status: "forbidden" };

/** La hoja 1 de un estado de cuenta (tienda, mensajero, bodega u `/mi-wallet`). */
export type CuentaKardexServiceResult =
  | { status: "ok"; estado: EstadoCuentaDTO; kardex: KardexDTO }
  | { status: "limite_excedido"; hoja: "movimientos"; total: number; limite: number }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** Las dos hojas de un estado de cuenta con detalle (tienda, mensajero en la oficina, `/mi-wallet`). */
export type CuentaKardexConDetalleServiceResult =
  | { status: "ok"; estado: EstadoCuentaDTO; kardex: KardexDTO; porGuia: DetallePorGuiaDTO }
  | LimiteExcedidoDeHoja
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
