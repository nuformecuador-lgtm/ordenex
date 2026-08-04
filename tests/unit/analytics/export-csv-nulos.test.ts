import { describe, it, expect } from "vitest";

import {
  COLUMNAS_EXPORT_OPERATIVO,
  filasDeSerie,
} from "@/app/(app)/analitica/_components/operativo/export-operativo";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";
import { construirDescarga } from "@/lib/utils/descarga-dataset";

// Feature 134 — R11. `valor: null` significa INDEFINIDO (denominador 0), no cero.
//
// El contrato de la 126 lo declara sin ambiguedad: «`null` = indefinido. NUNCA `0` para decir
// no se sabe» (`lib/types/analitica-operativa.ts:89`). En una pantalla, confundirlos produce
// un hueco raro que alguien pregunta. En un archivo que se reenvia, produce una tasa del 0 %
// que nadie vuelve a cuestionar: parece un dato, se grafica, y no hay nada en el fichero que
// lo desmienta.
//
// La asercion va sobre el TEXTO: el `null` correcto en memoria que se serializa como "0",
// "null" o "-" sigue siendo el mismo archivo malo.

const RANGO = {
  preset: "semana" as const,
  desde: new Date("2026-08-01T06:00:00.000Z"),
  hasta: new Date("2026-08-04T06:00:00.000Z"),
  desdeFecha: "2026-08-01",
  hastaFecha: "2026-08-03",
};

const SERIE: SerieOperativa = {
  metricaId: "tasa_entrega",
  unidad: "porcentaje",
  unidadDeConteo: "gestion",
  rango: RANGO,
  puntos: [
    // Un cero DE VERDAD: hubo gestiones y ninguna termino en entrega.
    { fecha: "2026-08-01", valor: 0 },
    // Indefinido: no hubo denominador. No es un cero, y no puede parecerlo.
    { fecha: "2026-08-02", valor: null },
    { fecha: "2026-08-03", valor: 0.842 },
  ],
  cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
};

async function csv(): Promise<string> {
  const archivo = await construirDescarga({
    tipo: "csv",
    titulo: "Tasa de entrega",
    columnas: COLUMNAS_EXPORT_OPERATIVO,
    filas: filasDeSerie([{ etiqueta: "Tasa de entrega", serie: SERIE }]),
  });
  return String(archivo.contenido);
}

describe("Feature 134 (R11) — un valor indefinido no se convierte en cero", () => {
  it("un valor null se escribe como celda vacia y jamas como 0", async () => {
    const filas = filasDeSerie([{ etiqueta: "Tasa de entrega", serie: SERIE }]);
    expect(filas.map((f) => f.valor)).toEqual([0, null, 0.842]);

    const texto = await csv();
    const [cabecera, ...datos] = texto.split("\r\n");
    const iValor = cabecera.split(",").indexOf("Valor");
    const iFecha = cabecera.split(",").indexOf("Fecha");

    const porFecha = new Map(datos.map((l) => [l.split(",")[iFecha], l.split(",")[iValor]]));

    // La fila del indefinido: celda VACIA. Ni "0", ni "null", ni "-", ni "N/A".
    expect(porFecha.get("2026-08-02")).toBe("");
    // Y la del cero de verdad sigue siendo un cero: el `null` no se contagia al reves.
    expect(porFecha.get("2026-08-01")).toBe("0");
    expect(porFecha.get("2026-08-03")).toBe("0.842");

    // Las dos celdas son DISTINTAS en el archivo. Si un dia dejaran de serlo, este es el
    // caso que lo dice.
    expect(porFecha.get("2026-08-02")).not.toBe(porFecha.get("2026-08-01"));
  });

  it("y no se inventa ninguna fila para una fecha que la serie no trae", async () => {
    // R11, segunda mitad: el rango va del 1 al 3 y la serie trae tres puntos. Rellenar
    // huecos con ceros seria fabricar datos de negocio que nadie midio.
    const conHueco: SerieOperativa = {
      ...SERIE,
      puntos: [SERIE.puntos[0], SERIE.puntos[2]],
    };
    const filas = filasDeSerie([{ etiqueta: "Tasa de entrega", serie: conHueco }]);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.fecha)).toEqual(["2026-08-01", "2026-08-03"]);
  });

  it("el dialecto es el de la app: decimales con punto, coma como separador y sin BOM", async () => {
    // D5 — el punto de mutacion del dialecto. Un `;`, una coma decimal o un BOM aqui
    // crearian un segundo CSV en la misma app (25 tablas usan el otro).
    const texto = await csv();
    expect(texto.startsWith("﻿")).toBe(false);
    expect(texto).toContain("0.842");
    expect(texto).not.toContain("0,842");
    expect(texto.split("\r\n")[0]).toContain(",");
    expect(texto.split("\r\n")[0]).not.toContain(";");
  });
});
