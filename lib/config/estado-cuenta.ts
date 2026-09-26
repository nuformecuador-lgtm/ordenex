// FICHA 458-B (design §3.2/§6) — configuracion del ESTADO DE CUENTA de una tienda, un mensajero o una
// bodega: cuantas filas trae una pagina del extracto y cual es el tope que el borde admite.
//
// Molde exacto de `lib/config/composicion-detalle.ts` (`readPositiveInt` + `load…Config()` +
// instancia): la pantalla no declara ninguno de los dos numeros como literal y los dos se pueden
// mover por variable de entorno sin tocar codigo (`docs/architecture.md`, «sin hardcode»).
//
// 20 es la pagina por defecto de los libros de la wallet (Q458-4 de design §14 mide que ningun
// instante reune mas de 20 filas de una misma cuenta); 100, el tope de los listados del libro.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface EstadoCuentaConfig {
  /** Filas por pagina del extracto. */
  PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina: por encima, `validation_error`. */
  MAX_PAGE_SIZE: number;
}

export function loadEstadoCuentaConfig(): EstadoCuentaConfig {
  return {
    PAGE_SIZE: readPositiveInt("ESTADO_CUENTA_PAGE_SIZE", 20),
    MAX_PAGE_SIZE: readPositiveInt("ESTADO_CUENTA_MAX_PAGE_SIZE", 100),
  };
}

export const estadoCuentaConfig: EstadoCuentaConfig = loadEstadoCuentaConfig();
