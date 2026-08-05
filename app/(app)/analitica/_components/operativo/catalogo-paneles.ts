// Feature 131 (T1.3) — QUE PANELES PINTA EL TABLERO. Lista declarativa y explicita.
//
// R21 / D6 — LA LISTA NO SE DERIVA DE `listarMetricas()` Y NO CONSULTA
// `estadoProduccion`. NI AQUI NI EN NINGUN CONSUMIDOR. Motivo verificado, no estilistico:
//
//   `estadoProduccion` dice si una metrica TIENE PRODUCTOR (si alguien escribe su dato),
//   NO si su panel se pinta. Son dos preguntas distintas y usar la primera para responder
//   la segunda borra KPI vivos de la pantalla sin que nada falle: sin excepcion, sin log,
//   sin test rojo y sin hueco visible.
//
//   Historia que lo demuestra: `incidentes` y `sin_gestionar` estuvieron marcadas
//   `estadoProduccion: "declarada"` mientras la 126 YA las servia con datos reales
//   (`incidentes` tiene columna en el rollup y es el cuarto termino del denominador de las
//   tres tasas; `sin_gestionar` se deriva del embudo — `specs/126-…/design.md:468-480`,
//   divergencias 1 y 3). Un `…filter(p => getMetrica(p.metricaId).estadoProduccion ===
//   "producida")` las habria borrado del tablero. La ficha 175 corrigio esa mentira: hoy
//   las dos son `producida` (decision humana fechada ⟨D11⟩, `progress/decision_175.md`,
//   2026-08-03) y el catalogo no tiene ninguna metrica `declarada`.
//
//   Que la mentira concreta este corregida NO devuelve la licencia de filtrar por el
//   campo: la regla sigue siendo la misma, y la siguiente metrica marcada sin productor
//   volveria a desaparecer en silencio. Por eso esta lista es DECLARATIVA y el test de R21
//   comprueba que no cambia aunque el catalogo marque otra cosa, sin afirmar ningun valor.
//
// R25 — este archivo NO importa `lib/analytics/metrics`. El catalogo real es dato de
// SERVIDOR (23 metricas con su alcance por rol, su fuente y sus nombres de tabla) y
// arrastrarlo a un modulo de cliente publicaria ese censo al navegador; es la misma regla
// que ya aplica `components/private/analytics/tipos.ts:1-9`. El vinculo con el catalogo se
// mantiene POR TEST (`tests/unit/analytics/tablero-catalogo-paneles.test.ts`), que si corre
// en Node y si puede leer `getMetrica()`.

// Feature 182 (T2.2/R9/D4) — cada metrica DECLARA su `unidad`, y el vinculo con el
// catalogo real se ancla POR TEST, igual que todo lo demas de este archivo. La unidad es
// lo que decide si el panel pide el modo agregado (R8: el borde rechaza los `conteo`), asi
// que hace falta ANTES de la primera respuesta: deducirla de la serie obligaria a encadenar
// la llamada agregada tras la serie y romperia la oleada unica de R11.

import type { DimensionAnalitica, MetricaUnidad } from "@/lib/analytics/types";

import type { TipoGrafica } from "./agregacion";

/** Una metrica dentro de un panel. La etiqueta es la de la leyenda. */
export interface MetricaDePanel {
  readonly metricaId: string;
  readonly etiqueta: string;
  /**
   * R9 — la unidad que el catalogo de SERVIDOR declara para este `metricaId`. Se escribe a
   * mano porque el catalogo real no puede importarse aqui (R25), y
   * `tests/unit/analytics/tablero-catalogo-paneles.test.ts` comprueba que coincide.
   */
  readonly unidad: MetricaUnidad;
}

export interface PanelTablero {
  /** Estable: entra en la clave SWR del panel. */
  readonly id: string;
  /** Nombre accesible de la region del panel (`GraficaMarco` lo usa como `aria-label`). */
  readonly titulo: string;
  readonly grafica: TipoGrafica;
  readonly metricas: readonly MetricaDePanel[];
  /** Grano pedido. El test comprueba que esta en los `granos` de todas sus metricas. */
  readonly desagregacion?: DimensionAnalitica;
}

/**
 * Paneles v1. La composicion concreta es cosmetica (`design.md §6.1`) salvo por R21:
 * `incidentes` y `sin_gestionar` —las dos que el catalogo dio por «sin productor» mientras
 * la 126 ya las servia— TIENEN que estar.
 *
 * Desviacion declarada respecto a `design.md §6.1`: el panel de gestiones incluye
 * `incidentes` —es el cuarto termino del denominador de las tasas, asi que ahi es donde
 * se lee— y `sin_gestionar` tiene panel propio; a cambio se cae `motivos_devolucion`,
 * para no pasar de SEIS paneles (D4). Anotado en `progress/impl_131.md`.
 */
export const PANELES_OPERATIVOS: readonly PanelTablero[] = [
  {
    id: "ordenes-creadas",
    titulo: "Ordenes creadas",
    grafica: "lineas",
    metricas: [{ metricaId: "ordenes_creadas", etiqueta: "Ordenes creadas", unidad: "conteo" }],
  },
  {
    id: "ordenes-por-estado",
    titulo: "Ordenes por estado",
    grafica: "donut",
    metricas: [{ metricaId: "ordenes_por_estado", etiqueta: "Ordenes por estado", unidad: "conteo" }],
    desagregacion: "estatus",
  },
  {
    id: "resultado-gestiones",
    titulo: "Resultado de las gestiones",
    grafica: "barras",
    metricas: [
      { metricaId: "entregas", etiqueta: "Entregas", unidad: "conteo" },
      { metricaId: "devoluciones", etiqueta: "Devoluciones", unidad: "conteo" },
      { metricaId: "rechazos", etiqueta: "Rechazos", unidad: "conteo" },
      // R21/D6 — SERVIDA por la 126 (y antes dada por «sin productor»). No se filtra.
      { metricaId: "incidentes", etiqueta: "Incidentes", unidad: "conteo" },
    ],
  },
  {
    id: "sin-gestionar",
    titulo: "Ordenes sin gestionar",
    grafica: "lineas",
    // R21/D6 — DERIVADA del embudo por la 126 (y antes dada por «sin productor»). No se filtra.
    metricas: [{ metricaId: "sin_gestionar", etiqueta: "Sin gestionar", unidad: "conteo" }],
  },
  {
    id: "tasa-entrega",
    titulo: "Tasa de entrega",
    grafica: "lineas",
    metricas: [{ metricaId: "tasa_entrega", etiqueta: "Tasa de entrega", unidad: "porcentaje" }],
  },
  {
    id: "tiempo-ciclo",
    titulo: "Tiempo de ciclo",
    grafica: "lineas",
    metricas: [{ metricaId: "tiempo_ciclo", etiqueta: "Tiempo de ciclo", unidad: "segundos" }],
  },
];

/**
 * R9/R8 — la unidad de un panel: la de sus metricas, que comparten unidad por construccion
 * (lo afirma `tablero-catalogo-paneles.test.ts`; dos unidades en un mismo eje no se leen).
 * Es lo que decide si el panel pide el modo agregado.
 */
export function unidadDelPanel(panel: PanelTablero): MetricaUnidad {
  return panel.metricas[0]?.unidad ?? "conteo";
}

/** Todos los `metricaId` que el tablero consulta, sin repetir. */
export function metricasDelTablero(): string[] {
  return [...new Set(PANELES_OPERATIVOS.flatMap((p) => p.metricas.map((m) => m.metricaId)))];
}
