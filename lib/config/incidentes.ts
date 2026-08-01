// Feature 170 (T H.1, R40) — configuracion del dominio "incidentes". Sobreescribible por
// variable de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), patron de lib/config/usuarios.ts.
//
// Cubre los DOS listados del Anexo III que sirve `IncidenteAdminService`: incidentes
// pendientes de decision (cola) e incidentes historico. El historico es de los que crecen
// sin techo con el tiempo, que es lo que justifica paginarlos (design §11.3).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface IncidentesConfig {
  /** Tamano de pagina por defecto de los listados de incidentes (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadIncidentesConfig(): IncidentesConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("INCIDENTES_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("INCIDENTES_MAX_PAGE_SIZE", 100),
  };
}

export const incidentesConfig: IncidentesConfig = loadIncidentesConfig();
