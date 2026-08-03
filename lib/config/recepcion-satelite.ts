// Feature 170 (T H.1, R40) — configuracion del dominio "recepcion satelite". Sobreescribible
// por variable de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), patron de lib/config/usuarios.ts.
//
// Cubre el listado de ordenes de la bodega satelite (`RecepcionSateliteService`), la pantalla
// de riesgo ALTO del Anexo III: hoy recibe el dataset entero y resuelve TRES filtros en el
// cliente (design §11.3). La tanda K mueve esos filtros al servidor y pagina; el tamano de
// pagina sale de aqui y no de un literal en la pantalla.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RecepcionSateliteConfig {
  /** Tamano de pagina por defecto del listado de ordenes de la bodega satelite (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadRecepcionSateliteConfig(): RecepcionSateliteConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("RECEPCION_SATELITE_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("RECEPCION_SATELITE_MAX_PAGE_SIZE", 100),
  };
}

export const recepcionSateliteConfig: RecepcionSateliteConfig = loadRecepcionSateliteConfig();
