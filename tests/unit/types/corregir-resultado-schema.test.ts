import { describe, it, expect } from "vitest";

import { corregirResultadoGestionSchema } from "@/lib/types/cierres-admin";
import { motivoSchema } from "@/lib/types/gestion-orden";

// 💰 FICHA 398 (T3.1) — EL BORDE de la correccion en sitio del resultado de una gestion.
//
// LO QUE ESTE ARCHIVO PROTEGE, y no es forma por la forma: el contrato de esta ficha es que se
// corrige UNA y solo UNA pareja (`entregada -> rechazada`). El destino NO viaja en la peticion, y
// el dia que alguien lo añada «para reusar el endpoint» quedaran abiertas `entregada -> devuelta`
// y `rechazada -> entregada`, que mueven dinero en direcciones distintas y ninguna esta decidida.

const GESTION = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const MOTIVO = "el cliente rechazo el paquete";

describe("398/T3.1 — el borde acepta EXACTAMENTE dos campos", () => {
  it("una peticion valida pasa y sale con el motivo RECORTADO", () => {
    const r = corregirResultadoGestionSchema.parse({
      gestionId: GESTION,
      motivo: `   ${MOTIVO}   `,
    });
    expect(r).toEqual({ gestionId: GESTION, motivo: MOTIVO });
  });

  it("⭑ una peticion con `nuevoResultado` colado NO pasa: `.strict()` la rechaza", () => {
    // El caso que da sentido al archivo. Sin `.strict()` el campo se DESCARTARIA EN SILENCIO y el
    // cliente creeria que eligio el destino; con `.strict()` es un error de validacion.
    const r = corregirResultadoGestionSchema.safeParse({
      gestionId: GESTION,
      motivo: MOTIVO,
      nuevoResultado: "devuelta",
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ["resultado", { resultado: "rechazada" }],
    ["cierreId", { cierreId: GESTION }],
    ["evidencias", { evidencias: [{ storagePath: "x", contentType: "image/jpeg" }] }],
    ["pagoMensajero", { pagoMensajero: "0.00" }],
    ["ingresoBodegaRechazo", { ingresoBodegaRechazo: "1000.00" }],
  ])("una clave desconocida (`%s`) es `validation_error`, no un descarte mudo", (_n, extra) => {
    const r = corregirResultadoGestionSchema.safeParse({
      gestionId: GESTION,
      motivo: MOTIVO,
      ...extra,
    });
    expect(r.success).toBe(false);
  });
});

describe("398/R5 — el motivo del borde es EL MISMO que exige un rechazo real", () => {
  it.each(["", "   ", "\t\n "])("el motivo %j no pasa el borde", (motivo) => {
    expect(corregirResultadoGestionSchema.safeParse({ gestionId: GESTION, motivo }).success).toBe(
      false,
    );
  });

  it("⭑ el schema del motivo es LITERALMENTE el de una gestion `rechazada`, no una copia", () => {
    // La comprobacion no compara textos: ejercita los DOS schemas con las MISMAS entradas y exige
    // el mismo veredicto en todas. Si alguien reescribiera el motivo aqui con otro minimo o sin
    // `trim`, este caso lo dice — y ese es el defecto que R32 (una sola declaracion del umbral)
    // existe para impedir.
    const entradas = ["", " ", "  x  ", "a".repeat(500), "rechazo por direccion errada"];
    for (const entrada of entradas) {
      const delRechazo = motivoSchema.safeParse(entrada);
      const delBorde = corregirResultadoGestionSchema.safeParse({
        gestionId: GESTION,
        motivo: entrada,
      });
      expect(delBorde.success, `discrepan en ${JSON.stringify(entrada)}`).toBe(delRechazo.success);
      if (delRechazo.success && delBorde.success) {
        expect(delBorde.data.motivo).toBe(delRechazo.data);
      }
    }
    // Anti-vacuidad: al menos una entrada pasa y al menos una falla.
    expect(motivoSchema.safeParse("").success).toBe(false);
    expect(motivoSchema.safeParse("x").success).toBe(true);
  });
});

describe("398 — el identificador de la gestion es un uuid", () => {
  it.each(["", "g-1", "1234", "00000000-0000-0000-0000-00000000000"])(
    "`%s` no es un uuid y no llega al servicio",
    (gestionId) => {
      expect(
        corregirResultadoGestionSchema.safeParse({ gestionId, motivo: MOTIVO }).success,
      ).toBe(false);
    },
  );

  it("falta `gestionId` -> no pasa", () => {
    expect(corregirResultadoGestionSchema.safeParse({ motivo: MOTIVO }).success).toBe(false);
  });

  it("falta `motivo` -> no pasa", () => {
    expect(corregirResultadoGestionSchema.safeParse({ gestionId: GESTION }).success).toBe(false);
  });
});
