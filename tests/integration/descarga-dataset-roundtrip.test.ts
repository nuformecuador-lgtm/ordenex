/**
 * Feature 151 (T13) — round-trip de INTEGRACIÓN de la descarga de un dataset.
 *
 * Los tests unitarios de `descarga-dataset` ejercitan el despachador con filas
 * sintéticas; aquí se recorre el camino COMPLETO y real del primer consumidor:
 *
 *   OrdenListItemDTO[]  →  filaDescargaOrden + COLUMNAS_DESCARGA_ORDENES
 *                       →  construirDescarga
 *                       →  RE-LECTURA del artefacto producido
 *
 * El punto de R21 es que no hay truncado silencioso: N filas dentro ⇒ N filas
 * fuera. Por eso el dataset de prueba tiene 60 filas (muy por encima del
 * `ORDENES_MAX_PAGE_SIZE` = 100/página que el listado usaría, y suficiente para
 * que cualquier recorte accidental por página se note) e incluye deliberadamente
 * una fila con valores AUSENTES (R6) y otra con valores que exigen escapado CSV:
 * coma, comilla doble y salto de línea (R4).
 */
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ORDENES,
  filaDescargaOrden,
} from "@/app/(app)/ordenes/_components/ordenes-descarga-columnas";
import { construirDescarga } from "@/lib/utils/descarga-dataset";
import type { DescargaCelda } from "@/lib/types/descarga";
import type { OrdenListItemDTO } from "@/lib/types/orden";

/** Nº de filas del dataset: si algo truncara por página, aquí se vería. */
const TOTAL_FILAS = 60;

/** Índice de la fila sin datos opcionales (R6) dentro del dataset. */
const INDICE_FILA_VACIA = 17;

/** Índice de la fila con coma, comilla y salto de línea (escapado CSV, R4). */
const INDICE_FILA_ESCAPADA = 42;

const TITULO = "Órdenes";

