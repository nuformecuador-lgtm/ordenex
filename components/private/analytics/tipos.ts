// Contrato de props del paquete de graficas de analitica (feature 130).
//
// R3: la unidad de presentacion se IMPORTA del catalogo vigente de la 135
// (`lib/analytics/types.ts`), no se redeclara aqui. Es `import type`, asi que se
// borra en compilacion y no arrastra runtime al navegador. `@/lib/analytics/metrics`
// (23 metricas con alcance por rol, fuente y nombres de tabla) es dato de SERVIDOR
// y esta prohibido en este paquete: el llamador resuelve `titulo`/`etiqueta` y
// `unidad` server-side y pasa strings ya resueltos.
//
// El paquete NO tiene `index.ts` a proposito (design.md §4.2): un barril
// arrastraria `recharts` a cualquier consumidor y anularia R26/R27 en silencio.

import type { MetricaUnidad } from "@/lib/analytics/types";

export type { MetricaUnidad };

/**
 * Un punto de la serie: categoria (eje X o segmento del donut) + valor.
 *
 * `valor === null` significa DATO AUSENTE, nunca cero (R11): se pinta como hueco
 * en el lienzo y como marcador (`SIN_MONTO`) en la alternativa textual.
 */
export interface PuntoDato {
  /**
   * Ya formateada por el llamador (fecha en horario de Costa Rica, nombre de
   * zona...). El componente no sabe de fechas ni de zona horaria: esa aritmetica
   * vive en el tablero (131), que tiene el `RangoResuelto` de la 135.
   */
  readonly categoria: string;
  readonly valor: number | null;
}

/**
 * Una serie con nombre. El COLOR NO viaja en las props (design.md §9.6): lo
 * resuelve `paleta.ts` a partir del orden. Si el llamador pudiera pasar color,
 * cada tablero mantendria su propio catalogo a mano y R16 moriria ahi.
 */
export interface SerieDato {
  readonly id: string;
  readonly etiqueta: string;
  readonly puntos: readonly PuntoDato[];
}

/** Estados comunes a las tres graficas y a la tabla (R5-R8). */
export interface EstadoVisual {
  readonly cargando?: boolean;
  /** Mensaje YA saneado por el consumidor, igual que `DataTable` (R7). */
  readonly error?: string | null;
}

/**
 * Texto del estado vacio. Es prop y no literal para que no haya cadenas de UI
 * incrustadas en el paquete y para que R25 sea del llamador: el vacio de una
 * grafica habla de LA METRICA SIN DATOS EN EL RANGO, no de "llega en una entrega
 * posterior" (ese es el vacio del shell de la 129, y confundirlos hace ilegible
 * la pantalla).
 */
export interface TextoVacio {
  readonly titulo: string;
  readonly descripcion?: string;
}

export interface GraficaProps extends EstadoVisual {
  /** Nombre accesible OBLIGATORIO de la grafica (R9). */
  readonly titulo: string;
  readonly series: readonly SerieDato[];
  readonly unidad: MetricaUnidad;
  readonly vacio: TextoVacio;
  /**
   * Plantilla del aviso de recorte (R31/R33), en manos del llamador para no
   * incrustar texto de UI en el paquete. Recibe cuantas se muestran de cuantas.
   */
  readonly avisoRecorte?: (mostradas: number, recibidas: number) => string;
  /** R24: clase adicional opcional. El paquete no fija ancho ni alto en pixeles. */
  readonly className?: string;
}

/** Variacion respecto al periodo anterior (R15). */
export interface VariacionKpi {
  /** Delta ya calculado por el llamador. Su SIGNO se comunica con texto, no solo color. */
  readonly delta: number;
  /** Texto que acompana al delta ("vs. periodo anterior"), i18n-ready. */
  readonly etiqueta: string;
  /** Texto del signo, provisto por el llamador ("sube" / "baja" / "sin cambio"). */
  readonly texto: { readonly sube: string; readonly baja: string; readonly igual: string };
}

export interface KpiCardProps extends EstadoVisual {
  readonly etiqueta: string;
  /** `null` => marcador de dato ausente, nunca `0` (R14). */
  readonly valor: number | null;
  readonly unidad: MetricaUnidad;
  readonly variacion?: VariacionKpi;
  readonly className?: string;
}

/** Una columna de `TablaResumen`. La unidad fija el formato: el llamador NO pasa formateadores (R38). */
export interface ColumnaResumen {
  readonly id: string;
  readonly etiqueta: string;
  readonly unidad: MetricaUnidad;
}

/** Una fila de `TablaResumen`: la categoria y un valor por columna. */
export interface FilaResumen {
  readonly id: string;
  readonly categoria: string;
  readonly valores: Readonly<Record<string, number | null>>;
}
