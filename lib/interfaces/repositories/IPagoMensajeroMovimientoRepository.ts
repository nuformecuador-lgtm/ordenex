import type { PrismaClient } from "@prisma/client";
import type {
  PagoMensajeroMovimientoDTO,
  PagoMensajeroMovimientoTipo,
  PagoMensajeroMovimientoCategoria,
} from "@/lib/types/wallet-mensajero";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 44 (design §2.1) — contrato del repositorio del LIBRO del pago por mensajero. Solo
// queries Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING. El acotado
// por `mensajero_id` va SIEMPRE en el WHERE (R20), nunca en memoria.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `pagoMensajeroMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type PagoMensajeroTxClient = Pick<PrismaClient, "pagoMensajeroMovimiento">;

// Fila a insertar en el libro. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearPagoMensajeroInput {
  mensajeroId: string;
  tipo: PagoMensajeroMovimientoTipo;
  categoria: PagoMensajeroMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
}

// Filtros del listado del libro de UN mensajero (R20/R22). `cierreId` filtra por el origen
// (origen_tipo=cierre_dia, origen_id=cierreId). Rango de fechas sobre fecha_movimiento.
export interface ListarPorMensajeroFiltros {
  mensajeroId: string;
  page: number;
  pageSize: number;
  cierreId?: string;
  desde?: Date;
  hasta?: Date;
}

export interface ListarPorMensajeroPage {
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
}

// Filtros de la cuenta por pagar de UN mensajero (R14/R22): mismo conjunto que el listado, sin
// paginacion.
export interface CuentaPorPagarFiltros {
  cierreId?: string;
  desde?: Date;
  hasta?: Date;
}

// Totales agregados por tipo (devengo/pago), ya como STRING (money-safe). El service deriva la
// cuenta por pagar (devengado - pagado, con signo) via `derivarCuentaPorPagar`.
export interface CuentaPorPagarAgregado {
  devengado: string;
  pagado: string;
}

// Una fila por mensajero para la vista del maestro (R18): totales agregados + nombre. El service
// deriva la cuenta por pagar con signo.
export interface CuentaPorPagarAgregadoRow {
  mensajeroId: string;
  mensajeroNombre: string;
  devengado: string;
  pagado: string;
}

/**
 * Feature 170 — FASE 2 (T L.1, R45) — el UNICO filtro de este listado: la busqueda por nombre
 * de mensajero que hasta hoy resolvia el navegador. Es texto en crudo (sin normalizar): quien
 * normaliza es `lib/utils/cuentas-por-pagar-listado.ts`, para que el criterio viva en un solo
 * sitio. Ausente o vacio = sin filtro.
 *
 * NO lleva `mensajeroId` ni ninguna otra clave de alcance: este listado es «todos los
 * mensajeros» y su alcance lo decide el ROL del actor, nunca un dato de la peticion.
 */
export interface CuentasPorPagarFiltro {
  busqueda?: string;
}

export interface IPagoMensajeroMovimientoRepository {
  /**
   * R6/R12: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el indice
   * unico parcial (origen_tipo, origen_id, mensajero_id, categoria). NO hace check-then-insert
   * (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: PagoMensajeroTxClient, movs: CrearPagoMensajeroInput[]): Promise<number>;
  /** R20/R22: pagina el libro de UN mensajero (orderBy fecha_movimiento desc), filtros + mensajero en el WHERE. */
  listarPorMensajero(filtros: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage>;
  /** R14/R20: SUM(monto) por tipo acotado a `mensajeroId` + filtros en el WHERE. STRING (money-safe). */
  agregarCuentaPorPagar(mensajeroId: string, filtros: CuentaPorPagarFiltros): Promise<CuentaPorPagarAgregado>;
  /** R18: una fila por mensajero (con nombre) con sus totales devengado/pagado, para el maestro. */
  listarCuentasPorPagarTodos(): Promise<CuentaPorPagarAgregadoRow[]>;
  /**
   * Feature 170 — FASE 2 (T L.1, R40/R41/R45/R51): las MISMAS filas, con la busqueda por
   * nombre aplicada, ordenadas y recortadas a una pagina, mas el TOTAL del conjunto filtrado.
   *
   * Reusa la agregacion de `listarCuentasPorPagarTodos` en vez de agregar por su cuenta, y eso
   * es deliberado (precedente: `listarSaldosTiendasPaginado`, T I.1): cada fila es la suma de
   * TODO el libro de ese mensajero, asi que no hay nada que empujar al `LIMIT` sin cambiar el
   * dinero que la fila declara. El total sale de esa misma agregacion: no hay consulta de
   * conteo que pueda mirar otro conjunto (R41).
   */
  listarCuentasPorPagarPaginado(
    filtro: CuentasPorPagarFiltro,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CuentaPorPagarAgregadoRow>>;
  /** R18: nombre de UN mensajero (vista del maestro: desglose por cierre de un mensajero arbitrario). null si no existe. */
  obtenerNombreMensajero(mensajeroId: string): Promise<string | null>;
}
