import type { GestionResultado } from "@prisma/client";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

/**
 * Ficha 464 (design §2.3) — el contrato del DETALLE POR ORDEN EN LOTE: para cada movimiento de la
 * hoja de movimientos de una descarga, las ordenes que componen su importe (o por que no se reparte).
 *
 * Modulo de TIPOS: sin Prisma (salvo el union `GestionResultado`, que es un tipo y se borra al
 * compilar). Lo importan el servicio, el borde y el adaptador de cliente de la descarga.
 *
 * Money-safe: todo importe cruza la frontera como STRING escala 2, y el cuadre (`suma`, `cuadra`) lo
 * decide el SERVIDOR con `Prisma.Decimal`: el navegador no suma (R22/R23/R31).
 *
 * Ningun campo es un identificador que se pinte (R30): `movimientoId` es el ENLACE en memoria con la
 * fila de la hoja de movimientos y nunca va a una celda.
 */

/** Una orden que aporta al importe de un movimiento, con lo congelado en SU cierre (R29). */
export interface OrdenDelLoteDTO {
  /**
   * Ficha 468 (design §4.1) — el id de la orden: la clave del bloque de una orden SIN guia en la hoja
   * «Detalle por guia». Es un ENLACE en memoria y NUNCA se pinta (R30 de la 464 sigue vigente).
   */
  clave: string;
  /** `cierre_detail.num_guia` congelado, como texto; `null` si la orden nunca llego a tener guia. */
  guia: string | null;
  /** `cierre_detail.num_remision` congelado. */
  remision: string;
  /** `cierre_detail.destinatario` congelado. */
  destinatario: string;
  /** `cierre_detail.tienda_nombre` congelado. `null` en las vistas de UNA tienda (oficina y /mi-wallet). */
  tiendaNombre: string | null;
  /** Los resultados de TODAS sus gestiones en ese cierre, en el orden del detalle de la fila (R20). */
  resultados: GestionResultado[];
  /** STRING escala 2: lo deriva `aporteDeOrden`, la MISMA funcion que el detalle de una fila (R21/R31). */
  aporte: string;
}

/** La cabecera del cierre de un movimiento con reparto. */
export interface CierreDelLoteDTO {
  /** ISO de `cierre_dia.solicitado_at` (la pantalla lo pinta como dia de Costa Rica). */
  fecha: string;
  /** Nombre completo del mensajero; `null` en `/mi-wallet` (a la tienda no se le revela, R5). */
  mensajeroNombre: string | null;
}

export type DetalleDeMovimientoLoteDTO =
  | {
      movimientoId: string;
      modo: "ordenes";
      cierre: CierreDelLoteDTO;
      /** En el orden total del detalle de una fila (guia congelada asc nulls last, id). */
      ordenes: OrdenDelLoteDTO[];
      /** Σ de los aportes, STRING escala 2, sumada con Decimal en el servidor (R22/R23). */
      suma: string;
      /** `suma` == monto del movimiento. `false` => la celda «Detalle por orden» lo dice (R23). */
      cuadra: boolean;
    }
  | { movimientoId: string; modo: "sin_reparto"; motivo: MotivoSinReparto };

/** Resultado de DOMINIO del detalle en lote. Las tres formas son excluyentes y solo `ok` lleva filas. */
export type DetalleEnLoteServiceResult =
  | { status: "ok"; detalle: DetalleDeMovimientoLoteDTO[] }
  /** R39/R40: el detalle pasaria del tope. SOLO conteos: no se leyo ni una fila de ordenes. */
  | { status: "limite_excedido"; total: number; limite: number }
  | { status: "forbidden" };

/**
 * Ficha 468 (design §7.3, R18/R61) — solo los CONTEOS del lote: cuantas ordenes componen cada movimiento
 * recibido, en su orden (`null` = no repartible). No se lee ni una fila de ordenes.
 */
export type ContarEnLoteServiceResult =
  | { status: "ok"; ordenes: (number | null)[] }
  | { status: "forbidden" };

/**
 * R38/R39 — `limite_excedido` en el BORDE, con la hoja que se paso del tope para que el cliente
 * redacte el aviso correcto: «movimientos» (el de siempre) o «detalle» (el nuevo, R39).
 */
export interface LimiteExcedidoDeHoja {
  status: "limite_excedido";
  hoja: "movimientos" | "detalle";
  total: number;
  limite: number;
}

/**
 * Ficha 464 (design §2.3/§4) — la hoja de movimientos Y su detalle por orden, de UNA vez (R36), vistas
 * desde el SERVICIO. `limite_excedido` lleva `hoja`: «movimientos» es el tope de siempre (R38, el
 * resultado del completo tal cual) y «detalle» el nuevo (R39). Ninguna rama de error lleva filas.
 */
export type CajaConDetalleServiceResult =
  | { status: "ok"; items: WalletMovimientoDTO[]; total: number; detalle: DetalleDeMovimientoLoteDTO[] }
  | LimiteExcedidoDeHoja
  | { status: "forbidden" };

export type EstadoCuentaConDetalleServiceResult =
  | { status: "ok"; estado: EstadoCuentaDTO; detalle: DetalleDeMovimientoLoteDTO[] }
  | LimiteExcedidoDeHoja
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
