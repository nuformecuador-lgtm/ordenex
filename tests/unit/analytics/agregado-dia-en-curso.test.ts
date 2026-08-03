import { describe, it, expect } from "vitest";
import { AHORA, HOY_CR, consultaDe, cubo, rollupFalso, servicioCon, vivaFalso } from "./_fake-operativa";

// Feature 176 / T4.5 (segunda mitad) — R10 y D4.
//
// EL DIA EN CURSO ENTRA. Los tres presets no personalizados incluyen hoy
// (`lib/analytics/ranges.ts`), asi que excluirlo produciria —EN LA VISTA POR DEFECTO— un
// agregado que ignora en silencio el dia que el usuario esta mirando. La regla es la misma
// que la 126 aplica al punto de la serie: se pinta, y se anuncia parcial con su corte.
//
// La otra mitad importa igual: un cubo que solo contiene dias CERRADOS no puede llevar la
// marca. Si la llevara siempre, «parcial» dejaria de significar nada.

const CUBOS_DEL_DIA_EN_CURSO = {
  cubos: [cubo({ fecha: HOY_CR, entregas: 5, devoluciones: 5 })],
  entregasVigentes: [],
};

describe("R10 · el cubo que contiene hoy viaja parcial", () => {
  it("el cubo que contiene el dia en curso viaja parcial con su corteAt, y el que solo tiene dias cerrados no", async () => {
    // Grano `semana` sobre un rango que cruza el lunes: `2026-08-01` (sabado) y `2026-08-02`
    // (domingo) caen en la semana del lunes `2026-07-27`, toda ella CERRADA; `2026-08-03` es
    // hoy y ancla su propia semana. Dos cubos, uno de cada clase, en la misma respuesta.
    const cerrados = [
      cubo({ fecha: "2026-08-01", entregas: 1, devoluciones: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 2, devoluciones: 2 }),
    ];
    const agregado = await servicioCon(
      rollupFalso(cerrados),
      vivaFalso({ intradia: CUBOS_DEL_DIA_EN_CURSO }),
    ).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: HOY_CR,
      }),
      { grano: "semana" },
    );

    const porSemana = new Map(agregado.cubos.map((c) => [c.fecha, c]));
    expect([...porSemana.keys()].sort()).toEqual(["2026-07-27", "2026-08-03"]);

    const semanaCerrada = porSemana.get("2026-07-27");
    const semanaDeHoy = porSemana.get("2026-08-03");

    // La que contiene hoy: MARCADA y con su corte.
    expect(semanaDeHoy?.parcial).toBe(true);
    expect(semanaDeHoy?.corteAt).toBe(AHORA.toISOString());

    // La de solo dias cerrados: SIN marca. Si la llevara, las dos serian indistinguibles.
    expect(semanaCerrada?.parcial).toBeUndefined();
    expect(semanaCerrada?.corteAt).toBeUndefined();
  });

  it("con grano `periodo`, un rango que incluye hoy da un cubo unico y PARCIAL", async () => {
    const agregado = await servicioCon(
      rollupFalso([cubo({ fecha: "2026-08-01", entregas: 1, devoluciones: 1 })]),
      vivaFalso({ intradia: CUBOS_DEL_DIA_EN_CURSO }),
    ).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: HOY_CR,
      }),
    );

    expect(agregado.cubos).toHaveLength(1);
    expect(agregado.cubos[0].parcial).toBe(true);
    expect(agregado.cubos[0].corteAt).toBe(AHORA.toISOString());
    // Y el dia en curso SUMA de verdad: 1 + 5 entregas sobre 2 + 10 gestiones.
    expect(agregado.cubos[0].numerador).toBe(6);
    expect(agregado.cubos[0].denominador).toBe(12);
  });

  it("un rango de solo dias cerrados NO marca parcial y no inventa un corte", async () => {
    const agregado = await servicioCon(
      rollupFalso([cubo({ fecha: "2026-08-01", entregas: 1, devoluciones: 1 })]),
      vivaFalso({ intradia: CUBOS_DEL_DIA_EN_CURSO }),
    ).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
    );

    expect(agregado.cubos).toHaveLength(1);
    expect(agregado.cubos[0].parcial).toBeUndefined();
    expect(agregado.cubos[0].corteAt).toBeUndefined();
    // El repositorio vivo ni siquiera aporto: el dia en curso esta fuera del rango.
    expect(agregado.cubos[0].numerador).toBe(1);
  });
});
