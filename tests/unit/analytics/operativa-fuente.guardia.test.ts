import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import type { IAnaliticaOperativaVivaRepository } from "@/lib/interfaces/repositories/IAnaliticaOperativaVivaRepository";
import { consultaDe, cubo, rollupFalso, servicioCon, vivaFalso } from "./_fake-operativa";

// Feature 126 / T12.2 — R16 y R17. `clase: "snapshot"` <=> fuente ROLLUP es un INVARIANTE del
// catalogo (R5 de la 135), y la 126 lo hace estructural con dos repositorios en vez de
// sostenerlo con disciplina.
//
// R16: una metrica snapshot con rango cerrado se lee de `analytics_daily`. Servirla desde las
// tablas vivas (la mutacion: un `groupBy` sobre `gestion_orden` para `entregas`) daria numeros
// PARECIDOS pero no iguales —el rollup congela el estatus al corte— y una consulta cara por
// request sobre tablas que crecen sin techo, que es lo que las features 123-125 existen para
// evitar.
//
// R17: `aging_por_estado` es la UNICA metrica `live` del catalogo y NO puede leerse del
// rollup: mide la antiguedad AL INSTANTE, y el rollup solo tiene cortes de dias cerrados.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LECTOR_ROLLUP = "lib/repositories/AnaliticaOperativaRollupRepository.ts";
const LECTOR_VIVO = "lib/repositories/AnaliticaOperativaVivaRepository.ts";

function soloCodigo(rel: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const RANGO_CERRADO = {
  rango: "personalizado" as const,
  desde: "2026-07-20",
  hasta: "2026-07-22",
};

/** Repositorio vivo que EXPLOTA: si una metrica snapshot lo tocara, el test lo veria. */
const VIVA_PROHIBIDA: IAnaliticaOperativaVivaRepository = {
  async agingPorEstado(): Promise<never> {
    throw new Error("una metrica SNAPSHOT toco las tablas vivas");
  },
  async cubosDelDiaEnCurso(): Promise<never> {
    throw new Error("una metrica SNAPSHOT toco las tablas vivas");
  },
};

describe("R16 · una metrica snapshot con rango cerrado no toca las tablas vivas", () => {
  it("una metrica snapshot con rango cerrado no toca las tablas vivas", async () => {
    const snapshot = listarMetricas({ dominio: "operativa" }).filter((m) => m.clase === "snapshot");
    expect(snapshot.length, "el catalogo no tiene metricas snapshot: el guardia seria vacio").toBe(
      14,
    );
    for (const metrica of snapshot) {
      const serie = await servicioCon(
        rollupFalso([cubo({ fecha: "2026-07-21", entregas: 1 })]),
        VIVA_PROHIBIDA,
      ).consultar(consultaDe(metrica.id, undefined, RANGO_CERRADO));
      expect(serie.metricaId, metrica.id).toBe(metrica.id);
    }
  });

  it("y el lector del rollup NO consulta ninguna tabla viva", () => {
    const codigo = soloCodigo(LECTOR_ROLLUP);
    for (const tabla of ["gestion_orden", "orden_historial_estado", "gestionOrden"]) {
      expect(codigo, `${LECTOR_ROLLUP} nombra ${tabla} en codigo`).not.toContain(tabla);
    }
  });
});

describe("R17 · la unica metrica live no lee el rollup", () => {
  it("la unica metrica live no lee el rollup", async () => {
    const live = listarMetricas({ dominio: "operativa" }).filter((m) => m.clase === "live");
    expect(live.map((m) => m.id)).toEqual(["aging_por_estado"]);

    // El rollup falso ANOTA sus llamadas: si `aging_por_estado` se sirviera de `analytics_daily`
    // (la mutacion de R17), `agregarCubos` tendria una llamada.
    const rollup = rollupFalso([cubo({ fecha: "2026-08-03", ordenesEstadoStock: 99 })]);
    const serie = await servicioCon(
      rollup,
      vivaFalso({
        aging: [
          {
            estatusId: "e-reparto",
            zonaId: "z1",
            tiendaId: "t1",
            ordenes: 2,
            segEnEstadoAcum: BigInt(600),
          },
        ],
      }),
    ).consultar(consultaDe("aging_por_estado"));

    expect(rollup.llamadasAgregar, "el aging consulto `analytics_daily`").toEqual([]);
    // Y devuelve el promedio del aging, no el 99 del rollup.
    expect(serie.puntos[0].valor).toBe(300);
  });

  it("el lector VIVO no nombra `analytics_daily` en codigo", () => {
    const codigo = soloCodigo(LECTOR_VIVO);
    expect(codigo).not.toContain("analytics_daily");
    expect(codigo).not.toContain("analyticsDaily");
  });

  it("el invariante del catalogo se conserva: snapshot <=> fuente rollup", () => {
    // Si alguien anadiera una metrica operativa `snapshot` con fuente de tabla viva, la 126 la
    // serviria del rollup y devolveria vacio en silencio. Aqui se pone rojo antes.
    for (const m of listarMetricas({ dominio: "operativa" })) {
      const esRollup = m.fuente.tipo === "rollup";
      expect(m.clase === "snapshot", m.id).toBe(esRollup);
    }
  });
});
