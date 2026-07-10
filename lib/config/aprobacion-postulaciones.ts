// Feature 22 — configuracion de la aprobacion de postulaciones. Sobreescribible
// por variable de entorno para no hardcodear cotas de negocio ni TTL
// (docs/architecture.md: "Sin hardcode de contexto"), patron de
// lib/config/ordenes.ts y lib/config/postulacion.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AprobacionPostulacionesConfig {
  /** TTL en segundos de la URL firmada del bucket privado (R9/P3). Default 300 s. */
  SIGNED_URL_TTL_SECONDS: number;
  /** Tamano de pagina por defecto del listado de pendientes (R10). */
  PAGE_SIZE_DEFAULT: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R10). */
  PAGE_SIZE_MAX: number;
}

export function loadAprobacionPostulacionesConfig(): AprobacionPostulacionesConfig {
  return {
    SIGNED_URL_TTL_SECONDS: readPositiveInt("APROBACION_SIGNED_URL_TTL_SECONDS", 300),
    PAGE_SIZE_DEFAULT: readPositiveInt("APROBACION_PAGE_SIZE_DEFAULT", 20),
    PAGE_SIZE_MAX: readPositiveInt("APROBACION_PAGE_SIZE_MAX", 50),
  };
}

export const aprobacionPostulacionesConfig: AprobacionPostulacionesConfig =
  loadAprobacionPostulacionesConfig();
