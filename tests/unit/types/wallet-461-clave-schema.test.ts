import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  anularAjusteCajaSchema,
  claveIdempotenciaSchema,
  registrarEgresoAdministrativoSchema,
  registrarMovimientoManualSchema,
} from "@/lib/types/wallet";
import { registrarCobroTiendaSchema } from "@/lib/types/wallet-tienda";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R66 y R70 (auditoria de la wallet, D2 y D3) — el BORDE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// R66: los TRES registros manuales de dinero exigen `claveIdempotencia` (uuid). Antes se aceptaban sin
// ella, y dos envios iguales eran dos filas (auditoria: dos cobros identicos en 10 s). Lo que la clave
// hace en la BASE (una sola fila, `ya_registrado`) se mide en
// `tests/integration/db/wallet-461-idempotencia-clave.test.ts`.
// R70: la anulacion de una correccion de caja es `.strict()`: una peticion con `monto` muere aqui.

const CLAVE = randomUUID();

const COBRO = { tiendaId: randomUUID(), monto: "1500.00", descripcion: "Etiquetas" };
const CORRECCION = { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "Sobrante" };
const GASTO = { tipoEgreso: "gasto_variable", monto: "1234.56", descripcion: "Cajas" };

function campos(r: { success: boolean; error?: { flatten(): { fieldErrors: Record<string, unknown> } } }): string[] {
  return r.success || r.error === undefined ? [] : Object.keys(r.error.flatten().fieldErrors).sort();
}

describe("461/R66 — la clave de idempotencia es OBLIGATORIA en los tres registros manuales", () => {
  it.each([
    ["cobro de Ordenex a una tienda", registrarCobroTiendaSchema, COBRO],
    ["correccion de caja", registrarMovimientoManualSchema, CORRECCION],
    ["sueldo o gasto de Ordenex", registrarEgresoAdministrativoSchema, GASTO],
  ])("%s: sin clave -> validation_error bajo `claveIdempotencia`, y con ella pasa TAL CUAL", (_n, schema, base) => {
    const sin = schema.safeParse(base);
    expect(sin.success).toBe(false);
    expect(campos(sin)).toEqual(["claveIdempotencia"]);

    const con = schema.safeParse({ ...base, claveIdempotencia: CLAVE });
    expect(con.success).toBe(true);
    if (con.success) expect((con.data as { claveIdempotencia: string }).claveIdempotencia).toBe(CLAVE);
  });

  it.each([
    ["cobro de Ordenex a una tienda", registrarCobroTiendaSchema, COBRO],
    ["correccion de caja", registrarMovimientoManualSchema, CORRECCION],
    ["sueldo o gasto de Ordenex", registrarEgresoAdministrativoSchema, GASTO],
  ])("%s: una clave que no es uuid tambien muere en el borde", (_n, schema, base) => {
    for (const mala of ["", "1", "doble-clic", "6b1f0d2e-7c3a-4d5b-9e8f"]) {
      const r = schema.safeParse({ ...base, claveIdempotencia: mala });
      expect(r.success, `clave «${mala}»`).toBe(false);
      expect(campos(r)).toEqual(["claveIdempotencia"]);
    }
  });

  it("la pieza es UNA (`claveIdempotenciaSchema`) y sus mensajes dicen que falta o que no es uuid", () => {
    const falta = claveIdempotenciaSchema.safeParse(undefined);
    const mala = claveIdempotenciaSchema.safeParse("x");
    expect(falta.success).toBe(false);
    expect(mala.success).toBe(false);
    if (!falta.success) expect(falta.error.issues[0]?.message).toBe("Falta la clave de idempotencia del registro.");
    if (!mala.success) expect(mala.error.issues[0]?.message).toBe("La clave de idempotencia debe ser un uuid.");
  });
});

describe("461/R70 — anular una correccion de caja: la fila y un motivo, y NADA mas", () => {
  it("acepta `movimientoId` (uuid) y `motivo` recortado y no vacio", () => {
    const r = anularAjusteCajaSchema.safeParse({ movimientoId: CLAVE, motivo: "  Se registro dos veces  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ movimientoId: CLAVE, motivo: "Se registro dos veces" });
  });

  it("sin motivo, o con un motivo en blanco, es validation_error bajo `motivo`", () => {
    expect(campos(anularAjusteCajaSchema.safeParse({ movimientoId: CLAVE }))).toEqual(["motivo"]);
    expect(campos(anularAjusteCajaSchema.safeParse({ movimientoId: CLAVE, motivo: "   " }))).toEqual(["motivo"]);
  });

  it("`.strict()`: una peticion con `monto` —o cualquier clave de mas— muere en el borde", () => {
    // El monto del contra-asiento se lee DE LA CORRECCION en el servidor; si el cliente pudiera
    // dictarlo, anular seria una via para escribir cualquier cifra en el libro de la caja.
    expect(anularAjusteCajaSchema.safeParse({ movimientoId: CLAVE, motivo: "x", monto: "1.00" }).success).toBe(false);
    expect(anularAjusteCajaSchema.safeParse({ movimientoId: CLAVE, motivo: "x", tipo: "egreso" }).success).toBe(false);
    expect(anularAjusteCajaSchema.safeParse({ movimientoId: "no-es-uuid", motivo: "x" }).success).toBe(false);
  });
});
