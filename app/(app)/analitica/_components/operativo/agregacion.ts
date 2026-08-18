// Feature 131 (T1.2) — LOS NUMEROS. Modulo PURO: sin React, sin DOM, sin red.
//
// Aqui viven las cinco cosas que el tablero le hace al payload de la 126 antes de
// pasarlo al paquete de graficas de la 130, y las cinco pueden equivocarse en silencio:
//
//   R15 — agrupar la cola de categorias en «otros» (el paquete NO agrupa: lanza).
//   R16 — agregar temporalmente cuando el rango pasa de 62 puntos (el paquete NO
//         re-muestrea: lanza).
//   R17 — agregar SOLO conteos. Un `porcentaje` o un `segundos` promediado por dias es
//         una MEDIA DE MEDIAS: el servicio suma antes de dividir a proposito
//         (`AnaliticaOperativaService.ts:38-40`) y promediar los cocientes diarios
//         reintroduciria por la puerta de la UI el error que el servicio evita.
//   R18 — un cubo agregado que contenga el dia en curso HEREDA `parcial` y el `corteAt`
//         mayor. Perder esa marca convierte un dia abierto en un dia cerrado.
//   R20 — `null` se propaga como `null`. `valor ?? 0` afirma un dato que no existe.
//
// Feature 182 (T1.1/T1.2) — EL HUECO DE R27 QUEDA CERRADO.
//
// Lo que la 131 declaraba como no computable —la serie y la cifra de un `porcentaje` o un
// `segundos`— ya lo calcula el servidor (176, `consultarAgregadoOperativo`) sumando ANTES
// de dividir. Este modulo deja por tanto de tener una rama de aviso y pasa a tener dos
// entradas de datos:
//
//   - la SERIE DIARIA de la 126, como hasta hoy, por debajo del techo;
//   - los CUBOS del servidor (`CuboAgregado`), para la serie semanal por encima del techo
//     (R1/R2) y para la cifra total del periodo en cualquier rango (R4-R7).
//
// Tres cosas que este modulo NO hace, y que estan vigiladas por test:
//   R3  — no cubetea en el cliente puntos de `porcentaje`/`segundos`: si le llegan largos
//         y sin cubos, LANZA. Un `return` silencioso reintroduciria la media de medias.
//   R15 — `agregarPorSemana` exige la unidad y rechaza todo lo que no sea `conteo`. La
//         semana del cliente (`lunesDeLaSemana`) sigue viva porque es el unico camino de
//         los conteos largos —el modo agregado los RECHAZA—, pero queda acotada.
//   D2  — la UI NO divide. El total sale del `valor` que trae el cubo `periodo`; el
//         numerador y el denominador solo se leen para distinguir «no hubo gestiones» de
//         «no hay dato».

import { MAX_PUNTOS_SERIE, MAX_CATEGORIAS_LEGIBLES } from "@/components/private/analytics/topes";
import type { PuntoDato, SerieDato } from "@/components/private/analytics/tipos";
import type { MetricaUnidad } from "@/lib/analytics/types";
import type { CuboAgregado, PuntoSerie, SerieOperativa } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* Piezas                                                                      */
/* -------------------------------------------------------------------------- */

/** R15 — id y etiqueta del cubo de cola. No es una categoria del negocio. */
export const CATEGORIA_OTROS = "otros";

export type GranoTemporal = "dia" | "semana";

/* -------------------------------------------------------------------------- */
/* Feature 182 — los dos fallos RUIDOSOS (R3, R15)                             */
/* -------------------------------------------------------------------------- */

/**
 * R15 — alguien intento cubetear en el cliente algo que no es un conteo. Lanzar es el
 * requisito: un `return` silencioso o un cubeteo «best effort» reintroduciria por la
 * puerta de la UI la media de medias que el servicio evita a proposito.
 */
export class UnidadNoAgregableEnClienteError extends Error {
  constructor(readonly unidad: MetricaUnidad) {
    super(
      `la agregacion semanal del cliente solo admite conteos, y se invoco con "${unidad}": ` +
        "sumar o promediar cocientes diarios es una media de medias. Los cubos de esta " +
        "unidad los calcula el servidor sumando antes de dividir.",
    );
    this.name = "UnidadNoAgregableEnClienteError";
  }
}

