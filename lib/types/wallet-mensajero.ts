import { z } from "zod";
import type {
  PagoMensajeroMovimientoTipo as PrismaPagoMensajeroMovimientoTipo,
  PagoMensajeroMovimientoCategoria as PrismaPagoMensajeroMovimientoCategoria,
} from "@prisma/client";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

// Feature 44 (design §1.1/§3) — fuente unica de verdad de tipos/categorias del LIBRO del pago
// POR MENSAJERO, respaldada por los enums Postgres nativos (patron lib/types/wallet-tienda.ts).
// El `satisfies` rompe el build si un SEED tuviera un valor que el enum NO tiene; el chequeo
// `_Ensure*` rompe el build si el enum gana un valor que el SEED NO lista. Money-safe: todos los
// montos cruzan la frontera como STRING (R4/R27), nunca como number.

export const PAGO_MENSAJERO_MOVIMIENTO_TIPO_SEED = [
  "devengo",
  "pago",
] as const satisfies readonly PrismaPagoMensajeroMovimientoTipo[];

export type PagoMensajeroMovimientoTipo =
  (typeof PAGO_MENSAJERO_MOVIMIENTO_TIPO_SEED)[number];

type _EnsureTipoExhaustive = Exclude<
  PrismaPagoMensajeroMovimientoTipo,
  PagoMensajeroMovimientoTipo
> extends never
  ? true
  : never;
const _tipoExhaustive: _EnsureTipoExhaustive = true;
void _tipoExhaustive;

export const PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED = [
  // devengo (Ordenex le debe al mensajero)
  "pago_devengado",
  // pago (lo ya entregado, tomado del efectivo recaudado)
  "pago_efectivo",
  // liquidacion posterior de la cuenta por pagar (F1.4-Qf; RESERVADO)
  "liquidacion",
  // ajustes manuales (inmutables, correccion compensatoria R3)
  "ajuste_devengo",
  "ajuste_pago",
] as const satisfies readonly PrismaPagoMensajeroMovimientoCategoria[];

export type PagoMensajeroMovimientoCategoria =
  (typeof PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED)[number];

type _EnsureCategoriaExhaustive = Exclude<
  PrismaPagoMensajeroMovimientoCategoria,
  PagoMensajeroMovimientoCategoria
> extends never
  ? true
  : never;
const _categoriaExhaustive: _EnsureCategoriaExhaustive = true;
void _categoriaExhaustive;

// Las 2 categorias que EMITE el feed del cierre aprobado (R10): el devengo `pago_devengado`
// (= total_pago_mensajero) y el pago `pago_efectivo` (= min(P,E)). El resto (liquidacion,
// ajuste_*) NO viene del feed automatico.
export const PAGO_MENSAJERO_FEED_CATEGORIA_SEED = [
  "pago_devengado",
  "pago_efectivo",
] as const satisfies readonly PagoMensajeroMovimientoCategoria[];

export type PagoMensajeroFeedCategoria =
  (typeof PAGO_MENSAJERO_FEED_CATEGORIA_SEED)[number];

// ── Contratos I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R4/R27) ──

export type PagoMensajeroMovimientoDTO = {
  id: string;
  mensajeroId: string;
  tipo: PagoMensajeroMovimientoTipo;
  categoria: PagoMensajeroMovimientoCategoria;
  monto: string; // Decimal -> STRING 2 dec (R4/R27)
  origenTipo: string; // cierre_dia | pago_mensajero | manual (WalletOrigenTipo)
  origenId: string | null;
  descripcion: string | null;
  fechaMovimiento: string; // ISO
};

// La cuenta por pagar nunca es negativa en el flujo normal (R16): positivo (Ordenex debe) o cero.
export type CuentaPorPagarSigno = "positivo" | "cero";

// Cuenta por pagar de UN mensajero (R14/R16). `cuentaPorPagar` = devengado - pagado (>= 0).
export type CuentaPorPagarDTO = {
  devengado: string; // STRING 2 dec (Σ devengo)
  pagado: string; // STRING 2 dec (Σ pago) — "lo ya pagado"
  cuentaPorPagar: string; // STRING 2 dec (devengado - pagado) — "lo pendiente"
  signo: CuentaPorPagarSigno;
};

