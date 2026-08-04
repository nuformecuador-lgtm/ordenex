import { describe, it, expect } from "vitest";

import {
  COBERTURA_COMPLETO,
  COBERTURA_NO_COMPARABLE,
  COBERTURA_PARCIAL,
  COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
} from "@/app/(app)/analitica/_components/operativo/analitica-operativa-descarga-columnas";
import { filasDeSerie } from "@/app/(app)/analitica/_components/operativo/export-operativo";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";
import { construirDescarga, nombreArchivoDescarga } from "@/lib/utils/descarga-dataset";

// Feature 134 — R7 (ninguna columna inventada), R12 (la unidad viaja) y R20 (el nombre del
// archivo lo produce el patron comun).
//
// Las aserciones van sobre EL TEXTO del archivo siempre que la propiedad se pueda ver ahi.
// Un objeto de filas bien formado que se serializa mal sigue siendo un archivo malo, y el
// archivo es lo unico que sobrevive al filtro que lo genero.

/* -------------------------------------------------------------------------- */
/* El contrato de columnas, escrito A MANO aqui                                */
/* -------------------------------------------------------------------------- */

/**
 * Se declara LITERALMENTE en el test, y no se deriva de `COLUMNAS_DESCARGA_ANALITICA_OPERATIVA`, a
 * proposito: comparar el modulo consigo mismo aprobaria cualquier columna que alguien
 * anadiera. Anadir aqui una columna nueva obliga a justificarla de donde sale.
 */
const CLAVES_CONTRATO = [
  "fecha",
  "metrica",
  "dimension",
  "valor",
  "unidad",
  "cobertura",
  "corte_at",
  "limitacion_conocida",
] as const;

const ENCABEZADOS_CONTRATO = [
  "Fecha",
  "Metrica",
  "Desglose",
  "Valor",
  "Unidad",
  "Cobertura",
  "Corte",
  "Limitacion conocida",
];

const RANGO = {
  preset: "semana" as const,
  desde: new Date("2026-08-01T06:00:00.000Z"),
  hasta: new Date("2026-08-04T06:00:00.000Z"),
  desdeFecha: "2026-08-01",
  hastaFecha: "2026-08-03",
};

function serie(parcial: Partial<SerieOperativa> = {}): SerieOperativa {
  return {
    metricaId: "entregas",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    rango: RANGO,
    puntos: [
      { fecha: "2026-08-01", dimension: "Mensajero 1", valor: 12 },
      { fecha: "2026-08-02", dimension: "Mensajero 2", valor: null },
      {
        fecha: "2026-08-03",
        dimension: "Mensajero 1",
        valor: 4,
        parcial: true,
        corteAt: "2026-08-03T15:00:00.000Z",
      },
    ],
    cobertura: { fechasNoComparables: ["2026-08-01"], penumbra: PENUMBRA },
    ...parcial,
  };
}

/** Lineas del CSV. `buildCsvRows` une con CRLF y no emite BOM (dialecto de la app, D5). */
function lineas(csv: string): string[] {
  return csv.split("\r\n");
}

function celdas(linea: string): string[] {
  return linea.split(",");
}

async function csvDe(fuentes: Parameters<typeof filasDeSerie>[0], titulo = "Tasa de entrega") {
  const archivo = await construirDescarga({
    tipo: "csv",
    titulo,
    columnas: COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
    filas: filasDeSerie(fuentes),
  });
  return archivo;
}

