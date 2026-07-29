import { describe, it, expect } from "vitest";

import { buildXlsxRows, toXlsxColumns } from "@/lib/utils/xlsx-template";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { parseArchivo } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import { findMissingHeaders, filaCargaSchema } from "@/lib/types/carga-masiva";
import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/carga-masiva-fields";
import {
  COLUMNA_MOTIVO_ERROR,
  ERRORES_EXPORT_FIELDS,
  construirFilasErrorExport,
} from "@/app/(app)/ordenes/_components/carga-masiva-export-errores";
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";

/**
 * Feature 143 — EL RIESGO CENTRAL: el archivo de "órdenes con error" que descarga
 * la app debe poder CORREGIRSE Y VOLVER A SUBIRSE tal cual, con su columna extra
 * `motivo_error` incluida.
 *
 * Hoy eso funciona por diseño PERMISIVO, no por contrato:
 *  - `findMissingHeaders` comprueba presencia, sin lista blanca de cabeceras.
 *  - `filaCargaSchema` es un `z.object` SIN `.strict()`: zod descarta las claves
 *    desconocidas en silencio.
 * Estos tests convierten esa permisividad en contrato (R14, R15, R16): si alguien
 * endurece cualquiera de las dos piezas, rompe aquí y no en producción.
 */

const CLAVES_PLANTILLA = ORDENES_BULK_FIELDS.map((f) => f.key);

const filas: FilaParseada[] = [
  {
    linea: 7,
    row: {
      destinatario: "Ana Solís",
      telefono: "8888",
      direccion_destinatario: "Costa Rica / Cartago / Cartago (Occidental) / Frente gasolinera JSM, 200m sur",
      monto_cobrar: "25.90",
      producto: "Camiseta talla M",
      num_remision: "REM-0007",
      peso: "1.5",
      notas: "Entregar en la tarde",
    },
  },
  {
    linea: 12,
    row: {
      destinatario: "Beto Mora",
      telefono: "87654321",
      direccion_destinatario: "Costa Rica / San José / San José (Carmen) / 100m sur del parque",
      monto_cobrar: "abc",
      producto: "Pantalón",
      num_remision: "REM-0012",
      peso: "2",
      notas: "",
    },
  },
];

const errores: OrdenConError[] = [
  { fila: 7, numRemision: "REM-0007", errores: { telefono: ["debe tener 8 dígitos"] } },
  {
    fila: 12,
    numRemision: "REM-0012",
    errores: { monto_cobrar: ["debe ser numérico y no negativo"] },
  },
];

/** Filas del export (con motivo_error) y las MISMAS sin la columna extra. */
function filasExport(): {
  conMotivo: Array<Record<string, string>>;
  sinMotivo: Array<Record<string, string>>;
} {
  const conMotivo = construirFilasErrorExport(errores, filas);
  const sinMotivo = conMotivo.map((row) => {
    const copia = { ...row };
    delete copia[COLUMNA_MOTIVO_ERROR];
    return copia;
  });
  return { conMotivo, sinMotivo };
}

/** Campos del export sin la columna extra (archivo "de control" para R15). */
const CAMPOS_SIN_MOTIVO = ERRORES_EXPORT_FIELDS.filter(
  (f) => f.key !== COLUMNA_MOTIVO_ERROR,
);

/**
 * Re-parsea el binario exportado por el camino REAL del parser del navegador:
 * `parseArchivo(File)` → lectura xlsx con exceljs → `celdaATexto` → `matrizAArchivo`.
 * Se construye un `File` de verdad (como el que entrega `BulkUpload` al usuario)
 * en vez de reimplementar la lectura de celdas: si la coacción de celdas de
 * producción se rompiera (rich text, fórmula, fecha), este test debe caer con ella.
 */
