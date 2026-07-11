// Configuracion del CRUD de usuarios (feature 25). Sobreescribible por variable
// de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), patron de lib/config/tarifas.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface UsuariosConfig {
  /** Tamano de pagina por defecto del listado (R13). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R13). */
  MAX_PAGE_SIZE: number;
}

export function loadUsuariosConfig(): UsuariosConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("USUARIOS_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("USUARIOS_MAX_PAGE_SIZE", 100),
  };
}

export const usuariosConfig: UsuariosConfig = loadUsuariosConfig();