// Vista del maestro (R18): una fila por mensajero con su nombre + cuenta por pagar.
export type CuentaPorPagarResumenDTO = {
  mensajeroId: string;
  mensajeroNombre: string;
  devengado: string; // STRING 2 dec
  pagado: string; // STRING 2 dec
  cuentaPorPagar: string; // STRING 2 dec
  signo: CuentaPorPagarSigno;
};

export type ListarPagosMensajeroResult = {
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  cuenta: CuentaPorPagarDTO; // cuenta por pagar del conjunto filtrado (R22)
};

// Vista del MAESTRO (R18/R22): desglose por cierre de UN mensajero ARBITRARIO (paginado, mas
// reciente primero) + su nombre + la cuenta por pagar del CONJUNTO FILTRADO. A diferencia de
// `ListarPagosMensajeroResult` (vista propia del mensajero) lleva `mensajeroId`/`mensajeroNombre`
// porque el maestro NO esta acotado a si mismo. Montos STRING (R4/R27).
export type ListarPagosDeMensajeroResult = {
  mensajeroId: string;
  mensajeroNombre: string;
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  cuenta: CuentaPorPagarDTO; // cuenta por pagar del conjunto filtrado (R22)
};

// ── Schema zod de borde (R22) ──

// Listado del libro del mensajero: paginado + filtros opcionales por cierre y rango de fechas.
// El acotado por mensajero NO viaja aqui en la vista propia (lo pone el service desde el actor,
// R20); en la vista del maestro (R22) `mensajeroId` puede acotar el desglose.
export const listarPagosMensajeroSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cierreId: z.string().min(1).optional(),
  mensajeroId: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export type ListarPagosMensajeroInput = z.infer<typeof listarPagosMensajeroSchema>;

// Vista del MAESTRO (R18/R22): el maestro DEBE elegir un mensajero, asi que `mensajeroId` pasa a
// ser REQUERIDO (a diferencia de la vista propia, donde lo pone el actor y aqui era opcional). Un
// `mensajeroId` faltante o vacio -> ZodError -> validation_error en el borde. Deriva del schema
// base para heredar page/pageSize/cierreId/desde/hasta.
export const listarPagosDeMensajeroSchema = listarPagosMensajeroSchema.extend({
  mensajeroId: z.string().min(1),
});

export type ListarPagosDeMensajeroInput = z.infer<typeof listarPagosDeMensajeroSchema>;

// ── Feature 170 (T C.1) — modo SIN paginacion (descarga del dataset completo) ──

/**
 * Vista PROPIA del mensajero (`/mis-pagos`). Derivada del schema del listado quitando
 * `page`/`pageSize`, de modo que ambos caminos resuelvan los MISMOS filtros.
 *
 * `mensajeroId` SIGUE ADMITIENDOSE en el schema —se hereda del base— y sigue siendo
 * IRRELEVANTE: el service lo ignora y acota por `actor.usuarioId` (R15/R20). Se conserva por
 * paridad exacta con el listado: quitarlo aqui haria que la descarga rechazara una peticion
 * que el listado acepta, o sea otra divergencia. `.strict()` cierra el resto de claves (R18).
 */
export const listarMisPagosCompletoSchema = listarPagosMensajeroSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarMisPagosCompletoInput = z.infer<typeof listarMisPagosCompletoSchema>;

/**
 * Vista del ACCESO TOTAL: desglose de UN mensajero elegido. `mensajeroId` sigue siendo
 * REQUERIDO (igual que en el listado): sin el no hay desglose que pedir, y un `mensajeroId`
 * ausente es `validation_error` antes de tocar la base.
 */
export const listarPagosDeMensajeroCompletoSchema = listarPagosDeMensajeroSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarPagosDeMensajeroCompletoInput = z.infer<
  typeof listarPagosDeMensajeroCompletoSchema
>;

// Resultados del modo completo en el BORDE (T C.2). `limite_excedido` lleva SOLO conteos
// (R27) y ninguna rama de error viaja con filas (R16/R17/R18). Los dos ledgers proyectan el
// mismo DTO; se nombran aparte porque son dos superficies con alcances distintos.
export type ListarMisPagosCompletoResult = ListarCompletoResult<PagoMensajeroMovimientoDTO>;
export type ListarPagosDeMensajeroCompletoResult =
  ListarCompletoResult<PagoMensajeroMovimientoDTO>;
