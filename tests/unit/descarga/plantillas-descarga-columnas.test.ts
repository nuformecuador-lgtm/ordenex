import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_PLANTILLAS,
  filaDescargaPlantilla,
} from "@/app/(app)/configuracion/plantillas/_components/plantillas-descarga-columnas";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

// Feature 170 / T B.3 (R5/R6/R7/R8/R23/R24) — columnas de export del listado de plantillas.

const CUERPO_LARGO = `Hola {{destinatario}}, ${"tu pedido va en camino. ".repeat(6)}Gracias.`;

const PLANTILLA: PlantillaListItemDTO = {
  id: "7c1e9a0b-2d3f-4a5b-8c9d-0e1f2a3b4c5d",
  nombre: "Bienvenida",
  cuerpo: CUERPO_LARGO,
  estado: "refused",
  variables: ["destinatario"],
  templateId: "meta-tpl-99887766",
  createdAt: new Date("2026-03-15T18:30:00.000Z"),
};

describe("columnas de descarga de plantillas de mensaje", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_PLANTILLAS.map((c) => c.clave)).toEqual([
      "nombre",
      "estado",
      "cuerpo",
    ]);
    expect(COLUMNAS_DESCARGA_PLANTILLAS.map((c) => c.encabezado)).toEqual([
      "Nombre",
      "Estado",
      "Cuerpo",
    ]);
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(filaDescargaPlantilla(PLANTILLA))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("emite el estado como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const fila = filaDescargaPlantilla(PLANTILLA);
    expect(fila.estado).toBe("Rechazado");
    expect(fila.estado).not.toBe("refused");
  });

  it("emite el cuerpo COMPLETO, sin el truncado de pantalla (R7/R28)", () => {
    // La tabla corta a 80 caracteres y añade un elipsis porque la celda es de una línea; el
    // archivo no tiene esa restricción, y entregar el texto a medias sería un dato truncado
    // sin avisar, que es justo lo que la feature prohíbe.
    const fila = filaDescargaPlantilla(PLANTILLA);
    expect(fila.cuerpo).toBe(CUERPO_LARGO);
    expect(String(fila.cuerpo).length).toBeGreaterThan(80);
    expect(String(fila.cuerpo)).not.toContain("…");
  });

  it("no expone identificadores internos, ni el propio ni el de Meta (R23/R24)", () => {
    const fila = filaDescargaPlantilla(PLANTILLA);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("templateId");
    expect(Object.values(fila)).not.toContain(PLANTILLA.id);
    expect(Object.values(fila)).not.toContain(PLANTILLA.templateId);
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });

  it("no emite campos que el listado no muestra en pantalla (R24)", () => {
    const fila = filaDescargaPlantilla(PLANTILLA);
    // `createdAt` y `variables` vienen en el DTO; la tabla no los pinta.
    expect(fila).not.toHaveProperty("createdAt");
    expect(fila).not.toHaveProperty("variables");
    expect(Object.keys(fila).sort()).toEqual(
      COLUMNAS_DESCARGA_PLANTILLAS.map((c) => c.clave).sort(),
    );
  });

  it("un campo nuevo del DTO no aparece en el archivo hasta declararlo (R6)", () => {
    const conCampoNuevo = {
      ...PLANTILLA,
      tokenDeSincronizacion: "sync_tok_no_debe_salir",
    } as PlantillaListItemDTO;

    const fila = filaDescargaPlantilla(conCampoNuevo);
    expect(Object.keys(fila).sort()).toEqual(
      COLUMNAS_DESCARGA_PLANTILLAS.map((c) => c.clave).sort(),
    );
    expect(Object.values(fila)).not.toContain("sync_tok_no_debe_salir");
  });
});
