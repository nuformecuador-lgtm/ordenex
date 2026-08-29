import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  buildManifiestoXlsx,
  COLUMNAS_MANIFIESTO,
} from "@/lib/utils/manifiesto-xlsx";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";

// Feature 194 (T5) — el generador acepta un SUBCONJUNTO de columnas elegido por el usuario:
// R7 (el archivo trae las visibles y ninguna oculta), R9 (la cabecera emite la clave máquina),
// R13 (una selección vacía degrada a "todas", no falla) y R24 (sin selección, todas).
//
// ── DEROGACIÓN DE 194/R8 (ficha 314, decisión del humano del 2026-08-28) ──────────────────
// La 194 decidió que el orden del archivo fuera SIEMPRE el de `COLUMNAS_MANIFIESTO`, sin hacer
// caso al orden en que llegaran las claves. La ficha 314 da al selector la capacidad de
// REORDENAR y la aplica «al componente entero y en todos sus usos, manifiesto incluido»
// (314/R20, R21), así que R8 deja de regir: el generador emite EN EL ORDEN RECIBIDO.
//
// El caso de abajo NO se borra, se VOLTEA —afirma ahora lo contrario— porque lo que importa
// conservar es la pregunta, no la respuesta: «¿qué hace el generador cuando las claves llegan
// invertidas?». La alternativa que se descartó era dejar 194/R8 intacto y ofrecer reordenar
// solo en pantalla: el usuario movería columnas, la lista se movería, y el archivo saldría
// igual que antes sin un solo error. El fallo mudo de manual.
//
// En producción la conducta solo cambia para quien reordena: sin orden guardado, el orden
// efectivo ES el del catálogo y el archivo sale exactamente como ayer.
//
// R23 / 160-R28: el conjunto de columnas es ABIERTO. NINGÚN aserto de esta suite afirma un
// número total de columnas. Todo se expresa como "contiene", "no contiene" o "índice
// RELATIVO", y "todas las publicadas" se compara contra `COLUMNAS_MANIFIESTO` derivado, nunca
// contra una lista literal.

/** Recarga el binario con la misma librería (round-trip real, sin dobles). */
async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

/**
 * Cabeceras NO vacías de la fila 1. Se recorren tantas celdas como columnas publicadas para
 * no depender de una cardinalidad concreta: lo emitido es siempre un subconjunto de eso.
 */
async function cabeceraDe(buffer: ArrayBuffer): Promise<string[]> {
  const workbook = await loadWorkbook(buffer);
  const row = workbook.worksheets[0].getRow(1);
  const cabecera: string[] = [];
  for (let col = 1; col <= COLUMNAS_MANIFIESTO.length; col++) {
    const value = row.getCell(col).value;
    if (value === null || value === undefined) continue;
    cabecera.push(String(value));
  }
  return cabecera;
}

/** Cabecera publicada de una columna, buscada por su `key` (sin fijar cardinalidad). */
function headerDe(key: string): string {
  const columna = COLUMNAS_MANIFIESTO.find((c) => c.key === key);
  if (!columna) throw new Error(`columna ${key} ausente de COLUMNAS_MANIFIESTO`);
  return columna.header;
}

/** Todas las cabeceras publicadas, derivadas de la constante (nunca literales). */
function todasLasPublicadas(): string[] {
  return COLUMNAS_MANIFIESTO.map((c) => c.header);
}

function makeFila(over: Partial<ManifiestoFilaDTO> = {}): ManifiestoFilaDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    telefono: "88880000",
    direccion: "Calle 1, casa 2",
    zona: "Limón",
    producto: "Camiseta talla M",
    monto: 15000,
    intentos: 0,
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-07-28",
    ...over,
  };
}