/**
 * R3 — un panel de `porcentaje`/`segundos` por encima del techo SIN los cubos del
 * servidor. No hay forma honesta de pintarlo con lo que hay en el cliente, asi que se
 * falla en voz alta en vez de inventar una serie.
 */
export class CubosDelServidorRequeridosError extends Error {
  constructor(readonly unidad: MetricaUnidad, readonly fechas: number) {
    super(
      `un panel de "${unidad}" con ${fechas} fechas distintas (el techo son ` +
        `${MAX_PUNTOS_SERIE}) necesita los cubos semanales del servidor: agregarlos en el ` +
        "cliente seria una media de medias.",
    );
    this.name = "CubosDelServidorRequeridosError";
  }
}

/** R9 — un total, que sabe si mezcla dias cerrados con el dia en curso. */
export interface TotalTablero {
  /** R20 — `null` si no hay ni un valor: sumar nada da `null`, no `0`. */
  readonly valor: number | null;
  /** R9 — `true` si al menos un punto sumado venia `parcial: true`. */
  readonly parcial: boolean;
  /** El `corteAt` MAYOR de los puntos parciales sumados. */
  readonly corteAt?: string;
  /**
   * Feature 182 (R7) — el cubo existe y su DENOMINADOR es cero: no hubo gestiones sobre
   * las que calcular la cifra. Es distinto de «no hay dato» y distinto del vacio de la
   * metrica, y por eso viaja como campo propio en vez de colapsar en `valor: null`.
   */
  readonly sinGestiones: boolean;
}

/**
 * R9/R20 — totaliza puntos conservando las dos verdades incomodas: que puede no haber
 * dato (y entonces el total es `null`, no cero) y que el agregado puede estar abierto.
 *
 * Punto de mutacion de R9: fijar `parcial: false` aqui presenta un total que mezcla
 * dias cerrados con el dia en curso como si fuera cerrado.
 */
export function totalizarPuntos(puntos: readonly PuntoSerie[]): TotalTablero {
  let suma = 0;
  let hayValor = false;
  let parcial = false;
  let corteAt: string | undefined;

  for (const punto of puntos) {
    if (punto.valor !== null && Number.isFinite(punto.valor)) {
      suma += punto.valor;
      hayValor = true;
    }
    if (punto.parcial === true) {
      parcial = true;
      if (punto.corteAt && (corteAt === undefined || punto.corteAt > corteAt)) {
        corteAt = punto.corteAt;
      }
    }
  }

  return { valor: hayValor ? suma : null, parcial, corteAt, sinGestiones: false };
}

/**
 * Feature 182 (R4-R7) — LA CIFRA TOTAL, tomada del cubo de grano `periodo` del servidor.
 *
 * Se LEE, no se calcula: el `valor` del cubo es el que salio de dividir una sola vez sobre
 * todo el periodo (176). Aqui no hay division (D2), no hay media de los valores diarios y
 * no hay recomposicion de `numerador`/`denominador`.
 *
 * Puntos de mutacion:
 *   R5 — promediar los `valor` de los puntos diarios o de los cubos semanales.
 *   R6 — descartar `parcial`/`corteAt`: un periodo abierto se leeria como cerrado.
 *   R7 — `cubo.valor ?? 0`: un cero es una afirmacion sobre el dato, y con el denominador
 *        a cero no hay dato que afirmar.
 */
export function totalDelPeriodo(cubos: readonly CuboAgregado[]): TotalTablero | null {
  // El panel de un total no esta desagregado: el cubo del periodo es el que no lleva
  // dimension. Con desagregacion el servidor no emite cubo total, y entonces no hay cifra.
  const cubo = cubos.find((c) => c.dimension === undefined);
  if (cubo === undefined) return null;

  return {
    valor: cubo.valor,
    parcial: cubo.parcial === true,
    ...(cubo.parcial === true && cubo.corteAt !== undefined ? { corteAt: cubo.corteAt } : {}),
    sinGestiones: cubo.denominador === 0,
  };
}

/**
 * Semana ISO a la que pertenece una fecha calendario `YYYY-MM-DD`, expresada como la
 * fecha de su LUNES. Es aritmetica de calendario pura sobre medianoche UTC: no fija
 * ninguna frontera de dia de Costa Rica (eso ya lo hizo el servidor al construir la
 * serie), asi que no hay desfase propio que reimplementar.
 */
