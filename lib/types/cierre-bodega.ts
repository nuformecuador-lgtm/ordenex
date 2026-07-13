import { z } from "zod";
import type {
  ListarConsolidacionServiceResult,
  SolicitarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  ListarCierresBodegaAdminServiceResult,
  CierreBodegaDetalleServiceResult,
  AprobarCierreBodegaServiceResult,
  RechazarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierresBodegaAdminService";

// Feature 40 — schemas zod del borde de las Server Actions "Cierre de bodega" + los
// *Result de action (resultado de dominio del service + `unauthenticated` que resuelve
// el borde, patron lib/types/cierres-admin.ts).

// R11/R16/R17: identifica el cierre de bodega a ver/aprobar/rechazar. `uuid` casa el
// @default(uuid()) de cierre_bodega; un id mal formado -> VALIDATION_ERROR en el borde.
export const cierreBodegaIdSchema = z.object({
  cierreBodegaId: z.string().uuid(),
});

export const aprobarCierreBodegaSchema = cierreBodegaIdSchema;

// R17: el motivo de rechazo es OBLIGATORIO y no vacio. `.trim().min(1)` rechaza el
// string en blanco (defensa de borde; el service lo re-valida).
export const rechazarCierreBodegaSchema = z.object({
  cierreBodegaId: z.string().uuid(),
  motivo: z.string().trim().min(1),
});

export type CierreBodegaIdInput = z.infer<typeof cierreBodegaIdSchema>;
export type RechazarCierreBodegaInput = z.infer<typeof rechazarCierreBodegaSchema>;

// Resultados de las Server Actions: resultado de dominio del service +
// `unauthenticated` (sin sesion, lo resuelve el borde). Para ver-detalle/aprobar se
// agrega `validation_error` (el borde zod puede rechazar el id); rechazar ya lo trae
// en su ServiceResult.
export type ListarConsolidacionResult =
  | ListarConsolidacionServiceResult
  | { status: "unauthenticated" };
export type SolicitarCierreBodegaResult =
  | SolicitarCierreBodegaServiceResult
  | { status: "unauthenticated" };
export type ListarCierresBodegaAdminResult =
  | ListarCierresBodegaAdminServiceResult
  | { status: "unauthenticated" };
export type VerCierreBodegaDetalleResult =
  | CierreBodegaDetalleServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type AprobarCierreBodegaResult =
  | AprobarCierreBodegaServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type RechazarCierreBodegaResult =
  | RechazarCierreBodegaServiceResult
  | { status: "unauthenticated" };