describe("buildManifiestoXlsx con selección de columnas (feature 194)", () => {
  it("R7/R9: emite en la cabecera las claves máquina pedidas y ninguna de las ocultas", async () => {
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], [
        "numGuia",
        "destinatario",
        "fecha",
      ]),
    );

    expect(cabecera).toContain(headerDe("numGuia"));
    expect(cabecera).toContain(headerDe("destinatario"));
    expect(cabecera).toContain(headerDe("fecha"));
    // Las no pedidas quedan fuera del archivo.
    expect(cabecera).not.toContain(headerDe("numRemision"));
    expect(cabecera).not.toContain(headerDe("telefono"));
    expect(cabecera).not.toContain(headerDe("monto"));
    expect(cabecera).not.toContain(headerDe("intentos"));
  });

  it("R7: los datos de la fila viajan bajo la columna visible que les corresponde", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([makeFila({ destinatario: "Carla Ruiz" })], [
        "destinatario",
        "monto",
      ]),
    );
    const worksheet = workbook.worksheets[0];
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], ["destinatario", "monto"]),
    );

    const colDestinatario = cabecera.indexOf(headerDe("destinatario")) + 1;
    const colMonto = cabecera.indexOf(headerDe("monto")) + 1;
    expect(worksheet.getRow(2).getCell(colDestinatario).value).toBe("Carla Ruiz");
    expect(worksheet.getRow(2).getCell(colMonto).value).toBe(15000);
  });

  it("314/R20: emite las columnas en el orden RECIBIDO, aunque venga invertido (deroga 194/R8)", async () => {
    // El usuario puso `fecha` la primera y `numGuia` la última: el archivo le hace caso. Este
    // caso afirmaba lo contrario hasta la ficha 314; la derogación está razonada arriba.
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], [
        "fecha",
        "zona",
        "destinatario",
        "numGuia",
      ]),
    );

    // Índices RELATIVOS entre las claves pedidas, nunca posiciones absolutas.
    expect(cabecera.indexOf(headerDe("fecha"))).toBeLessThan(
      cabecera.indexOf(headerDe("zona")),
    );
    expect(cabecera.indexOf(headerDe("zona"))).toBeLessThan(
      cabecera.indexOf(headerDe("destinatario")),
    );
    expect(cabecera.indexOf(headerDe("destinatario"))).toBeLessThan(
      cabecera.indexOf(headerDe("numGuia")),
    );
    // Y la secuencia emitida es EXACTAMENTE la pedida: no sobra ni falta ninguna.
    expect(cabecera).toEqual([
      headerDe("fecha"),
      headerDe("zona"),
      headerDe("destinatario"),
      headerDe("numGuia"),
    ]);
  });

  it("314/R20: una clave repetida en la petición no duplica su columna en el archivo", async () => {
    // El orden lo pone quien llama, así que una lista con una clave dos veces dejaría de ser
    // un subconjunto: emitiría la misma cabecera dos veces y `buildXlsxRows` volcaría el mismo
    // dato en dos columnas. Se queda con la primera aparición.
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], [
        "zona",
        "numGuia",
        "zona",
      ]),
    );

    expect(cabecera).toEqual([headerDe("zona"), headerDe("numGuia")]);
  });

  it("R13: una selección VACÍA emite todas las columnas publicadas en vez de fallar", async () => {
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], []),
    );

    expect(cabecera).toEqual(todasLasPublicadas());
  });

  it("R13: una selección de la que no casa NINGUNA clave degrada a todas las publicadas", async () => {
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], [
        "columna_que_no_existe",
        "otra_mas",
      ]),
    );

    expect(cabecera).toEqual(todasLasPublicadas());
  });

  it("R24: sin segundo parámetro emite todas las columnas publicadas, como hasta hoy", async () => {
    const cabecera = await cabeceraDe(await buildManifiestoXlsx([makeFila()]));

    expect(cabecera).toEqual(todasLasPublicadas());
  });

  it("R7: una clave DESCONOCIDA se ignora sin romper y no añade columna alguna", async () => {
    const cabecera = await cabeceraDe(
      await buildManifiestoXlsx([makeFila()], [
        "numGuia",
        "no_es_una_columna",
        "zona",
      ]),
    );

    expect(cabecera).toContain(headerDe("numGuia"));
    expect(cabecera).toContain(headerDe("zona"));
    expect(cabecera).not.toContain("no_es_una_columna");
    // Solo sobreviven claves publicadas: cada cabecera emitida pertenece a la lista.
    for (const header of cabecera) {
      expect(todasLasPublicadas()).toContain(header);
    }
  });

  it("R17 (148, vigente): sigue lanzando sin filas aunque se pase una selección", async () => {
    await expect(buildManifiestoXlsx([], ["numGuia"])).rejects.toThrow();
  });
});
