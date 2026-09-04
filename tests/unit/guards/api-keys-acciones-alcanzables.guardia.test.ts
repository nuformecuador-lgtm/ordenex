// @vitest-environment jsdom
// FICHA 373 (2026-09-04) — GUARDIA: en `Configuración › API`, los botones de una fila tienen
// que quedar DENTRO del área visible sin desplazar la tabla en horizontal.
//
// POR QUÉ EXISTE. El defecto no lo encontró ningún test: se vio MIRANDO la pantalla. «Acciones»
// era la última columna y, con la tabla desbordando su contenedor con scroll, el botón
// «Eliminar» caía fuera del área visible en anchos de portátil. Medido en Chromium con la barra
// lateral desplegada (256 px), que es el caso del defecto:
//
//   | viewport | visible | tabla | desborda | «Eliminar» visible |
//   |----------|---------|-------|----------|--------------------|
//   | 1920     |    1614 |  1614 |        0 | 74 px              |
//   | 1440     |    1134 |  1134 |        0 | 74 px              |
//   | 1280     |     974 |  1100 |    126 → | −40 px  (FUERA)    |
//   | 1024     |     718 |  1100 |    382 → | −296 px (FUERA)    |
//
// Y NO se arreglaba estrechando columnas: el mínimo de contenido de las SIETE columnas de datos
// ya suma 838 px, así que a 1024 (718 px de sitio) la tabla desborda aunque los botones no
// existieran. El desbordamiento es un hecho de esta pantalla; lo que se decide es QUÉ queda
// fuera. Por eso las dos columnas INTERACTIVAS se adelantaron junto a «Estado» —que es lo que
// dice si el botón del medio ofrece Activar o Desactivar—, igual que la feature 160 adelantó
// «Intentos» en `/ordenes` con el mismo motivo escrito y que `OrdenesModule` antepone su columna
// de selección.
//
// QUÉ AFIRMA, Y CÓMO SE PONE ROJO. Los anchos de abajo son MEDIDOS en el navegador y viven aquí
// como literales; el orden lo pone el componente. Son dos fuentes distintas: mover «Acciones» al
// final otra vez —o meter delante una columna ancha— empuja la suma por encima del presupuesto
// de 1024 y este archivo se pone rojo. Comparar el componente contra sí mismo, en cambio, estaría
// verde siempre (lección «aserción contra su propia fuente»).
import { describe, it, expect, vi } from "vitest";

// El borde: sin esto, importar las columnas arrastra las Server Actions al test. No se renderiza
// nada aquí —solo se lee la LISTA de columnas—, así que basta con cortar la cadena.
vi.mock("@/lib/actions/api-keys", () => ({
  rotarApiKey: vi.fn(),
  activarApiKey: vi.fn(),
  desactivarApiKey: vi.fn(),
  eliminarApiKey: vi.fn(),
}));
vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: vi.fn(),
  registrarWebhook: vi.fn(),
  desactivarWebhook: vi.fn(),
  rotarSecretoWebhook: vi.fn(),
}));

import { buildApiKeysColumns } from "@/app/(app)/configuracion/api/_components/api-keys-columns";

/**
 * Ancho MÍNIMO real de cada columna, medido en Chromium sobre `/configuracion/api` a 1024 y
 * 1280 px (donde la tabla está en su suelo y las dos medidas coinciden). Suma: 1100 px.
 *
 * Si alguien añade una columna y no la mide, el primer test se pone rojo: sin su ancho, este
 * archivo no puede afirmar nada sobre lo que cabe.
 */
const ANCHO_MEDIDO_PX: Record<string, number> = {
  identificador: 104,
  estado: 91,
  acciones: 262,
  webhook: 83,
  keyPrefix: 133,
  usuarioEmail: 167,
  tiendaDestino: 140,
  createdAt: 120,
};

/**
 * Ancho VISIBLE del contenedor con scroll de la tabla en un portátil de 1024 px con la barra
 * lateral desplegada (256 px). Medido, no estimado: es el presupuesto que hay que respetar.
 */
const VISIBLE_1024_PX = 718;

/** Las columnas cuya celda PINTA BOTONES. Son las que no pueden quedar fuera de pantalla. */
const COLUMNAS_INTERACTIVAS = ["acciones", "webhook"] as const;

/** El orden que tenía la tabla cuando se reportó el defecto (referencia histórica). */
const ORDEN_CON_EL_DEFECTO = [
  "identificador",
  "keyPrefix",
  "usuarioEmail",
  "tiendaDestino",
  "createdAt",
  "estado",
  "webhook",
  "acciones",
];

function columnas() {
  return buildApiKeysColumns({ onMutated: async () => {}, onEliminada: () => {} });
}

/** Suma de anchos desde la primera columna hasta la de `id`, ambas incluidas. */
function anchoHasta(ids: string[], id: string): number {
  const hasta = ids.indexOf(id);
  expect(hasta, `la columna «${id}» ya no existe en el listado`).toBeGreaterThanOrEqual(0);
  return ids
    .slice(0, hasta + 1)
    .reduce((suma, actual) => suma + ANCHO_MEDIDO_PX[actual], 0);
}

describe("API keys · los botones de la fila caben sin desplazar la tabla (ficha 373)", () => {
  it("toda columna del listado tiene su ancho medido: sin medirla no se puede afirmar que quepa", () => {
    const ids = columnas().map((c) => c.id);
    expect(ids).toEqual([...new Set(ids)]); // ids únicos: son la key de React de la celda
    for (const id of ids) {
      expect(
        ANCHO_MEDIDO_PX[id],
        `columna «${id}» sin ancho medido: mídela en el navegador y añádela a ANCHO_MEDIDO_PX`,
      ).toBeTypeOf("number");
    }
  });

  it("las columnas con botones caben enteras en los 718 px visibles de un portátil de 1024", () => {
    const ids = columnas().map((c) => c.id);
    for (const interactiva of COLUMNAS_INTERACTIVAS) {
      expect(
        anchoHasta(ids, interactiva),
        `la columna «${interactiva}» termina fuera del área visible a 1024 px`,
      ).toBeLessThanOrEqual(VISIBLE_1024_PX);
    }
  });

  it("el orden que tenía el defecto NO pasaría este listón: el presupuesto muerde", () => {
    // Sin esto, un 718 demasiado generoso dejaría la guardia verde para cualquier orden.
    const suma = ORDEN_CON_EL_DEFECTO.reduce((s, id) => s + ANCHO_MEDIDO_PX[id], 0);
    expect(suma).toBe(1100);
    expect(anchoHasta(ORDEN_CON_EL_DEFECTO, "acciones")).toBeGreaterThan(VISIBLE_1024_PX);
  });

  it("la identidad de la fila sigue PRIMERA y ninguna columna de datos se perdió por el camino", () => {
    const ids = columnas().map((c) => c.id);
    // Unos botones sin saber de qué key son no sirven; además la flecha de scroll izquierda de
    // `DataTable` se dibuja sobre la primera columna, así que ahí no puede ir un control.
    expect(ids[0]).toBe("identificador");
    // El arreglo es un REORDENADO: el conjunto de columnas es exactamente el de antes. Si alguien
    // "arregla" el desbordamiento borrando una columna, esto se pone rojo.
    expect([...ids].sort()).toEqual([...ORDEN_CON_EL_DEFECTO].sort());
  });
});
