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
  | "postulacion_recurso_pendiente"
  // Feature 262 (D7, P2 cerrada SI el 2026-08-22): a una orden asignada le corrigieron el dia de
  // reparto. Unico destinatario: el MENSAJERO asignado (R46/R51). Los admins no se avisan — son
  // quienes corrigen.
  | "dia_reparto_corregido"
  // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) — los DOS avisos del bloqueo por cierres.
  //
  // `cierre_dia_vencido`: el corte creo un cierre `vencido`. Destinatarios: el MENSAJERO dueño
  // (primera notificacion de cierre que le llega, nunca la habia tenido) y su bodega responsable.
  | "cierre_dia_vencido"
  // `mensajero_bloqueado_por_cierres`: el mensajero quedo BLOQUEADO — por acumular (`N >= 2`) o
  // porque le rechazaron un cierre. Mismo evento para las dos causas porque piden la MISMA accion
  // («resuelve el mas antiguo»); son dos eventos y no uno frente a `cierre_dia_vencido` porque ahi
  // la pelota esta en tejados opuestos, y el evento es lo que la campana usa para agrupar.
  | "mensajero_bloqueado_por_cierres"
  // FICHA 333 (R29/R30/R31/R35/R36) — quedan cobros de gasto fijo esperando decisión. Lo emite
  // el cron de gastos fijos AL FINAL de su corrida, una vez por día CR, mientras quede al menos
  // un cobro `pendiente` —también los días en que no se generó ninguno nuevo—. Destinatario: el
  // rol `maestro` y nadie más, porque el `admin` VE la cola pero no puede decidirla (R24) y un
  // recordatorio diario que no se puede atender es ruido. El texto lleva SOLO el número (R35).
  | "gasto_fijo_cobro_pendiente";

/** Entidad de origen referenciada (referencia polimorfica, sin FK — design §1.2). */
export type NotificacionEntidadTipo =
  | "orden"
  | "usuario"
  | "cierre_dia"
  | "carga"
  // Feature 253 (D6): fila de `postulacion_recurso`. NO es un `usuario`: esta postulacion no
  // crea ninguna cuenta (design §14-C), asi que reusar `usuario` seria un dato falso.
  | "postulacion_recurso"
  // Feature 262 (D7): fila de `orden_dia_reparto_cambio` — LA CORRECCION, no la orden. Reusar
  // `orden` con `entidad_id = <ordenId>` (A20) haria que `notificacion_dedupe_key` admitiera UNA
  // sola fila por (evento, orden, mensajero) para siempre, y `crear` absorbe el `P2002` devolviendo
  // `false`: la SEGUNDA correccion de esa orden no avisaria nunca, en silencio. Con la correccion
  // como entidad, «dos correcciones, dos avisos» (R50) es estructural.
  | "orden_dia_reparto_cambio"
  // ⚠️ FICHA 333 (design §4.2) — LA ENTIDAD DE ESTE AVISO ES **EL DÍA CR**, NO EL COBRO, y este
  // es el valor que lo declara: `entidad_id` es la fecha `"YYYY-MM-DD"` de la corrida. Es el
  // PRIMER `entidad_tipo` del inventario que NO apunta a una fila de tabla, y por eso tiene
  // valor propio en vez de reusar uno que prometa una (reusar `carga` o `usuario` sería escribir
  // un dato falso con formato de dato, el motivo por el que la 253 no reusó `usuario`).
  //
  // POR QUÉ NO EL COBRO, que es la elección natural: `notificacion_dedupe_key` es UNIQUE sobre
  // `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y
  // `WHERE entidad_id IS NOT NULL`, y `NotificacionRepository.crear` ABSORBE el `P2002`
  // devolviendo `false`. Con el cobro como entidad, la clave admitiría UNA sola fila por
  // (evento, cobro, maestro) PARA SIEMPRE y el recordatorio del día 2 no saldría NUNCA, en
  // silencio absoluto: sin error, sin log y sin nada. Es EXACTAMENTE el fallo que la 262
  // documentó y evitó eligiendo como entidad el CAMBIO y no la orden.
  //
  // Con el día: días distintos ⇒ entidades distintas ⇒ el recordatorio diario sale siempre
  // (R30); misma corrida repetida el mismo día ⇒ misma entidad ⇒ un solo aviso (R31). Las dos
  // propiedades son ESTRUCTURALES, no de disciplina.
  | "gasto_fijo_cobro_dia";

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
