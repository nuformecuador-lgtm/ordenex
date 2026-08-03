import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.3 — R14 y la parte de R30 que le toca.
//
// Dos fallos distintos y los dos silenciosos:
//   (a) promediar promedios. `seg_ciclo_acum`/`seg_ciclo_n` viajan SEPARADOS justo para que la
//       division sea lo ultimo; dividir por fila y luego promediar da un numero plausible que
//       pondera mal los cubos pequenos.
//   (b) dejar escapar un `BigInt`. `seg_ciclo_acum` es `BigInt` en el rollup y
//       `JSON.stringify` de un `BigInt` LANZA `TypeError` (documentado en
//       `IAnaliticaRollupService.ts`): el fallo no aparece en el servicio sino al serializar
//       la respuesta, es decir en produccion y no aqui — salvo que se afirme.

describe("R14 · el promedio de ciclo suma antes de dividir", () => {
  it("el promedio de ciclo suma numerador y denominador antes de dividir", async () => {
    // Cubo A: 100 s en 1 orden (media 100). Cubo B: 900 s en 9 ordenes (media 100).
    // Aqui coinciden a proposito... no: se eligen distintos para que la diferencia se vea.
    // A: 1000 s / 1 orden = 1000. B: 100 s / 9 ordenes = 11.1.
    // Correcto: (1000 + 100) / (1 + 9) = 110.
    // Promedio de promedios: (1000 + 11.1) / 2 = 505.6.
    const cubos = [
      cubo({ fecha: "2026-08-01", zonaId: "z1", segCicloAcum: BigInt(1000), segCicloN: 1 }),
      cubo({ fecha: "2026-08-01", zonaId: "z2", segCicloAcum: BigInt(100), segCicloN: 9 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tiempo_ciclo"));
    expect(serie.puntos[0].valor).toBeCloseTo(110, 10);
    expect(serie.puntos[0].valor).not.toBeCloseTo(505.55, 1);
  });

  it("con `seg_ciclo_n` agregado 0 devuelve null, no 0 y no NaN", async () => {
    const cubos = [cubo({ fecha: "2026-08-01", entregas: 5, segCicloAcum: BigInt(0), segCicloN: 0 })];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tiempo_ciclo"));
    expect(serie.puntos[0].valor).toBeNull();
  });
});

describe("R14/R30 · nada de BigInt sale del servicio", () => {
  it("la respuesta no contiene BigInt", async () => {
    // `JSON.stringify` de un `BigInt` lanza `TypeError: Do not know how to serialize a BigInt`.
    // Serializar la respuesta ES la afirmacion: si `segCicloAcum` se colara tal cual desde
    // Prisma (la mutacion de R30), esta linea lanzaria.
    const cubos = [
      cubo({ fecha: "2026-08-01", segCicloAcum: BigInt("9007199254740993"), segCicloN: 3 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tiempo_ciclo"));
    expect(() => JSON.stringify(serie)).not.toThrow();
    for (const punto of serie.puntos) {
      expect(typeof punto.valor).not.toBe("bigint");
      expect(typeof punto.valor === "number" || punto.valor === null).toBe(true);
    }
  });

  it("y el `bigint` muere en la division, no antes: el numerador conserva su magnitud", async () => {
    // 3600 s en 2 ordenes = 1800 s de media. Si alguien «arreglara» el BigInt convirtiendolo a
    // number ANTES de sumar, con dos cubos grandes el resultado se desviaria; con estos
    // valores el numero exacto es comprobable.
    const cubos = [
      cubo({ fecha: "2026-08-01", zonaId: "z1", segCicloAcum: BigInt(3000), segCicloN: 1 }),
      cubo({ fecha: "2026-08-01", zonaId: "z2", segCicloAcum: BigInt(600), segCicloN: 1 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tiempo_ciclo"));
    expect(serie.puntos[0].valor).toBe(1800);
  });
});
