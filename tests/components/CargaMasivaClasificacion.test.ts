import { describe, it, expect } from "vitest";

import { clasificarBulkSummary } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

describe("clasificarBulkSummary — separa el resumen en tres grupos (R1, R2, R3)", () => {
  it("separa creada/duplicada/error en tres grupos disjuntos (R1)", () => {
    const data = {
      total: 3,
      creadas: 1,
      duplicadas: 1,
      conError: 1,
      filas: [
        { fila: 1, numRemision: "REM-0001", resultado: "creada" },
        {
          fila: 2,
          numRemision: "REM-0002",
          resultado: "duplicada",
          estatus: "en_preparacion",
        },
        {
          fila: 3,
          numRemision: "REM-0003",
          resultado: "error",
          errores: { num_remision: ["obligatorio"] },
        },
      ],
    };

    const clasif = clasificarBulkSummary(data);

    expect(clasif.numRemisionesNuevas).toEqual(["REM-0001"]);
    expect(clasif.existentes).toEqual([
      { numRemision: "REM-0002", estatus: "en_preparacion" },
    ]);
    expect(clasif.errores).toEqual([
      {
        fila: 3,
        numRemision: "REM-0003",
        errores: { num_remision: ["obligatorio"] },
      },
    ]);
  });

  it("separa el resumen incluso con data desconocida (R2)", () => {
    for (const data of [undefined, null, 42, "x", {}, { filas: "nope" }]) {
      const clasif = clasificarBulkSummary(data);
      expect(clasif.numRemisionesNuevas).toEqual([]);
      expect(clasif.existentes).toEqual([]);
      expect(clasif.errores).toEqual([]);
      expect(clasif.ajustadas).toEqual([]);
    }
  });

  it("duplicada sin estatus → estatus: null (R3)", () => {
    const clasif = clasificarBulkSummary({
      filas: [{ fila: 1, numRemision: "REM-0009", resultado: "duplicada" }],
    });

    expect(clasif.existentes).toEqual([
      { numRemision: "REM-0009", estatus: null },
    ]);
  });

  it("error sin errores → errores: {} conservando fila/numRemision (R3)", () => {
    const clasif = clasificarBulkSummary({
      filas: [{ fila: 7, numRemision: "REM-0007", resultado: "error" }],
    });

    expect(clasif.errores).toEqual([
      { fila: 7, numRemision: "REM-0007", errores: {} },
    ]);
  });

  it("una carga NORMAL no gana ni un ajuste (feature 304)", () => {
    // El caso de casi todas: sin `montoAjustado` en ninguna fila, `ajustadas` queda vacío y
    // el resumen se pinta exactamente igual que antes de esta ficha.
    const clasif = clasificarBulkSummary({
      filas: [
        { fila: 1, numRemision: "REM-0001", resultado: "creada" },
        { fila: 2, numRemision: "REM-0002", resultado: "duplicada" },
      ],
    });

    expect(clasif.ajustadas).toEqual([]);
  });

  it("ignora filas sin forma esperada sin lanzar (R2)", () => {
    const clasif = clasificarBulkSummary({
      filas: [null, 5, "x", { resultado: "creada" }],
    });

    // La fila creada sin numRemision string no aporta remisión.
    expect(clasif.numRemisionesNuevas).toEqual([]);
    expect(clasif.existentes).toEqual([]);
    expect(clasif.errores).toEqual([]);
    // Y una creada sin remisión tampoco aporta un ajuste que nadie podría nombrar.
    expect(clasif.ajustadas).toEqual([]);
  });
});

/**
 * FEATURE 304 — EL AVISO DE MONTO REDONDEADO SOBREVIVE AL VIAJE.
 *
 * La 299 emite `montoAjustado: { original, aplicado }` en la fila creada, y aquí es donde ese
 * dato moría: de una fila `creada` solo se conservaba el `numRemision`, así que el resumen de
 * la carga no tenía con qué pintarlo. El integrador se enteraba por el JSON; la tienda que
 * sube por pantalla, no.
 */
