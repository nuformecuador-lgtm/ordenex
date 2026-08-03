import { describe, it, expect } from "vitest";
import { AHORA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.1 + T3.1 — R26 (una consulta por tablero) y R31 (determinismo).

describe("R26 · una agregacion por grano, no una por metrica", () => {
  it("un tablero de cinco metricas hace una sola consulta al rollup", async () => {
    // Las cinco comparten el grano del rollup. Si el servicio llamara al repositorio una vez
    // POR METRICA dentro de un bucle (la mutacion de R26), este conteo seria 5 por metrica.
    const cubos = [cubo({ fecha: "2026-08-01", entregas: 3, devoluciones: 1 })];
    for (const metricaId of [
      "entregas",
      "devoluciones",
      "rechazos",
      "tasa_entrega",
      "tiempo_ciclo",
    ]) {
      const rollup = rollupFalso(cubos);
      await servicioCon(rollup).consultar(consultaDe(metricaId));
      expect(rollup.llamadasAgregar.length, metricaId).toBe(1);
    }
  });

  it("y esa unica consulta trae las diez medidas, no la columna de la metrica pedida", async () => {
    // La contracara: si el repositorio proyectara solo la medida de la metrica, cada metrica
    // necesitaria su propia consulta y R26 seria irrealizable. El contrato `CuboRollup` lleva
    // las diez, y el servicio elige. Se comprueba pidiendo DOS metricas de medidas distintas
    // sobre los MISMOS cubos: las dos tienen que salir con su numero.
    const cubos = [cubo({ fecha: "2026-08-01", entregas: 7, devoluciones: 2 })];
    const entregas = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("entregas"));
    const devoluciones = await servicioCon(rollupFalso(cubos)).consultar(
      consultaDe("devoluciones"),
    );
    expect(entregas.puntos[0].valor).toBe(7);
    expect(devoluciones.puntos[0].valor).toBe(2);
  });
});

describe("R31 · determinismo: el reloj se inyecta y no se construye", () => {
  it("dos llamadas con el mismo reloj inyectado dan el mismo resultado", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 4, devoluciones: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 2, rechazos: 3 }),
    ];
    const servicio = servicioCon(rollupFalso(cubos));
    const consulta = consultaDe("tasa_entrega", undefined, { rango: "semana" });
    const a = await servicio.consultar(consulta);
    const b = await servicio.consultar(consulta);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("el reloj INYECTADO es el que manda: mover `now` mueve la respuesta", async () => {
    // Si el servicio usara `new Date()` por dentro (la mutacion de R31), estas dos llamadas
    // darian lo MISMO pese a tener relojes distintos, porque el reloj inyectado no se usaria.
    // Lo observable es la cobertura: con el reloj en 2026-07-10 el rango `dia` cae bajo el
    // horizonte del historial y la fecha sale como no comparable; con `AHORA`, no.
    const rollup = rollupFalso([]);
    const antiguo = new Date("2026-07-10T15:00:00.000Z");
    const enElPasado = await servicioCon(rollup, undefined, undefined, antiguo).consultar(
      consultaDe("entregas", undefined, { rango: "dia" }, antiguo),
    );
    const hoy = await servicioCon(rollup).consultar(consultaDe("entregas"));
    expect(enElPasado.cobertura.fechasNoComparables).toEqual(["2026-07-10"]);
    expect(hoy.cobertura.fechasNoComparables).toEqual([]);
  });

  it("el rango que viaja en la respuesta es el resuelto por la 135, no uno recalculado", async () => {
    const consulta = consultaDe("entregas");
    const serie = await servicioCon(rollupFalso([])).consultar(consulta);
    expect(serie.rango).toEqual(consulta.rango);
    expect(serie.rango.hastaFecha).toBe("2026-08-03");
    expect(AHORA.toISOString()).toBe("2026-08-03T15:00:00.000Z");
  });
});
