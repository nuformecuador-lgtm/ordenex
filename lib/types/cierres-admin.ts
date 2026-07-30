import { z } from "zod";
import { montoPositivoSchema } from "@/lib/types/wallet";
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

// Feature 158 (R19/R20/R24) — un monto de indemnizacion por gestion `incidente` del cierre.
// El monto viaja como STRING de extremo a extremo (`montoPositivoSchema` de la wallet: hasta 2
// decimales, > 0, comparado con `Prisma.Decimal`) y solo se convierte a Decimal AL ESCRIBIR:
// nunca `number`, nunca `parseFloat`. Un monto vacio, 0, negativo, con 3 decimales o con coma
// cae aqui -> ZodError -> `validation_error` por campo.
export const indemnizacionSchema = z.object({
  gestionId: z.string().uuid(),
  monto: montoPositivoSchema,
});

// Feature 158 (R19/R36): `aprobarCierre` gana la lista de indemnizaciones. `.default([])` la
// hace RETROCOMPATIBLE con el contrato de la 38: un cierre sin incidentes se aprueba
// exactamente como hoy, sin campos nuevos obligatorios. La cobertura EXACTA (que no falte ni
// sobre ninguna) la valida el SERVICE contra las gestiones reales del cierre, no el borde: el
// borde no sabe que gestiones tiene ese cierre.
export const aprobarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  indemnizaciones: z.array(indemnizacionSchema).default([]),
});

export type IndemnizacionInput = z.infer<typeof indemnizacionSchema>;
export type AprobarCierreInput = z.infer<typeof aprobarCierreSchema>;

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
