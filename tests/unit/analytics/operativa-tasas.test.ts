import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.2 — R10. LA trampa que la 135 dejo anunciada.
//
// D10/R35 de la 135 fijo UNA convencion: las tres tasas son SOBRE GESTIONES. Su denominador
// es `entregas + devoluciones + rechazos + incidentes`, y NO «el numero de ordenes». Una orden
// reprogramada y luego entregada aporta DOS gestiones, asi que dividir entre `ordenes_creadas`
// da un numero mayor que 1 y perfectamente creible. Ese es el bug que este archivo caza.

/** Un dia con 6 gestiones de resultado (2+1+1) + 2 incidentes, sobre 3 ordenes creadas. */
const DIA = [
  cubo({
    fecha: "2026-08-01",
    ordenesCreadas: 3,
    entregas: 2,
    devoluciones: 1,
    rechazos: 1,
    incidentes: 2,
    reprogramaciones: 5,
  }),
];

describe("R10 · las tres tasas dividen entre GESTIONES", () => {
  it("la tasa de entrega divide entre gestiones, no entre ordenes", async () => {
    const serie = await servicioCon(rollupFalso(DIA)).consultar(consultaDe("tasa_entrega"));
    // 2 / (2+1+1+2) = 2/6. Con el denominador equivocado seria 2/3 = 0.666..., que tambien
    // «parece» una tasa: por eso el caso compara contra el numero exacto y no contra un rango.
    expect(serie.puntos[0].valor).toBeCloseTo(2 / 6, 10);
    expect(serie.puntos[0].valor).not.toBeCloseTo(2 / 3, 5);
  });

  it("las reprogramaciones NO entran en el denominador aunque sean gestiones vigentes", async () => {
    // `DENOMINADOR_GESTIONES` del catalogo tiene CUATRO terminos y `reprogramaciones` no es
    // uno: una reprogramacion no es un resultado final. Con las 5 reprogramaciones dentro el
    // denominador seria 11 y la tasa 2/11.
    const serie = await servicioCon(rollupFalso(DIA)).consultar(consultaDe("tasa_entrega"));
    expect(serie.puntos[0].valor).not.toBeCloseTo(2 / 11, 5);
  });

  it("los incidentes SI entran: son el cuarto termino del denominador", async () => {
    const sinIncidentes = [cubo({ fecha: "2026-08-01", entregas: 2, devoluciones: 1, rechazos: 1 })];
    const serie = await servicioCon(rollupFalso(sinIncidentes)).consultar(
      consultaDe("tasa_entrega"),
    );
    expect(serie.puntos[0].valor).toBeCloseTo(2 / 4, 10);
  });

  it("tasa_devolucion y tasa_rechazo usan el MISMO denominador", async () => {
    const dev = await servicioCon(rollupFalso(DIA)).consultar(consultaDe("tasa_devolucion"));
    const rech = await servicioCon(rollupFalso(DIA)).consultar(consultaDe("tasa_rechazo"));
    expect(dev.puntos[0].valor).toBeCloseTo(1 / 6, 10);
    expect(rech.puntos[0].valor).toBeCloseTo(1 / 6, 10);
  });

  it("suma numerador y denominador de TODOS los cubos antes de dividir, no promedia tasas", async () => {
    // Dos cubos: 1/1 y 0/5. La media de las tasas seria (1 + 0)/2 = 0.5; la tasa correcta es
    // 1/6. La diferencia entre las dos es exactamente el error que D5 prohibe.
    const cubos = [
      cubo({ fecha: "2026-08-01", zonaId: "z1", entregas: 1 }),
      cubo({ fecha: "2026-08-01", zonaId: "z2", devoluciones: 5 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tasa_entrega"));
    expect(serie.puntos[0].valor).toBeCloseTo(1 / 6, 10);
    expect(serie.puntos[0].valor).not.toBeCloseTo(0.5, 5);
  });
});

describe("R10 · denominador cero", () => {
  it("denominador cero devuelve null", async () => {
    // Un dia con ordenes creadas pero SIN ninguna gestion de resultado. `0` diria «nadie
    // entrego nada», y no es lo mismo que «no hubo de que»: R10 exige `null`.
    const cubos = [cubo({ fecha: "2026-08-01", ordenesCreadas: 9, reprogramaciones: 2 })];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("tasa_entrega"));
    expect(serie.puntos[0].valor).toBeNull();
    expect(serie.puntos[0].valor).not.toBe(0);
    expect(Number.isNaN(serie.puntos[0].valor as unknown as number)).toBe(false);
  });

  it("y no lanza: una tasa indefinida es un dato, no un error", async () => {
    const cubos = [cubo({ fecha: "2026-08-01" })];
    await expect(
      servicioCon(rollupFalso(cubos)).consultar(consultaDe("tasa_rechazo")),
    ).resolves.toBeDefined();
  });
});
