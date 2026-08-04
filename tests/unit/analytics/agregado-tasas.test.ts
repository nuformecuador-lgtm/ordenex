import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.1 — R2 (el central), R4, R6 y R7.
//
// LA RAZON DE SER DE ESTA FEATURE ESTA EN EL PRIMER CASO. El servicio de la 126 divide POR
// DIA y devuelve el cociente ya dividido; promediar despues esos cocientes es media de
// medias, que pondera igual un dia de 1 gestion y un dia de 1.000.
//
// ⚠ LOS DATOS ESTAN DESEQUILIBRADOS A PROPOSITO. Con volumenes iguales las dos formulas
// —sumar-antes-de-dividir y media de medias— COINCIDEN, y un test con datos equilibrados
// pasaria igual de verde con la implementacion mala: no probaria nada. Aqui el dia 1 aporta
// 1 gestion y el dia 2 aporta 99, de modo que las dos respuestas estan a un orden de
// magnitud de distancia.
//
// ⚠ Y LA ASERCION ES DOBLE: se afirma el valor correcto Y se NIEGA el de la media de medias.
// Sin la segunda mitad, una implementacion parecida pero mala pasaria.

const RANGO_DOS_DIAS_CERRADOS = {
  rango: "personalizado",
  desde: "2026-08-01",
  hasta: "2026-08-02",
} as const;

describe("R2 · la tasa del periodo suma antes de dividir", () => {
  it("con dias de volumen desigual la tasa del periodo suma antes de dividir y no promedia los dias", async () => {
    // Dia 1: 1 entrega de 1 gestion  -> tasa diaria 1,0000
    // Dia 2: 9 entregas de 99 gestiones -> tasa diaria 0,0909
    //
    // Sumar antes de dividir: (1 + 9) / (1 + 99) = 10/100 = 0,10   <- LO CORRECTO
    // Media de los valores diarios: (1,0000 + 0,0909) / 2 = 0,5455 <- LA MENTIRA
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 9, devoluciones: 90 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, RANGO_DOS_DIAS_CERRADOS),
    );

    expect(agregado.cubos).toHaveLength(1);
    const periodo = agregado.cubos[0];
    // Los componentes, a la vista y ya sumados: 10 sobre 100.
    expect(periodo.numerador).toBe(10);
    expect(periodo.denominador).toBe(100);
    // La afirmacion...
    expect(periodo.valor).toBeCloseTo(0.1, 10);
    // ...y la NEGACION, que es la mitad que caza a la media de medias.
    expect(periodo.valor).not.toBeCloseTo(0.5455, 2);
  });

  it("y el mismo dato leido como serie SIGUE dando dos cocientes diarios: el agregado no los promedia", async () => {
    // Contraprueba: la serie de la 126 no esta mal, esta a otro GRANO. Lo que estaba mal era
    // recomponer el total desde ella.
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 9, devoluciones: 90 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(
      consultaDe("tasa_entrega", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    expect(serie.puntos.map((p) => p.valor)).toHaveLength(2);
    const mediaDeMedias =
      serie.puntos.reduce((a, p) => a + (p.valor ?? 0), 0) / serie.puntos.length;
    expect(mediaDeMedias).toBeCloseTo(0.5455, 2);
  });
});

describe("R4 · denominador cero es `null`, nunca `0`", () => {
  it("denominador cero devuelve valor null con numerador y denominador en 0, no una tasa de 0", async () => {
    // Un dia sin NINGUNA gestion. «No se sabe» y «cero» no son el mismo dato: una tasa de
    // entrega de 0 significa que se gestiono y no se entrego nada, que es falso aqui.
    const cubos = [cubo({ fecha: "2026-08-01", ordenesCreadas: 7 })];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    const periodo = agregado.cubos[0];

    expect(periodo.valor).toBeNull();
    expect(periodo.valor).not.toBe(0);
    // D2 — los componentes viajan PRESENTES y en 0: asi el consumidor distingue «no hubo
    // gestiones en el periodo» (una afirmacion sobre la operacion) de «no hay dato».
    expect(periodo.numerador).toBe(0);
    expect(periodo.denominador).toBe(0);
    expect(Number.isNaN(periodo.numerador)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(periodo, "denominador")).toBe(true);
  });
});

describe("R6 · el denominador de las tres tasas es GESTIONES", () => {
  it("el denominador de las tres tasas es gestiones, no ordenes creadas", async () => {
    // 1000 ordenes creadas y solo 10 gestiones de resultado: si el denominador fuera
    // `ordenes_creadas` las tres tasas saldrian 100 veces mas pequenas y plausibles.
    const cubos = [
      cubo({
        fecha: "2026-08-01",
        ordenesCreadas: 1000,
        entregas: 5,
        devoluciones: 3,
        rechazos: 1,
        incidentes: 1,
      }),
    ];
    const rollup = rollupFalso(cubos);
    const servicio = servicioCon(rollup);

    const esperado: Record<string, number> = {
      tasa_entrega: 0.5,
      tasa_devolucion: 0.3,
      tasa_rechazo: 0.1,
    };
    for (const [metricaId, valor] of Object.entries(esperado)) {
      const agregado = await servicio.consultarAgregado(
        consultaDe(metricaId, undefined, RANGO_DOS_DIAS_CERRADOS),
      );
      const periodo = agregado.cubos[0];
      expect(periodo.denominador, `${metricaId}: denominador`).toBe(10);
      expect(periodo.denominador, `${metricaId}: no es ordenes_creadas`).not.toBe(1000);
      expect(periodo.valor, `${metricaId}: valor`).toBeCloseTo(valor, 10);
    }
  });
});

describe("R7 · el denominador de `primer_intento_ok` es ENTREGAS", () => {
  it("el denominador de primer_intento_ok es entregas", async () => {
    // 8 entregas (6 al primer intento) y 90 devoluciones: el denominador de gestiones seria
    // 98 y daria 0,061; el correcto es 8 y da 0,75. Los dos numeros son plausibles.
    const cubos = [cubo({ fecha: "2026-08-01", entregas: 8, primerIntentoOk: 6, devoluciones: 90 })];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("primer_intento_ok", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    const periodo = agregado.cubos[0];

    expect(periodo.numerador).toBe(6);
    expect(periodo.denominador).toBe(8);
    expect(periodo.denominador).not.toBe(98);
    expect(periodo.valor).toBeCloseTo(0.75, 10);
  });

  it("y suma los dos dias antes de dividir tambien aqui", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 1, primerIntentoOk: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 99, primerIntentoOk: 9 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("primer_intento_ok", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    expect(agregado.cubos[0].valor).toBeCloseTo(0.1, 10);
    expect(agregado.cubos[0].valor).not.toBeCloseTo(0.5455, 2);
  });
});