describe("clasificarBulkSummary — montos redondeados (feature 304)", () => {
  /** El caso REAL de la captura del 2026-08-27 que motivó la 299. */
  const AJUSTE = { original: 11898.81, aplicado: 11899 };

  it("una fila creada con `montoAjustado` llega con LOS DOS montos y su fila", () => {
    const clasif = clasificarBulkSummary({
      filas: [
        { fila: 7, numRemision: "REM-0007", resultado: "creada", montoAjustado: AJUSTE },
        { fila: 8, numRemision: "REM-0008", resultado: "creada" },
      ],
    });

    expect(clasif.ajustadas).toEqual([
      { fila: 7, numRemision: "REM-0007", original: 11898.81, aplicado: 11899 },
    ]);
    // Y NO deja de ser una creada: el ajuste es una vista, no un cuarto grupo.
    expect(clasif.numRemisionesNuevas).toEqual(["REM-0007", "REM-0008"]);
    expect(clasif.errores).toEqual([]);
    expect(clasif.existentes).toEqual([]);
  });

  it("solo cuenta el ajuste de las CREADAS: una duplicada o una con error no ajustó nada", () => {
    // El backend ya borra el aviso al reclasificar una omitida a `duplicada` (299); esto es la
    // segunda vuelta de llave en el cliente: si la fila no creó ninguna orden, no hay monto
    // ajustado que contar, que es la misma mentira que la 294 vino a matar.
    const clasif = clasificarBulkSummary({
      filas: [
        {
          fila: 1,
          numRemision: "REM-0001",
          resultado: "duplicada",
          estatus: "en_preparacion",
          montoAjustado: AJUSTE,
        },
        {
          fila: 2,
          numRemision: "REM-0002",
          resultado: "error",
          errores: { telefono: ["x"] },
          montoAjustado: AJUSTE,
        },
      ],
    });

    expect(clasif.ajustadas).toEqual([]);
    expect(clasif.existentes).toHaveLength(1);
    expect(clasif.errores).toHaveLength(1);
  });

  it("un `montoAjustado` que no trae dos montos finitos se ignora sin lanzar", () => {
    const basura: unknown[] = [
      null,
      42,
      "11899",
      {},
      { original: 11898.81 },
      { aplicado: 11899 },
      { original: "11898.81", aplicado: 11899 },
      { original: 11898.81, aplicado: null },
      { original: Number.NaN, aplicado: 11899 },
      { original: Number.POSITIVE_INFINITY, aplicado: 11899 },
    ];

    for (const montoAjustado of basura) {
      const clasif = clasificarBulkSummary({
        filas: [{ fila: 1, numRemision: "REM-0001", resultado: "creada", montoAjustado }],
      });
      expect(clasif.ajustadas, JSON.stringify(montoAjustado ?? null)).toEqual([]);
      // La fila sigue siendo una creada normal pase lo que pase con el aviso.
      expect(clasif.numRemisionesNuevas).toEqual(["REM-0001"]);
    }
  });

  it("un ajuste que no cambia el monto NO se anuncia", () => {
    // Pintar «de ₡11.899 a ₡11.899» es exactamente la pantalla que se contradice sola de las
    // fichas 299/300. Un aviso que no informa de ningún cambio no se pinta.
    const clasif = clasificarBulkSummary({
      filas: [
        {
          fila: 1,
          numRemision: "REM-0001",
          resultado: "creada",
          montoAjustado: { original: 11899, aplicado: 11899 },
        },
      ],
    });

    expect(clasif.ajustadas).toEqual([]);
    expect(clasif.numRemisionesNuevas).toEqual(["REM-0001"]);
  });

  it("sin `fila` numérica el ajuste sigue llegando, con `fila: null`", () => {
    const clasif = clasificarBulkSummary({
      filas: [{ numRemision: "REM-0001", resultado: "creada", montoAjustado: AJUSTE }],
    });

    expect(clasif.ajustadas).toEqual([
      { fila: null, numRemision: "REM-0001", original: 11898.81, aplicado: 11899 },
    ]);
  });
});
