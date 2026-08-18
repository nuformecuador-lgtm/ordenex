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
  /**
   * Proporcion del lienzo. `normal` = 16:9 (lo de siempre); `bajo` = 32:9, la MITAD de alto.
   *
   * Alto por PROPORCION y no por pixeles, que es la regla del paquete (R24): el slot del
   * shell es una columna flex y cualquier `h-[300px]` se rompe ahi. Por eso la prop es una
   * union cerrada y no un numero: las clases de Tailwind se compilan estaticamente, asi que
   * una interpolada no existiria en el CSS final.
   *
   * Opcional y con el default en lo de siempre, como `innerRadius` o `leyenda`: ninguna
   * grafica ya montada cambia de forma porque exista una opcion nueva.
   */
  readonly proporcion?: "normal" | "bajo";
}

/**
 * Lo que distingue un donut de un ANILLO: el grosor y lo que va en el hueco.
 *
 * Los dos radios se declaran como los declara recharts —pixeles o porcentaje del radio
 * disponible— y viajan tal cual al lienzo. No se validan aqui: el paquete dibuja, y una
 * combinacion absurda (interior mayor que exterior) se ve en el acto.
 *
 * Vive en el CONTRATO y no junto al lienzo porque `GraficaDonut` la necesita en sus props
 * y no puede importar nada de `./lienzo/` sin romper el confinamiento de recharts
 * (R26/R27): ahi el guardia mira el texto del import, no si el tipo se borra al compilar.
 */
/** Ajuste propio de las BARRAS. Opcional y con el default en el comportamiento de siempre,
 *  igual que la familia de `AnilloProps`: ninguna grafica ya montada cambia de forma. */
export interface BarrasProps {
  /**
   * Apilar las series en UNA barra por categoria, cada una de su color, en vez de ponerlas
   * lado a lado. Default `false` (como se dibujan desde la 130).
   *
   * ⚠ APILAR AFIRMA QUE LAS SERIES SON PARTES DE UN TODO: la altura de la barra es su suma. Con
   * series que se solapan —una que ya esta contenida en otra— esa altura no significa nada, y
   * el grafico lo dice igual de convincente. Quien enciende esto se hace responsable de que
   * sumar sus series tenga sentido.
   */
  readonly apilado?: boolean;
  /**
   * Dibujar las barras TUMBADAS: la categoria baja por el eje vertical y el valor crece hacia
   * la derecha. Default `false` (barras de pie, como se dibujan desde la 130).
   *
   * ⚠ EL ALTO DEJA DE SER LIBRE. De pie, el numero de categorias reparte el ANCHO —que es
   * elastico— y el alto lo fija el contenedor. Tumbadas, cada categoria necesita su franja de
   * ALTO: con muchas categorias en una caja baja las barras se aplastan hasta no distinguirse.
   * Quien la enciende tiene que mirar cuantas categorias hay y darle alto en consecuencia.
   */
  readonly horizontal?: boolean;
  /**
   * GROSOR de cada barra, en px. Ausente: recharts lo reparte solo con el espacio disponible,
   * que es como se dibujan las barras desde la 130.
   *
   * Es un tope, no una medida rigida: recharts nunca dibuja mas grueso que esto, pero SI mas
   * fino si no cabe. Por eso fijarlo no puede desbordar la caja con muchas categorias — lo que
   * pasa es que las barras se separan menos entre si.
   *
   * Se llama GROSOR y no «ancho» a proposito: con `horizontal` la barra esta tumbada y lo que
   * este numero mide es su ALTO. Una prop llamada `ancho` mentiria en la mitad de los casos.
   */
  readonly grosorBarra?: number;
}

export interface AnilloProps {
  /** Radio interior. Default del donut: `"55%"`. Un `"80%"` deja un anillo fino. */
  readonly innerRadius?: string | number;
  /** Radio exterior. Default del donut: `"85%"`. */
  readonly outerRadius?: string | number;
  /**
   * Texto al CENTRO del hueco. Cadena YA formateada por el llamador —no un `ReactNode`—
   * porque estas graficas las monta tambien un Server Component, y un nodo con funciones
   * dentro no cruza la frontera RSC. Ausente: el hueco queda vacio.
   */
  readonly centro?: string;
  /**
   * Donde va la leyenda. `"abajo"` (default) es como el donut lleva dibujandose desde la 130.
   * `"lateral"` la pone en COLUMNA a la derecha del anillo, una entrada por linea.
   *
   * Opcional y con el default puesto en el comportamiento viejo, igual que `innerRadius` y
   * `centro`: es la regla de esta familia de props —ninguna grafica ya montada cambia de
   * forma porque exista una opcion nueva—. Hoy la piden las ENTREGAS; el donut financiero y
   * los paneles operativos siguen con su leyenda abajo hasta que alguien lo decida para
   * ellos, que es una decision de cada pantalla y no de este archivo.
   */
  readonly leyenda?: "abajo" | "lateral";
  /**
   * Escribir el VALOR de cada segmento sobre el propio anillo, para no tener que pasar el
   * raton por encima para leerlo. Default `false` (el comportamiento de siempre).
   *
   * ⚠ No es gratis en un anillo FINO: con `innerRadius: "80%"` la banda es estrecha y el
   * numero se apoya sobre ella. Con la leyenda lateral encendida la cifra ya se lee ahi, asi
   * que esto es redundancia deliberada, no la unica via: se puede apagar sin perder el dato.
   */
  readonly mostrarValores?: boolean;
  /**
   * Escribir tambien el PESO de cada porcion sobre el total del anillo, pegado a su cifra:
   * `«20 (50 %)»`. Default `false` (el comportamiento de siempre).
   *
   * Acompana a la cifra, no la sustituye: «50 %» a solas no dice de cuantas ordenes se habla,
   * y en un anillo de operacion la cantidad es tan dato como la proporcion.
   *
   * Los porcentajes se calculan con `porcentajesDeReparto`, que reparte por RESTO MAYOR para
   * que la columna sume exactamente 100 %. Redondear cada porcion por su cuenta daria 99 o
   * 101, y unos porcentajes que no suman contradicen el propio dibujo.
   */
  readonly mostrarPorcentaje?: boolean;
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
