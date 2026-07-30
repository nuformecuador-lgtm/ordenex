// Rediseño del chat del mensajero (rama ux) — helpers de PRESENTACIÓN del chat separado
// (botón flotante + modal). Ya NO hay datos quemados: los contactos son las órdenes en
// reparto, el hilo lo sirve `listarHiloChat` (feature 120) y las plantillas
// `listarPlantillasParaEnvio` (feature 87), las MISMAS que usa el chat del detalle.

/** Familia de estado que el chip de la lista pinta con color. */
export type ChatEstado =
  | "por_recoger"
  | "en_reparto"
  | "entregada"
  | "devuelta"
  | "otro";

/** Etiqueta + clases del chip por estado (tokens de marca, no colores crudos). */
export const ESTADO_CHIP: Record<
  ChatEstado,
  { label: string; className: string }
> = {
  por_recoger: { label: "Por recoger", className: "bg-muted text-muted-foreground" },
  en_reparto: { label: "En reparto", className: "bg-info-soft text-info-strong" },
  entregada: { label: "Entregada", className: "bg-success-soft text-success-strong" },
  devuelta: { label: "Devuelta", className: "bg-danger-soft text-danger-strong" },
  otro: { label: "Asignada", className: "bg-muted text-muted-foreground" },
};

/** Familia de estado del chip a partir del `estatusValue` de la orden. */
export function estadoDe(estatusValue: string): ChatEstado {
  switch (estatusValue) {
    case "por_recoger":
    case "en_reparto":
    case "entregada":
    case "devuelta":
      return estatusValue;
    default:
      return "otro";
  }
}

/** Iniciales del avatar (una o dos letras) a partir del nombre del destinatario. */
export function iniciales(destinatario: string): string {
  const partes = destinatario.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return partes
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Nombre de plantilla legible para el chip. Las plantillas de Meta se nombran en snake_case
 * (`hello_world`), así que se cambian `_`/`-` por espacios y se pone en mayúscula la inicial
 * de cada palabra: `hello_world` → `Hello World`. El RESTO de cada palabra se deja intacto
 * para no destrozar siglas (`sinpe_MOVIL` → `Sinpe MOVIL`).
 */
export function nombrePlantilla(nombre: string): string {
  return nombre
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(" ");
}

/** Hora local (HH:MM) del evento, para acompañar cada burbuja. */
export function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Guía visible de la orden: el número de guía si lo tiene, si no la remisión. */
export function guiaVisible(orden: {
  numGuia: number | null;
  numRemision: string;
}): string {
  return orden.numGuia === null ? orden.numRemision : `${orden.numGuia}`;
}

/** Zona de la parada ("Distrito · Cantón"), como segunda línea de la fila. */
export function zonaCorta(orden: {
  distritoNombre: string | null;
  cantonNombre: string;
}): string {
  return orden.distritoNombre === null
    ? orden.cantonNombre
    : `${orden.distritoNombre} · ${orden.cantonNombre}`;
}
