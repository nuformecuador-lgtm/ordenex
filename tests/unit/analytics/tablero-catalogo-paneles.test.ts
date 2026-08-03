import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  PANELES_OPERATIVOS,
  metricasDelTablero,
} from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { getMetrica } from "@/lib/analytics/metrics";

// Feature 131 (T1.3) — R21 y D6.
//
// El catalogo de paneles es una lista DECLARATIVA y no importa `lib/analytics/metrics`
// (es dato de servidor: R25 y la misma regla de `components/private/analytics/tipos.ts`).
// El vinculo con el catalogo real se mantiene AQUI, en un test que si corre en Node.

const RUTA_CATALOGO = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "(app)",
  "analitica",
  "_components",
  "operativo",
  "catalogo-paneles.ts",
);

describe("Feature 131 (R21) — el tablero no decide sus paneles por `estadoProduccion`", () => {
  it("el tablero declara panel para `incidentes` y `sin_gestionar` pese a estar marcadas `declarada`", () => {
    // D6 — ESTE es el caso que la mutacion tiene que matar, y por eso NOMBRA las dos
    // metricas en vez de contar paneles.
    //
    // Las dos estan marcadas `estadoProduccion: "declarada"` en el catalogo
    // (`lib/analytics/metrics.ts`) pero la 126 SI las sirve con datos reales:
    // `incidentes` tiene columna en el rollup y es el cuarto termino del denominador de
    // las tres tasas; `sin_gestionar` se deriva del embudo (divergencias 1 y 3 heredadas
    // a la ficha 175). Un `filter(estadoProduccion === "producida")` las borraria de la
    // pantalla sin excepcion, sin log y sin hueco visible.
    const metricas = metricasDelTablero();

    expect(getMetrica("incidentes")?.estadoProduccion).toBe("declarada");
    expect(getMetrica("sin_gestionar")?.estadoProduccion).toBe("declarada");

    expect(metricas, "`incidentes` esta marcada `declarada` pero la 126 la sirve").toContain(
      "incidentes",
    );
    expect(metricas, "`sin_gestionar` esta marcada `declarada` pero la 126 la sirve").toContain(
      "sin_gestionar",
    );

    // Y cada una llega hasta un panel de verdad, con su titulo: estar en la lista de ids
    // pero sin panel que la pinte seria el mismo agujero por otra puerta.
    for (const id of ["incidentes", "sin_gestionar"]) {
      const panel = PANELES_OPERATIVOS.find((p) => p.metricas.some((m) => m.metricaId === id));
      expect(panel, `ninguna region del tablero pinta \`${id}\``).toBeDefined();
      expect(panel?.titulo.length).toBeGreaterThan(0);
    }
  });

  it("el catalogo de paneles no lee `estadoProduccion`", () => {
    // Direccion 2: aunque hoy las dos esten, nada impide que manana alguien anada el
    // filtro. El censo lee el FUENTE del catalogo (sin comentarios) y lo prohibe.
    const codigo = fs
      .readFileSync(RUTA_CATALOGO, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(codigo).not.toContain("estadoProduccion");
    expect(codigo).not.toContain("listarMetricas");
    // Y tampoco importa el catalogo de servidor (R25).
    expect(codigo).not.toContain("lib/analytics/metrics");
  });
});

describe("Feature 131 (R21) — todo panel corresponde a una metrica operativa real", () => {
  it("todo `metricaId` existe en el catalogo de la 135", () => {
    for (const id of metricasDelTablero()) {
      expect(getMetrica(id), `\`${id}\` no existe en el catalogo`).toBeDefined();
    }
  });

  it("todas son de `dominio: \"operativa\"`: el tablero operativo no pinta dinero", () => {
    for (const id of metricasDelTablero()) {
      expect(getMetrica(id)?.dominio, id).toBe("operativa");
    }
  });

  it("toda `desagregacion` declarada esta en los `granos` de sus metricas", () => {
    for (const panel of PANELES_OPERATIVOS) {
      if (!panel.desagregacion) continue;
      for (const metrica of panel.metricas) {
        expect(
          getMetrica(metrica.metricaId)?.granos,
          `${metrica.metricaId} no admite el grano ${panel.desagregacion}`,
        ).toContain(panel.desagregacion);
      }
    }
  });

  it("los ids de panel son unicos y hay como mucho seis paneles (D4)", () => {
    const ids = PANELES_OPERATIVOS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PANELES_OPERATIVOS.length).toBeLessThanOrEqual(6);
  });

  it("un donut solo se declara sobre metricas de conteo y con desagregacion", () => {
    // Sumar cocientes entre segmentos no significa nada; y un donut sin desagregar
    // tendria un solo segmento.
    for (const panel of PANELES_OPERATIVOS.filter((p) => p.grafica === "donut")) {
      expect(panel.desagregacion, panel.id).toBeDefined();
      for (const metrica of panel.metricas) {
        expect(getMetrica(metrica.metricaId)?.unidad, metrica.metricaId).toBe("conteo");
      }
    }
  });

  it("un panel con varias metricas no pasa del tope de series del paquete de la 130", () => {
    for (const panel of PANELES_OPERATIVOS) {
      expect(panel.metricas.length, panel.id).toBeLessThanOrEqual(5);
      expect(panel.metricas.length, panel.id).toBeGreaterThan(0);
    }
  });

  it("las metricas de un mismo panel comparten unidad: dos unidades en un eje no se leen", () => {
    for (const panel of PANELES_OPERATIVOS) {
      const unidades = new Set(panel.metricas.map((m) => getMetrica(m.metricaId)?.unidad));
      expect(unidades.size, panel.id).toBe(1);
    }
  });
});
