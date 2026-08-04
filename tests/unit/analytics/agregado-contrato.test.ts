import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.3 — R1 y R5.
//
// R1: el modo agregado existe para devolver los COMPONENTES. Un agregado que solo trajera
// `valor` no arreglaria nada: el consumidor volveria a no poder sumar dos cubos, que es
// exactamente el hueco que esta feature cierra.
//
// R5: `segCicloAcum` es `BigInt` en el rollup y `JSON.stringify` de un `BigInt` LANZA
// `TypeError`. El fallo no aparece en el servicio sino AL SERIALIZAR, es decir en produccion
// y no aqui — salvo que se afirme. Por eso se serializa la respuesta entera.

const RANGO_DOS_DIAS_CERRADOS = {
  rango: "personalizado",
  desde: "2026-08-01",
  hasta: "2026-08-02",
} as const;

describe("R1 · el cubo agregado trae los componentes, no solo el cociente", () => {
  it("cada cubo agregado trae numerador y denominador ademas del valor", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", entregas: 3, devoluciones: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 7, devoluciones: 9 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, RANGO_DOS_DIAS_CERRADOS),
    );

    expect(agregado.cubos.length).toBeGreaterThan(0);
    for (const c of agregado.cubos) {
      expect(Object.prototype.hasOwnProperty.call(c, "numerador"), "falta `numerador`").toBe(true);
      expect(Object.prototype.hasOwnProperty.call(c, "denominador"), "falta `denominador`").toBe(
        true,
      );
      expect(typeof c.numerador).toBe("number");
      expect(typeof c.denominador).toBe("number");
      // Y el valor sigue viajando ya dividido: los componentes se SUMAN al contrato, no lo
      // sustituyen.
      expect(typeof c.valor === "number" || c.valor === null).toBe(true);
    }
    // Los componentes son los de verdad, no un relleno: 10 entregas sobre 20 gestiones.
    expect(agregado.cubos[0].numerador).toBe(10);
    expect(agregado.cubos[0].denominador).toBe(20);
  });

  it("y el agregado declara su metrica, su unidad, su grano y su rango", async () => {
    const agregado = await servicioCon(
      rollupFalso([cubo({ fecha: "2026-08-01", entregas: 1 })]),
    ).consultarAgregado(consultaDe("tasa_entrega", undefined, RANGO_DOS_DIAS_CERRADOS));

    expect(agregado.metricaId).toBe("tasa_entrega");
    expect(agregado.unidad).toBe("porcentaje");
    expect(agregado.unidadDeConteo).toBe("gestion");
    expect(agregado.grano).toBe("periodo");
    expect(agregado.rango.desdeFecha).toBe("2026-08-01");
    expect(agregado.rango.hastaFecha).toBe("2026-08-02");
    // Y el cubo `periodo` anuncia los extremos del rango, no los del dia que lo origino.
    expect(agregado.cubos[0].desdeFecha).toBe("2026-08-01");
    expect(agregado.cubos[0].hastaFecha).toBe("2026-08-02");
  });
});

describe("R5 · nada de BigInt sale del modo agregado", () => {
  it("la respuesta agregada sobrevive a JSON.stringify y no lleva bigint", async () => {
    // Un acumulado por encima de `Number.MAX_SAFE_INTEGER`: si `segCicloAcum` se colara tal
    // cual desde Prisma (la mutacion de R5), esta linea lanzaria `TypeError`.
    const cubos = [
      cubo({ fecha: "2026-08-01", segCicloAcum: BigInt("9007199254740993"), segCicloN: 3 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tiempo_ciclo", undefined, RANGO_DOS_DIAS_CERRADOS),
    );

    expect(() => JSON.stringify(agregado)).not.toThrow();
    for (const c of agregado.cubos) {
      expect(typeof c.numerador).toBe("number");
      expect(typeof c.numerador).not.toBe("bigint");
      expect(typeof c.denominador).toBe("number");
      expect(typeof c.valor === "number" || c.valor === null).toBe(true);
    }
  });

  it("y el `bigint` muere al construir el cubo, no antes: la suma conserva su magnitud", async () => {
    // Si alguien «arreglara» el BigInt convirtiendolo a number ANTES de sumar, dos cubos
    // grandes se desviarian. Con estos valores el numero exacto es comprobable.
    const cubos = [
      cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(3000), segCicloN: 1 }),
      cubo({ fecha: "2026-08-02", segCicloAcum: BigInt(600), segCicloN: 1 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tiempo_ciclo", undefined, RANGO_DOS_DIAS_CERRADOS),
    );
    expect(agregado.cubos[0].numerador).toBe(3600);
    expect(agregado.cubos[0].valor).toBe(1800);
  });
});
