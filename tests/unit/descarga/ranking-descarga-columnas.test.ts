import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_RANKING } from "@/app/(app)/ranking/_components/ranking-descarga-columnas";

// ORDEN y CENSO de las columnas del archivo descargable del RANKING DEL DÍA (`/ranking`,
// feature 170 T F.1 / R5).
//
// ⚠️ POR QUÉ ESTE ARCHIVO EXISTE, si el ranking ya tenía un test que hablaba de columnas.
//
// `tests/components/descarga/RankingDescarga.test.tsx` comprueba que el componente pasa al
// `xlsx` las columnas DECLARADAS:
//
//     expect(columnas.map((c) => c.key)).toEqual(COLUMNAS_DESCARGA_RANKING.map((c) => c.clave))
//
// Eso es útil —verifica el cableado componente → archivo— pero NO es una aserción de orden: el
// esperado ES la propia constante, así que permutar dos columnas mueve los dos lados a la vez
// y el caso sigue verde. La 189 lo censó como «cobertura tautológica, un test de integración
// con disfraz». Aquél no se toca; éste es el que faltaba, con el esperado escrito A MANO.
//
// La medición está en `progress/impl_columnas-sin-asercion.md`: bajo la MISMA permuta
// (`posicion` ↔ `mensajero`), el caso de allá se queda VERDE y el de aquí se pone ROJO.
//
// Dos encabezados con historia, y por eso van literales:
//
// - «% del día» sale de `RANKING_COLUMNAS.porcentaje`, el mismo rótulo de la tabla. La celda
//   viaja SIN el símbolo `%` (es el STRING del servidor), así que la unidad la dice el
//   encabezado y solo el encabezado: si alguien lo reescribe, la columna deja de decir qué es.
// - «Entregadas» y «Asignadas» NO son rótulos de la tabla: la pantalla pinta una sola celda
//   «Entregadas / asignadas» con `5/5`, y el archivo la parte en dos números crudos (R7).
//   Son los dos únicos encabezados de esta constante que no tienen gemelo en pantalla.
//
// Lo que la constante NO lleva, y este caso también sujeta: ni `mensajeroId` (uuid interno,
// R23) ni `premio` —que el DTO trae, pero lo muestra la tarjeta del podio, fuera de alcance—.

describe("orden de las columnas de descarga del ranking del día", () => {
  it("declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_RANKING.map((c) => c.clave)).toEqual([
      "posicion",
      "mensajero",
      "porcentaje",
      "entregadas",
      "asignadas",
    ]);
    expect(COLUMNAS_DESCARGA_RANKING.map((c) => c.encabezado)).toEqual([
      "Posición",
      "Mensajero",
      "% del día",
      "Entregadas",
      "Asignadas",
    ]);
  });
});
