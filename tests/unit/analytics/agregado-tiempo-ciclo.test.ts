import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.2 — R3.
//
// ⚠ LOS DOS CUBOS ESTAN EN DIAS DISTINTOS, Y ESO ES INNEGOCIABLE.
//
// El test que ya existe, `operativa-tiempo-ciclo.test.ts:22-29`, usa dos ZONAS DEL MISMO DIA
// (`2026-08-01` las dos). Ese caso la 126 YA lo resuelve bien: dentro de un dia suma los
// cubos y divide al final. Quien copie aquella plantilla escribira un test que pasa
// exactamente igual con la implementacion mala —promediar los valores diarios— y creera
// haber probado algo sin haberlo probado, porque con un solo dia no hay nada que promediar.
//
// Aqui los cubos son `2026-08-01` y `2026-08-02`. La media de medias solo aparece cuando hay
// mas de un dia, asi que este es el unico sitio donde el error puede caer.

const RANGO_DOS_DIAS_CERRADOS = {
  rango: "personalizado",
  desde: "2026-08-01",
  hasta: "2026-08-02",
} as const;

describe("R3 · el tiempo de ciclo del periodo es Σ acum / Σ n", () => {
  it("el tiempo de ciclo del periodo es Σ acum / Σ n a traves de DIAS distintos", async () => {
    // Dia 1 (2026-08-01): 1000 s en 1 orden  -> media diaria 1000 s
    // Dia 2 (2026-08-02):  100 s en 9 ordenes -> media diaria  11,1 s
    //
    // Sumar antes de dividir: (1000 + 100) / (1 + 9) = 110 s  <- LO CORRECTO
    // Media de las medias diarias: (1000 + 11,1) / 2 = 505,6  <- LA MENTIRA
    const cubos = [
      cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(1000), segCicloN: 1 }),
      cubo({ fecha: "2026-08-02", segCicloAcum: BigInt(100), segCicloN: 9 }),
    ];
    // La desigualdad de volumen es lo que separa las dos formulas; y las FECHAS DISTINTAS son
    // lo que hace que este caso no lo cubra ya la 126.
    expect(cubos[0].fecha).not.toBe(cubos[1].fecha);

    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tiempo_ciclo", undefined, RANGO_DOS_DIAS_CERRADOS),
    );

    expect(agregado.cubos).toHaveLength(1);
    const periodo = agregado.cubos[0];
    expect(periodo.numerador).toBe(1100);
    expect(periodo.denominador).toBe(10);
    // La afirmacion...
    expect(periodo.valor).toBeCloseTo(110, 10);
    // ...y la NEGACION de la media de medias.
    expect(periodo.valor).not.toBeCloseTo(505.6, 1);
  });

  it("con `seg_ciclo_n` agregado 0 devuelve null, no 0 y no NaN", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 5, segCicloAcum: BigInt(0), segCicloN: 0 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tiempo_ciclo", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    expect(agregado.cubos[0].valor).toBeNull();
    expect(agregado.cubos[0].denominador).toBe(0);
  });

  it("y la serie de la 126 sobre el MISMO dato sigue dando dos puntos cuya media es la mentira", async () => {
    // Contraprueba explicita de por que el agregado no puede derivarse de la serie.
    const cubos = [
      cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(1000), segCicloN: 1 }),
      cubo({ fecha: "2026-08-02", segCicloAcum: BigInt(100), segCicloN: 9 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(
      consultaDe("tiempo_ciclo", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    const mediaDeMedias =
      serie.puntos.reduce((a, p) => a + (p.valor ?? 0), 0) / serie.puntos.length;
    expect(mediaDeMedias).toBeCloseTo(505.6, 1);
  });
});
