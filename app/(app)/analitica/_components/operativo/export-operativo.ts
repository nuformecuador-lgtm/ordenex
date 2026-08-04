// Feature 134 (T2.1, design §4.2) — LA PROYECCION del export operativo: de las series de UN
// panel a las filas del contrato de descarga de la 151.
//
// Modulo PURO: sin React, sin DOM, sin servicio, sin repositorio, sin Prisma y sin catalogo
// de servidor. Recorre lo que la Server Action ya devolvio.
//
// LAS COLUMNAS Y LA PROYECCION DE UNA FILA NO VIVEN AQUI, y no es un capricho de reparto:
// viven en `analitica-operativa-descarga-columnas.ts` porque la guardia perenne de la 170
// (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre las declaraciones de
// columnas de export POR CONVENCION DE NOMBRE y prohibe que exista ninguna fuera de ella.
// Ahi las columnas de este export quedan bajo su censo —y bajo su sonda, que delata que
// campo lee cada celda—, que es justo la vigilancia que un archivo de analitica necesita.
//
// Aqui queda lo unico que ese modulo no puede hacer: el RECORRIDO. Y con el, R10.

import type { DescargaFila } from "@/lib/types/descarga";

import {
  filaDescargaAnaliticaOperativa,
  type FuenteExport,
} from "./analitica-operativa-descarga-columnas";

/**
 * D6 — un archivo POR PANEL: estas fuentes son las metricas de UN panel, con el mismo grano
 * que la grafica que el usuario esta mirando. Un archivo unico del tablero mezclaria
 * `conteo`, `porcentaje` y `segundos` en una sola hoja.
 *
 * R10 — una fila por punto, en el orden recibido: ni se filtra, ni se rellena, ni se
 * reordena. Ni una fila de mas ni una de menos que las que pinta el panel. Es la tentacion
 * razonable de «limpiar» el archivo lo que esto impide: quitar los puntos sin valor produce
 * un CSV mas bonito y una mentira por omision.
 */
export function filasDeSerie(fuentes: readonly FuenteExport[]): DescargaFila[] {
  return fuentes.flatMap((fuente) =>
    fuente.serie.puntos.map(
      filaDescargaAnaliticaOperativa(fuente, new Set(fuente.serie.cobertura.fechasNoComparables)),
    ),
  );
}
