import { describe, it, expect } from "vitest";

import { prepararPanel } from "@/app/(app)/analitica/_components/operativo/agregacion";
import {
  COLUMNAS_EXPORT_OPERATIVO,
  filasDeSerie,
} from "@/app/(app)/analitica/_components/operativo/export-operativo";
import { categoriaDePunto } from "@/app/(app)/analitica/_components/operativo/textos";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";
import { construirDescarga } from "@/lib/utils/descarga-dataset";

// Feature 134 — R10. EQUIVALENCIA PANTALLA-ARCHIVO: ni una fila de mas, ni una de menos.
//
// Se parte de la MISMA `SerieOperativa` que consume `prepararPanel()` —la puerta unica por la
// que pasa el payload de la 126 antes de llegar a la grafica— y se comprueba que el archivo
// contiene punto por punto lo mismo.
//
// Lo que este caso protege no es la estetica: es la tentacion razonable de «limpiar» el
// archivo. Filtrar los puntos sin valor o los del dia en curso produce un CSV mas bonito y
// una mentira por omision — un dia sin dato desaparece y el lector interpola, o el dia en
// curso desaparece y el total del periodo no cuadra con la pantalla.
//
// Nota de alcance (design §4.1): la equivalencia que se promete es «MISMO DATO para el mismo
// alcance y el mismo filtro», no «misma foto». El archivo se relee al pulsar el control, asi
// que el punto del dia en curso puede haber avanzado; por eso su fila lleva su propio
// `corte_at`.

const RANGO = {
  preset: "semana" as const,
  desde: new Date("2026-08-01T06:00:00.000Z"),
  hasta: new Date("2026-08-04T06:00:00.000Z"),
  desdeFecha: "2026-08-01",
  hastaFecha: "2026-08-03",
};

/** Serie con los dos puntos que mas invitan a que alguien los filtre: un `null` y un parcial. */
const ENTREGAS: SerieOperativa = {
  metricaId: "entregas",
  unidad: "conteo",
  unidadDeConteo: "gestion",
  rango: RANGO,
  puntos: [
    { fecha: "2026-08-01", valor: 20 },
    { fecha: "2026-08-02", valor: null },
    { fecha: "2026-08-03", valor: 7, parcial: true, corteAt: "2026-08-03T15:00:00.000Z" },
  ],
  cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
};

const DEVOLUCIONES: SerieOperativa = {
  ...ENTREGAS,
  metricaId: "devoluciones",
  puntos: [
    { fecha: "2026-08-01", valor: 3 },
    { fecha: "2026-08-02", valor: 0 },
    { fecha: "2026-08-03", valor: 1, parcial: true, corteAt: "2026-08-03T15:00:00.000Z" },
  ],
};

const FUENTES = [
  { etiqueta: "Entregas", serie: ENTREGAS },
  { etiqueta: "Devoluciones", serie: DEVOLUCIONES },
];

describe("Feature 134 (R10) — el archivo trae exactamente lo que pinta el panel", () => {
  it("las filas del CSV son punto por punto las de la serie que pinta el panel", async () => {
    // LA PANTALLA: la misma entrada, por la puerta de la grafica.
    const preparado = prepararPanel(FUENTES, { grafica: "lineas", categoriaDePunto });
    expect(preparado.modo).toBe("serie");
    expect(preparado.grano).toBe("dia"); // sin agregacion temporal: 1 punto = 1 fila
    const pintados = preparado.series.flatMap((s) => s.puntos);

    // EL ARCHIVO: la misma entrada, por la puerta del export.
    const filas = filasDeSerie(FUENTES);
    const archivo = await construirDescarga({
      tipo: "csv",
      titulo: "Resultado de las gestiones",
      columnas: COLUMNAS_EXPORT_OPERATIVO,
      filas,
    });
    const [cabecera, ...datos] = String(archivo.contenido).split("\r\n");
    const col = (nombre: string) => cabecera.split(",").indexOf(nombre);

    // Ni una fila de mas ni una de menos, en las dos direcciones.
    const puntosCrudos = FUENTES.flatMap((f) => f.serie.puntos);
    expect(datos).toHaveLength(puntosCrudos.length);
    expect(datos).toHaveLength(pintados.length);

    // Las mismas fechas, en el mismo orden.
    expect(datos.map((l) => l.split(",")[col("Fecha")])).toEqual(
      puntosCrudos.map((p) => p.fecha),
    );
    // La categoria que pinta la grafica lleva la fecha de su fila (con el sufijo de
    // parcialidad cuando toca): las dos vistas hablan de los mismos dias.
    pintados.forEach((punto, i) => {
      expect(punto.categoria.startsWith(puntosCrudos[i].fecha)).toBe(true);
    });

    // Y los mismos valores: el `null` viaja como celda vacia a los dos lados, el cero como
    // cero y el parcial se conserva.
    expect(datos.map((l) => l.split(",")[col("Valor")])).toEqual(
      puntosCrudos.map((p) => (p.valor === null ? "" : String(p.valor))),
    );
    expect(pintados.map((p) => p.valor)).toEqual(puntosCrudos.map((p) => p.valor));

    // Las dos metricas del panel estan en el archivo, cada fila con la suya.
    expect(datos.map((l) => l.split(",")[col("Metrica")])).toEqual([
      "Entregas",
      "Entregas",
      "Entregas",
      "Devoluciones",
      "Devoluciones",
      "Devoluciones",
    ]);
  });

  it("y con desagregacion el archivo conserva una fila por dimension", async () => {
    // R10 con desglose: el panel pinta una serie por dimension; el archivo, una fila por
    // punto. Colapsar dimensiones en el export produciria un archivo con menos filas que la
    // grafica y con totales que no cuadran con ningun segmento.
    const desglosada: SerieOperativa = {
      ...ENTREGAS,
      puntos: [
        { fecha: "2026-08-01", dimension: "Mensajero 1", valor: 12 },
        { fecha: "2026-08-01", dimension: "Mensajero 2", valor: 8 },
        { fecha: "2026-08-02", dimension: "Mensajero 1", valor: null },
      ],
    };
    const fuentes = [{ etiqueta: "Entregas", serie: desglosada }];

    const preparado = prepararPanel(fuentes, { grafica: "lineas", categoriaDePunto });
    expect(preparado.series.map((s) => s.id)).toEqual(["Mensajero 1", "Mensajero 2"]);

    const filas = filasDeSerie(fuentes);
    expect(filas).toHaveLength(3);
    expect(filas.map((f) => f.dimension)).toEqual([
      "Mensajero 1",
      "Mensajero 2",
      "Mensajero 1",
    ]);
    expect(filas.map((f) => f.valor)).toEqual([12, 8, null]);
  });
});