function ordenBase(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 1000 + i,
    numRemision: `REM-${String(i).padStart(3, "0")}`,
    estatusId: "est-uuid",
    estatusValue: "entregada",
    destinatario: `Destinatario ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-uuid",
    provinciaId: "prov-uuid",
    cantonId: "canton-uuid",
    distritoId: "distrito-uuid",
    producto: `Producto ${i}`,
    peso: 1.5,
    notas: null,
    direccion: `Calle ${i}`,
    montoCobrar: 1000 + i,
    intentosEntrega: i % 3,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
    relaciones: {
      estatus: { id: "est-uuid", value: "entregada" },
      tienda: {
        id: "tienda-uuid",
        nombre: "Tienda Relación",
        email: "tienda@x.com",
        telefono: "022222222",
        tarifa: null,
      },
      zona: { id: "zona-uuid", nombre: "Zona Norte", esCentral: false },
      provincia: { id: "prov-uuid", nombre: "San José" },
      canton: { id: "canton-uuid", nombre: "Escazú" },
      distrito: { id: "distrito-uuid", nombre: "San Rafael" },
      mensajeroAsignado: { id: "mens-uuid", nombre: "Luis Mora" },
    },
  };
}

/**
 * Dataset de prueba: filas normales salvo dos casos borde deliberados. La fila
 * "vacía" conserva los campos obligatorios del DTO (destinatario, producto) y
 * suelta todo lo opcional, que es exactamente el aspecto de una orden recién
 * creada sin geografía resuelta ni mensajero asignado.
 */
function datasetOrdenes(): OrdenListItemDTO[] {
  return Array.from({ length: TOTAL_FILAS }, (_, i) => {
    const orden = ordenBase(i);

    if (i === INDICE_FILA_VACIA) {
      return {
        ...orden,
        numGuia: null,
        direccion: null,
        montoCobrar: null,
        intentosEntrega: undefined,
        estatusValue: undefined,
        relaciones: undefined,
      };
    }

    if (i === INDICE_FILA_ESCAPADA) {
      return {
        ...orden,
        destinatario: 'Solís, "El Rápido"',
        // Salto de línea real dentro de la celda: sin comillas, partiría la fila.
        direccion: "Calle 5, casa 3\nfrente al parque",
        producto: 'Camiseta "premium", talla M',
      };
    }

    return orden;
  });
}

const FILAS = datasetOrdenes().map(filaDescargaOrden);
const ENCABEZADOS = COLUMNAS_DESCARGA_ORDENES.map((c) => c.encabezado);

/** Texto esperado de una celda: `null`/ausente → vacío; número → decimal. */
function textoEsperado(valor: DescargaCelda | undefined): string {
  if (valor === null || valor === undefined) return "";
  return typeof valor === "number" ? String(valor) : valor;
}

/**
 * Parser CSV RFC4180 mínimo (comillas dobles duplicadas, separador y saltos de
 * línea DENTRO de celda entrecomillada). Se implementa aquí, y no se reusa
 * `parseSpreadsheet`, porque aquél normaliza a objetos por cabecera y aquí hace
 * falta ver las celdas CRUDAS, en su posición, para juzgar el escapado.
 */
function parseCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];

    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += ch;
      }
      continue;
    }

    if (ch === '"') {
      enComillas = true;
    } else if (ch === ",") {
      fila.push(celda);
      celda = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += ch;
    }
  }

  fila.push(celda);
  filas.push(fila);
  return filas;
}

describe("Descarga de dataset — round-trip desde el listado de órdenes", () => {
  it("el xlsx generado a partir de filas del listado se relee con las mismas cabeceras y el mismo número de filas", async () => {
    const archivo = await construirDescarga(
      { titulo: TITULO, columnas: COLUMNAS_DESCARGA_ORDENES, filas: FILAS },
      new Date("2026-07-29T12:00:00Z"),
    );

    expect(archivo.nombreArchivo.endsWith(".xlsx")).toBe(true);
    expect(typeof archivo.contenido).not.toBe("string");
    if (typeof archivo.contenido === "string") return;

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    // El `Buffer` que exceljs declara en su firma no es el de @types/node; el cast
    // es el mismo que ya usan `lib/parsers/spreadsheet` y los tests de xlsx.
    await workbook.xlsx.load(
      archivo.contenido as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );

    // R3: UNA sola hoja, nombrada con el título (R8).
    expect(workbook.worksheets).toHaveLength(1);
    const hoja = workbook.worksheets[0]!;
    expect(hoja.name).toBe(TITULO);

    // R3: la fila 1 son EXACTAMENTE las cabeceras declaradas, en su orden.
    const cabeceras: string[] = [];
    hoja.getRow(1).eachCell((cell) => cabeceras.push(String(cell.value ?? "")));
    expect(cabeceras).toEqual(ENCABEZADOS);

    // R21: N filas dentro ⇒ N filas fuera. Sin truncado silencioso.
    const filasDatos: number[] = [];
    hoja.eachRow((_row, numero) => {
      if (numero > 1) filasDatos.push(numero);
    });
    expect(filasDatos).toHaveLength(TOTAL_FILAS);
    expect(hoja.rowCount).toBe(TOTAL_FILAS + 1);

    // La primera y la última fila del dataset sobreviven al viaje en su posición:
    // un recorte por página habría dejado fuera a la última.
    const columnaGuia = ENCABEZADOS.indexOf("Nº Guía") + 1;
    expect(hoja.getRow(2).getCell(columnaGuia).value).toBe(FILAS[0]!.numGuia);
    expect(hoja.getRow(TOTAL_FILAS + 1).getCell(columnaGuia).value).toBe(
      FILAS[TOTAL_FILAS - 1]!.numGuia,
    );
  });

  it("el csv generado se reparsea a las mismas celdas", async () => {
    const archivo = await construirDescarga(
      {
        tipo: "csv",
        titulo: TITULO,
        columnas: COLUMNAS_DESCARGA_ORDENES,
        filas: FILAS,
      },
      new Date("2026-07-29T12:00:00Z"),
    );

    expect(archivo.nombreArchivo.endsWith(".csv")).toBe(true);
    expect(typeof archivo.contenido).toBe("string");
    if (typeof archivo.contenido !== "string") return;

    const filas = parseCsv(archivo.contenido);

    // R4: una línea de cabecera + una por elemento, en el orden recibido (R21).
    expect(filas).toHaveLength(TOTAL_FILAS + 1);
    expect(filas[0]).toEqual(ENCABEZADOS);

    // Celda a celda: el escapado del generador y el desescapado del parser son
    // inversos exactos, incluidos coma, comilla y salto de línea.
    for (let i = 0; i < TOTAL_FILAS; i++) {
      const esperada = COLUMNAS_DESCARGA_ORDENES.map((columna) =>
        textoEsperado(FILAS[i]![columna.clave]),
      );
      expect(filas[i + 1], `fila ${i} del csv`).toEqual(esperada);
    }

    // Guards explícitos de los dos casos borde, para que un fallo diga QUÉ se rompió.
    const columnaDestinatario = ENCABEZADOS.indexOf("Destinatario");
    const columnaDireccion = ENCABEZADOS.indexOf("Dirección");
    expect(filas[INDICE_FILA_ESCAPADA + 1]![columnaDestinatario]).toBe(
      'Solís, "El Rápido"',
    );
    expect(filas[INDICE_FILA_ESCAPADA + 1]![columnaDireccion]).toBe(
      "Calle 5, casa 3\nfrente al parque",
    );
    // R6: la fila sin datos opcionales deja celdas VACÍAS, no texto de relleno.
    expect(filas[INDICE_FILA_VACIA + 1]![ENCABEZADOS.indexOf("Nº Guía")]).toBe("");
    expect(filas[INDICE_FILA_VACIA + 1]![columnaDireccion]).toBe("");
    expect(filas[INDICE_FILA_VACIA + 1]![ENCABEZADOS.indexOf("Mensajero")]).toBe("");
  });
});