async function parsearComoNavegador(buffer: ArrayBuffer) {
  const file = new File([buffer], "ordenes-con-error.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return parseArchivo(file);
}

describe("Carga masiva — round-trip del export de filas con error", () => {
  it("R14: parser SERVIDOR — el archivo exportado no reporta cabeceras obligatorias ausentes", async () => {
    const { conMotivo } = filasExport();
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), conMotivo);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(findMissingHeaders(headers)).toEqual([]);
    expect(headers).toEqual([...CLAVES_PLANTILLA, COLUMNA_MOTIVO_ERROR]);
  });

  it("R14: parser NAVEGADOR — el archivo exportado no reporta cabeceras obligatorias ausentes", async () => {
    const { conMotivo } = filasExport();
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), conMotivo);
    const { headers } = await parsearComoNavegador(buffer);
    expect(findMissingHeaders(headers)).toEqual([]);
    expect(headers).toEqual([...CLAVES_PLANTILLA, COLUMNA_MOTIVO_ERROR]);
  });

  it("R14: cada clave de columna aparece VERBATIM en la cabecera (sin label ni sufijo)", async () => {
    const { conMotivo } = filasExport();
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), conMotivo);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    for (const clave of [...CLAVES_PLANTILLA, COLUMNA_MOTIVO_ERROR]) {
      expect(
        headers,
        `El header '${clave}' no aparece tal cual (¿sufijo/etiqueta?): [${headers.join(", ")}]`,
      ).toContain(clave);
    }
  });

  it("R15: parser SERVIDOR — la columna extra no altera el valor de ninguna otra", async () => {
    const { conMotivo, sinMotivo } = filasExport();
    const conBuffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), conMotivo);
    const sinBuffer = await buildXlsxRows(toXlsxColumns(CAMPOS_SIN_MOTIVO), sinMotivo);

    const con = await parseSpreadsheet(Buffer.from(conBuffer), "xlsx");
    const sin = await parseSpreadsheet(Buffer.from(sinBuffer), "xlsx");

    expect(con.rows).toHaveLength(sin.rows.length);
    con.rows.forEach((row, i) => {
      for (const clave of CLAVES_PLANTILLA) {
        expect(row[clave], `columna '${clave}' de la fila ${i + 1}`).toBe(
          sin.rows[i]?.[clave],
        );
      }
    });
    // Y los valores son los CRUDOS del archivo original (R4 end-to-end).
    expect(con.rows[0]?.telefono).toBe("8888");
    expect(con.rows[1]?.monto_cobrar).toBe("abc");
  });

  it("R15: parser NAVEGADOR — la columna extra no altera el valor de ninguna otra", async () => {
    const { conMotivo, sinMotivo } = filasExport();
    const conBuffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), conMotivo);
    const sinBuffer = await buildXlsxRows(toXlsxColumns(CAMPOS_SIN_MOTIVO), sinMotivo);

    const con = await parsearComoNavegador(conBuffer);
    const sin = await parsearComoNavegador(sinBuffer);

    expect(con.filas).toHaveLength(sin.filas.length);
    con.filas.forEach((f, i) => {
      for (const clave of CLAVES_PLANTILLA) {
        expect(f.row[clave], `columna '${clave}' de la fila ${i + 1}`).toBe(
          sin.filas[i]?.row[clave],
        );
      }
      // La numeración de línea tampoco se desplaza por la columna extra.
      expect(f.linea).toBe(sin.filas[i]?.linea);
    });
  });

  it("R16: `filaCargaSchema` valida la fila re-subida y DESCARTA motivo_error", async () => {
    const { conMotivo } = filasExport();
    // Fila corregida por el usuario: teléfono y monto ya válidos, motivo intacto.
    const corregidas = conMotivo.map((row) => ({
      ...row,
      telefono: "88887777",
      monto_cobrar: "25.90",
    }));
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), corregidas);
    const { rows } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row[COLUMNA_MOTIVO_ERROR]).not.toBe(undefined); // llega al parser…
      const parsed = filaCargaSchema.parse(row); // …y NO produce error de validación
      expect(COLUMNA_MOTIVO_ERROR in parsed).toBe(false); // …y se descarta
      expect(parsed.num_remision).not.toBe("");
      expect(parsed.telefono).toBe("88887777");
    }
  });

  it("R16: el schema NO es `.strict()` (endurecerlo rompería la re-subida)", () => {
    const resultado = filaCargaSchema.safeParse({
      num_remision: "REM-1",
      destinatario: "Ana",
      telefono: "88887777",
      producto: "Camisa",
      [COLUMNA_MOTIVO_ERROR]: "Fila 7 — telefono: debe tener 8 dígitos",
      columna_desconocida: "lo que sea",
    });
    expect(resultado.success).toBe(true);
  });

  it("R18: la plantilla vacía sigue teniendo 8 columnas y NINGUNA motivo_error", () => {
    expect(ORDENES_BULK_FIELDS.map((f) => f.key)).toHaveLength(8);
    expect(ORDENES_BULK_FIELDS.some((f) => f.key === COLUMNA_MOTIVO_ERROR)).toBe(false);
  });
});
