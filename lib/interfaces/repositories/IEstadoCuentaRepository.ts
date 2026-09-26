import type { MetodoPagoValue } from "@prisma/client";

import type { DesgloseTiendaAgregadoRow } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";

/**
 * FICHA 458-B (design §3.2, R16–R25) — las LECTURAS del estado de cuenta de una tienda, un mensajero
 * o una bodega satelite. SOLO queries. Montos STRING escala 2 (`numeric → text` en la base).
 *
 * El SALDO CORRIDO se calcula en la BASE con una ventana sobre la cuenta ENTERA (hasta `hastaUtc`),
 * ordenada por `(fecha, created_at, id)` (R21/R23); el periodo (`desdeUtc`) y el filtro de chip se
 * aplican FUERA de la ventana, y despues se pagina. Asi el corrido de cada fila es el de la cuenta
 * completa, sea cual sea el chip.
 */

/** Un par (categoria, origen[, es premio]) que pertenece al chip pedido: el filtro del chip en SQL. */
export interface ParDeChip {
  categoria: string;
  origen: string;
  /** Solo mensajero: la fila lleva `premio_dia` (premio del ranking o su reverso). */
  esPremio?: boolean;
}

export interface VentanaDeLibro {
  /** Inicio del dia CR de `desde` (inclusivo), o sin periodo. */
  desdeUtc?: Date;
  /** Inicio del dia CR SIGUIENTE a `hasta` (cota exclusiva), o hasta hoy. */
  hastaUtc?: Date;
  /** `null` = «Todo». */
  pares: ParDeChip[] | null;
  /**
   * FICHA 458-D (servidor, R10/R12) — solo las filas que nacen de ESE cierre (`origen_tipo =
   * 'cierre_dia' AND origen_id = cierreId`), DENTRO de la cuenta: se aplica fuera de la ventana, como
   * el chip, asi que el corrido sigue siendo el de la cuenta entera. Sin efecto en la bodega.
   */
  cierreId?: string;
  skip: number;
  take: number;
}

/** Una fila de un libro de cuenta, con su saldo corrido. */
export interface FilaDeLibroRow {
  id: string;
  /** tienda: credito|debito · mensajero: devengo|pago · bodega: declarado|recibido. */
  tipo: string;
  categoria: string;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  registradoPorNombre: string | null;
  fechaMovimiento: Date;
  monto: string;
  saldoCorrido: string;
  /** Solo mensajero. */
  premioDia: Date | null;
}

export interface PaginaDeLibro {
  filas: FilaDeLibroRow[];
  total: number;
}

/** Un movimiento del periodo, con lo minimo para decidir los pares anulados (D3). */
export interface MovimientoDelPeriodoRow {
  id: string;
  tipo: string;
  categoria: string;
  origenTipo: string;
  origenId: string | null;
  premioDia: Date | null;
  monto: string;
}

/** Una constancia de anulacion leida en lote: el documento, el motivo, quien y cuando. */
export interface AnulacionLeida {
  documentoId: string;
  motivo: string | null;
  anuladoPorNombre: string | null;
  fecha: Date;
}

export type TipoDeDocumentoDeLibro = "liquidacion_pago" | "cobro_tienda" | "pago_por_cuenta_tienda" | "abono_tienda";

/** FICHA 458-D (servidor) — los documentos de PAGO: los unicos con metodo y referencia. */
export type TipoDeDocumentoDePago = Exclude<TipoDeDocumentoDeLibro, "cobro_tienda">;

/** El metodo y la referencia de un documento de pago, por su id. */
export interface PagoDeDocumento {
  documentoId: string;
  metodo: MetodoPagoValue;
  referencia: string | null;
}

/** FICHA 458-D (servidor, R19) — lo minimo de una fila del libro del mensajero para abrir su detalle. */
export interface MovimientoDeMensajeroRow {
  monto: string;
  categoria: PagoMensajeroMovimientoCategoria;
  origenTipo: string;
  origenId: string | null;
}

