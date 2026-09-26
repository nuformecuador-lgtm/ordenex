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

export interface IEstadoCuentaRepository {
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
  /** R57 — quien aprobo cada cierre (`cierre_dia.resuelto_por`), por id de cierre. */
  quienAproboLosCierres(cierreIds: readonly string[]): Promise<Map<string, string | null>>;
}
