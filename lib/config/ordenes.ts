// Configuracion del CRUD de ordenes. Sobreescribible por variable de entorno
// para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode de
// contexto"), patron de lib/config/auth.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonEmpty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw;
}

export interface OrdenesConfig {
  /** Tamano de pagina por defecto del listado (N2). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R33). */
  MAX_PAGE_SIZE: number;
  /**
   * Valor de estatus inicial por defecto al crear si no se especifica
   * (N1/R10/R27). Feature 15/R7/R8: default GLOBAL "en_preparacion" (antes
   * "en_bodega"), compartido por el CRUD (feature 6) y la carga masiva.
   */
  DEFAULT_ESTATUS_VALUE: string;
  /**
   * Feature 27/R16/R23: estatus inicial de la carga masiva cuando la tienda que
   * carga tiene `fulfillment = true`. Reutiliza el valor de catalogo ya sembrado
   * (`en_fulfillment`, feature 28); hermana de DEFAULT_ESTATUS_VALUE.
   */
  FULFILLMENT_ESTATUS_VALUE: string;
}

export function loadOrdenesConfig(): OrdenesConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("ORDENES_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("ORDENES_MAX_PAGE_SIZE", 100),
    DEFAULT_ESTATUS_VALUE: readNonEmpty("ORDENES_DEFAULT_ESTATUS_VALUE", "en_preparacion"),
    FULFILLMENT_ESTATUS_VALUE: readNonEmpty(
      "ORDENES_FULFILLMENT_ESTATUS_VALUE",
      "en_fulfillment",
    ),
  };
}

export const ordenesConfig: OrdenesConfig = loadOrdenesConfig();