export interface IEstadoCuentaRepository {
  /**
   * FICHA 458-B (revision M2) — ejecuta `fn` con un repositorio ligado a UNA transaccion
   * REPEATABLE READ: todas sus lecturas ven la MISMA foto de los libros. Sin esto, un cierre
   * aprobado entre dos lecturas (los totales y el periodo) hace que R22 no cuadre y la pantalla
   * responda con un error de servidor.
   */
  enLecturaConsistente<T>(fn: (repo: IEstadoCuentaRepository) => Promise<T>): Promise<T>;
  /** El nombre de la cuenta si existe con ese papel (tienda = adminTienda, mensajero = mensajero, bodega = zona satelite); `null` si no. */
  nombreDeCuenta(tipo: "tienda" | "mensajero" | "bodega", id: string): Promise<string | null>;

  paginaDeTienda(tiendaId: string, ventana: VentanaDeLibro): Promise<PaginaDeLibro>;
  paginaDeMensajero(mensajeroId: string, ventana: VentanaDeLibro): Promise<PaginaDeLibro>;
  paginaDeBodega(zonaId: string, ventana: VentanaDeLibro): Promise<PaginaDeLibro>;

  /**
   * Los DOS totales de la cuenta con los movimientos ANTERIORES a `antesDe` (o de todos, sin
   * `antesDe`). La RESTA la hace el servicio con la MISMA funcion que hoy deriva cada saldo
   * (`derivarSaldoTienda`, `derivarCuentaPorPagar`, `saldoDe`): R22 compara contra ellas.
   */
  totalesDeTienda(tiendaId: string, antesDe?: Date): Promise<{ creditos: string; debitos: string }>;
  /**
   * FICHA 458-D (cierre, 172 R55) — los totales de la cuenta ENTERA de una tienda por (tipo,
   * categoria), sin periodo ni chip: la entrada de `derivarDesgloseTienda` para el resumen de tres
   * cifras de `/mi-wallet`. Es la MISMA forma que `IWalletTiendaMovimientoRepository.
   * agregarDesglosePorTienda`, leida DENTRO de la lectura consistente del extracto.
   */
  desgloseDeTienda(tiendaId: string): Promise<DesgloseTiendaAgregadoRow[]>;
  totalesDeMensajero(mensajeroId: string, antesDe?: Date): Promise<{ devengado: string; pagado: string }>;
  /** Bodega: el efectivo declarado y lo recibido, sin las consolidaciones rechazadas. */
  totalesDeBodega(zonaId: string, antesDe?: Date): Promise<{ efectivo: string; recibido: string }>;

  /** Los movimientos del periodo `[desdeUtc, hastaUtc)` (para los totales netos, D3). */
  periodoDeTienda(tiendaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]>;
  periodoDeMensajero(mensajeroId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]>;
  periodoDeBodega(zonaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]>;

  /** R25/R71 — las anulaciones de estos documentos, UNA consulta por tipo; ids vacios → sin consulta. */
  anulacionesDe(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<AnulacionLeida[]>;
  /** Los documentos de estos tipos que tienen comprobante. */
  conComprobante(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<Set<string>>;
  /** Los reversos de premio (`ajuste_pago` con `premio_dia`) de ese mensajero en esos dias. */
  reversosDePremio(mensajeroId: string, dias: readonly Date[]): Promise<AnulacionLeida[]>;
  /** FICHA 458-D (servidor) — metodo y referencia de estos documentos de pago, UNA consulta por tipo. */
  pagosDe(tipo: TipoDeDocumentoDePago, ids: readonly string[]): Promise<PagoDeDocumento[]>;
  /**
   * FICHA 458-D (servidor, R19) — una fila del libro del mensajero, con `mensajero_id` en el `WHERE`:
   * la de otro mensajero responde `null`, igual que una que no existe.
   */
  movimientoDeMensajero(movimientoId: string, mensajeroId: string): Promise<MovimientoDeMensajeroRow | null>;
  /** R57 — quien aprobo cada cierre (`cierre_dia.resuelto_por`), por id de cierre. */
  quienAproboLosCierres(cierreIds: readonly string[]): Promise<Map<string, string | null>>;
}
