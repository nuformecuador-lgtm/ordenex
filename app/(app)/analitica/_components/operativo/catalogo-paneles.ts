// Feature 131 (T1.3) — QUE PANELES PINTA EL TABLERO. Lista declarativa y explicita.
//
// R21 / D6 — LA LISTA NO SE DERIVA DE `listarMetricas()` Y NO CONSULTA
// `estadoProduccion`. NI AQUI NI EN NINGUN CONSUMIDOR. Motivo verificado, no estilistico:
//
//   `incidentes` (`lib/analytics/metrics.ts:220`) y `sin_gestionar` (`:242`) estan
//   marcadas `estadoProduccion: "declarada"` en el catalogo, PERO la 126 SI las sirve con
//   datos reales: `incidentes` tiene columna en el rollup y es el cuarto termino del
//   denominador de las tres tasas, y `sin_gestionar` se deriva del embudo
//   (`specs/126-…/design.md:468-480`; divergencias 1 y 3, heredadas a la ficha 175).
//
//   Un tablero que hiciera `…filter(p => getMetrica(p.metricaId).estadoProduccion ===
//   "producida")` borraria DOS KPI VIVOS de la pantalla sin que nada fallase: sin
//   excepcion, sin log, sin test rojo y sin hueco visible. Por eso el test de R21 NOMBRA
//   las dos metricas y afirma su presencia, en vez de contar paneles.
//
// R25 — este archivo NO importa `lib/analytics/metrics`. El catalogo real es dato de
// SERVIDOR (23 metricas con su alcance por rol, su fuente y sus nombres de tabla) y
// arrastrarlo a un modulo de cliente publicaria ese censo al navegador; es la misma regla
// que ya aplica `components/private/analytics/tipos.ts:1-9`. El vinculo con el catalogo se
// mantiene POR TEST (`tests/unit/analytics/tablero-catalogo-paneles.test.ts`), que si corre
// en Node y si puede leer `getMetrica()`.

import type { DimensionAnalitica } from "@/lib/analytics/types";

import type { TipoGrafica } from "./agregacion";

/** Una metrica dentro de un panel. La etiqueta es la de la leyenda. */
export interface MetricaDePanel {
  readonly metricaId: string;
  readonly etiqueta: string;
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
 * Paneles v1. La composicion concreta es cosmetica (`design.md §6.1`) salvo por R21: las
 * dos metricas `declarada` que la 126 sirve TIENEN que estar.
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
    metricas: [{ metricaId: "ordenes_creadas", etiqueta: "Ordenes creadas" }],
  },
  {
    id: "ordenes-por-estado",
    titulo: "Ordenes por estado",
    grafica: "donut",
    metricas: [{ metricaId: "ordenes_por_estado", etiqueta: "Ordenes por estado" }],
    desagregacion: "estatus",
  },
  {
    id: "resultado-gestiones",
    titulo: "Resultado de las gestiones",
    grafica: "barras",
    metricas: [
      { metricaId: "entregas", etiqueta: "Entregas" },
      { metricaId: "devoluciones", etiqueta: "Devoluciones" },
      { metricaId: "rechazos", etiqueta: "Rechazos" },
      // R21/D6 — `declarada` en el catalogo, SERVIDA por la 126. No se filtra.
      { metricaId: "incidentes", etiqueta: "Incidentes" },
    ],
  },
  {
    id: "sin-gestionar",
    titulo: "Ordenes sin gestionar",
    grafica: "lineas",
    // R21/D6 — `declarada` en el catalogo, DERIVADA del embudo por la 126. No se filtra.
    metricas: [{ metricaId: "sin_gestionar", etiqueta: "Sin gestionar" }],
  },
  {
    id: "tasa-entrega",
    titulo: "Tasa de entrega",
    grafica: "lineas",
    metricas: [{ metricaId: "tasa_entrega", etiqueta: "Tasa de entrega" }],
  },
  {
    id: "tiempo-ciclo",
    titulo: "Tiempo de ciclo",
    grafica: "lineas",
    metricas: [{ metricaId: "tiempo_ciclo", etiqueta: "Tiempo de ciclo" }],
  },
];

/** Todos los `metricaId` que el tablero consulta, sin repetir. */
export function metricasDelTablero(): string[] {
  return [...new Set(PANELES_OPERATIVOS.flatMap((p) => p.metricas.map((m) => m.metricaId)))];
}
