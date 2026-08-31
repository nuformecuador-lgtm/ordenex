import { z } from "zod";
import type {
  WalletTiendaMovimientoTipo as PrismaWalletTiendaMovimientoTipo,
  WalletTiendaMovimientoCategoria as PrismaWalletTiendaMovimientoCategoria,
} from "@prisma/client";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";

// Feature 43 (design §1.1/§3) — fuente unica de verdad de tipos/categorias del ledger POR
// TIENDA, respaldada por los enums Postgres nativos (patron lib/types/wallet.ts). El
// `satisfies` rompe el build si un SEED tuviera un valor que el enum NO tiene; el chequeo
// `_Ensure*` rompe el build si el enum gana un valor que el SEED NO lista. Money-safe: todos
// los montos cruzan la frontera como STRING (R4/R27), nunca como number.

export const WALLET_TIENDA_MOVIMIENTO_TIPO_SEED = [
  "credito",
  "debito",
] as const satisfies readonly PrismaWalletTiendaMovimientoTipo[];

export type WalletTiendaMovimientoTipo = (typeof WALLET_TIENDA_MOVIMIENTO_TIPO_SEED)[number];

type _EnsureTipoExhaustive = Exclude<
  PrismaWalletTiendaMovimientoTipo,
  WalletTiendaMovimientoTipo
> extends never
  ? true
  : never;
const _tipoExhaustive: _EnsureTipoExhaustive = true;
void _tipoExhaustive;

export const WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED = [
  // credito (a favor de la tienda)
  "cod_recaudado",
  // debitos (espejo 1:1 de los 6 conceptos de ingreso de la 42, R8)
  "flete",
  "flete_devolucion",
  "comision_cod",
  "iva_flete",
  "iva_flete_devolucion",
  "iva_comision_cod",
  // pago/liquidacion (F1.4-Q4; RESERVADO)
  "pago_tienda",
  // ajustes manuales (inmutables, R3/R29)
  "ajuste_credito",
  "ajuste_debito",
] as const satisfies readonly PrismaWalletTiendaMovimientoCategoria[];

export type WalletTiendaMovimientoCategoria =
  (typeof WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED)[number];

type _EnsureCategoriaExhaustive = Exclude<
  PrismaWalletTiendaMovimientoCategoria,
  WalletTiendaMovimientoCategoria
> extends never
  ? true
  : never;
const _categoriaExhaustive: _EnsureCategoriaExhaustive = true;
void _categoriaExhaustive;

// Las 6 categorias de DEBITO de la tienda, espejo 1:1 de los 6 conceptos de ingreso de la
// 42 (WALLET_INGRESO_CONCEPTO_SEED, R8). El feed las emite con tipo `debito`; el credito
// (`cod_recaudado`) va aparte. El resto (pago_tienda, ajuste_*) NO viene del feed del cierre.
export const WALLET_TIENDA_DEBITO_CATEGORIA_SEED = [
  "flete",
  "flete_devolucion",
  "comision_cod",
  "iva_flete",
  "iva_flete_devolucion",
  "iva_comision_cod",
] as const satisfies readonly WalletTiendaMovimientoCategoria[];

export type WalletTiendaDebitoCategoria =
  (typeof WALLET_TIENDA_DEBITO_CATEGORIA_SEED)[number];

// ── Contratos I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R4/R27) ──

export type WalletTiendaMovimientoDTO = {
  id: string;
  tiendaId: string;
  tipo: WalletTiendaMovimientoTipo;
  categoria: WalletTiendaMovimientoCategoria;
  monto: string; // Decimal -> STRING 2 dec (R4/R27)
  origenTipo: string; // cierre_dia | pago_tienda | manual (WalletOrigenTipo)
  origenId: string | null;
  descripcion: string | null;
  fechaMovimiento: string; // ISO
};

export type SaldoTiendaSigno = "positivo" | "negativo" | "cero";

// Saldo a favor de UNA tienda (R16/R17). `saldo` = creditos - debitos, puede ser negativo.
export type SaldoTiendaDTO = {
  creditos: string; // STRING 2 dec
  debitos: string; // STRING 2 dec
  saldo: string; // STRING 2 dec (puede venir "-123.45")
  signo: SaldoTiendaSigno;
};

// Vista del maestro (R20): una fila por tienda con su nombre + saldo.
export type SaldoTiendaResumenDTO = {
  tiendaId: string;
  tiendaNombre: string;
  saldo: string; // STRING 2 dec + signo
  signo: SaldoTiendaSigno;
};

