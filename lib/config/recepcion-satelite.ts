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
  /**
   * Feature 184 — Tanda A (Q2) — cuantos identificadores como maximo admite la comprobacion de
   * vigencia con la que se poda la seleccion.
   *
   * La entrada de esa comprobacion es la lista de ordenes marcadas FUERA de la pagina visible, y
   * acaba en un `IN` de SQL: sin cota es una lista abierta que el cliente decide. 500 son veinte
   * paginas de 25 marcadas enteras, muy por encima de cualquier uso observado; pasarse devuelve
   * `validation_error` en el borde y la seleccion NO se toca (R22).
   */
  MAX_IDS_VIGENCIA: number;
}

export function loadRecepcionSateliteConfig(): RecepcionSateliteConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("RECEPCION_SATELITE_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("RECEPCION_SATELITE_MAX_PAGE_SIZE", 100),
    MAX_IDS_VIGENCIA: readPositiveInt("RECEPCION_SATELITE_MAX_IDS_VIGENCIA", 500),
  };
}

export const recepcionSateliteConfig: RecepcionSateliteConfig = loadRecepcionSateliteConfig();
