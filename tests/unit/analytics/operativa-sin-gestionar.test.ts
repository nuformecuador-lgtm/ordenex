import { describe, it, expect } from "vitest";
import { NOTA_SIN_GESTIONAR } from "@/lib/types/analitica-operativa";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T8bis — R35 (T0-Q4 = A del 2026-08-02).
//
// HECHO VERIFICADO: `sin_gestionar` esta en el catalogo como `snapshot`/`rollup`, pero
// `analytics_daily` NO tiene columna `sin_gestionar` (`db/schema.prisma`: sus 10 medidas no la
// incluyen). El estado SI aparece como un `estatus_id` dentro de `ordenes_estado_stock`, y de
// ahi se deriva.
//
// EL MATIZ QUE HAY QUE DECIR CON TODAS LAS LETRAS: al derivarse del stock hereda el universo
// **B2** de la 124 — ordenes vivas en ese estado AL CORTE mas las que llegaron a terminal ese
// dia—, o sea «sin gestionar HOY» y NO «sin gestionar acumuladas». Son dos numeros muy
// distintos y nada en el nombre de la metrica impide la lectura acumulada.

const ETIQUETAS = new Map([
  ["e-sin-gestionar", { value: "sin_gestionar", label: "sin_gestionar" }],
  ["e-reparto", { value: "en_reparto", label: "en_reparto" }],
]);

const TRES_DIAS = [
  cubo({ fecha: "2026-08-01", estatusId: "e-sin-gestionar", ordenesEstadoStock: 6 }),
  cubo({ fecha: "2026-08-01", estatusId: "e-reparto", ordenesEstadoStock: 20 }),
  cubo({ fecha: "2026-08-02", estatusId: "e-sin-gestionar", ordenesEstadoStock: 6 }),
  cubo({ fecha: "2026-08-03", estatusId: "e-sin-gestionar", ordenesEstadoStock: 6 }),
];

const RANGO_TRES_DIAS = {
  rango: "personalizado" as const,
  desde: "2026-08-01",
  hasta: "2026-08-03",
};

describe("R35 · sin_gestionar se deriva del embudo", () => {
  it("sin_gestionar se deriva del embudo y no se suma entre fechas", async () => {
    const serie = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("sin_gestionar", undefined, RANGO_TRES_DIAS),
    );
    // Tres dias => TRES puntos de 6, jamas un unico punto de 18: es un stock (R12).
    expect(serie.puntos).toHaveLength(3);
    expect(serie.puntos.map((p) => p.valor)).toEqual([6, 6, 6]);
    expect(serie.puntos.map((p) => p.valor)).not.toContain(18);
  });

  it("y proyecta SOLO el estatus sin_gestionar: el resto del embudo no entra", async () => {
    const serie = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("sin_gestionar", undefined, RANGO_TRES_DIAS),
    );
    // Si el filtro por estatus no existiera, el punto del 01 valdria 26 (6 + 20 de en_reparto).
    expect(serie.puntos[0].valor).toBe(6);
    expect(serie.puntos[0].valor).not.toBe(26);
  });
});

describe("R35 · la semantica se declara en el contrato, no en un comentario", () => {
  it("la serie declara la semantica HOY (universo B2)", async () => {
    const serie = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("sin_gestionar", undefined, RANGO_TRES_DIAS),
    );
    expect(serie.nota).toBe(NOTA_SIN_GESTIONAR);
    // Y VIAJA en la respuesta serializada: si viviera solo en un comentario del codigo, el
    // consumidor (131/133) leeria la metrica como acumulada sin nada que lo desmienta.
    expect(JSON.stringify(serie)).toContain(NOTA_SIN_GESTIONAR);
  });

  it("la nota dice HOY y universo b2, no una frase cualquiera", () => {
    // El literal es parte del contrato: la 131/133 lo consume. Si alguien lo reescribe, este
    // caso obliga a pensarlo en vez de dejarlo pasar como retoque de copy.
    expect(NOTA_SIN_GESTIONAR).toBe("sin_gestionar_es_del_dia_universo_b2");
  });

  it("y NINGUNA otra metrica la lleva: la nota es especifica, no decoracion global", async () => {
    const otra = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado", undefined, RANGO_TRES_DIAS),
    );
    expect(otra.nota).toBeUndefined();
  });
});
