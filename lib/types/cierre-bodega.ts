import { z } from "zod";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import type {
  CierreBodegaResumen,
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

/**
 * Feature 170 — FASE 2 (T I.1, R40) — entrada de los DOS listados paginados de este dominio:
 * el historico del maestro (cierres de bodega resueltos) y los cierres solicitados por la
 * zona del adminSatelite. Ninguno tiene filtros (design §11.3, riesgo BAJO) y ninguno acepta
 * su alcance por la peticion: el rol y la zona salen del actor.
 *
 * `.strict()` para que una clave colada —`zonaId`, la que abriria el historico de otra
 * bodega— muera en el BORDE con `validation_error` y no en un servicio que la ignoraria en
 * silencio. Tamano de pagina desde `cierreBodegaConfig` (T H.1), recortado a `MAX_PAGE_SIZE`.
 */
export const listarCierresBodegaPaginadoSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(cierreBodegaConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, cierreBodegaConfig.MAX_PAGE_SIZE)),
  })
  .strict();

export type ListarCierresBodegaPaginadoInput = z.infer<typeof listarCierresBodegaPaginadoSchema>;

/** Errores de BORDE de los listados de este modulo (dominio + los dos que resuelve la action). */
export type CierreBodegaListadoError =
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// Feature 170 (T I.1, R41): el contrato comun aplicado a los dos listados del dominio.
export type ListarHistoricoCierresBodegaResult = ListarPaginadoResult<
  CierreBodegaResumen,
  CierreBodegaListadoError
>;
export type ListarCierresBodegaSolicitadosResult = ListarPaginadoResult<
  CierreBodegaResumen,
  CierreBodegaListadoError
>;

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
