// Feature 170 (T H.1, R40) — configuracion del dominio "cierre de bodega". Sobreescribible
// por variable de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), patron de lib/config/usuarios.ts.
//
// Cubre los TRES listados de bodega del Anexo III que pasan a paginacion server-side en la
// FASE 2: cierres de bodega pendientes, cierres de bodega resueltos (ambos de
// `CierresBodegaAdminService`) y cierres de bodega solicitados (`CierreBodegaService`).
// Nace con paginacion y sin nada mas: el TTL de evidencias del cierre del dia vive en
// lib/config/cierre.ts y NO se duplica aqui.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CierreBodegaConfig {
  /** Tamano de pagina por defecto de los listados de cierres de bodega (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadCierreBodegaConfig(): CierreBodegaConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("CIERRE_BODEGA_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("CIERRE_BODEGA_MAX_PAGE_SIZE", 100),
  };
}

export const cierreBodegaConfig: CierreBodegaConfig = loadCierreBodegaConfig();
