import { z } from "zod";
import { Prisma } from "@prisma/client";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { evidenciasSchema } from "@/lib/types/gestion-orden";
import { montoPositivoSchema } from "@/lib/types/wallet";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
import { incidentesConfig } from "@/lib/config/incidentes";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import { paginaInputSchema } from "@/lib/types/pagina-input";
import type {
  AprobarIncidenteServiceResult,
  IncidenteAdminDTO,
  ListarIncidentesServiceResult,
  RechazarIncidenteServiceResult,
  ReportarIncidenteServiceResult,
  RetractarIncidenteServiceResult,
  VerIncidenteServiceResult,
} from "@/lib/interfaces/services/IIncidenteAdminService";

// Feature 158 (T1.25, R45/R46/R50/R54/R55) — schemas zod del BORDE de las Server Actions del
// camino del ADMIN + los `*Result` de action (resultado de dominio del service +
// `unauthenticated`, que resuelve el borde). Patron `lib/types/cierres-admin.ts`.

/**
 * R45: la causa es la MISMA lista CERRADA de tres valores en espanol que usa el camino del
 * mensajero (R9). Se importa el SEED, NO se reescribe: si un dia gana una cuarta causa, los dos
 * caminos la ganan a la vez y el doble candado de `causa-incidente.ts` sigue siendo el unico
 * sitio donde eso se decide.
 */
const causaSchema = z.enum(CAUSA_INCIDENTE_SEED, { message: "causa requerida" });

/** R45: motivo en texto libre OBLIGATORIO y APARTE de la causa (mismo contrato que 73/158-R11). */
const motivoSchema = z.string().trim().min(1, "motivo requerido");

/**
 * R41/R45/R46 — reporte del incidente por un admin. La `ordenId` viaja como uuid (casa el
 * `@default(uuid())` de `orden`). Las evidencias reusan `evidenciasSchema` de la 119/158-PR1:
 * 1..N OBLIGATORIAS con independencia de la causa (Q-B), con los MISMOS limites por archivo y
 * por lista que el panel del mensajero.
 *
 * NO hay campo de monto: el monto lo captura el APROBADOR (R50), y quien reporta no aprueba
 * (R51). Que no exista en este schema es la primera linea de esa separacion.
 */
export const reportarIncidenteSchema = z.object({
  ordenId: z.string().uuid(),
  causa: causaSchema,
  motivo: motivoSchema,
  evidencias: evidenciasSchema,
});

/**
 * R50/R55 — aprobacion con monto. El monto viaja STRING de extremo a extremo
 * (`montoPositivoSchema`: hasta 2 decimales, > 0, comparado con `Prisma.Decimal`) y solo se
 * convierte a Decimal AL ESCRIBIR: nunca `number`, nunca `parseFloat`.
 *
 * El TOPE se REUSA de `lib/types/cierres-admin.ts` (`INDEMNIZACION_MONTO_MAX`, m5 del review del
 * PR 1) y no se re-deriva aqui: `orden_incidente.indemnizacion` es `DECIMAL(12,2)`, exactamente
 * la misma precision que `gestion_orden.indemnizacion`, asi que el limite real de Postgres es el
 * mismo numero. Un valor por encima se rechaza en el BORDE, como `validation_error`, ANTES de
 * abrir la transaccion del dinero — que es el defecto que m5 vino a cerrar. Hay un test que fija
 * que las dos columnas comparten precision: si una cambiara, este reuso deja de ser correcto.
 */
export const aprobarIncidenteSchema = z.object({
  incidenteId: z.string().uuid(),
  monto: montoPositivoSchema.refine((v) => {
    try {
      return new Prisma.Decimal(v).lte(INDEMNIZACION_MONTO_MAX);
    } catch {
      // Zod v4 corre el refine AUNQUE el regex de `montoPositivoSchema` ya haya fallado. Un
      // valor no numerico no es un problema DE TOPE: se devuelve `true` para no anadir un
      // mensaje enganoso ("no puede superar 9999999999.99" ante «mil colones»), y el regex lo
      // rechaza igual con el suyo.
      return true;
    }
  }, `El monto no puede superar ${INDEMNIZACION_MONTO_MAX}.`),
});