export type ListarMovimientosTiendaResult = {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Feature 170 — FASE 2 (T I.1, R40) — entrada del listado paginado de SALDOS DE TIENDAS.
 *
 * Sin filtros (design §11.3, riesgo BAJO) y sin alcance: quien lo ve son los roles de acceso
 * total y lo decide el servicio. `.strict()` para que un `tiendaId` colado —la clave que
 * convertiria un listado global en uno dirigido— muera en el BORDE. Tamano de pagina desde
 * `walletTiendaConfig` (T H.1), recortado a `MAX_PAGE_SIZE`.
 */
export const listarSaldosTiendasPaginadoSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(walletTiendaConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, walletTiendaConfig.MAX_PAGE_SIZE)),
  })
  .strict();

export type ListarSaldosTiendasPaginadoInput = z.infer<typeof listarSaldosTiendasPaginadoSchema>;

/**
 * Feature 184 — Tanda G (R17) — entrada del modo SIN paginacion (el conjunto del archivo).
 *
 * DERIVADA de la de su pagina quitando `page`/`pageSize`, no reescrita. La lista blanca
 * resultante tiene CERO claves, y la que importa sigue siendo `tiendaId`: la unica que
 * convertiria un listado global —el saldo de TODAS las tiendas— en uno dirigido. Muere aqui,
 * antes del servicio, con `validation_error`.
 */
export const listarSaldosTiendasCompletoSchema = listarSaldosTiendasPaginadoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarSaldosTiendasCompletoInput = z.infer<typeof listarSaldosTiendasCompletoSchema>;

/**
 * Resultado del modo completo en el BORDE. `limite_excedido` lleva SOLO conteos y ninguna rama
 * de error viaja con filas (R6/R7).
 */
export type ListarSaldosTiendasCompletoResult = ListarCompletoResult<SaldoTiendaResumenDTO>;

// ── Schema zod de borde (R22) ──

