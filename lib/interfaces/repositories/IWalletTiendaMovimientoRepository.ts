import type { PrismaClient } from "@prisma/client";
import type {
  WalletTiendaMovimientoDTO,
  WalletTiendaMovimientoTipo,
  WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 43 (design §2.1) — contrato del repositorio del LEDGER por tienda. Solo queries
// Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING. El acotado por
// `tienda_id` va SIEMPRE en el WHERE (R19), nunca en memoria.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `walletTiendaMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type WalletTiendaTxClient = Pick<PrismaClient, "walletTiendaMovimiento">;

// Fila a insertar en el ledger. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearMovimientoTiendaInput {
  tiendaId: string;
  tipo: WalletTiendaMovimientoTipo;
  categoria: WalletTiendaMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
  /**
   * Feature 172 (T B.2, design §2.4, R37) — fecha del movimiento, OPCIONAL.
   *
   * La columna existe desde la 43 con `DEFAULT CURRENT_TIMESTAMP` y hasta hoy ningun
   * escritor la exponia: el feed del cierre escribe con la hora real y le vale el default.
   * La liquidacion necesita fechar el movimiento con la fecha REAL del pago —que puede ser
   * de ayer— y no con el instante de registro.
   *
   * Es opcional A PROPOSITO y la implementacion la pasa SOLO si viene: quien no la manda
   * sigue cayendo en el `DEFAULT` de la columna y su comportamiento no cambia ni un byte.
   * La prueba de que es opcional de verdad es que los tests de los dos feeds del cierre
   * siguen verdes sin editarlos.
   *
   * Convencion de la 172: MEDIANOCHE UTC del dia de `fecha_pago` (`medianocheUtcDelDia`),
   * no 06:00Z, para que el pago entre por los dos bordes del filtro por rango del desglose.
   */
  fechaMovimiento?: Date;
}

