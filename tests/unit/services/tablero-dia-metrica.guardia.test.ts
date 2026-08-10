import { describe, expect, it } from "vitest";

import { getMetrica } from "@/lib/analytics/metrics";
import { METRICA_ALCANCE_TABLERO } from "@/lib/services/TableroDiaService";

// Feature 192 (B3.6, design.md §3.2) — R8.
//
// El tablero NO declara su propia tabla de roles: le pregunta a `resolverAlcance` por una
// metrica del catalogo. Eso ata su frontera de seguridad a un id que vive en otro archivo, y
// ese archivo se mueve.
//
// El modo de fallo es SILENCIOSO en la peor direccion posible: si la metrica se renombra,
// `resolverAlcance` devuelve `metrica_desconocida` y el tablero queda DENEGADO para todo el
// mundo. Falla cerrada —que es lo correcto— pero sin señal: la pantalla simplemente muere y
// parece un bug de permisos. Este guardia convierte ese renombrado en un test rojo.

describe("la metrica que gobierna el alcance del tablero", () => {
  it("existe en el catalogo (R8)", () => {
    expect(getMetrica(METRICA_ALCANCE_TABLERO)).toBeDefined();
  });

  it("cuenta ORDENES y tiene grano mensajero y zona: la semantica del tablero", () => {
    const metrica = getMetrica(METRICA_ALCANCE_TABLERO);
    if (metrica === undefined) throw new Error("metrica ausente");

    expect(metrica.unidadDeConteo).toBe("orden");
    expect(metrica.granos).toContain("mensajero");
    expect(metrica.granos).toContain("zona");
  });

  it("atribuye la zona por la ORDEN, nunca por el mensajero (R6)", () => {
    const metrica = getMetrica(METRICA_ALCANCE_TABLERO);
    if (metrica === undefined) throw new Error("metrica ausente");
    expect(metrica.definicion).toMatchObject({ atribucionZona: "orden" });
  });

  it("concede total a admin/maestro y acotado a adminSatelite (R4/R5)", () => {
    const metrica = getMetrica(METRICA_ALCANCE_TABLERO);
    if (metrica === undefined) throw new Error("metrica ausente");

    expect(metrica.alcance.admin).toBe("total");
    expect(metrica.alcance.maestro).toBe("total");
    expect(metrica.alcance.adminSatelite).toBe("acotado");
  });

  it("esta feature NO añade una metrica nueva al catalogo (alternativa 5)", () => {
    // El id es uno de los ya existentes; el catalogo es una decision humana fechada y hay
    // guardias ajenos que cuentan sus etiquetas.
    expect(METRICA_ALCANCE_TABLERO).toBe("ordenes_por_estado");
  });
});
