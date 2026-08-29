import type { PrismaClient } from "@prisma/client";
import type {
  AgregadoCajaRow,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
  WalletMovimientoCategoria,
  WalletOrigenTipo,
} from "@/lib/types/wallet";

// Feature 42 (design §2.1) — contrato del repositorio del LIBRO de movimientos. Solo
// queries Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `walletMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type WalletTxClient = Pick<PrismaClient, "walletMovimiento">;

// Fila a insertar en el libro. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearMovimientoInput {
  /**
   * Ficha 334 (design §5, R28): id de la fila, generado ARRIBA por quien inserta.
   *
   * Existe porque `createMany` sobre Postgres NO devuelve los ids generados, asi que quien
   * necesita releer EXACTAMENTE la fila que acaba de crear no tiene por donde agarrarla —y la
   * relectura «el mas reciente de esa categoria» devuelve otra fila en cuanto un movimiento se
   * fecha en el pasado. Mismo precedente ya razonado en `lib/repositories/registrar-cambio-
   * dia-reparto.ts`: generarlos arriba permite seguir haciendo UN SOLO `createMany`.
   *
   * OPCIONAL por el mismo motivo —y con la misma forma— que `fechaMovimiento`: ausente ⇒ manda
   * el `@default(uuid())` de la columna y NINGUNO de los cinco escritores existentes cambia de
   * comportamiento.
   */
  id?: string;
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
  /**
   * Feature 173 (design §2.3, R20/R25): fecha REAL del hecho que el movimiento representa —la
   * del pago a la tienda, la del dia de la anulacion—, no el instante en que se registra.
   *
   * OPCIONAL a proposito, y es lo que hace que la ampliacion sea de coste CERO: ausente ⇒ la
   * columna `fecha_movimiento` cae en su `DEFAULT CURRENT_TIMESTAMP` y NINGUNO de los cinco
   * escritores existentes cambia de comportamiento. Es lo mismo que la 172 hizo con los otros
   * dos libros.
   */
  fechaMovimiento?: Date;
}

// Filtros del listado del libro (R20). Rango de fechas sobre fecha_movimiento.
export interface ListarMovimientosFiltros {
  page: number;
  pageSize: number;
  tipo?: WalletMovimientoTipo;
  categoria?: WalletMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

export interface ListarMovimientosPage {
  movimientos: WalletMovimientoDTO[];
  total: number;
}

// Filtros del conjunto agregado (R16/R20/R8): mismo conjunto que el listado, sin paginacion.
export interface BalanceFiltros {
  tipo?: WalletMovimientoTipo;
  categoria?: WalletMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

// Feature 45 (R11) — desglose de egresos por tipo, ya como STRING (money-safe). Deriva de un
// groupBy(categoria) acotado a las categorias del desglose.
// Feature 158 (R32): + `indemnizacion`. Con ella el desglose deja de ser SOLO de egresos
// ADMINISTRATIVOS — la indemnizacion es operativa, no administrativa.
export interface DesgloseEgresosAgregado {
  gastoFijo: string; // SUM(egreso_gasto_fijo)
  gastoVariable: string; // SUM(egreso_gasto_variable)
  sueldo: string; // SUM(egreso_sueldo)
  indemnizacion: string; // SUM(egreso_indemnizacion) — feature 158/R32
}

export interface IWalletMovimientoRepository {
  /**
   * R6/R13: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el
   * indice unico parcial (origen_tipo, origen_id, categoria). NO hace check-then-insert
   * (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number>;
  /**
   * R20/R24: pagina el libro (fecha_movimiento desc) con filtros en el WHERE.
   *
   * Ficha 334 (R26, design §4): el orden es TOTAL —`fecha_movimiento`, luego `created_at`,
   * luego `id`—, porque una sola columna con `skip`/`take` deja las filas empatadas en orden
   * indefinido y paginar repite u omite filas.
   */
  listar(filtros: ListarMovimientosFiltros): Promise<ListarMovimientosPage>;
  /**
   * Feature 173 (T D.1, design §5.1 — R8 parte datos, R47): `groupBy(categoria, tipo)` +
   * `SUM(monto)` sobre EXACTAMENTE los mismos filtros del listado. Salida STRING escala 2.
   *
   * SUSTITUYE al agregado por `tipo` a secas que traia la 42, que no podia decir de QUIEN es
   * el dinero. Con la caja en modo tesoreria eso ya no alcanza: la naturaleza (propio / de
   * terceros) es de la CATEGORIA, asi que sin la categoria en el `groupBy` las dos cifras de
   * `derivarCaja` no se pueden derivar. Los dos NO coexisten: el viejo se elimino en esta
   * misma tanda al quedarse sin consumidores (conventions: nada de codigo muerto).
   *
   * El repositorio se queda en su sitio: agrega y devuelve filas. La particion por naturaleza
   * y las dos restas las hace `derivarCaja`, que es PURA y no conoce la base (R10).
   */
  agregarPorCategoriaYTipo(filtros: BalanceFiltros): Promise<readonly AgregadoCajaRow[]>;
  /**
   * Feature 45 (R13): lee un movimiento por id para la reversa (monto server-side; evita
   * que el cliente falsee el monto). null si no existe.
   */
  obtenerPorId(id: string): Promise<WalletMovimientoDTO | null>;
  /**
   * Feature 45 (R11): desglose de egresos administrativos por tipo (gasto fijo / variable /
   * sueldo) del conjunto filtrado (mismos filtros que el libro). groupBy(categoria) +
   * SUM(monto), STRING (money-safe).
   */
  agregarPorCategoria(filtros: BalanceFiltros): Promise<DesgloseEgresosAgregado>;
}