export function lunesDeLaSemana(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(dia.getTime())) return fecha;
  // `getUTCDay()`: 0 = domingo. La semana ISO empieza en lunes, igual que el preset
  // `semana` de `lib/analytics/ranges.ts` (borde de CALENDARIO, D2 de la 135).
  const desplazamiento = (dia.getUTCDay() + 6) % 7;
  dia.setUTCDate(dia.getUTCDate() - desplazamiento);
  return dia.toISOString().slice(0, 10);
}

/**
 * R16/R18/R20 — suma los puntos por semana ISO conservando la dimension.
 *
 * La suma de conteos diarios es EXACTA: todos los puntos son de la misma metrica, asi
 * que comparten `unidadDeConteo` y `sonSumables` se cumple por construccion.
 *
 * Punto de mutacion de R18: no propagar `parcial`/`corteAt` al cubo deja el dia en curso
 * escondido dentro de una semana que se lee como cerrada.
 *
 * Feature 182 (R15) — LA UNIDAD ES OBLIGATORIA Y SE COMPRUEBA. Sumar cocientes diarios es
 * una media de medias, asi que esta funcion solo sabe agregar `conteo`; cualquier otra
 * unidad la hace LANZAR. No es una precaucion teorica: es la unica forma de que un camino
 * de `porcentaje`/`segundos` que la invocase muriese en el acto en vez de pintar un numero
 * falso. Se conserva (y no se retira) porque es el unico camino de los conteos por encima
 * del techo: el modo agregado del servidor los rechaza por contrato.
 */
export function agregarPorSemana(
  puntos: readonly PuntoSerie[],
  unidad: MetricaUnidad,
): PuntoSerie[] {
  if (!esAgregableTemporal(unidad)) throw new UnidadNoAgregableEnClienteError(unidad);

  const cubos = new Map<string, PuntoSerie>();

  for (const punto of puntos) {
    const semana = lunesDeLaSemana(punto.fecha);
    // El separador es `\u001f` (US) y NO un byte NUL, que es lo que hubo hasta el
    // 2026-08-10. Los dos son igual de imposibles dentro de una fecha o de una dimension,
    // pero un NUL en el fuente hace que **git trate el archivo entero como binario**: el
    // diff de este archivo —el central de la 182— salia como `Bin 14529 -> 22687 bytes` y
    // no habia manera de revisarlo. No lo vuelvas a poner.
    const clave = `${semana}\u001f${punto.dimension ?? ""}`;
    const previo = cubos.get(clave);

    const valor =
      punto.valor === null || !Number.isFinite(punto.valor)
        ? (previo?.valor ?? null)
        : (previo?.valor ?? 0) + punto.valor;

    const parcial = previo?.parcial === true || punto.parcial === true;
    const cortes = [previo?.corteAt, punto.corteAt].filter(
      (c): c is string => typeof c === "string",
    );
    const corteAt = cortes.length > 0 ? cortes.reduce((a, b) => (a > b ? a : b)) : undefined;

    const cubo: PuntoSerie = {
      fecha: semana,
      ...(punto.dimension !== undefined ? { dimension: punto.dimension } : {}),
      valor,
      ...(parcial ? { parcial: true as const } : {}),
      ...(corteAt !== undefined ? { corteAt } : {}),
    };
    cubos.set(clave, cubo);
  }

  return [...cubos.values()].sort((a, b) =>
    a.fecha === b.fecha
      ? (a.dimension ?? "").localeCompare(b.dimension ?? "")
      : a.fecha.localeCompare(b.fecha),
  );
}

function magnitud(puntos: readonly PuntoDato[]): number {
  return puntos.reduce((acc, p) => acc + Math.abs(p.valor ?? 0), 0);
}

export interface Agrupacion<T> {
  readonly items: readonly T[];
  /** Cuantas categorias se fundieron en «otros». `0` = no se agrupo nada. */
  readonly agrupadas: number;
}

/**
 * R15 — ordena por magnitud descendente y funde la cola en «otros».
 *
 * El resultado NUNCA supera `MAX_CATEGORIAS_LEGIBLES`: si se conservasen 5 y ademas se anadiese
 * «otros» serian 6 y `aplicarTopeSeries` lanzaria `SeriesExcedidasError`, que es
 * exactamente lo que R15 existe para evitar. Se conservan por tanto las `MAX_CATEGORIAS_LEGIBLES - 1`
 * mayores y la cola va al cubo (declarado en `progress/impl_131.md`).
 *
 * Punto de mutacion de R15: devolver las series sin agrupar hace que el tope de la 130
 * lance.
 */
