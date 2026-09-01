// Ficha 339 (T3.1, design §4.6, R29/R30) — configuracion del DETALLE de una fila de la tarjeta
// «Como se compone la ganancia de Ordenex»: cuantos movimientos trae una pagina del desplegable
// y cual es el tope que el borde admite.
//
// Molde exacto de `lib/config/gasto-fijo.ts` (`readPositiveInt` + `load…Config()` + instancia).
// Existe para que la pantalla NO declare ninguno de los dos numeros como literal (R29) y para
// que los dos se puedan mover por variable de entorno sin tocar codigo (R30), que es la regla
// de `docs/architecture.md` («sin hardcode de contexto»).
//
// POR QUE 10 Y NO 25: el detalle se pinta DENTRO de una columna que ocupa media tarjeta, no en
// una pantalla entera. Y por que dominio PROPIO en vez de colgarlo de otro: su escala no es la
// de ninguno de los existentes — crece con el numero de movimientos de UNA categoria del libro.
//
// NO se registra en `tests/unit/config/paginacion-dominios.test.ts` a proposito (design §4.6):
// ese archivo es el censo de los 13 listados del Anexo III de la ficha 170, con un
// `toHaveLength(13)` que significa eso literalmente. Este desplegable no es uno de ellos, y
// meterlo alli convertiria esa afirmacion en mentira. Lleva su propio test —
// `tests/unit/config/composicion-detalle-config.test.ts` — con las mismas comprobaciones.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ComposicionDetalleConfig {
  /** Movimientos por pagina del detalle de una fila de la tarjeta (R27/R29). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina que el borde admite: por encima, `validation_error` (R32). */
  MAX_PAGE_SIZE: number;
}

export function loadComposicionDetalleConfig(): ComposicionDetalleConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("COMPOSICION_DETALLE_DEFAULT_PAGE_SIZE", 10),
    MAX_PAGE_SIZE: readPositiveInt("COMPOSICION_DETALLE_MAX_PAGE_SIZE", 50),
  };
}

export const composicionDetalleConfig: ComposicionDetalleConfig = loadComposicionDetalleConfig();
