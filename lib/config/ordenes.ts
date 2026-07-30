// Configuracion del CRUD de ordenes. Sobreescribible por variable de entorno
// para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode de
// contexto"), patron de lib/config/auth.ts.
//
// FEATURE 155/R30 — aqui YA NO se configura en que estado nace una orden. Se retiraron
// `DEFAULT_ESTATUS_VALUE` y `FULFILLMENT_ESTATUS_VALUE` con sus dos variables de entorno
// (`ORDENES_DEFAULT_ESTATUS_VALUE`, `ORDENES_FULFILLMENT_ESTATUS_VALUE`), y NO queda ninguna
// otra palanca de entorno capaz de fijarlo: la decision vive entera en
// `resolverDestinoCreacion` (`lib/services/destino-creacion.ts`).
//
// El motivo no es purismo. `docs/architecture.md` §Principios-4 ("sin hardcode de contexto")
// habla de pais, moneda, cuenta y credenciales, no de la maquina de estados; y desde la feature
// 140 la creacion se valida contra `ESTADOS_CREACION` con fallo CERRADO. Exportar
// `ORDENES_DEFAULT_ESTATUS_VALUE=cualquier_cosa` no producia "otra configuracion": producia
// `TransicionIlegalError` en CADA creacion, es decir produccion caida. Una palanca cuyo unico
// efecto posible es romper la aplicacion no es configuracion, es una trampa.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface OrdenesConfig {
  /** Tamano de pagina por defecto del listado (N2). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R33). */
  MAX_PAGE_SIZE: number;
}

export function loadOrdenesConfig(): OrdenesConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("ORDENES_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("ORDENES_MAX_PAGE_SIZE", 100),
  };
}

export const ordenesConfig: OrdenesConfig = loadOrdenesConfig();
