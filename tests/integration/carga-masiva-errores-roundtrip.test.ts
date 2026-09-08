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
import { construirChips } from "@/app/(app)/ordenes/_components/carga-masiva-error-chips";
import { mensajeCargaCaracterNoImprimible } from "@/lib/utils/mensaje-caracter-no-imprimible";
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
      provincia: "Cartago",
      canton_distrito: "Cartago (Occidental)",
      direccion: "Frente gasolinera JSM, 200m sur",
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
      provincia: "San José",
      canton_distrito: "San José (Carmen)",
      direccion: "100m sur del parque",
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

  it("R18/R32: la plantilla vacía sigue teniendo 10 columnas y NINGUNA motivo_error", () => {
    expect(ORDENES_BULK_FIELDS.map((f) => f.key)).toHaveLength(10);
    expect(ORDENES_BULK_FIELDS.some((f) => f.key === COLUMNA_MOTIVO_ERROR)).toBe(false);
  });
});

/**
 * ⭑ FICHA 383 (T7.3, R13) — EL RECHAZO POR CARÁCTER NO IMPRIMIBLE VIAJA POR LOS CANALES QUE YA
 * EXISTÍAN, SIN TOCAR NI EL MÓDULO DE CHIPS NI EL DEL EXPORT.
 *
 * El backend emite el rechazo bajo LA CLAVE DE LA COLUMNA DEL ARCHIVO (`destinatario`,
 * `telefono`, `producto`, `direccion`, `num_remision`), que es justo lo que hace que los chips y
 * el `motivo_error` funcionen sin cambios. Esto lo COMPRUEBA en vez de darlo por supuesto — y de
 * paso mide algo que ningún otro test mira: el mensaje lleva un EMOJI (par suplente UTF-16) y dos
 * AISLANTES BIDI invisibles (U+2068/U+2069) y tiene que sobrevivir al viaje por el XLSX. Si
 * `exceljs` los mutilara, la tienda descargaría un motivo que no nombra ningún carácter.
 */
const CARA = "\u{1F642}"; // 🙂  U+1F642
const CARA_2 = "\u{1F600}"; // 😀  U+1F600

/**
 * El mensaje REAL que emite el backend, escrito como LITERAL. No se compone llamando al emisor:
 * eso sería una aserción contra su propia fuente y estaría verde pasara lo que pasara. El primer
 * test de abajo lo ANCLA al emisor, así que si el texto cambia, esto se pone rojo y alguien
 * vuelve a mirar los chips.
 */
const MOTIVO_CARA =
  "El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨\u{1F642}⁩» (U+1F642). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.";
const MOTIVO_CARA_2 =
  "El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨\u{1F600}⁩» (U+1F600). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.";

const filas383: FilaParseada[] = [
  {
    linea: 7,
    row: {
      destinatario: `Ana ${CARA}`,
      telefono: "88887777",
      provincia: "Cartago",
      canton_distrito: "Cartago (Occidental)",
      direccion: "200m sur",
      monto_cobrar: "25.90",
      producto: "Camiseta talla M",
      num_remision: "REM-0007",
      peso: "1.5",
      notas: "",
    },
  },
];

const errores383: OrdenConError[] = [
  { fila: 7, numRemision: "REM-0007", errores: { destinatario: [MOTIVO_CARA] } },
];

