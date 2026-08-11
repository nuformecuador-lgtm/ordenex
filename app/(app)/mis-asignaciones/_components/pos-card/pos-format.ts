import { formatMonto as formatMontoConfigurado, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Rediseño "POS card" (rama ux): helpers de PRESENTACIÓN puros para la card del
// mensajero estilo terminal (navegación primero, targets grandes, alto contraste).
// Sin lógica de negocio ni side-effects: reciben la orden ya resuelta y devuelven
// strings/URLs listos para pintar. Se separan del componente para poder testearlos
// aislados y para no duplicar el formateo que ya vive en `AsignacionDetalle`.

/**
 * Monto a cobrar con la moneda configurada, con 2 decimales y separador de miles,
 * o la raya larga si es nulo.
 *
 * Feature 201: el formato ya no se escribe aquí. Este archivo tenía una de las
 * CUATRO copias del formateador "estilo EEUU" (coma para miles y punto para
 * decimales, `₡13,331,832.72`), que además hardcodeaba el símbolo pese a existir
 * `lib/config/moneda.ts`. Lo que ve el mensajero pasa a ser lo mismo que ve el
 * admin en cierres y en la wallet: `₡13.331.832,72`.
 *
 * El marcador de ausencia SÍ se conserva: estas pantallas pintan la raya larga
 * (`SIN_MONTO_RAYA`), no el guion corto que `formatMonto` usa por defecto. Se pasa
 * explícito para que la mudanza no cambie en silencio lo que se lee cuando no hay
 * monto que cobrar.
 */
export function formatMonto(monto: number | null): string {
  return formatMontoConfigurado(monto, SIN_MONTO_RAYA);
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
