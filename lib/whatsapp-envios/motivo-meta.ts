// Ficha 474 (design §6.3, R45) — el MOTIVO que se guarda y se muestra cuando Meta rechaza.
//
// NUNCA el `detalle` crudo del cliente: el `message` de Meta puede ecoar datos de la peticion
// (el numero destino, el nombre del archivo). Un texto FIJO por codigo, y uno generico con el
// codigo cuando no esta mapeado. El crudo va al log ya redactado por `chat-logger`, como hoy.

const MOTIVOS: Readonly<Record<number, string>> = {
  131026: "El número no tiene WhatsApp o no puede recibir mensajes.",
  131047: "Fuera de la ventana de 24 horas de WhatsApp.",
  132000: "La plantilla no coincide con la aprobada en Meta o no existe.",
  132001: "La plantilla no coincide con la aprobada en Meta o no existe.",
  132012: "El formato de los datos no coincide con la plantilla.",
  131053: "Meta no pudo procesar el PDF.",
  130429: "Se alcanzó el límite de envío de Meta.",
  131056: "Se alcanzó el límite de envío de Meta.",
  131049: "Meta limitó la entrega para no saturar al destinatario.",
};

/** Texto fijo para un codigo de error de Meta. Nunca devuelve el detalle crudo. */
export function motivoMeta(codigoMeta: number | null): string {
  if (codigoMeta === null) return "Meta rechazó el envío (sin código).";
  return MOTIVOS[codigoMeta] ?? `Meta rechazó el envío (código ${codigoMeta}).`;
}

/** Motivo de un fallo transitorio agotado (red, 5xx, 429). Sin detalle crudo. */
export const MOTIVO_TRANSITORIO_AGOTADO =
  "Meta no respondió tras varios intentos (error temporal).";

/** Acota un motivo a lo que admite la columna (CHECK de 500). */
export function acotarMotivo(motivo: string): string {
  return motivo.length <= 500 ? motivo : `${motivo.slice(0, 497)}...`;
}
