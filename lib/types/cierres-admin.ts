import { z } from "zod";
import type {
  ListarCierresAdminServiceResult,
  CierreDetalleAdminServiceResult,
  AprobarCierreServiceResult,
  RechazarCierreServiceResult,
  ForzarSolicitudVencidoServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";

// Feature 38 — schemas zod del borde de las Server Actions "Cierres del dia" del
// admin + los *Result de action (resultado de dominio del service + `unauthenticated`
// que resuelve el borde, patron lib/types/cierre.ts / recepcion-satelite.ts).

// R6/R10/R13: identifica el cierre a ver/aprobar. `uuid` casa el @default(uuid()) de
// cierre_dia (feature 37); un id mal formado -> VALIDATION_ERROR en el borde.
export const cierreIdSchema = z.object({
  cierreId: z.string().uuid(),
});

export const aprobarCierreSchema = cierreIdSchema;

// Feature 111/R16: la valvula de escape identifica el cierre `vencido` a destrabar por su id
// (mismo shape que aprobar). Un id mal formado -> VALIDATION_ERROR en el borde.
export const forzarSolicitudVencidoSchema = cierreIdSchema;

// R11: el motivo de rechazo es OBLIGATORIO y no vacio. `.trim().min(1)` rechaza el
// string en blanco (defensa de borde; el service lo re-valida).
export const rechazarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  motivo: z.string().trim().min(1),
});

export type CierreIdInput = z.infer<typeof cierreIdSchema>;
export type RechazarCierreInput = z.infer<typeof rechazarCierreSchema>;

// Resultados de las Server Actions: resultado de dominio del service +
// `unauthenticated` (sin sesion, lo resuelve el borde).
export type ListarCierresAdminResult =
  | ListarCierresAdminServiceResult
  | { status: "unauthenticated" };
export type VerCierreDetalleResult =
  | CierreDetalleAdminServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type AprobarCierreResult =
  | AprobarCierreServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type RechazarCierreResult =
  | RechazarCierreServiceResult
  | { status: "unauthenticated" };
// Feature 111/R16: resultado de la Server Action de la valvula de escape (dominio del service
// + `validation_error` de zod / `unauthenticated` sin sesion, resueltos en el borde).
export type ForzarSolicitudVencidoResult =
  | ForzarSolicitudVencidoServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
