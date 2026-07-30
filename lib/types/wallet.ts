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
  "egreso_gasto_fijo", // feature 45: gasto fijo (lo emite el CRON, no el form manual)
  "egreso_gasto_variable", // feature 45: gasto variable (manual)
  // Feature 158 (R2/R3): indemnizacion por incidente. La EMITE la aprobacion del cierre del
  // dia (nunca el formulario manual de la 45, que solo admite gasto_variable/sueldo).
  "egreso_indemnizacion",
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

// Feature 45 (R11) — desglose de egresos administrativos por tipo para el conjunto
// filtrado. Derivado por agregacion (no almacenado). Montos SIEMPRE STRING (R12).
// Feature 158 (R32): + `indemnizacion` como fila PROPIA y sumada al total. El desglose deja de
// ser solo de egresos "administrativos": la indemnizacion es operativa.
export type DesgloseEgresosDTO = {
  gastoFijo: string; // total egreso_gasto_fijo
  gastoVariable: string; // total egreso_gasto_variable
  sueldo: string; // total egreso_sueldo
  indemnizacion: string; // total egreso_indemnizacion (feature 158/R32)
  total: string; // suma de los cuatro
};

// ── Schemas zod de borde ──

// Un monto de dinero como STRING con hasta 2 decimales, > 0 (R2/R15; feature 45 R4/R24).
// Se valida como STRING (nunca number) para no perder precision en la frontera
// money-critical. Se EXPORTA para reutilizarlo en los schemas de la feature 45 (egresos
// administrativos y plantillas de gasto fijo).
export const montoPositivoSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "El monto debe ser un numero con hasta 2 decimales.")
  // Money-safe: comparacion con Prisma.Decimal (nunca parseFloat/Number sobre montos). Zod v4
  // corre este refine AUNQUE el regex ya haya fallado (p. ej. monto vacio/no numerico), y
  // `new Prisma.Decimal("")` lanza -> el borde veria un error INTERNAL en vez de validation.
  // Se blinda con try/catch: un formato invalido devuelve false (su propio issue) y el regex
  // emite el suyo -> ZodError limpio -> validation_error (R4: vacio/no numerico se rechaza).
  .refine((v) => {
    try {
      return new Prisma.Decimal(v).gt(0);
    } catch {
      return false;
    }
  }, "El monto debe ser mayor que 0.");

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

// ── Feature 45 — egresos administrativos (manual) + reversa ──

// Los DOS tipos de egreso administrativo que se registran A MANO (R2/R19). El gasto FIJO
// NO entra aqui: lo EMITE el cron mensual (R27), no el formulario manual.
export const TIPO_EGRESO_MANUAL_SEED = ["gasto_variable", "sueldo"] as const;
export type TipoEgresoManual = (typeof TIPO_EGRESO_MANUAL_SEED)[number];

// Mapa tipo de egreso manual -> categoria del libro (R2). Se reutiliza `egreso_sueldo`
// (existente en la 42) para el sueldo; `egreso_gasto_variable` (nuevo, R21) para el gasto
// variable. `gasto_fijo` NO se mapea aqui (lo emite el cron con `egreso_gasto_fijo`).
export const TIPO_EGRESO_MANUAL_A_CATEGORIA = {
  gasto_variable: "egreso_gasto_variable",
  sueldo: "egreso_sueldo",
} as const satisfies Record<TipoEgresoManual, WalletMovimientoCategoria>;

// R2/R4/R5/R19 (borde): egreso manual = tipo del conjunto {gasto_variable, sueldo}, monto
// STRING > 0 con hasta 2 decimales, descripcion no vacia. `gasto_fijo` u otro valor cae
// fuera del enum -> ZodError -> validation_error (R19).
export const registrarEgresoAdministrativoSchema = z.object({
  tipoEgreso: z.enum(TIPO_EGRESO_MANUAL_SEED),
  monto: montoPositivoSchema,
  descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),
});

export type RegistrarEgresoAdministrativoInput = z.infer<
  typeof registrarEgresoAdministrativoSchema
>;

// R13: reversa de un egreso administrativo por su id (el monto se lee server-side, no lo
// provee el cliente).
export const reversarEgresoSchema = z.object({ movimientoId: z.string().uuid() });

export type ReversarEgresoInput = z.infer<typeof reversarEgresoSchema>;