// Listado del ledger de la tienda: paginado + filtros opcionales por cierre, concepto y
// rango de fechas. El acotado por tienda NO viaja aqui (lo pone el service desde el actor,
// R19); estos filtros son solo del desglose.
export const listarMovimientosTiendaSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cierreId: z.string().min(1).optional(),
  categoria: z.enum(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export type ListarMovimientosTiendaInput = z.infer<typeof listarMovimientosTiendaSchema>;

// Feature 170 (T C.1) — entrada del modo SIN paginacion del ledger de la tienda (descarga
// del dataset completo). Derivada del schema del listado quitando `page`/`pageSize`, de modo
// que ambos caminos resuelvan los MISMOS filtros.
//
// `.strict()` importa MAS aqui que en los listados de configuracion: este es el ledger de UNA
// tienda, y el acotado por `tienda_id` lo pone el service desde el actor (R19). Con `.strict()`
// un cliente que intente colar `tiendaId` en la peticion recibe `validation_error` en el
// BORDE, sin llegar al service (R18) — y si llegara, el service lo ignoraria igual (R15),
// porque nunca lee esa clave. Dos cierres independientes para la misma fuga.
export const listarMovimientosTiendaCompletoSchema = listarMovimientosTiendaSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarMovimientosTiendaCompletoInput = z.infer<
  typeof listarMovimientosTiendaCompletoSchema
>;

// Feature 170 (T C.2): resultado del modo completo en el BORDE. `limite_excedido` lleva SOLO
// conteos (R27) y ninguna rama de error viaja con filas (R16/R17/R18).
export type ListarMovimientosTiendaCompletoResult =
  ListarCompletoResult<WalletTiendaMovimientoDTO>;

// ── Feature 171 — DESGLOSE del dinero de UNA tienda elegida (vista de ACCESO TOTAL) ──
//
// Superficie NUEVA y distinta de `/mi-wallet`: alli la tienda ve LO SUYO y el acotado lo pone
// el actor (R19 de la 43); aqui el maestro elige la tienda y el acotado lo pone el INPUT
// (`tiendaId`), con el alcance fijado por el ROL (`esAccesoTotal`, R26/R27/R28 de la 171).

/**
 * Feature 171 (design §2.1, R7/R8/R10) — cabecera del desglose: TRES cubetas exhaustivas
 * sobre el ledger + el saldo que se deriva de ellas.
 *
 * `pagado` esta separado de `cargos` a proposito, y hoy vale siempre "0.00" porque ningun
 * flujo emite `pago_tienda` (lo emitira la 172). No es un cero fijo: se lee de la categoria
 * REAL del ledger, de modo que el dia que la 172 inserte el primer pago esta cabecera lo
 * refleje sin tocar una linea (R43). Si «pagado» se plegara dentro de «cargos», nadie podria
 * distinguir *lo que te cobre* de *lo que ya te pague* mirando la pantalla.
 *
 * Money-safe (R23): los cuatro importes cruzan la frontera como STRING escala 2.
 */
export type DesgloseTiendaDTO = {
  aFavor: string; // Σ creditos (cod_recaudado, ajuste_credito)
  cargos: string; // Σ debitos != pago_tienda (fletes, comision, los tres IVA, ajuste_debito)
  pagado: string; // Σ debitos == pago_tienda (hoy siempre "0.00", ver R43)
  saldo: string; // aFavor - cargos - pagado (puede venir "-123.45")
  signo: SaldoTiendaSigno;
};

/**
 * R22: TODO lo que la pantalla necesita para pintar un desglose, en UNA sola respuesta —
 * pagina, total del conjunto filtrado, paginacion y los cuatro importes de la cabecera.
 *
 * NO lleva `tiendaNombre` (R35): el nombre ya esta en la fila desde la que se despliega
 * (`SaldoTiendaResumenDTO.tiendaNombre`) y baja por props. Devolverlo costaria una consulta
 * mas por apertura — la que el desglose del mensajero paga hoy de mas para un dato que su
 * componente ni siquiera usa.
 */
export type ListarMovimientosDeTiendaResult = {
  tiendaId: string;
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  desglose: DesgloseTiendaDTO; // del CONJUNTO FILTRADO (R12), no del agregado total
};

/**
 * R22/R25 — entrada del desglose de UNA tienda. Deriva del schema del listado propio, asi que
 * hereda EXACTAMENTE los mismos filtros (cierre, concepto, rango de fechas) y paginacion; lo
 * unico que anade es `tiendaId`, y lo anade REQUERIDO: sin tienda no hay desglose que pedir, y
 * el borde responde `validation_error` sin consultar la base.
 *
 * Espejo exacto de `listarPagosDeMensajeroSchema`.
 */
export const listarMovimientosDeTiendaSchema = listarMovimientosTiendaSchema.extend({
  tiendaId: z.string().min(1),
});

export type ListarMovimientosDeTiendaInput = z.infer<typeof listarMovimientosDeTiendaSchema>;

/**
 * R37 — el MISMO desglose sin recorte por pagina, para la descarga: los mismos filtros y el
 * mismo `tiendaId` requerido, sin `page`/`pageSize`. `.strict()` cierra el resto de claves,
 * de modo que ninguna clave extra de la peticion pueda ampliar el alcance a otra tienda o a
 * todas (R24, primera de las tres barreras; las otras dos viven en el servicio).
 */
export const listarMovimientosDeTiendaCompletoSchema = listarMovimientosDeTiendaSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarMovimientosDeTiendaCompletoInput = z.infer<
  typeof listarMovimientosDeTiendaCompletoSchema
>;

// Resultado del modo completo en el BORDE. `limite_excedido` lleva SOLO conteos y ninguna
// rama de error viaja con filas (R39/R40).
export type ListarMovimientosDeTiendaCompletoResult =
  ListarCompletoResult<WalletTiendaMovimientoDTO>;

// ── FICHA 335 — las opciones del selector de cierre de `/mi-wallet` ──

/**
 * Ficha 335 (design §2.5, R6/R9) — UNA opcion del selector de cierre, tal como cruza la
 * frontera servidor → cliente.
 *
 * TRES datos y ni uno mas, y cada exclusion tiene motivo:
 *  - NO lleva NINGUN importe (R9). Se pide `_count`, nunca `_sum`: money-safe por
 *    construccion, no por disciplina de quien escriba el mapper manana.
 *  - NO lleva el mensajero del cierre. Costaria dos consultas mas (leer `cierre_dia` y
 *    `usuario`) y sobre todo le revelaria a la tienda QUE mensajero movio su dinero, cosa que
 *    esta pantalla hoy no dice. Dos cierres del mismo dia se desambiguan con `movimientos` y
 *    con la hora de `fecha`, que ya vienen en la MISMA consulta.
 *
 * `movimientos` es un CARDINAL, no dinero: es cuantas filas de ESE cierre hay en el libro de
 * ESTA tienda. Por eso es `number` y no `string`.
 */
export type CierreTiendaOpcionDTO = {
  /** `= wallet_tienda_movimiento.origen_id`, o sea un `cierre_dia.id`. Es el valor que viaja
   *  como `cierreId` al filtro que ya existe (`listarMovimientosTiendaSchema`). */
  cierreId: string;
  /** ISO del movimiento MAS RECIENTE de ese cierre en ESTE libro. Sin transformar. */
  fecha: string;
  /** Cuantos movimientos de ESTA tienda trajo ese cierre. Cardinal, NO es un monto. */
  movimientos: number;
};