/** R54: el motivo de rechazo es OBLIGATORIO y no vacio (el service lo re-valida). */
export const rechazarIncidenteSchema = z.object({
  incidenteId: z.string().uuid(),
  motivo: motivoSchema,
});

/**
 * R59 — RETRACTO del propio autor mientras el incidente sigue `solicitado`. NO lleva motivo: no
 * es la decision de un aprobador sobre el trabajo de otro, es alguien deshaciendo su propio
 * error dentro de la ventana controlada (Q-D). El efecto sobre la orden es el MISMO que el del
 * rechazo (vuelve a su estado de origen, R57).
 */
export const retractarIncidenteSchema = z.object({
  incidenteId: z.string().uuid(),
});

/** R48/R49: consultar un incidente por id, acotado por el alcance del actor. */
export const incidenteIdSchema = z.object({
  incidenteId: z.string().uuid(),
});

export type ReportarIncidenteInput = z.infer<typeof reportarIncidenteSchema>;
export type AprobarIncidenteInput = z.infer<typeof aprobarIncidenteSchema>;
export type RechazarIncidenteInput = z.infer<typeof rechazarIncidenteSchema>;
export type RetractarIncidenteInput = z.infer<typeof retractarIncidenteSchema>;

/**
 * Feature 170 — FASE 2 (T I.1, R40) — entrada del HISTORICO paginado de incidentes. Sin
 * filtros (design §11.3, riesgo BAJO) y sin alcance: la zona la resuelve el servicio desde el
 * actor.
 *
 * `.strict()` para que un `zonaId` colado —la clave que abriria los incidentes de otra zona—
 * muera en el BORDE con `validation_error`. Tamano de pagina desde `incidentesConfig`
 * (T H.1), recortado a `MAX_PAGE_SIZE`.
 */
export const listarHistoricoIncidentesSchema = paginaInputSchema(incidentesConfig);

export type ListarHistoricoIncidentesInput = z.infer<typeof listarHistoricoIncidentesSchema>;

/**
 * Feature 170 — FASE 2 (T J.1, R40) — entrada de la COLA paginada de incidentes pendientes de
 * decision. Misma forma que el historico y por el mismo motivo que en `cierres-admin.ts`: son
 * dos listados que la pantalla pagina por separado y el nombre es lo que los distingue.
 */
export const listarPendientesIncidentesSchema = paginaInputSchema(incidentesConfig);

export type ListarPendientesIncidentesInput = z.infer<typeof listarPendientesIncidentesSchema>;

/** Errores de BORDE del listado (dominio + los dos que resuelve la Server Action). */
export type IncidentesListadoError =
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// Feature 170 (T I.1, R41): el contrato comun de listado paginado, aplicado al historico.
export type ListarHistoricoIncidentesResult = ListarPaginadoResult<
  IncidenteAdminDTO,
  IncidentesListadoError
>;

// Feature 170 (T J.1, R41/R42): el mismo contrato, aplicado a la COLA de pendientes. Su `total`
// sustituye al `({pendientes.length})` de la cabecera.
export type ListarPendientesIncidentesResult = ListarPaginadoResult<
  IncidenteAdminDTO,
  IncidentesListadoError
>;

// ── Resultados de las Server Actions (dominio del service + lo que resuelve el borde) ──

export type ListarIncidentesResult =
  | ListarIncidentesServiceResult
  | { status: "unauthenticated" };

export type VerIncidenteResult =
  | VerIncidenteServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type ReportarIncidenteResult =
  | ReportarIncidenteServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type AprobarIncidenteResult =
  | AprobarIncidenteServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type RechazarIncidenteResult =
  | RechazarIncidenteServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type RetractarIncidenteResult =
  | RetractarIncidenteServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
