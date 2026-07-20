// Configuracion del listado de API keys (feature 82). Sobreescribible por variable
// de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), mismo molde que lib/config/usuarios.ts. [D3]

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ApiKeysConfig {
  /** Tamano de pagina por defecto del listado (R4). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R8). */
  MAX_PAGE_SIZE: number;
}

export function loadApiKeysConfig(): ApiKeysConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("API_KEYS_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("API_KEYS_MAX_PAGE_SIZE", 100),
  };
}

export const apiKeysConfig: ApiKeysConfig = loadApiKeysConfig();
