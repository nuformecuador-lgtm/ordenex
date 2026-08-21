import { describe, it, expect } from "vitest";

import { DIA_REPARTO, diaRepartoSchema } from "@/lib/types/dia-reparto";
import { asignarBodegaSchema } from "@/lib/types/orden-guia";
import { asignarSateliteSchema } from "@/lib/types/recepcion-satelite";

// Feature 246 (T1.2, R4/R6) — el TOKEN de la eleccion, en el borde.
//
// Lo que este archivo protege es que el cliente NO pueda decidir una FECHA. Manda cual de las dos
// opciones eligio; la fecha la pone el servidor con el huso de Costa Rica. Un `YYYY-MM-DD` salido
// del reloj del navegador no puede determinar el dia de reparto de ninguna orden.

describe("diaRepartoSchema — el vocabulario (R6)", () => {
  it("acepta exactamente los dos valores del producto y ninguno mas", () => {
    expect(DIA_REPARTO).toEqual(["hoy", "manana"]);
    expect(diaRepartoSchema.parse("hoy")).toBe("hoy");
    expect(diaRepartoSchema.parse("manana")).toBe("manana");
  });

  it("rechaza un valor desconocido", () => {
    expect(diaRepartoSchema.safeParse("pasado_manana").success).toBe(false);
    expect(diaRepartoSchema.safeParse("HOY").success).toBe(false);
    expect(diaRepartoSchema.safeParse("").success).toBe(false);
  });

  it("R6: una FECHA no es un valor aceptable — el cliente no puede elegir el dia", () => {
    // Es EL requisito de esta pieza: si esto pasara, un portatil con la hora corrida podria
    // fijar el dia de reparto de un lote entero.
    expect(diaRepartoSchema.safeParse("2026-08-21").success).toBe(false);
    expect(diaRepartoSchema.safeParse("2026-08-21T00:00:00.000Z").success).toBe(false);
    expect(diaRepartoSchema.safeParse(new Date("2026-08-21")).success).toBe(false);
    expect(diaRepartoSchema.safeParse(1_787_000_000_000).success).toBe(false);
  });

  it("el enum en si es ESTRICTO: el default lo pone quien lo consume, no el enum", () => {
    expect(diaRepartoSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("R4 — una peticion SIN el campo se comporta como «hoy», y no falla", () => {
  it("bodega central: `asignarBodegaSchema` sin `dia` produce `hoy`", () => {
    const parsed = asignarBodegaSchema.parse({ ordenIds: ["o1"], mensajeroId: "m1" });
    expect(parsed.dia).toBe("hoy");
  });

  it("bodega satelite: `asignarSateliteSchema` sin `dia` produce `hoy`", () => {
    const parsed = asignarSateliteSchema.parse({
      ordenIds: ["11111111-1111-4111-8111-111111111111"],
      mensajeroId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.dia).toBe("hoy");
  });

  it("las dos superficies aceptan `manana` y ninguna acepta una fecha (D4: misma regla)", () => {
    expect(
      asignarBodegaSchema.parse({ ordenIds: ["o1"], mensajeroId: "m1", dia: "manana" }).dia,
    ).toBe("manana");
    expect(
      asignarBodegaSchema.safeParse({ ordenIds: ["o1"], mensajeroId: "m1", dia: "2026-08-21" })
        .success,
    ).toBe(false);
    expect(
      asignarSateliteSchema.safeParse({
        ordenIds: ["11111111-1111-4111-8111-111111111111"],
        mensajeroId: "22222222-2222-4222-8222-222222222222",
        dia: "2026-08-21",
      }).success,
    ).toBe(false);
  });

  it("D4: las dos superficies deciden IGUAL sobre el mismo juego de entradas", () => {
    // El requisito de D4 es que la regla NO dependa de desde que bodega te asignaron. Se mide
    // por COMPORTAMIENTO —mismo veredicto para las mismas entradas— y no por la forma interna
    // del schema, que puede cambiar con la version de zod sin que la regla cambie.
    const casos: unknown[] = [
      "hoy",
      "manana",
      undefined,
      "HOY",
      "mañana",
      "pasado_manana",
      "2026-08-21",
      null,
      42,
    ];
    const veredictoBodega = casos.map(
      (dia) =>
        asignarBodegaSchema.safeParse({ ordenIds: ["o1"], mensajeroId: "m1", ...(dia === undefined ? {} : { dia }) })
          .success,
    );
    const veredictoSatelite = casos.map(
      (dia) =>
        asignarSateliteSchema.safeParse({
          ordenIds: ["11111111-1111-4111-8111-111111111111"],
          mensajeroId: "22222222-2222-4222-8222-222222222222",
          ...(dia === undefined ? {} : { dia }),
        }).success,
    );
    expect(veredictoSatelite).toEqual(veredictoBodega);
    // Y el veredicto concreto, para que la igualdad de arriba no pueda cumplirse «con los dos
    // rotos igual»: solo los dos tokens y la ausencia del campo pasan.
    expect(veredictoBodega).toEqual([true, true, true, false, false, false, false, false, false]);
  });
});
