// Feature 229 — umbrales del rastreo publico. Todos sobreescribibles por variable de
// entorno, con el defecto en codigo (patron `lib/config/auth.ts:37-51`, "Sin hardcode de
// contexto" de docs/architecture.md). R10: el modulo que APLICA el limite no los hardcodea.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonEmpty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export interface RastreoPublicoConfig {
  /** Intentos permitidos por IP dentro de la ventana (G4). */
  RATE_MAX: number;
  /** Ventana deslizante del limitador, en minutos (G4). */
  RATE_WINDOW_MINUTES: number;
  /** Digitos finales del telefono del destinatario que forman el segundo factor (G1). */
  DIGITOS_SEGUNDO_FACTOR: number;
  /**
   * R19 — zona horaria del NEGOCIO para el dia y la hora de cada hito. Vive aqui y no en el
   * service a proposito: una guardia comprueba que el service no contiene ningun literal de
   * zona ni de pais.
   */
  ZONA_HORARIA: string;
}

export function loadRastreoPublicoConfig(): RastreoPublicoConfig {
  return {
    RATE_MAX: readPositiveInt("RASTREO_PUBLICO_RATE_MAX", 8),
    RATE_WINDOW_MINUTES: readPositiveInt("RASTREO_PUBLICO_RATE_WINDOW_MINUTES", 10),
    DIGITOS_SEGUNDO_FACTOR: readPositiveInt("RASTREO_PUBLICO_DIGITOS_FACTOR", 4),
    ZONA_HORARIA: readNonEmpty("RASTREO_PUBLICO_ZONA_HORARIA", "America/Costa_Rica"),
  };
}

/**
 * Instantanea al cargar el modulo, para consumidores que no necesitan releer el entorno.
 * El borde publico llama a `loadRastreoPublicoConfig()` en cada invocacion: es una lectura
 * de `process.env` y tres parseos, y hace que un cambio de umbral no exija reiniciar.
 */
export const rastreoPublicoConfig: RastreoPublicoConfig = loadRastreoPublicoConfig();
