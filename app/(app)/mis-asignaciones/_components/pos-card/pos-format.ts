import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Rediseño "POS card" (rama ux): helpers de PRESENTACIÓN puros para la card del
// mensajero estilo terminal (navegación primero, targets grandes, alto contraste).
// Sin lógica de negocio ni side-effects: reciben la orden ya resuelta y devuelven
// strings/URLs listos para pintar. Se separan del componente para poder testearlos
// aislados y para no duplicar el formateo que ya vive en `AsignacionDetalle`.

/**
 * Monto a cobrar en colones (₡) con 2 decimales y separador de miles, o "—" si es
 * nulo. Formateo determinista (no depende de datos ICU de locale, que varían por
 * entorno) — mismo criterio que `AsignacionDetalle`.
 */
export function formatMonto(monto: number | null): string {
  if (monto === null) return "—";
  const [entero, decimales] = monto.toFixed(2).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₡${conMiles}.${decimales}`;
}

/** Peso en kilogramos (p. ej. "1.5 kg"), o "—" si es nulo. */
export function formatPeso(peso: number | null): string {
  if (peso === null) return "—";
  return `${peso} kg`;
}

/**
 * URL de NAVEGACIÓN externa (Google Maps, ruta directa) para el bloque "Ir".
 * Prefiere las coordenadas geocodificadas (feature 91) y cae a una búsqueda por
 * texto (dirección + distrito/cantón/provincia) cuando aún no hay coords. No
 * fuerza permisos ni GPS: Maps resuelve el origen del propio usuario.
 */
export function mapsNavUrl(orden: MiAsignacionDTO): string {
  const base = "https://www.google.com/maps/dir/?api=1&destination=";
  if (orden.latitud !== null && orden.longitud !== null) {
    return `${base}${orden.latitud},${orden.longitud}`;
  }
  const partes = [
    orden.direccion,
    orden.distritoNombre,
    orden.cantonNombre,
    orden.provinciaNombre,
  ]
    .filter(Boolean)
    .join(", ");
  return `${base}${encodeURIComponent(partes)}`;
}