export function agruparSeriesEnOtros(series: readonly SerieDato[]): Agrupacion<SerieDato> {
  if (series.length <= MAX_CATEGORIAS_LEGIBLES) return { items: series, agrupadas: 0 };

  const ordenadas = [...series].sort((a, b) => magnitud(b.puntos) - magnitud(a.puntos));
  const conservadas = ordenadas.slice(0, MAX_CATEGORIAS_LEGIBLES - 1);
  const cola = ordenadas.slice(MAX_CATEGORIAS_LEGIBLES - 1);

  // La cola se suma POR CATEGORIA: dos series temporales distintas comparten eje X.
  const porCategoria = new Map<string, number | null>();
  const orden: string[] = [];
  for (const serie of cola) {
    for (const punto of serie.puntos) {
      if (!porCategoria.has(punto.categoria)) {
        porCategoria.set(punto.categoria, null);
        orden.push(punto.categoria);
      }
      if (punto.valor === null || !Number.isFinite(punto.valor)) continue;
      porCategoria.set(punto.categoria, (porCategoria.get(punto.categoria) ?? 0) + punto.valor);
    }
  }

  const otros: SerieDato = {
    id: CATEGORIA_OTROS,
    etiqueta: CATEGORIA_OTROS,
    puntos: orden.map((categoria) => ({ categoria, valor: porCategoria.get(categoria) ?? null })),
  };

  return { items: [...conservadas, otros], agrupadas: cola.length };
}

/** R15 en un donut: alli las categorias son los PUNTOS de la unica serie, no las series. */
export function agruparPuntosEnOtros(puntos: readonly PuntoDato[]): Agrupacion<PuntoDato> {
  if (puntos.length <= MAX_CATEGORIAS_LEGIBLES) return { items: puntos, agrupadas: 0 };

  const ordenados = [...puntos].sort((a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0));
  const conservados = ordenados.slice(0, MAX_CATEGORIAS_LEGIBLES - 1);
  const cola = ordenados.slice(MAX_CATEGORIAS_LEGIBLES - 1);

  const presentes = cola.filter((p): p is PuntoDato & { valor: number } => p.valor !== null);
  const otros: PuntoDato = {
    categoria: CATEGORIA_OTROS,
    valor: presentes.length === 0 ? null : presentes.reduce((acc, p) => acc + p.valor, 0),
  };

  return { items: [...conservados, otros], agrupadas: cola.length };
}

/* -------------------------------------------------------------------------- */
/* La puerta unica: de `SerieOperativa` a props de la 130                      */
/* -------------------------------------------------------------------------- */

/**
 * Feature 182 (R16) — UN SOLO MODO. El modo de aviso `rango_excedido` de la 131 se retira:
 * solo se entraba con «excede el techo y no es un conteo», que es exactamente el caso que
 * ahora sirven los cubos del servidor. Se retira en vez de dejarse inalcanzable porque una
 * rama muerta con su propio texto de UI es lo que un guardia futuro puede acabar censando
 * creyendo que vigila algo vivo.
 */
export type ModoPanel = "serie";

export type TipoGrafica = "lineas" | "barras" | "donut";

export interface FuenteSerie {
  /** Etiqueta de la metrica en la leyenda (la declara el catalogo de paneles). */
  readonly etiqueta: string;
  readonly serie: SerieOperativa;
}

export interface OpcionesPanel {
  readonly grafica: TipoGrafica;
  /** R8 — como se nombra un punto en el eje. La marca de parcialidad vive ahi. */
  readonly categoriaDePunto: (punto: PuntoSerie) => string;
}

export interface PanelPreparado {
  readonly modo: ModoPanel;
  readonly series: readonly SerieDato[];
  readonly unidad: MetricaUnidad;
  readonly grano: GranoTemporal;
  /**
   * Feature 182 (R14) — `true` si la serie se pinto con los CUBOS del servidor y no con la
   * serie diaria. El panel lo anuncia: nadie tiene que deducir del eje de donde salio.
   */
  readonly desdeCubos: boolean;
  /** R15 — cuantas categorias se fundieron en «otros». */
  readonly categoriasAgrupadas: number;
  /** R9 — `null` cuando no hay cifra que mostrar (no llego el cubo del periodo). */
  readonly total: TotalTablero | null;
  /** `true` si la serie no trae ni un punto: es el vacio de la metrica. */
  readonly vacio: boolean;
}

