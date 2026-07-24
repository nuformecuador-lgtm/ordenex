// Feature 93 (R9, design §6.1.b) — mapeo COMPARTIDO de los `motivo` del gate de
// asignabilidad por coordenadas (feature 92, R1-R8) a mensajes de usuario.
//
// Por qué vive aquí y no dentro de un mapper concreto: los cuatro modales de
// asignación delegan en DOS mappers distintos
// (`ordenes/_components/guia-decision-error-messages.ts` y
// `recepcion-satelite/_components/asignacion-satelite-error-messages.ts`), y ambos
// ramifican solo por `status`. La regla de R9 se escribe UNA vez aquí y los dos
// mappers la consultan ANTES de su switch por `status`; así no se duplica ni se
// deja un consumidor atrás.
//
// No filtra PII: los mensajes son literales fijos, nunca la dirección ni el id.

/** Estados de asignabilidad no-`asignable` que emite el gate de la 92 (R1). */
export const MOTIVOS_DIRECCION_NO_ENCONTRADA = [
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
] as const;

export const MOTIVOS_DIRECCION_EN_VALIDACION = [
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
] as const;

/** R9: desenlace DEFINITIVO — la dirección no se puede resolver. */
export const MSG_DIRECCION_NO_ENCONTRADA = "Dirección no encontrada";

/** R9: desenlace TRANSITORIO — todavía se está resolviendo, no es un fallo final. */
export const MSG_DIRECCION_EN_VALIDACION =
  "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.";

const MOTIVO_A_MENSAJE = new Map<string, string>([
  ...MOTIVOS_DIRECCION_NO_ENCONTRADA.map(
    (m) => [m, MSG_DIRECCION_NO_ENCONTRADA] as const,
  ),
  ...MOTIVOS_DIRECCION_EN_VALIDACION.map(
    (m) => [m, MSG_DIRECCION_EN_VALIDACION] as const,
  ),
]);

/** Lee `detalle[].motivo` de un resultado no-"ok" sin asumir su forma. */
function motivosDe(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const detalle = (error as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return [];
  return detalle
    .map((d) =>
      d && typeof d === "object" ? (d as { motivo?: unknown }).motivo : undefined,
    )
    .filter((m): m is string => typeof m === "string");
}

/**
 * R9: mensaje de usuario si el error trae al menos un `motivo` del gate de
 * coordenadas; `null` si no aplica (el mapper llamador sigue con su switch por
 * `status`). Si conviven un motivo definitivo y uno transitorio gana el
 * DEFINITIVO: es el que exige acción del operador.
 */
export function geocodificacionMotivoMessage(error: unknown): string | null {
  const motivos = motivosDe(error);
  if (motivos.length === 0) return null;
  const mensajes = motivos
    .map((m) => MOTIVO_A_MENSAJE.get(m))
    .filter((m): m is string => m !== undefined);
  if (mensajes.length === 0) return null;
  return mensajes.includes(MSG_DIRECCION_NO_ENCONTRADA)
    ? MSG_DIRECCION_NO_ENCONTRADA
    : MSG_DIRECCION_EN_VALIDACION;
}