describe("Carga masiva — el rechazo por carácter no imprimible (ficha 383)", () => {
  it("el literal de este test ES el mensaje que emite el backend (ancla, no adorno)", () => {
    expect(mensajeCargaCaracterNoImprimible("destinatario", CARA, 0x1f642)).toBe(
      MOTIVO_CARA,
    );
    expect(mensajeCargaCaracterNoImprimible("destinatario", CARA_2, 0x1f600)).toBe(
      MOTIVO_CARA_2,
    );
  });

  it("R13: produce su chip sin tocar `carga-masiva-error-chips.ts`", () => {
    const chips = construirChips(errores383);

    expect(chips).toHaveLength(1);
    expect(chips[0].count).toBe(1);
    // La clave se forma con la columna del archivo, que es lo que permite filtrar por ella.
    expect(chips[0].key).toBe(`destinatario::${MOTIVO_CARA}`);
    expect(chips[0].label).toContain("no puede imprimir");
    expect(chips[0].label).toContain("U+1F642");
  });

  it("HOY: un chip por CARÁCTER, no por tipo — limitación MEDIDA, no un requisito", () => {
    // `canonizarMensaje` agrupa reemplazando lo que va entre comillas SIMPLES (`'…'`), que es
    // como escriben los mensajes de geografía. El de esta ficha lleva el carácter entre `«…»` y
    // además su `U+XXXX`, así que NO se canoniza: dos filas con dos emojis distintos dan DOS
    // chips. No rompe nada (el filtrado y el export funcionan) y la ficha no pide agruparlos.
    //
    // Queda escrito aquí, y no en una nota que nadie lee, porque el caso patológico es real: mil
    // filas con mil caracteres distintos pintarían mil chips y la fila de filtros se volvería
    // ilegible. Arreglarlo obliga a canonizar TAMBIÉN el `U+XXXX` y a decidir qué hacer con la
    // colisión de etiquetas que eso crea entre campos (`«destinatario»` y `«direccion»`
    // quedarían con la MISMA etiqueta y distinta clave) — otra ficha, no esta.
    //
    // SI ALGUIEN LO ARREGLA: este test se pone rojo. Es lo que se quiere. Actualízalo a 1.
    const chips = construirChips([
      { fila: 7, numRemision: "REM-0007", errores: { destinatario: [MOTIVO_CARA] } },
      { fila: 8, numRemision: "REM-0008", errores: { destinatario: [MOTIVO_CARA_2] } },
    ]);

    expect(
      chips,
      "si esto es 1, alguien canonizó el carácter en los chips: quita este test y actualiza el de arriba",
    ).toHaveLength(2);
    expect(chips.map((c) => c.count)).toEqual([1, 1]);
  });

  it("R13: llega al XLSX de errores con su `motivo_error`, y el carácter sobrevive", async () => {
    const rows = construirFilasErrorExport(errores383, filas383);
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), rows);
    const { rows: leidas } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");

    expect(leidas).toHaveLength(1);
    expect(leidas[0]?.[COLUMNA_MOTIVO_ERROR]).toBe(`Fila 7 — destinatario: ${MOTIVO_CARA}`);
    // El emoji es un par suplente y los aislantes bidi son invisibles: si el XLSX se los comiera,
    // el motivo descargado no nombraría ningún carácter y el `U+XXXX` se quedaría solo.
    expect(leidas[0]?.[COLUMNA_MOTIVO_ERROR]).toContain(CARA);
    expect(leidas[0]?.[COLUMNA_MOTIVO_ERROR]).toContain("⁨");
    expect(leidas[0]?.[COLUMNA_MOTIVO_ERROR]).toContain("⁩");
    // Y la celda del dato sigue trayendo el valor CRUDO del archivo, con su emoji, para que la
    // tienda vea qué corregir (R4 de la 143).
    expect(leidas[0]?.destinatario).toBe(`Ana ${CARA}`);
  });

  it("R13: y el parser del NAVEGADOR lee ese mismo archivo sin mutilar el carácter", async () => {
    const rows = construirFilasErrorExport(errores383, filas383);
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), rows);
    const { filas: leidas, headers } = await parsearComoNavegador(buffer);

    expect(findMissingHeaders(headers)).toEqual([]);
    expect(leidas[0]?.row[COLUMNA_MOTIVO_ERROR]).toBe(
      `Fila 7 — destinatario: ${MOTIVO_CARA}`,
    );
    expect(leidas[0]?.row.destinatario).toBe(`Ana ${CARA}`);
  });

  it("R13: corregida la celda, la fila re-subida vuelve a validar", async () => {
    // El round-trip completo de la 143 aplicado a esta ficha: el archivo de errores se corrige y
    // se vuelve a subir. Si esto no cerrara, el rechazo sería una vía muerta.
    const rows = construirFilasErrorExport(errores383, filas383).map((row) => ({
      ...row,
      destinatario: "Ana",
    }));
    const buffer = await buildXlsxRows(toXlsxColumns(ERRORES_EXPORT_FIELDS), rows);
    const { rows: leidas } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");

    const parsed = filaCargaSchema.parse(leidas[0]);
    expect(parsed.destinatario).toBe("Ana");
    expect(parsed.num_remision).toBe("REM-0007");
    expect(COLUMNA_MOTIVO_ERROR in parsed).toBe(false);
  });
});
