import { z } from "zod";
import { Prisma } from "@prisma/client";
import type {
  WalletMovimientoTipo as PrismaWalletMovimientoTipo,
  WalletMovimientoCategoria as PrismaWalletMovimientoCategoria,
  WalletOrigenTipo as PrismaWalletOrigenTipo,
} from "@prisma/client";

// Feature 42 (design §1.1/§3) — fuente unica de verdad de tipos/categorias/origenes de
// la wallet, respaldada por los enums Postgres nativos (patron METODO_PAGO_SEED). El
// `satisfies` rompe el build si el SEED tuviera un valor que el enum NO tiene; el chequeo
// `_Ensure*` rompe el build si el enum gana un valor que el SEED NO lista.

export const WALLET_MOVIMIENTO_TIPO_SEED = [
  "ingreso",
  "egreso",
] as const satisfies readonly PrismaWalletMovimientoTipo[];

export type WalletMovimientoTipo = (typeof WALLET_MOVIMIENTO_TIPO_SEED)[number];

type _EnsureTipoExhaustive = Exclude<PrismaWalletMovimientoTipo, WalletMovimientoTipo> extends never
  ? true
  : never;
const _tipoExhaustive: _EnsureTipoExhaustive = true;
void _tipoExhaustive;

export const WALLET_MOVIMIENTO_CATEGORIA_SEED = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
  "ingreso_ajuste",
  "egreso_pago_tienda",
  "egreso_pago_mensajero",
  "egreso_gasto",
  "egreso_sueldo",
  "egreso_ajuste",
] as const satisfies readonly PrismaWalletMovimientoCategoria[];

export type WalletMovimientoCategoria = (typeof WALLET_MOVIMIENTO_CATEGORIA_SEED)[number];

type _EnsureCategoriaExhaustive = Exclude<
  PrismaWalletMovimientoCategoria,
  WalletMovimientoCategoria
> extends never
  ? true
  : never;
const _categoriaExhaustive: _EnsureCategoriaExhaustive = true;
void _categoriaExhaustive;

export const WALLET_ORIGEN_TIPO_SEED = [
  "cierre_dia",
  "gestion_orden",
  "manual",
  "pago_tienda",
  "pago_mensajero",
  "gasto",
] as const satisfies readonly PrismaWalletOrigenTipo[];

export type WalletOrigenTipo = (typeof WALLET_ORIGEN_TIPO_SEED)[number];

type _EnsureOrigenExhaustive = Exclude<PrismaWalletOrigenTipo, WalletOrigenTipo> extends never
  ? true
  : never;
const _origenExhaustive: _EnsureOrigenExhaustive = true;
void _origenExhaustive;

// Las 6 categorias de ingreso de Ordenex (design §4) que emite el feed del cierre. El
// resto (ingreso_ajuste, egreso_*) NO viene del feed automatico.
export const WALLET_INGRESO_CONCEPTO_SEED = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletIngresoConcepto = (typeof WALLET_INGRESO_CONCEPTO_SEED)[number];

// ── Contratos I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R4/R25) ──

export type WalletMovimientoDTO = {
  id: string;
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: string; // Decimal -> STRING 2 dec (R4/R25)
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento: string; // ISO
};

export type WalletBalanceSigno = "positivo" | "negativo" | "cero";

export type WalletBalanceDTO = {
  ingresos: string; // STRING 2 dec
  egresos: string; // STRING 2 dec
  balance: string; // STRING 2 dec (puede venir "-123.45")
  signo: WalletBalanceSigno;
};

export type ListarMovimientosResult = {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
};

// ── Schemas zod de borde ──

// Un monto de dinero como STRING con hasta 2 decimales, > 0 (R2/R15). Se valida como
// STRING (nunca number) para no perder precision en la frontera money-critical.
const montoPositivoSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "El monto debe ser un numero con hasta 2 decimales.")
  // Money-safe: comparacion con Prisma.Decimal (nunca parseFloat/Number sobre montos).
  .refine((v) => new Prisma.Decimal(v).gt(0), "El monto debe ser mayor que 0.");

// Manual (R15/F1.4-Q6): ingreso/egreso de AJUSTE, descripcion obligatoria, monto > 0.
// Solo las categorias de ajuste; el tipo debe casar con la categoria (ingreso<->ingreso_ajuste).
export const registrarMovimientoManualSchema = z
  .object({
    tipo: z.enum(WALLET_MOVIMIENTO_TIPO_SEED),
    categoria: z.enum(["ingreso_ajuste", "egreso_ajuste"] as const),
    monto: montoPositivoSchema,
    descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),
  })
  .refine(
    (v) =>
      (v.tipo === "ingreso" && v.categoria === "ingreso_ajuste") ||
      (v.tipo === "egreso" && v.categoria === "egreso_ajuste"),
    { message: "La categoria de ajuste no corresponde al tipo.", path: ["categoria"] },
  );

export type RegistrarMovimientoManualInput = z.infer<typeof registrarMovimientoManualSchema>;

// Listado (R20): paginado acotado + filtros opcionales tipo/categoria/rango de fechas.
export const listarMovimientosSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tipo: z.enum(WALLET_MOVIMIENTO_TIPO_SEED).optional(),
  categoria: z.enum(WALLET_MOVIMIENTO_CATEGORIA_SEED).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export type ListarMovimientosInput = z.infer<typeof listarMovimientosSchema>;
