import { z } from "zod";
import type {
  WalletTiendaMovimientoTipo as PrismaWalletTiendaMovimientoTipo,
  WalletTiendaMovimientoCategoria as PrismaWalletTiendaMovimientoCategoria,
} from "@prisma/client";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

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
