import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// Feature 146 (A1, design §3.1) — FRONTERA CONTRACTUAL entre backend y frontend:
// tipos de dominio, DTO de la campana, schemas de borde (zod) y resultados tipados
// de las 5 Server Actions. Congelado en A1/B10: `components/shared/NotificationsBell.tsx`
// consume `NotificacionDTO` (via el alias publico `NotificationItem`, R50) y no debe
// necesitar ningun otro tipo del backend.

/** Tipo de PRESENTACION (icono de la campana). Espejo del enum `notificacion_tipo`. */
export type NotificationType = "alert" | "box" | "warning";

/** Evento de dominio que origino la notificacion. Inventario CERRADO de D1. */
export type NotificacionEvento =
  | "orden_rechazada"
  | "carga_masiva_terminada"
  | "postulacion_mensajero_pendiente"
  | "cierre_dia_por_aprobar"
  // Feature 253 (D6): alguien ofrecio un vehiculo o una bodega desde la landing publica.
  | "postulacion_recurso_pendiente";

/** Entidad de origen referenciada (referencia polimorfica, sin FK — design §1.2). */
export type NotificacionEntidadTipo =
  | "orden"
  | "usuario"
  | "cierre_dia"
  | "carga"
  // Feature 253 (D6): fila de `postulacion_recurso`. NO es un `usuario`: esta postulacion no
  // crea ninguna cuenta (design §14-C), asi que reusar `usuario` seria un dato falso.
  | "postulacion_recurso";

/**
 * DTO que viaja al cliente (design §3.1). `read` NO es una columna de `notificacion`:
 * se DERIVA de `notificacion_lectura` del usuario que consulta (D4), por eso dos
 * usuarios del mismo rol pueden ver la misma fila con `read` distinto (R3).
 */
export interface NotificacionDTO {
  id: string;
  notification_type: NotificationType;
  description: string;
  anexo?: string;
  read: boolean;
  /** ISO-8601. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Schemas de borde (R36): toda entrada externa se valida ANTES de tocar la DB.
// ---------------------------------------------------------------------------

/** R36: identificador de notificacion no vacio (ZodError -> VALIDATION_ERROR). */
export const notificacionIdSchema = z.string().min(1);

/**
 * R36/R39: contadores de la carga masiva por UI. `creadas`/`total` enteros >= 0 con
 * `creadas <= total`; `loteId` es el uuid que el cliente genera al INICIAR la carga y
 * reusa en un reintento — es la clave de idempotencia (design §3.6).
 */
export const cargaTerminadaSchema = z
  .object({
    creadas: z.number().int().min(0),
    total: z.number().int().min(0),
    loteId: z.uuid(),
  })
  .refine((v) => v.creadas <= v.total, {
    message: "creadas no puede superar total",
    path: ["creadas"],
  });
export type CargaTerminadaInput = z.infer<typeof cargaTerminadaSchema>;

// ---------------------------------------------------------------------------
// Resultados de dominio del service (sin acoplarse a HTTP).
// ---------------------------------------------------------------------------

export type ListarNotificacionesServiceResult = {
  status: "ok";
  items: NotificacionDTO[];
  noLeidas: number;
};

export type MarcarNotificacionServiceResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" };

export type MarcarTodasServiceResult = { status: "ok"; marcadas: number };

export type NotificarCargaServiceResult = { status: "ok" };

// ---------------------------------------------------------------------------
// Resultados tipados de las Server Actions (lo que consume la campana).
// ---------------------------------------------------------------------------

export type ListarNotificacionesResult =
  | { status: "ok"; items: NotificacionDTO[]; noLeidas: number }
  | ActionError;

export type MarcarNotificacionResult = { status: "ok" } | ActionError;

export type MarcarTodasLeidasResult = { status: "ok"; marcadas: number } | ActionError;

export type NotificarCargaMasivaResult = { status: "ok" } | ActionError;
