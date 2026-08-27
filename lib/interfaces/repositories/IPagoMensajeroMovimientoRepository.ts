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
  /**
   * Feature 293 (design §3.3, R17) — FECHA CALENDARIO CR DEL PODIO del que nace el premio,
   * MEDIANOCHE UTC (convencion `@db.Date` del repo, `fechaComoDate`).
   *
   * Es la mitad de la guarda no negociable: el unico parcial
   * `(mensajero_id, premio_dia) WHERE categoria = 'premio_ranking'` la impone en la BASE, no
   * en un `if` del servicio. Sin ella el premio no se puede escribir —el CHECK
   * `pago_mensajero_movimiento_premio_dia_check` lo rechaza con 23514— y con ella en una
   * categoria que no sea `premio_ranking` o `ajuste_pago`, tambien.
   *
   * OPCIONAL, como `fechaMovimiento`: los escritores previos (feed del cierre, liquidacion) no
   * la mandan y su comportamiento no cambia ni un byte.
   */
  premioDia?: Date;
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
  /**
   * Feature 293 (T2.2, design §5, R24) — Σ de los PREMIOS VIVOS imputados a cada cierre pedido,
   * en UNA consulta para toda la pagina de cierres. Es el termino nuevo de
   * `derivarPendienteCierre`.
   *
   * «Vivo» = registrado y no anulado, y aqui eso es una RESTA, no un filtro: la anulacion no
   * borra ni edita la fila del premio (R21), escribe su compensacion. Por eso
   *
   *     premiosVivos(cierre) = Σ `premio_ranking` − Σ (`ajuste_pago` con `premio_dia` NOT NULL)
   *
   * y por eso el WHERE lleva las dos categorias a la vez. El `premio_dia IS NOT NULL` de la
   * segunda rama es lo que separa la compensacion de un premio de un `ajuste_pago` cualquiera:
   * son la misma categoria y solo la columna los distingue.
   *
   * `origen_tipo = 'cierre_dia'` va SIEMPRE en el WHERE, y no es adorno: sin el, un
   * `origen_id` que casualmente coincidiera con un cierre —el id de un PAGO, por ejemplo—
   * sumaria dinero a un cierre al que no pertenece.
   *
   * Devuelve una entrada por CADA id pedido (`"0.00"` los que no tienen premio), igual que
   * `sumarVigentesPorCierre`, para que el caller no tenga que distinguir «no hay» de «no lo
   * pedi». Con la lista vacia no consulta.
   */
  sumarPremiosVivosPorCierre(cierreIds: string[]): Promise<Record<string, string>>;
  /**
   * Feature 293 (T3.3, R9/R18/R31/R32) — el ESTADO del premio de un mensajero en unos dias
   * concretos: las filas `premio_ranking` y las de su compensacion (`ajuste_pago` con
   * `premio_dia`) de ESE mensajero para ESOS dias.
   *
   * Es lo que deja al servicio responder «no registrado / registrado / anulado» (R9) sin
   * ningun estado almacenado aparte, y lo que distingue `ya_registrado` de `anulado` en el
   * segundo intento de registro (R32): las dos respuestas nacen de que el unico parcial
   * rechazo la fila, y solo estas filas dicen cual de las dos es.
   *
   * `tx` es OPCIONAL y existe por un motivo concreto (revision de la 293, m4): esa segunda
   * lectura ocurre DENTRO de la transaccion del registro, y una lectura por el cliente propio
   * del repositorio es OTRA conexion — no ve lo que la transaccion en curso lleva escrito.
   * Quien lea dentro de una transaccion debe pasar su `tx`; quien lea fuera (el listado del
   * podio) lo omite y sigue usando el cliente del repositorio, como hasta hoy.
   */
  listarPremiosPorDias(
    mensajeroId: string,
    dias: Date[],
    tx?: PagoMensajeroTxClient,
  ): Promise<PremioRegistradoRow[]>;
}

/**
 * Feature 293 (T3.3) — una fila del libro que pertenece al mundo del premio, con lo justo para
 * decidir su estado. `monto` STRING (money-safe) y `premioDia` tal cual sale de la columna
 * `@db.Date` (medianoche UTC de la fecha calendario CR).
 */
export interface PremioRegistradoRow {
  categoria: Extract<PagoMensajeroMovimientoCategoria, "premio_ranking" | "ajuste_pago">;
  premioDia: Date;
  monto: string;
  /** El cierre al que se imputo (`origen_tipo = cierre_dia` -> el `origen_id` ES el cierre). */
  cierreId: string | null;
  fechaMovimiento: Date;
}
