import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.4 — R8, EL ANCLA.
//
// Sobre un rango de UN UNICO DIA CERRADO, el agregado y la serie de la 126 tienen que dar el
// MISMO numero. Es lo que impide que el modo agregado invente una formula paralela —o, peor,
// que DERIVE de la serie— sin que nadie lo note hasta el primer rango largo.
//
// ⚠ LOS DOS CAMINOS USAN EL MISMO DOBLE DE REPOSITORIO, y eso es la mitad del test: los dos
// piden los cubos al MISMO metodo (`agregarCubos`) con los MISMOS granos, luego con la misma
// clave de cache. Sobre un dia parten de las mismas filas y solo pueden diferir en la
// ARITMETICA, que es exactamente lo unico que aqui se mide. Con dobles distintos la igualdad
// dejaria de ser estructural y pasaria a ser una coincidencia que hay que vigilar.

const UN_DIA_CERRADO = {
  rango: "personalizado",
  desde: "2026-08-01",
  hasta: "2026-08-01",
} as const;

/** Varios cubos del MISMO dia: los dos caminos tienen que fundirlos antes de dividir. */
const CUBOS = [
  cubo({
    fecha: "2026-08-01",
    zonaId: "z1",
    entregas: 7,
    devoluciones: 2,
    rechazos: 1,
    incidentes: 1,
    primerIntentoOk: 5,
    segCicloAcum: BigInt(4000),
    segCicloN: 3,
  }),
  cubo({
    fecha: "2026-08-01",
    zonaId: "z2",
    entregas: 3,
    devoluciones: 11,
    rechazos: 0,
    incidentes: 2,
    primerIntentoOk: 1,
    segCicloAcum: BigInt(500),
    segCicloN: 7,
  }),
];

const METRICAS = [
  "tasa_entrega",
  "tasa_devolucion",
  "tasa_rechazo",
  "primer_intento_ok",
  "tiempo_ciclo",
];

describe("R8 · sobre un dia cerrado, agregado y serie coinciden", () => {
  it("sobre un unico dia cerrado el agregado coincide con el punto de la serie de la 126", async () => {
    for (const metricaId of METRICAS) {
      // EL MISMO doble, y ademas el MISMO servicio, para los dos caminos.
      const servicio = servicioCon(rollupFalso(CUBOS));
      const consulta = consultaDe(metricaId, undefined, UN_DIA_CERRADO);

      const serie = await servicio.consultar(consulta);
      const agregado = await servicio.consultarAgregado(consulta);

      expect(serie.puntos, `${metricaId}: la serie del dia`).toHaveLength(1);
      expect(agregado.cubos, `${metricaId}: el cubo del periodo`).toHaveLength(1);

      const dePunto = serie.puntos[0].valor;
      const deCubo = agregado.cubos[0].valor;
      expect(deCubo, `${metricaId}: agregado vs serie`).not.toBeNull();
      expect(deCubo as number, `${metricaId}: agregado vs serie`).toBeCloseTo(
        dePunto as number,
        10,
      );
    }
  });

  it("y los dos caminos piden los cubos al MISMO metodo con los MISMOS granos", async () => {
    // La igualdad de arriba solo es ESTRUCTURAL si esto se cumple. Si el agregado consultara
    // por otra via —o pidiera otros granos— podria coincidir hoy y divergir manana sin que
    // nada avisara.
    const rollup = rollupFalso(CUBOS);
    const servicio = servicioCon(rollup);
    const consulta = consultaDe("tasa_entrega", undefined, UN_DIA_CERRADO);

    await servicio.consultar(consulta);
    await servicio.consultarAgregado(consulta);

    expect(rollup.llamadasAgregar).toHaveLength(2);
    expect(rollup.llamadasAgregar[0].granos).toEqual(rollup.llamadasAgregar[1].granos);
    expect(rollup.llamadasAgregar[0].consulta).toBe(rollup.llamadasAgregar[1].consulta);
  });

  it("y coinciden tambien desagregando por zona, cubo a cubo", async () => {
    const servicio = servicioCon(rollupFalso(CUBOS));
    const consulta = consultaDe("tasa_entrega", undefined, UN_DIA_CERRADO);

    const serie = await servicio.consultar(consulta, "zona");
    const agregado = await servicio.consultarAgregado(consulta, { desagregacion: "zona" });

    const porSerie = new Map(serie.puntos.map((p) => [p.dimension, p.valor]));
    expect(porSerie.size).toBe(2);
    for (const c of agregado.cubos) {
      expect(c.valor as number).toBeCloseTo(porSerie.get(c.dimension) as number, 10);
    }
  });
});
