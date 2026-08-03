import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas, sonSumables, type MetricaId } from "@/lib/analytics/metrics";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.6 — R11. D10/R36 de la 135: dos metricas se pueden sumar SOLO si cuentan lo
// mismo. `sonSumables("entregas", "ordenes_creadas") === false` porque una orden reprogramada
// y luego entregada aporta DOS gestiones y UNA orden.
//
// La tentacion concreta es una serie «total gestionado» que sume `entregas + ordenes_creadas`:
// da un numero, la grafica lo pinta y nadie sabe que unidad tiene. Es la mutacion de R11.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICIO = "lib/services/AnaliticaOperativaService.ts";

function soloCodigo(rel: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Las medidas del rollup, agrupadas por la `unidadDeConteo` de la metrica que las encarna.
 * Sumar dos medidas de GRUPOS distintos dentro de una misma expresion es la infraccion.
 */
const MEDIDA_DE_UNIDAD: Readonly<Record<string, "gestion" | "orden" | "tiempo">> = {
  entregas: "gestion",
  devoluciones: "gestion",
  rechazos: "gestion",
  reprogramaciones: "gestion",
  incidentes: "gestion",
  primerIntentoOk: "gestion",
  ordenesCreadas: "orden",
  ordenesEstadoStock: "orden",
  segCicloAcum: "tiempo",
  segCicloN: "tiempo",
};

/** Expresiones `m.<medida> + m.<medida>` (o con `+=`) que cruzan unidades. */
function sumasQueCruzanUnidades(codigo: string): string[] {
  const hallazgos: string[] = [];
  const patron = /m\.(\w+)\s*\+\s*m\.(\w+)/g;
  for (const m of codigo.matchAll(patron)) {
    const [, a, b] = m;
    const ua = MEDIDA_DE_UNIDAD[a];
    const ub = MEDIDA_DE_UNIDAD[b];
    if (ua && ub && ua !== ub) hallazgos.push(`${a} + ${b} (${ua} vs ${ub})`);
  }
  return hallazgos;
}

describe("R11 · ninguna composicion del servicio suma metricas no sumables", () => {
  it("ninguna composicion del servicio suma metricas no sumables", () => {
    const hallazgos = sumasQueCruzanUnidades(soloCodigo(SERVICIO));
    expect(
      hallazgos,
      "una orden reprogramada y luego entregada aporta DOS gestiones y UNA orden: sumarlas " +
        "produce un numero sin unidad. Hallazgos: " + hallazgos.join(", "),
    ).toEqual([]);
  });

  it("el detector DISCRIMINA: caza el «total gestionado» y respeta el denominador legitimo", () => {
    // La mutacion, tal cual.
    expect(sumasQueCruzanUnidades("const total = m.entregas + m.ordenesCreadas;")).not.toEqual([]);
    // El denominador de las tasas suma CUATRO medidas de la misma unidad: es legitimo y no debe
    // salir marcado, o el guardia seria ruido que alguien acabaria apagando.
    expect(
      sumasQueCruzanUnidades("const den = m.entregas + m.devoluciones + m.rechazos + m.incidentes;"),
    ).toEqual([]);
  });

  it("y el catalogo confirma que esas dos NO son sumables", () => {
    expect(sonSumables("entregas" as MetricaId, "ordenes_creadas" as MetricaId)).toBe(false);
    expect(sonSumables("entregas" as MetricaId, "devoluciones" as MetricaId)).toBe(true);
  });
});

describe("R11 · cada serie declara UNA unidad, y sus puntos son de esa unidad", () => {
  it("ninguna serie mezcla: la unidad de la serie es la del catalogo, sin excepcion", async () => {
    // La contracara funcional del censo. Si el servicio compusiera una serie sumando dos
    // metricas, tendria que elegir una `unidadDeConteo` para el resultado — y esa eleccion
    // seria una mentira. Aqui se afirma que no hay ninguna serie que no venga del catalogo.
    const ids = listarMetricas({ dominio: "operativa" }).map((m) => m.id);
    for (const id of ids) {
      const serie = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
        consultaDe(id),
      );
      expect(ids, `la serie ${serie.metricaId} no corresponde a ninguna metrica`).toContain(
        serie.metricaId,
      );
    }
  });

  it("no existe ninguna metrica «total gestionado» ni equivalente en el catalogo", () => {
    const ids = listarMetricas().map((m) => m.id);
    for (const inventada of ["total_gestionado", "total", "todo", "suma_operativa"]) {
      expect(ids).not.toContain(inventada);
    }
  });
});