describe("Feature 134 (R7) — el archivo no lleva ni una columna que no venga de la serie", () => {
  it("toda celda del CSV procede de un campo de SerieOperativa", async () => {
    // R7 — el punto de mutacion es anadir una columna «Mensajero (nombre)» resuelta contra
    // cualquier catalogo. El archivo circula: una columna de identidad ahi ya no se retira.
    expect(COLUMNAS_DESCARGA_ANALITICA_OPERATIVA.map((c) => c.clave)).toEqual([...CLAVES_CONTRATO]);
    expect(COLUMNAS_DESCARGA_ANALITICA_OPERATIVA.map((c) => c.encabezado)).toEqual(ENCABEZADOS_CONTRATO);

    const s = serie();
    const filas = filasDeSerie([{ etiqueta: "Entregas", serie: s }]);

    // Ninguna fila trae una clave de mas: `buildCsvRows` ignora las claves no declaradas,
    // asi que una columna clandestina no se veria en el texto pero SI estaria en el objeto
    // que un dia alguien declare.
    for (const fila of filas) {
      expect(Object.keys(fila).sort()).toEqual([...CLAVES_CONTRATO].sort());
    }

    // Y toda celda del ARCHIVO sale de la serie: el universo de valores admitidos se
    // construye desde `s`, no desde las filas.
    const admitidos = new Set<string>([
      ...s.puntos.map((p) => p.fecha),
      ...s.puntos.map((p) => p.dimension ?? ""),
      ...s.puntos.map((p) => (p.valor === null ? "" : String(p.valor))),
      ...s.puntos.map((p) => p.corteAt ?? ""),
      "Entregas",
      s.unidad,
      s.cobertura.penumbra,
      COBERTURA_COMPLETO,
      COBERTURA_PARCIAL,
      COBERTURA_NO_COMPARABLE,
      "",
    ]);

    const { contenido } = await csvDe([{ etiqueta: "Entregas", serie: s }]);
    const [cabecera, ...datos] = lineas(String(contenido));
    expect(celdas(cabecera)).toEqual(ENCABEZADOS_CONTRATO);
    expect(datos).toHaveLength(s.puntos.length);
    for (const linea of datos) {
      for (const celda of celdas(linea)) {
        expect(admitidos, `celda inesperada en el archivo: "${celda}"`).toContain(celda);
      }
    }
  });

  it("y el texto del archivo no contiene ninguna clave de identidad", async () => {
    // R7, su otra cara: ni «nombre», ni «correo», ni «telefono», ni «id» como encabezado.
    const { contenido } = await csvDe([{ etiqueta: "Entregas", serie: serie() }]);
    const cabecera = lineas(String(contenido))[0].toLowerCase();
    for (const prohibido of ["nombre", "correo", "email", "telefono", "_id", "uuid"]) {
      expect(cabecera).not.toContain(prohibido);
    }
  });
});

describe("Feature 134 (R12) — la unidad viaja en el archivo", () => {
  it("cada fila declara la unidad de su metrica", async () => {
    // Sin esto, «0,84» de una tasa y «84» de un conteo son la misma celda en la misma hoja,
    // y nada en el archivo permite distinguirlos seis meses despues.
    const conteo = serie({ metricaId: "entregas", unidad: "conteo" });
    const tasa = serie({
      metricaId: "tasa_entrega",
      unidad: "porcentaje",
      unidadDeConteo: "gestion",
    });

    const { contenido } = await csvDe([
      { etiqueta: "Entregas", serie: conteo },
      { etiqueta: "Tasa de entrega", serie: tasa },
    ]);

    const [cabecera, ...datos] = lineas(String(contenido));
    const iUnidad = celdas(cabecera).indexOf("Unidad");
    const iMetrica = celdas(cabecera).indexOf("Metrica");
    expect(iUnidad).toBeGreaterThanOrEqual(0);

    expect(datos).toHaveLength(conteo.puntos.length + tasa.puntos.length);
    for (const linea of datos) {
      const c = celdas(linea);
      expect(c[iUnidad]).toBe(c[iMetrica] === "Entregas" ? "conteo" : "porcentaje");
    }
    // Y las dos unidades estan de verdad en el mismo archivo: si el test solo viera una,
    // pasaria tambien con una unidad constante escrita a mano.
    expect(new Set(datos.map((l) => celdas(l)[iUnidad]))).toEqual(
      new Set(["conteo", "porcentaje"]),
    );
  });
});

describe("Feature 134 (R20) — el nombre del archivo es el del patron comun", () => {
  it("el nombre del archivo lo produce nombreArchivoDescarga", async () => {
    const fecha = new Date("2026-08-04T12:00:00");
    const archivo = await construirDescarga(
      {
        tipo: "csv",
        titulo: "Tasa de entrega",
        columnas: COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
        filas: filasDeSerie([{ etiqueta: "Tasa de entrega", serie: serie() }]),
      },
      fecha,
    );

    expect(archivo.nombreArchivo).toBe(
      nombreArchivoDescarga("Tasa de entrega", "csv", fecha),
    );
    expect(archivo.nombreArchivo).toBe("tasa-de-entrega-2026-08-04.csv");

    // R20 — el subarbol del export NO compone nombres: su superficie publica son las
    // columnas, la proyeccion de una fila, el recorrido y el vocabulario de cobertura, y
    // nada mas. (El censo del arbol entero lo hace el bloque 4 de
    // `export-csv-frontera.guardia.test.ts`.)
    const columnas = await import(
      "@/app/(app)/analitica/_components/operativo/analitica-operativa-descarga-columnas"
    );
    expect(Object.keys(columnas).sort()).toEqual([
      "COBERTURA_COMPLETO",
      "COBERTURA_NO_COMPARABLE",
      "COBERTURA_PARCIAL",
      "COLUMNAS_DESCARGA_ANALITICA_OPERATIVA",
      "filaDescargaAnaliticaOperativa",
    ]);
    const recorrido = await import(
      "@/app/(app)/analitica/_components/operativo/export-operativo"
    );
    expect(Object.keys(recorrido).sort()).toEqual(["filasDeSerie"]);
  });
});
