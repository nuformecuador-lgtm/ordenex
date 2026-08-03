// Configuracion del modulo "Cierre del dia" (feature 37). Sobreescribible por
// variable de entorno para no hardcodear cotas de contexto (docs/architecture.md:
// "Sin hardcode de contexto"), patron lib/config/gestion.ts. El bucket de las
// evidencias es el MISMO de la feature 36 (las evidencias son las de gestion_orden);
// se reusa `gestionConfig.EVIDENCIA_BUCKET` en el borde para firmar.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CierreConfig {
  /** TTL (segundos) de la URL firmada de una evidencia al listar (R5). Default 5 min. */
  SIGNED_URL_TTL_SECONDS: number;
  /**
   * Feature 170 (T H.1, R40) — tamano de pagina por defecto de los listados de cierres del
   * dia: cola de pendientes, historico, cola a consolidar y cierres solicitados por el
   * mensajero. Mismo valor que el resto de listados del repo (25): las opciones que ofrece
   * la UI son 10/25/50 y 25 es la de en medio, ya rodada en ordenes/usuarios/plantillas.
   */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadCierreConfig(): CierreConfig {
  return {
    SIGNED_URL_TTL_SECONDS: readPositiveInt("CIERRE_SIGNED_URL_TTL_SECONDS", 5 * 60),
    DEFAULT_PAGE_SIZE: readPositiveInt("CIERRE_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("CIERRE_MAX_PAGE_SIZE", 100),
  };
}

export const cierreConfig: CierreConfig = loadCierreConfig();
