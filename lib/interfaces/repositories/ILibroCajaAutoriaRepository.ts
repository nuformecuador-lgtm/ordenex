/**
 * FICHA 458-B (design §3.4, R56/R57) — las lecturas EN LOTE con las que se resuelve, para una pagina
 * del libro de la caja, «A quien» y «Registro». SOLO queries: una por tipo de origen PRESENTE en la
 * pagina (ninguna si no hay filas de ese tipo). Devuelven NOMBRES (con la funcion unica de nombre del
 * repo) y los ids de cuenta solo para el enlace, que viajan y no se pintan.
 */
export interface CuentaNombrada {
  tipo: "tienda" | "mensajero";
  id: string;
  nombre: string;
}

import type { ComoDTO } from "@/lib/types/libro-caja-autoria";
import type { WalletMovimientoCategoria, WalletMovimientoTipo, WalletOrigenTipo } from "@/lib/types/wallet";

export interface MovimientoDeCajaParaAutoria {
  id: string;
  /** Ficha 458-C (M1): tipo y categoria deciden si la fila es la ORIGINAL de un documento. */
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  registradoPor: string | null;
}

/** Ficha 458-C (M1, R58) — una anulacion leida de su constancia. */
export interface AnulacionDeDocumento {
  motivo: string | null;
  por: string | null;
  fecha: Date;
}

/** Ficha 458-C (M1, R58) — los ids de documento por tipo, para leer su «como» o su anulacion. */
export interface IdsDeDocumentos {
  /** `liquidacion_pago` (172: a una tienda o a un mensajero). */
  pagos: readonly string[];
  pagosPorCuenta: readonly string[];
  aportes: readonly string[];
  abonos: readonly string[];
  /** Debitos de la tienda de los cobros de Ordenex (461/381). */
  cobros: readonly string[];
  /** Gestiones de los cobros por rechazo (el cobro se busca por su gestion). */
  rechazos: readonly string[];
  /** Filas del podio de los premios del ranking. */
  premios: readonly string[];
  /** Filas de la caja cuya constancia es `ajuste_caja_anulacion` (egreso, correccion, indemnizacion). */
  movimientos: readonly string[];
}

export interface ILibroCajaAutoriaRepository {
  /** Las filas del libro de la caja por su id (solo las columnas que deciden autoria). */
  movimientos(ids: readonly string[]): Promise<MovimientoDeCajaParaAutoria[]>;
  /** Nombre de cada usuario que registro algo. */
  nombres(usuarioIds: readonly string[]): Promise<Map<string, string>>;
  /** Cierre del dia → su mensajero y quien lo aprobo. */
  cierres(ids: readonly string[]): Promise<Map<string, { mensajero: CuentaNombrada; aprobo: string | null }>>;
  /** Pago de la 172 → su beneficiario (tienda o mensajero). */
  pagos(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Gestion de un cobro por rechazo → la tienda cobrada y quien aprobo el cobro. */
  rechazos(gestionIds: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; aprobo: string | null }>>;
  /** Fila del podio → el mensajero premiado. */
  podios(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Incidente → la tienda de la orden y quien lo resolvio. */
  incidentes(ids: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; resolvio: string | null }>>;
  /** Pago de un gasto de una tienda (459) → la tienda y el beneficiario (texto libre). */
  pagosPorCuenta(ids: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; beneficiario: string }>>;
  /** Debito de la tienda de un cobro (461/381) → la tienda. */
  debitosDeTienda(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Pago de una tienda a Ordenex (457) → la tienda. */
  abonos(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** R42/R56 — la anotacion «a quien» de un movimiento registrado a mano (sueldo, gasto, correccion). */
  anotaciones(movimientoIds: readonly string[]): Promise<Map<string, string | null>>;
  /**
   * Ficha 458-C (M1, R58) — «Como»: metodo y referencia de los pagos (172), de los pagos de un gasto
   * (459) y de los pagos de una tienda (457), por id de documento; y la referencia anotada a mano
   * (`wallet_anotacion`) por id de la fila. Una consulta por tipo presente.
   */
  comos(ids: Pick<IdsDeDocumentos, "pagos" | "pagosPorCuenta" | "abonos" | "movimientos">): Promise<{
    pagos: Map<string, ComoDTO>;
    pagosPorCuenta: Map<string, ComoDTO>;
    abonos: Map<string, ComoDTO>;
    movimientos: Map<string, ComoDTO>;
  }>;
  /**
   * Ficha 458-C (M1, R58) — la anulacion de cada documento, leida de SU constancia (quien, cuando,
   * motivo). El premio no tiene constancia: se lee su reverso de caja (quien lo registro, cuando, y su
   * descripcion, que lleva el motivo). Una consulta por tipo presente.
   */
  anulaciones(ids: IdsDeDocumentos): Promise<Record<keyof IdsDeDocumentos, Map<string, AnulacionDeDocumento>>>;
}
