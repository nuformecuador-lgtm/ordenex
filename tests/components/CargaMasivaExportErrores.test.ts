import { describe, it, expect, vi } from "vitest";

import {
  COLUMNA_MOTIVO_ERROR,
  ERRORES_EXPORT_FIELDS,
  construirFilasErrorExport,
  motivoErrorDeFila,
  nombreArchivoErrores,
} from "@/app/(app)/ordenes/_components/carga-masiva-export-errores";
import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/carga-masiva-fields";
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import { clasificarBulkSummary } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { procesarEnChunks } from "@/app/(app)/ordenes/_components/carga-masiva-chunks";
import type { BulkSummary } from "@/lib/types/carga-masiva";

/**
 * Feature 143 — Compositor PURO de las filas del export de "órdenes con error".
 * Cubre R1, R3, R4, R5, R6, R7, R8, R10 y R22.
 */

function fila(linea: number, row: Record<string, string>): FilaParseada {
  return { linea, row };
}

function error(
  fila: number | null,
  numRemision: string,
  errores: Record<string, string[]> = {},
): OrdenConError {
  return { fila, numRemision, errores };
}

describe("ERRORES_EXPORT_FIELDS", () => {
  it("R1: las 8 columnas de la plantilla en su orden + motivo_error al final", () => {
    expect(ERRORES_EXPORT_FIELDS.map((f) => f.key)).toEqual([
      ...ORDENES_BULK_FIELDS.map((f) => f.key),
      COLUMNA_MOTIVO_ERROR,
    ]);
    expect(COLUMNA_MOTIVO_ERROR).toBe("motivo_error");
  });

  it("R1: hay UNA sola columna extra (nada de `fila_original` ni segunda columna)", () => {
    expect(ERRORES_EXPORT_FIELDS).toHaveLength(ORDENES_BULK_FIELDS.length + 1);
  });
});

describe("motivoErrorDeFila", () => {
  it("R6: `Fila N — campo: mensaje` con el mismo detalle que la columna Motivo", () => {
    expect(
      motivoErrorDeFila(error(7, "REM-7", { telefono: ["debe tener 8 dígitos"] })),
    ).toBe("Fila 7 — telefono: debe tener 8 dígitos");
  });

  it("R6/R8: varios mensajes de un campo se separan con ', '", () => {
    expect(
      motivoErrorDeFila(
        error(7, "REM-7", { telefono: ["debe tener 8 dígitos", "formato inválido"] }),
      ),
    ).toBe("Fila 7 — telefono: debe tener 8 dígitos, formato inválido");
  });

  it("R6/R8: varios campos se separan con '; ' y el prefijo aparece UNA sola vez", () => {
    const texto = motivoErrorDeFila(
      error(12, "REM-12", {
        direccion_destinatario: ["distrito no encontrado"],
        monto_cobrar: ["debe ser numérico y no negativo"],
      }),
    );
    expect(texto).toBe(
      "Fila 12 — direccion_destinatario: distrito no encontrado; monto_cobrar: debe ser numérico y no negativo",
    );
    expect(texto.match(/Fila 12/g)).toHaveLength(1);
    expect(texto.match(/Fila /g)).toHaveLength(1);
  });

  it("R7: sin detalle (mapa vacío) → `Fila N — Error de validación`", () => {
    expect(motivoErrorDeFila(error(3, "REM-3", {}))).toBe("Fila 3 — Error de validación");
  });

  it("R7: campos sin mensajes también degradan al motivo genérico", () => {
    expect(motivoErrorDeFila(error(3, "REM-3", { telefono: [] }))).toBe(
      "Fila 3 — Error de validación",
    );
  });

  it("R22: `fila: null` → SIN prefijo; no se inventa número de fila", () => {
    const texto = motivoErrorDeFila(
      error(null, "REM-X", { telefono: ["debe tener 8 dígitos"] }),
    );
    expect(texto).toBe("telefono: debe tener 8 dígitos");
    expect(texto).not.toMatch(/Fila/);
  });

  it("R22: `fila: null` y sin detalle → solo el motivo genérico, sin prefijo", () => {
    expect(motivoErrorDeFila(error(null, "", {}))).toBe("Error de validación");
  });
});

