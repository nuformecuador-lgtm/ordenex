import { describe, it, expect } from "vitest";

import {
  COBERTURA_COMPLETO,
  COBERTURA_NO_COMPARABLE,
  COBERTURA_PARCIAL,
  COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
} from "@/app/(app)/analitica/_components/operativo/analitica-operativa-descarga-columnas";
import { filasDeSerie } from "@/app/(app)/analitica/_components/operativo/export-operativo";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";
import { construirDescarga } from "@/lib/utils/descarga-dataset";

// Feature 134 — R13, R14, R15. LO QUE NO PUEDE PERDERSE POR EL CAMINO.
//
// D3 — la cobertura y el dia parcial viajan en COLUMNAS POR FILA, no en un bloque de
// cabecera. La fila es lo unico de un fichero plano que sobrevive a filtrar, ordenar y copiar
// a otra hoja; una cabecera de metadatos rompe `read_csv` y desaparece en cuanto alguien
// reguarda desde Excel — que es justo el momento en que el archivo empieza a circular.
//
// Los tres casos afirman sobre EL TEXTO, y ademas comprueban que la marca viaja EN LA FILA
// que le corresponde: una columna constante correcta en la fila equivocada es peor que
// ninguna.

const RANGO = {
  preset: "semana" as const,
  desde: new Date("2026-07-11T06:00:00.000Z"),
  hasta: new Date("2026-08-04T06:00:00.000Z"),
  desdeFecha: "2026-07-11",
  hastaFecha: "2026-08-03",
};

/**
 * Tres dias con las tres coberturas posibles:
 *  - uno bajo el horizonte del historial (no comparable),
 *  - uno cerrado y comparable,
 *  - el dia EN CURSO, con su corte.
 */
const SERIE: SerieOperativa = {
  metricaId: "entregas",
  unidad: "conteo",
  unidadDeConteo: "gestion",
  rango: RANGO,
  puntos: [
    { fecha: "2026-07-11", valor: 0 },
    { fecha: "2026-08-02", valor: 31 },
    { fecha: "2026-08-03", valor: 9, parcial: true, corteAt: "2026-08-03T15:00:00.000Z" },
  ],
  cobertura: { fechasNoComparables: ["2026-07-11"], penumbra: PENUMBRA },
};

const FUENTES = [{ etiqueta: "Entregas", serie: SERIE }];

async function tabla(): Promise<{ cabecera: string[]; filas: Map<string, string[]> }> {
  const archivo = await construirDescarga({
    tipo: "csv",
    titulo: "Ordenes creadas",
    columnas: COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
    filas: filasDeSerie(FUENTES),
  });
  const [cab, ...datos] = String(archivo.contenido).split("\r\n");
  const cabecera = cab.split(",");
  const iFecha = cabecera.indexOf("Fecha");
  const filas = new Map(datos.map((l) => [l.split(",")[iFecha], l.split(",")]));
  return { cabecera, filas };
}

describe("Feature 134 (R13) — el dia en curso se declara parcial y lleva su corte", () => {
  it("la fila del dia en curso se marca parcial y lleva su corte", async () => {
    const { cabecera, filas } = await tabla();
    const iCobertura = cabecera.indexOf("Cobertura");
    const iCorte = cabecera.indexOf("Corte");
    expect(iCobertura).toBeGreaterThanOrEqual(0);
    expect(iCorte).toBeGreaterThanOrEqual(0);

    // El dia en curso, marcado Y con la hora a la que se corto.
    expect(filas.get("2026-08-03")?.[iCobertura]).toBe(COBERTURA_PARCIAL);
    expect(filas.get("2026-08-03")?.[iCorte]).toBe("2026-08-03T15:00:00.000Z");

    // Y un dia cerrado NO lleva corte: sin este contraste, una columna constante con la
    // hora en todas las filas pasaria por buena.
    expect(filas.get("2026-08-02")?.[iCobertura]).toBe(COBERTURA_COMPLETO);
    expect(filas.get("2026-08-02")?.[iCorte]).toBe("");
  });
});

describe("Feature 134 (R14) — las fechas bajo el horizonte no se leen como ceros de negocio", () => {
  it("las fechas bajo el horizonte del historial se marcan no comparables en su fila", async () => {
    // El 2026-07-11 trae un CERO. Sin la marca, ese cero se descarga como «ese dia no se
    // entrego nada», cuando lo que ocurre es que no hay rollup con el que compararlo. En un
    // archivo que circula, esa lectura no se corrige nunca.
    const { cabecera, filas } = await tabla();
    const iCobertura = cabecera.indexOf("Cobertura");
    const iValor = cabecera.indexOf("Valor");

    expect(filas.get("2026-07-11")?.[iValor]).toBe("0");
    expect(filas.get("2026-07-11")?.[iCobertura]).toBe(COBERTURA_NO_COMPARABLE);

    // Solo esa: la marca no se derrama sobre las demas fechas del rango.
    expect(filas.get("2026-08-02")?.[iCobertura]).toBe(COBERTURA_COMPLETO);
    expect(filas.get("2026-08-03")?.[iCobertura]).toBe(COBERTURA_PARCIAL);
    expect(SERIE.cobertura.fechasNoComparables).toEqual(["2026-07-11"]);
  });
});

describe("Feature 134 (R15) — la limitacion permanente se declara dentro del archivo", () => {
  it("el archivo declara la penumbra sin estimarla", async () => {
    const { cabecera, filas } = await tabla();
    const iLimitacion = cabecera.indexOf("Limitacion conocida");
    expect(iLimitacion).toBeGreaterThanOrEqual(0);

    // D3 — en TODAS las filas, no en una cabecera de metadatos: la fila es lo unico que
    // sobrevive a filtrar y copiar a otra hoja.
    for (const fecha of ["2026-07-11", "2026-08-02", "2026-08-03"]) {
      expect(filas.get(fecha)?.[iLimitacion]).toBe(PENUMBRA);
    }

    // R15 — DECLARADA, no estimada: es la constante literal, jamas un numero. Un conteo ahi
    // seria una cifra que nadie puede medir presentada como si alguien la hubiera medido.
    expect(Number.isNaN(Number(PENUMBRA))).toBe(true);
    for (const fecha of ["2026-07-11", "2026-08-02", "2026-08-03"]) {
      expect(Number.isFinite(Number(filas.get(fecha)?.[iLimitacion]))).toBe(false);
    }
  });

  it("y no hay cabecera de metadatos: la primera linea son las columnas (D4)", async () => {
    // D4 — el archivo lleva cabecera de columnas y datos, nada mas. El motivo importa mas
    // que la decision: escribir ahi el `tiendaId`/`zonaId` del actor como «alcance» meteria
    // en un archivo que circula justo la clase de identificador que R8/R9 quieren fuera.
    const { cabecera } = await tabla();
    expect(cabecera[0]).toBe("Fecha");
    const texto = cabecera.join(",").toLowerCase();
    for (const prohibido of ["alcance", "tienda", "zona", "actor", "generado", "usuario"]) {
      expect(texto).not.toContain(prohibido);
    }
  });
});