// Filtros del listado del ledger de UNA tienda (R19/R22). `cierreId` filtra por el origen
// (origen_tipo=cierre_dia, origen_id=cierreId). Rango de fechas sobre fecha_movimiento.
export interface ListarPorTiendaFiltros {
  tiendaId: string;
  page: number;
  pageSize: number;
  cierreId?: string;
  categoria?: WalletTiendaMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

export interface ListarPorTiendaPage {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
}

// Filtros del saldo de UNA tienda (R16/R22): mismo conjunto que el listado, sin paginacion.
export interface SaldoTiendaFiltros {
  cierreId?: string;
  categoria?: WalletTiendaMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

// Totales agregados por tipo (credito/debito), ya como STRING (money-safe). El service
// deriva el saldo (creditos - debitos, con signo) via `derivarSaldoTienda`.
export interface SaldoTiendaAgregado {
  creditos: string;
  debitos: string;
}

// Una fila por tienda para la vista del maestro (R20): totales agregados + nombre de la
// tienda. El service deriva el saldo con signo.
export interface SaldoTiendaAgregadoRow {
  tiendaId: string;
  tiendaNombre: string;
  creditos: string;
  debitos: string;
}

/**
 * Feature 171 (design §4.2) — una fila por par (tipo, categoria) con su Σ monto, para UNA
 * tienda y unos filtros. Es el material CRUDO del desglose: el repositorio no clasifica ni
 * resta, solo agrega. Quien decide en que cubeta cae cada categoria es `derivarDesgloseTienda`
 * (`lib/utils/desglose-tienda.ts`), donde la clasificacion esta declarada y es exhaustiva.
 *
 * `tipo` viaja aunque la cubeta se decida por `categoria`: es lo que permite comprobar contra
 * la OTRA derivacion del mismo ledger (`derivarSaldoTienda`, que parte de credito/debito) que
 * ambas cuadran sobre el mismo conjunto (R11). Money-safe: `total` STRING escala 2.
 */
export interface DesgloseTiendaAgregadoRow {
  tipo: WalletTiendaMovimientoTipo;
  categoria: WalletTiendaMovimientoCategoria;
  total: string;
}

/**
 * Ficha 335 (design §2.2, R1/R6) — un cierre del dia VISTO DESDE EL LIBRO DE UNA TIENDA.
 *
 * No sale del dominio de cierres: sale de `wallet_tienda_movimiento` agrupado por `origen_id`.
 * La consecuencia que importa es de alcance: el conjunto ya esta acotado por construccion —solo
 * puede contener cierres que movieron dinero de ESTA tienda— y toda opcion devuelta rinde al
 * menos una fila al aplicarse.
 *
 * Sin `_sum` y sin ningun monto (R9): la lectura del selector no toca dinero.
 */
export interface CierreDeTiendaAgregadoRow {
  /** `= origen_id`, un `cierre_dia.id`. Nunca `null`: el WHERE lo excluye. */
  cierreId: string;
  /** ISO del movimiento MAS RECIENTE de ese cierre EN ESTE LIBRO (no del cierre entero). */
  ultimaFecha: string;
  /** Cuantos movimientos de ESA tienda trajo ese cierre. Cardinal, no monto. */
  movimientos: number;
}

export interface IWalletTiendaMovimientoRepository {
  /**
   * R6/R13: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el
   * indice unico parcial (origen_tipo, origen_id, tienda_id, categoria). NO hace
   * check-then-insert (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: WalletTiendaTxClient, movs: CrearMovimientoTiendaInput[]): Promise<number>;
  /** R19/R22: pagina el ledger de UNA tienda (orderBy fecha_movimiento desc), filtros + tienda en el WHERE. */
  listarPorTienda(filtros: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage>;
  /** R16/R19: SUM(monto) por tipo acotado a `tiendaId` + filtros en el WHERE. STRING (money-safe). */
  agregarSaldoPorTienda(tiendaId: string, filtros: SaldoTiendaFiltros): Promise<SaldoTiendaAgregado>;
  /** R20: una fila por tienda (con nombre) con sus totales credito/debito, para el maestro. */
  listarSaldosTodasTiendas(): Promise<SaldoTiendaAgregadoRow[]>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA de los saldos por tienda +
   * el TOTAL de tiendas con movimientos.
   *
   * Reusa la MISMA agregacion que `listarSaldosTodasTiendas` (el saldo de una tienda no se
   * puede derivar de una pagina de movimientos: la agregacion es del conjunto por
   * construccion), y por eso el recorte no anade NI UNA consulta — tampoco la del conteo. El
   * orden es por NOMBRE de tienda (`tiendaId` como desempate): este listado no tenia criterio
   * de ordenacion y sin un orden total la pagina 2 podria repetir u omitir filas. Ver la
   * desviacion declarada en la impl del repositorio.
   */
  listarSaldosTiendasPaginado(
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<SaldoTiendaAgregadoRow>>;
  /**
   * Feature 171 (R22/R24/R34): Σ monto agrupado por (tipo, categoria) para UNA tienda +
   * filtros, con `tiendaId` SIEMPRE en el WHERE. UN solo `groupBy`, sea cual sea el tamaño de
   * pagina o el numero de tiendas listadas. Salida STRING (money-safe).
   */
  agregarDesglosePorTienda(
    tiendaId: string,
    filtros: SaldoTiendaFiltros,
  ): Promise<DesgloseTiendaAgregadoRow[]>;
  /**
   * Ficha 335 (R1/R2/R7/R10) — los cierres que dejaron al menos un movimiento en el libro de
   * UNA tienda, del mas reciente al mas antiguo, recortados a `limite`.
   *
   * UNA sola sentencia sea cual sea el numero de cierres (R10): es un `groupBy`, no un listado
   * seguido de N conteos. `tiendaId` va SIEMPRE en el WHERE (R2), como en `listarPorTienda` y
   * `agregarDesglosePorTienda` — nunca filtrando en memoria.
   *
   * Vive AQUI y no en un repositorio nuevo a proposito: habria dos sitios donde escribir el
   * `tienda_id` del mismo libro, y esa duplicacion es exactamente contra lo que argumentan los
   * comentarios de este modulo. El coste de extender la interfaz —romper los dobles— lo canta
   * el typecheck: es ruido, no un fallo mudo.
   */
  listarCierresDeTienda(tiendaId: string, limite: number): Promise<CierreDeTiendaAgregadoRow[]>;
  /**
   * Ficha 344 (R41/R42) — UNA fila del ledger por su id, acotada a SU tienda.
   *
   * Los dos argumentos van juntos a proposito: no existe un `obtenerPorId` a secas de este
   * libro. El `tienda_id` es parte de la IDENTIDAD de la lectura, no un filtro posterior, y va
   * en el `WHERE` — leer primero y comparar despues significaria haber sacado de la base el
   * movimiento de otra tienda para decidir tirarlo.
   *
   * `null` cuando no hay tal fila EN EL LIBRO DE ESA TIENDA. Es la MISMA respuesta para «no
   * existe» y para «es de otra tienda», y es deliberado: distinguirlas confirmaria la existencia
   * de un movimiento ajeno.
   */
  obtenerPorIdDeTienda(id: string, tiendaId: string): Promise<WalletTiendaMovimientoDTO | null>;
}
