// Feature 21 (pedido humano 2026-08-26) — mensaje de usuario del rechazo por «el mensajero
// no tiene vehiculo asociado», en UN solo sitio y consultado por LOS DOS mappers de asignacion
// (`guia-decision-error-messages` y `asignacion-satelite-error-messages`), igual que hace
// `geocodificacion-motivo-messages` con los motivos del gate de coordenadas.
//
// POR QUE UN CASO PROPIO. El rechazo viaja en `fieldErrors.mensajeroId`, no en el `detalle` por
// orden: no le pasa nada a las ordenes, le pasa al mensajero. Sin este caso caeria en el generico
// de `validation_error` («revisa la seleccion»), que manda a mirar justo donde el problema NO
// esta — el mismo patron de mentira que este repo ya pago una vez con «Actualiza la lista».
//
// Se reconoce por substring del motivo que emiten los services (`MSG_MENSAJERO_SIN_VEHICULO`),
// como el resto de mappers de esta carpeta: la UI no importa constantes del dominio.
const FRAGMENTO = "no tiene un vehiculo asociado";

export function mensajeroSinVehiculoMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return null;
  const mensajes = (fieldErrors as { mensajeroId?: unknown }).mensajeroId;
  if (!Array.isArray(mensajes)) return null;
  const hay = mensajes.some((m) => typeof m === "string" && m.includes(FRAGMENTO));
  return hay
    ? "El mensajero que elegiste no tiene un vehículo asociado. Asígnale uno en Configuración > Usuarios, o elige otro mensajero."
    : null;
}
