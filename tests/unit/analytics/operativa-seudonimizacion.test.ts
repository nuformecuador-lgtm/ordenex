import { describe, it, expect } from "vitest";
import { ETIQUETA_MENSAJERO } from "@/lib/analytics/identidad";
import { MENSAJERO_SIN_ASIGNAR } from "@/lib/analytics/types";
import { MAESTRO, TIENDA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T9.4 — R7. D5 de la 122 autorizo al `adminTienda` a desagregar por mensajero,
// PERO ANONIMIZADO: ve la distribucion de su carga sin poder identificar a la persona («un
// adminTienda no es empleador de esos mensajeros»).
//
// POR QUE SE ASIERTA SOBRE `JSON.stringify` Y NO SOBRE LOS CAMPOS QUE LA UI PINTA: en el App
// Router lo que un Server Component «no pinta» IGUALMENTE VIAJA. El payload RSC y la respuesta
// de una Server Action son inspeccionables en la pestana Network. Un `mensajeroId` real que
// llegue al navegador ya esta filtrado aunque ningun pixel lo muestre.
//
// La mutacion de R7 es exactamente esa: devolver `mensajeroId` JUNTO a la etiqueta seudonima
// «por comodidad de la UI». Un test que solo mirara `punto.dimension` la aprobaria.

const UUID_A = "3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa";
const UUID_B = "3f0a7c62-2222-4a1e-9e21-bbbbbbbbbbbb";

const CUBOS = [
  cubo({ fecha: "2026-08-01", mensajeroId: UUID_A, entregas: 5 }),
  cubo({ fecha: "2026-08-01", mensajeroId: UUID_B, entregas: 3 }),
];

describe("R7 · politica seudonima: ningun id real sobrevive a la serializacion", () => {
  it("ningun uuid de mensajero sobrevive a JSON.stringify de la respuesta", async () => {
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    const serializada = JSON.stringify(serie);
    expect(serializada).not.toContain(UUID_A);
    expect(serializada).not.toContain(UUID_B);
    // Y no es que la serie este vacia: los dos cubos siguen ahi, etiquetados.
    expect(serie.puntos).toHaveLength(2);
    for (const punto of serie.puntos) {
      expect(punto.dimension).toMatch(new RegExp(`^${ETIQUETA_MENSAJERO} \\d+$`));
    }
  });

  it("la desagregacion se CONSERVA: dos mensajeros siguen siendo dos filas con sus numeros", async () => {
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    expect(serie.puntos.map((p) => p.valor).sort((a, b) => Number(a) - Number(b))).toEqual([3, 5]);
  });

  it("y las etiquetas son distintas entre si: no se colapsan los mensajeros en uno", async () => {
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    expect(new Set(serie.puntos.map((p) => p.dimension)).size).toBe(2);
  });
});

describe("R7 · politica real: el id se conserva porque el rol puede verlo", () => {
  it("un maestro recibe el uuid real como dimension", async () => {
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", MAESTRO),
      "mensajero",
    );
    expect(serie.puntos.map((p) => p.dimension)).toContain(UUID_A);
  });

  it("la seudonimizacion no se aplica a dimensiones que no son el mensajero", async () => {
    // Un `adminTienda` desagregando por estatus recibe la etiqueta del estatus tal cual: la
    // politica de identidad es del MENSAJERO, no un borrado indiscriminado.
    const etiquetas = new Map([["e-entregada", { value: "entregada", label: "entregada" }]]);
    const serie = await servicioCon(rollupFalso(CUBOS, etiquetas)).consultar(
      consultaDe("ordenes_por_estado", TIENDA),
      "estatus",
    );
    expect(serie.puntos[0].dimension).toBe("entregada");
  });
});

describe("R7/R8 · el cubo sin asignar sobrevive a la seudonimizacion", () => {
  it("se conserva TAL CUAL y no se convierte en «Mensajero N»", async () => {
    const conNulo = [...CUBOS, cubo({ fecha: "2026-08-01", mensajeroId: null, entregas: 2 })];
    const serie = await servicioCon(rollupFalso(conNulo)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    expect(serie.puntos.map((p) => p.dimension)).toContain(MENSAJERO_SIN_ASIGNAR);
    // No es una persona: etiquetarlo «Mensajero 3» inventaria un repartidor que no existe.
    expect(serie.puntos.filter((p) => p.dimension?.startsWith(ETIQUETA_MENSAJERO))).toHaveLength(2);
  });
});
