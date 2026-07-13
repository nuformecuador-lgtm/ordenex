// Feature 46 (R2/R3, decision F1.4-c) — motivo TIPADO y compartido del bloqueo por
// reprogramacion. Una orden en estatus `reprogramada` esta bloqueada hasta su
// `fecha_reprogramacion`: no es reasignable por ningun rol. Se usa como `motivo` en el
// `detalle` de `conflict` de los servicios de asignacion (maestro y adminSatelite) para
// que el rechazo sea accionable y testeable (defensa en profundidad: `reprogramada` ya
// no es un origen valido de asignacion, este guardia lo hace explicito).
export const MSG_ORDEN_REPROGRAMADA_BLOQUEADA =
  "orden reprogramada: bloqueada hasta la fecha de reprogramacion";
