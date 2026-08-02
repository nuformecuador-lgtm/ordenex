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
  /**
   * Feature 172 (T B.2, design §2.4, R37) — fecha del movimiento, OPCIONAL.
   *
   * La columna existe desde la 44 con `DEFAULT CURRENT_TIMESTAMP` y hasta hoy ningun
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

/**
 * Filtros del listado del libro de UN mensajero (R20/R22). Rango de fechas sobre
 * `fecha_movimiento`.
 *
 * **`cierreId` = «todo lo que pertenece a ese cierre», y son DOS orígenes** desde la feature
 * 172 (T C.3, R52): lo que el feed escribio al aprobarlo (`origen_tipo = cierre_dia`) **y** los
 * pagos registrados contra el, con sus contraasientos (`origen_tipo = pago_mensajero`, cuyo
 * `origen_id` es el PAGO, no el cierre). La traduccion a SQL vive en el repositorio.
 */
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
// paginacion — y con la MISMA lectura de `cierreId` (172/T C.3), para que la cabecera y la
// tabla del desglose no puedan contar cosas distintas.
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
  /**
   * Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el CONJUNTO que casa la busqueda, entero,
   * ordenado igual que la pagina y SIN recorte. Es lo que la descarga necesita (R52).
   *
   * Es el hermano de `listarCuentasPorPagarPaginado` y comparte con el la MISMA linea de
   * filtrado y orden: la pagina es literalmente un `slice` de lo que devuelve este metodo. Por
   * eso existe como metodo y no como «lo mismo con `take` grande» — que la fila 26 salga en la
   * pagina 2 y en el archivo es una consecuencia de que solo haya UNA lista, no de que dos
   * escrituras coincidan.
   */
  listarCuentasPorPagarCompleto(
    filtro: CuentasPorPagarFiltro,
  ): Promise<CuentaPorPagarAgregadoRow[]>;
  /** R18: nombre de UN mensajero (vista del maestro: desglose por cierre de un mensajero arbitrario). null si no existe. */
  obtenerNombreMensajero(mensajeroId: string): Promise<string | null>;
}