describe("construirFilasErrorExport", () => {
  const filas = [
    fila(1, {
      destinatario: "Ana",
      telefono: "8888",
      direccion_destinatario: "CR / SJ / SJ (Carmen) / 100m sur",
      monto_cobrar: "abc",
      producto: "Camisa",
      num_remision: "REM-1",
      peso: "1.5",
      notas: "  ojo  ",
    }),
    fila(2, { destinatario: "Beto", num_remision: "REM-2" }),
    fila(3, { destinatario: "Cita", num_remision: "REM-3" }),
  ];

  it("R3/R4: una fila por error, en el orden de la clasificación, con valores CRUDOS", () => {
    const salida = construirFilasErrorExport(
      [
        error(3, "REM-3", { telefono: ["obligatorio"] }),
        error(1, "REM-1", { monto_cobrar: ["debe ser numérico y no negativo"] }),
      ],
      filas,
    );

    expect(salida).toHaveLength(2);
    // Orden de la clasificación, NO el del archivo.
    expect(salida[0]?.num_remision).toBe("REM-3");
    expect(salida[1]?.num_remision).toBe("REM-1");
    // Valores crudos, tal cual los devolvió el parser (incluido "abc" inválido).
    expect(salida[1]?.destinatario).toBe("Ana");
    expect(salida[1]?.monto_cobrar).toBe("abc");
    expect(salida[1]?.notas).toBe("  ojo  ");
  });

  it("R1/R4: cada fila trae las 8 claves de la plantilla + motivo_error", () => {
    const [salida] = construirFilasErrorExport([error(2, "REM-2")], filas);
    expect(Object.keys(salida ?? {}).sort()).toEqual(
      [...ORDENES_BULK_FIELDS.map((f) => f.key), COLUMNA_MOTIVO_ERROR].sort(),
    );
    // Clave ausente en la fila cruda → celda vacía.
    expect(salida?.telefono).toBe("");
    expect(salida?.peso).toBe("");
  });

  it("R5: `fila: null` → se emite igual, vacía salvo num_remision, sin lanzar", () => {
    const salida = construirFilasErrorExport(
      [error(null, "REM-HUERFANA", { num_remision: ["obligatorio"] })],
      filas,
    );
    expect(salida).toHaveLength(1);
    expect(salida[0]?.num_remision).toBe("REM-HUERFANA");
    expect(salida[0]?.destinatario).toBe("");
    expect(salida[0]?.direccion_destinatario).toBe("");
  });

  it("R5: línea sin correspondencia → fila degradada y el resto se sigue generando", () => {
    const salida = construirFilasErrorExport(
      [
        error(99, "REM-99", { telefono: ["obligatorio"] }),
        error(1, "REM-1", { telefono: ["obligatorio"] }),
      ],
      filas,
    );
    expect(salida).toHaveLength(2);
    expect(salida[0]?.destinatario).toBe("");
    expect(salida[0]?.num_remision).toBe("REM-99");
    // La siguiente fila SÍ cruza y trae sus valores crudos.
    expect(salida[1]?.destinatario).toBe("Ana");
  });

  it("R5: sin filas parseadas no lanza; degrada todas las filas", () => {
    expect(() => construirFilasErrorExport([error(1, "REM-1")], [])).not.toThrow();
    expect(construirFilasErrorExport([error(1, "REM-1")], [])[0]?.num_remision).toBe(
      "REM-1",
    );
  });

  it("R6: el motivo_error de cada fila lleva su prefijo de línea", () => {
    const salida = construirFilasErrorExport(
      [error(1, "REM-1", { telefono: ["debe tener 8 dígitos"] })],
      filas,
    );
    expect(salida[0]?.[COLUMNA_MOTIVO_ERROR]).toBe(
      "Fila 1 — telefono: debe tener 8 dígitos",
    );
  });

  it("R8: dos generaciones sobre la misma clasificación dan un resultado idéntico", () => {
    const errores = [
      error(1, "REM-1", { telefono: ["a", "b"], monto_cobrar: ["c"] }),
      error(null, "REM-Z", {}),
    ];
    const a = construirFilasErrorExport(errores, filas);
    const b = construirFilasErrorExport(errores, filas);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("nombreArchivoErrores", () => {
  it("R10: `ordenes-con-error-AAAAMMDD-HHmm.xlsx` con hora local, cero-rellenado", () => {
    // Fecha LOCAL (constructor con componentes): 5 de marzo de 2026, 09:07.
    expect(nombreArchivoErrores(new Date(2026, 2, 5, 9, 7))).toBe(
      "ordenes-con-error-20260305-0907.xlsx",
    );
  });

  it("R10/R21: la extensión ofrecida es siempre .xlsx", () => {
    expect(nombreArchivoErrores(new Date(2026, 11, 31, 23, 59))).toBe(
      "ordenes-con-error-20261231-2359.xlsx",
    );
  });
});

/**
 * T6 / riesgo R-1 — El cruce `OrdenConError.fila` ↔ `FilaParseada.linea` solo es
 * válido porque `procesarEnChunks` REMAPEA la fila relativa al lote a la línea
 * original del archivo. Si alguien elimina ese remapeo, el export saldría con
 * los valores de OTRAS filas (peor que vacío) y este test debe gritar.
 */
describe("Cruce fila ↔ linea a través de procesarEnChunks (R4)", () => {
  it("R4: con varios lotes, cada fila con error exporta SUS propios valores crudos", async () => {
    // 4 filas, chunkSize 2 → dos lotes. Dentro del 2º lote, el servidor numera
    // 1 y 2; sin remapeo, la fila 3 del archivo se leería como la fila 1.
    const filas: FilaParseada[] = [
      fila(1, { num_remision: "REM-1", destinatario: "Uno", telefono: "1" }),
      fila(2, { num_remision: "REM-2", destinatario: "Dos", telefono: "2" }),
      fila(3, { num_remision: "REM-3", destinatario: "Tres", telefono: "3" }),
      fila(4, { num_remision: "REM-4", destinatario: "Cuatro", telefono: "4" }),
    ];

    // El endpoint devuelve la fila RELATIVA al lote (1-based), como en producción.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rows: Record<string, string>[] };
      const summary: BulkSummary = {
        total: body.rows.length,
        creadas: 0,
        duplicadas: 0,
        conError: body.rows.length,
        filas: body.rows.map((row, i) => ({
          fila: i + 1,
          numRemision: row.num_remision ?? "",
          resultado: "error" as const,
          errores: { telefono: ["debe tener 8 dígitos"] },
        })),
      };
      return new Response(JSON.stringify(summary), { status: 200 });
    }) as unknown as typeof fetch;

    const resultados = await procesarEnChunks(filas, {
      dryRun: true,
      chunkSize: 2,
      fetchImpl,
    });
    const clasificacion = clasificarBulkSummary({ filas: resultados });
    const salida = construirFilasErrorExport(clasificacion.errores, filas);

    expect(salida).toHaveLength(4);
    // Si el remapeo desapareciera, las filas 3 y 4 traerían "Uno"/"Dos".
    expect(salida.map((r) => r.destinatario)).toEqual([
      "Uno",
      "Dos",
      "Tres",
      "Cuatro",
    ]);
    expect(salida.map((r) => r[COLUMNA_MOTIVO_ERROR])).toEqual([
      "Fila 1 — telefono: debe tener 8 dígitos",
      "Fila 2 — telefono: debe tener 8 dígitos",
      "Fila 3 — telefono: debe tener 8 dígitos",
      "Fila 4 — telefono: debe tener 8 dígitos",
    ]);
  });
});