/**
 * Feature 182 (R1/R4) — los cubos que el servidor calculo para este panel, por grano.
 *
 * Ambos son opcionales porque un panel de `conteo` no los pide (R8: el borde los
 * rechazaria) y porque mientras no han llegado el panel esta en carga.
 */
export interface CubosDelPanel {
  /** Grano `periodo`: UN cubo con la cifra de todo el rango (R4-R7). */
  readonly periodo?: readonly CuboAgregado[];
  /** Grano `semana`: un cubo por semana ISO, para la serie por encima del techo (R1/R2). */
  readonly semana?: readonly CuboAgregado[];
}

/** R17 — solo los conteos se agregan temporalmente. Lo demas ya viene dividido. */
export function esAgregableTemporal(unidad: MetricaUnidad): boolean {
  return unidad === "conteo";
}

function puntosDe(fuentes: readonly FuenteSerie[]): PuntoSerie[] {
  return fuentes.flatMap((f) => [...f.serie.puntos]);
}

function fechasDistintas(puntos: readonly PuntoSerie[]): number {
  return new Set(puntos.map((p) => p.fecha)).size;
}

/**
 * R19/R20 — un punto de la 130 a partir de un punto del servicio: el `porcentaje` se
 * pasa CRUDO (`0,842`, que `formato.ts` pinta como «84,2 %»; multiplicarlo por 100 aqui
 * daria «8420 %») y el `null` se pasa como `null`.
 */
function aPuntoDato(punto: PuntoSerie, opciones: OpcionesPanel): PuntoDato {
  return { categoria: opciones.categoriaDePunto(punto), valor: punto.valor };
}

function seriesPorDimension(
  puntos: readonly PuntoSerie[],
  opciones: OpcionesPanel,
): SerieDato[] {
  const porDimension = new Map<string, PuntoDato[]>();
  const orden: string[] = [];
  for (const punto of puntos) {
    const clave = punto.dimension ?? "";
    if (!porDimension.has(clave)) {
      porDimension.set(clave, []);
      orden.push(clave);
    }
    (porDimension.get(clave) as PuntoDato[]).push(aPuntoDato(punto, opciones));
  }
  return orden.map((clave) => ({
    id: clave,
    etiqueta: clave,
    puntos: porDimension.get(clave) as PuntoDato[],
  }));
}

/**
 * Donut: las categorias son los segmentos y el tiempo se colapsa sumando. Solo tiene
 * sentido con `unidad: "conteo"` —sumar cocientes no significa nada—, y el catalogo de
 * paneles solo declara donut para conteos.
 */
function segmentosDonut(puntos: readonly PuntoSerie[]): PuntoDato[] {
  const porDimension = new Map<string, number | null>();
  const orden: string[] = [];
  for (const punto of puntos) {
    const clave = punto.dimension ?? "";
    if (!porDimension.has(clave)) {
      porDimension.set(clave, null);
      orden.push(clave);
    }
    if (punto.valor === null || !Number.isFinite(punto.valor)) continue;
    porDimension.set(clave, (porDimension.get(clave) ?? 0) + punto.valor);
  }
  return orden.map((clave) => ({ categoria: clave, valor: porDimension.get(clave) ?? null }));
}

/**
 * Feature 182 (R1/R2) — la serie de un panel A PARTIR DE LOS CUBOS DEL SERVIDOR.
 *
 * La categoria de cada punto es la `fecha` del cubo TAL CUAL (el ancla de la semana la
 * decidio el servidor) y el valor es el `valor` del cubo. Aqui no se recalcula la semana
 * —`lunesDeLaSemana` no interviene— y no se recompone ningun valor a partir de los puntos
 * diarios: seria una segunda definicion de semana y una media de medias.
 */
function seriesDesdeCubos(
  cubos: readonly CuboAgregado[],
  fuentes: readonly FuenteSerie[],
): SerieDato[] {
  const puntos: PuntoDato[] = cubos.map((cubo) => ({ categoria: cubo.fecha, valor: cubo.valor }));
  const primera = fuentes[0];
  return [
    {
      id: primera?.serie.metricaId ?? "serie",
      etiqueta: primera?.etiqueta ?? "",
      puntos,
    },
  ];
}

