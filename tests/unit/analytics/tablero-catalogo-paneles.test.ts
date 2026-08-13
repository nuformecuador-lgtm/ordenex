import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

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
  // REEXPRESADO POR LA FICHA 175 (T5.1, Q4/⟨D11⟩ de `progress/decision_175.md`, 2026-08-03).
  //
  // Este bloque afirmaba el VALOR concreto del campo: que `incidentes` y `sin_gestionar`
  // eran `estadoProduccion: "declarada"`. Ese valor era la mentira que la 175 corrige (las
  // dos SI tienen productor: columna en el rollup la primera, derivada del embudo la
  // segunda), asi que el caso quedaba rojo por diseno. Lo que R21 protege NO es ese valor:
  // es que `catalogo-paneles.ts` **no decida los paneles filtrando por `estadoProduccion`**
  // —un campo que dice si hay productor, no si el panel se pinta—. Por eso ahora la
  // independencia se comprueba sin nombrar ningun valor del catalogo real.
  it("el tablero declara panel para `incidentes` y `sin_gestionar`, que la 126 sirve", () => {
    // D6 — direccion 1: las dos metricas que motivaron la regla siguen llegando a pantalla.
    // `incidentes` tiene columna en el rollup y es el cuarto termino del denominador de las
    // tres tasas; `sin_gestionar` se deriva del embudo. Este caso NO mira `estadoProduccion`
    // (eso es la direccion 2, el caso de abajo): solo exige presencia.
    //
    // MUTACION QUE ESTE CASO MATA: quitar `incidentes` del panel de gestiones o borrar el
    // panel `sin-gestionar` de `PANELES_OPERATIVOS`.
    const metricas = metricasDelTablero();

    expect(metricas, "`incidentes` la sirve la 126 y no tiene panel").toContain("incidentes");
    expect(metricas, "`sin_gestionar` la sirve la 126 y no tiene panel").toContain(
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

  it("la lista de paneles no cambia si el catalogo marca TODO `declarada`", async () => {
    // D6 — direccion 2, la que mata la mutacion, y AHORA SIN AFIRMAR NINGUN VALOR REAL:
    // se re-importa `catalogo-paneles` con el catalogo MOCKEADO de forma que todas las
    // metricas figuren `estadoProduccion: "declarada"`, y se exige que la lista de paneles
    // salga identica a la real. Si el modulo derivase o filtrase por ese campo, con este
    // catalogo de mentira se quedaria vacio (o distinto) y el caso muere.
    //
    // MUTACION QUE ESTE CASO MATA (aplicada, roja y revertida): en `catalogo-paneles.ts`,
    //   export function metricasDelTablero() {
    //     return [...new Set(PANELES_OPERATIVOS
    //       .filter((p) => p.metricas.every(
    //         (m) => getMetrica(m.metricaId)?.estadoProduccion === "producida"))
    //       .flatMap((p) => p.metricas.map((m) => m.metricaId)))];
    //   }
    // (o su variante derivada: `listarMetricas({ estadoProduccion: "producida" }).map(m => m.id)`).
    // Con el catalogo real —hoy entero `producida`— ese filtro no se notaria; con este, si.
    const esperado = metricasDelTablero();
    const panelesEsperados = PANELES_OPERATIVOS.map((p) => p.id);

    vi.resetModules();
    vi.doMock("@/lib/analytics/metrics", async () => {
      const real = await vi.importActual<typeof import("@/lib/analytics/metrics")>(
        "@/lib/analytics/metrics",
      );
      const enmascarar = <T extends { estadoProduccion: string }>(m: T): T => ({
        ...m,
        estadoProduccion: "declarada",
      });
      return {
        ...real,
        METRICAS: real.METRICAS.map(enmascarar),
        getMetrica: (id: string) => {
          const m = real.getMetrica(id);
          return m ? enmascarar(m) : undefined;
        },
        listarMetricas: (filtro?: Parameters<typeof real.listarMetricas>[0]) => {
          const { estadoProduccion, ...resto } = filtro ?? {};
          const base = real.listarMetricas(resto).map(enmascarar);
          return estadoProduccion === "producida" ? [] : base;
        },
      };
    });

    try {
      // Autocomprobacion del montaje: si el mock no se aplicara, todo lo de abajo pasaria
      // por vacio y el caso seria un adorno.
      const catalogoMockeado = await import("@/lib/analytics/metrics");
      expect(catalogoMockeado.getMetrica("incidentes")?.estadoProduccion).toBe("declarada");
      expect(catalogoMockeado.listarMetricas({ estadoProduccion: "producida" })).toEqual([]);

      const bajoMock = await import(
        "@/app/(app)/analitica/_components/operativo/catalogo-paneles"
      );
      expect(
        bajoMock.metricasDelTablero(),
        "la lista de metricas del tablero depende de `estadoProduccion`",
      ).toEqual(esperado);
      expect(
        bajoMock.PANELES_OPERATIVOS.map((p) => p.id),
        "la lista de paneles depende de `estadoProduccion`",
      ).toEqual(panelesEsperados);
    } finally {
      vi.doUnmock("@/lib/analytics/metrics");
      vi.resetModules();
    }
  });

  it("el catalogo de paneles no lee `estadoProduccion`", () => {
    // Direccion 2: aunque hoy las dos esten, nada impide que manana alguien anada el
    // filtro. El censo lee el FUENTE del catalogo (sin comentarios) y lo prohibe.
    const codigo = quitarComentarios(fs.readFileSync(RUTA_CATALOGO, "utf8"));
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

  it("la unidad declarada por cada metrica del catalogo de paneles es la que declara el catalogo de metricas", () => {
    // Feature 182 (R9/D4) — el catalogo de paneles DECLARA la unidad porque no puede
    // importar el de servidor (R25), y esa unidad decide si el panel pide el modo agregado
    // (R8). Una unidad mal declarada no rompe nada visible: pediria el agregado de un
    // `conteo` —que el borde rechaza con `validation_error`— o dejaria a una tasa sin cifra.
    // El vinculo se ancla AQUI, donde `getMetrica()` si se puede leer.
    //
    // Recorre TODAS las metricas del catalogo de paneles, no solo las dos de tasa/tiempo:
    // una metrica nueva mal declarada pasaria sin ruido.
    let comprobadas = 0;
    for (const panel of PANELES_OPERATIVOS) {
      for (const metrica of panel.metricas) {
        expect(
          metrica.unidad,
          `${metrica.metricaId} declara \`${metrica.unidad}\` en el catalogo de paneles`,
        ).toBe(getMetrica(metrica.metricaId)?.unidad);
        comprobadas += 1;
      }
    }
    // Y no puede quedar verde por vacio.
    expect(comprobadas).toBe(PANELES_OPERATIVOS.flatMap((p) => p.metricas).length);
    expect(comprobadas).toBeGreaterThan(5);
  });

  it("las metricas de un mismo panel comparten unidad: dos unidades en un eje no se leen", () => {
    for (const panel of PANELES_OPERATIVOS) {
      const unidades = new Set(panel.metricas.map((m) => getMetrica(m.metricaId)?.unidad));
      expect(unidades.size, panel.id).toBe(1);
    }
  });
});
