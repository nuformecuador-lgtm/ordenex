// Ficha 344 (T2.1, design §3.6, R26/R27) — configuracion del DETALLE de una fila del libro de
// movimientos: cuantas ordenes trae una pagina del desplegable y cual es el tope que el borde
// admite.
//
// Molde exacto de `lib/config/composicion-detalle.ts` (`readPositiveInt` + `load…Config()` +
// instancia). Existe para que la pantalla NO declare ninguno de los dos numeros como literal
// (R26) y para que los dos se puedan mover por variable de entorno sin tocar codigo (R27), que
// es la regla de `docs/architecture.md` («sin hardcode de contexto»).
//
// POR QUE 25 Y NO 10 (el de la ficha 339): aquel detalle se pinta DENTRO de una columna que
// ocupa media tarjeta; este se despliega bajo una fila de una tabla a ancho completo, y 25 es
// el tamano que ya usan los listados de pagina entera de este repo. Un cierre de 23 ordenes
// cabe en UNA pagina, que es justo el caso que el humano quiere poder revisar de una vez.
//
// NO se registra en `tests/unit/config/paginacion-dominios.test.ts` a proposito (design §3.6):
// ese archivo es el censo de los 13 listados del Anexo III de la ficha 170, con una afirmacion
// de longitud que significa exactamente eso. Este desplegable no es uno de ellos, y meterlo
// alli convertiria esa afirmacion en mentira. Lleva su propio test —
// `tests/unit/config/detalle-movimiento-config.test.ts` — con las mismas comprobaciones.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface DetalleMovimientoConfig {
  /** Ordenes por pagina del detalle de un movimiento (R24/R26). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina que el borde admite: por encima, `validation_error` (R29). */
  MAX_PAGE_SIZE: number;
}

export function loadDetalleMovimientoConfig(): DetalleMovimientoConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("DETALLE_MOVIMIENTO_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("DETALLE_MOVIMIENTO_MAX_PAGE_SIZE", 100),
  };
}

export const detalleMovimientoConfig: DetalleMovimientoConfig = loadDetalleMovimientoConfig();