/**
 * La UNICA puerta por la que pasa el payload de la 126 antes de llegar al paquete de la
 * 130. Todo lo que este modulo promete se decide aqui.
 *
 * Feature 182 — `cubos` es lo que el servidor calculo para este panel (176). Con `conteo`
 * llega vacio y nada cambia respecto a la 131; con `porcentaje`/`segundos` aporta la cifra
 * total en TODO rango y la serie semanal por encima del techo.
 */
export function prepararPanel(
  fuentes: readonly FuenteSerie[],
  opciones: OpcionesPanel,
  cubos: CubosDelPanel = {},
): PanelPreparado {
  const unidad: MetricaUnidad = fuentes[0]?.serie.unidad ?? "conteo";
  const crudos = puntosDe(fuentes);
  const excedeTecho = fechasDistintas(crudos) > MAX_PUNTOS_SERIE;

  // R4/R5 — la cifra de un `porcentaje`/`segundos` SIEMPRE sale del cubo `periodo`, tanto
  // por encima como por debajo del techo. La de un `conteo` se suma como en la 131: sumar
  // conteos diarios es exacto, dividir dos veces no.
  const totalDeCubos = esAgregableTemporal(unidad) ? null : totalDelPeriodo(cubos.periodo ?? []);

  // R1/R2/R3 — por encima del techo, un `porcentaje`/`segundos` se pinta con los cubos
  // semanales del servidor. Sin ellos NO hay nada honesto que pintar: se lanza.
  if (excedeTecho && !esAgregableTemporal(unidad)) {
    const semanales = cubos.semana;
    if (semanales === undefined || semanales.length === 0) {
      throw new CubosDelServidorRequeridosError(unidad, fechasDistintas(crudos));
    }
    const agrupacion = agruparSeriesEnOtros(seriesDesdeCubos(semanales, fuentes));
    return {
      modo: "serie",
      series: agrupacion.items,
      unidad,
      grano: "semana",
      desdeCubos: true,
      categoriasAgrupadas: agrupacion.agrupadas,
      total: totalDeCubos,
      vacio: semanales.length === 0,
    };
  }

  const grano: GranoTemporal = excedeTecho ? "semana" : "dia";
  const fuentesAgregadas: FuenteSerie[] =
    grano === "semana"
      ? fuentes.map((f) => ({
          ...f,
          // R15 — la unidad viaja: solo los conteos llegan hasta aqui, y la funcion lo
          // comprueba. Es el acotamiento, no un comentario.
          serie: { ...f.serie, puntos: agregarPorSemana(f.serie.puntos, f.serie.unidad) },
        }))
      : [...fuentes];
  const puntos = puntosDe(fuentesAgregadas);

  if (opciones.grafica === "donut") {
    const agrupacion = agruparPuntosEnOtros(segmentosDonut(puntos));
    const serie = fuentesAgregadas[0];
    return {
      modo: "serie",
      series: [
        {
          id: serie?.serie.metricaId ?? "serie",
          etiqueta: serie?.etiqueta ?? "",
          puntos: agrupacion.items,
        },
      ],
      unidad,
      grano,
      desdeCubos: false,
      categoriasAgrupadas: agrupacion.agrupadas,
      total: esAgregableTemporal(unidad) ? totalizarPuntos(puntos) : totalDeCubos,
      vacio: puntos.length === 0,
    };
  }

  const desagregada = puntos.some((p) => p.dimension !== undefined);
  const brutas: SerieDato[] = desagregada
    ? seriesPorDimension(puntos, opciones)
    : fuentesAgregadas.map((f) => ({
        id: f.serie.metricaId,
        etiqueta: f.etiqueta,
        puntos: f.serie.puntos.map((p) => aPuntoDato(p, opciones)),
      }));

  const agrupacion = agruparSeriesEnOtros(brutas);

  return {
    modo: "serie",
    series: agrupacion.items,
    unidad,
    grano,
    desdeCubos: false,
    categoriasAgrupadas: agrupacion.agrupadas,
    // Feature 182 (R4/D2) — el conteo se suma aqui; el `porcentaje`/`segundos` se LEE del
    // cubo `periodo` que calculo el servidor. Ninguna de las dos ramas divide.
    total: esAgregableTemporal(unidad) ? totalizarPuntos(puntos) : totalDeCubos,
    vacio: puntos.length === 0,
  };
}
