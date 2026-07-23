import { describe, it, expect } from "vitest";
import type { ZodError } from "zod";
import { gestionarSchema } from "@/lib/types/gestion-orden";

/**
 * `flatten().fieldErrors` de una discriminatedUnion es un tipo UNION (uno por variante), asi
 * que TS no deja indexar por un campo que solo existe en una rama. Se normaliza a un mapa
 * plano: es lo mismo que hace el panel al pintar errores por campo (`firstError`), y lo que
 * consume la Server Action al devolver `fieldErrors`.
 */
function fieldErrorsDe(error: ZodError<unknown>): Record<string, string[] | undefined> {
  return error.flatten().fieldErrors as Record<string, string[] | undefined>;
}

// Feature 73 (R1/R6/R7/R8/R9/R10) — el BORDE (zod) de la causa tipificada. Este es el MISMO
// schema que usan el panel (cliente) y la Server Action (servidor): validarlo aqui valida las
// dos defensas (R9). La obligatoriedad de la causa vive AQUI, no en la base (F1.4-b).

const MOTIVO = "el cliente no contesto el timbre";

function evidenciaValida() {
  return { type: "image/jpeg", size: 1024 };
}

// Feature 75: `devuelta` valido exige AHORA tambien evidencia (foto). El helper la incluye por
// defecto para que los tests de causa/motivo sigan fallando por SU campo (no por la evidencia).
function devuelta(extra: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
    resultado: "devuelta",
    causaDevolucion: "not_found",
    motivo: MOTIVO,
    evidencia: evidenciaValida(),
    ...extra,
  };
}

/** `devuelta()` sin el campo indicado (para probar su ausencia en el borde). */
function devueltaSin(campo: "causaDevolucion" | "motivo" | "evidencia") {
  const base: Record<string, unknown> = devuelta();
  delete base[campo];
  return base;
}

describe("Feature 73 · rama `devuelta` — causa obligatoria (R1/R6)", () => {
  it.each(["not_found", "wrong_number", "wrong_address"])(
    "R1: acepta la causa del catalogo `%s` junto al motivo",
    (causa) => {
      const r = gestionarSchema.safeParse(devuelta({ causaDevolucion: causa }));
      expect(r.success).toBe(true);
      if (r.success && r.data.resultado === "devuelta") {
        expect(r.data.causaDevolucion).toBe(causa);
        expect(r.data.motivo).toBe(MOTIVO);
      }
    },
  );

  it("R6: SIN causa -> invalido, con el error asociado al campo `causaDevolucion`", () => {
    const r = gestionarSchema.safeParse(devueltaSin("causaDevolucion"));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrorsDe(r.error).causaDevolucion).toBeDefined();
    }
  });

  it("R1/R6: causa FUERA del catalogo -> invalido (no hay 'Otro')", () => {
    for (const invalida of ["otro", "desconocido", "NOT_FOUND", "", "cliente_no_localizado"]) {
      const r = gestionarSchema.safeParse(devuelta({ causaDevolucion: invalida }));
      expect(r.success, `deberia rechazar '${invalida}'`).toBe(false);
      if (!r.success) {
        expect(fieldErrorsDe(r.error).causaDevolucion).toBeDefined();
      }
    }
  });

  it("pedido: SIN evidencia -> invalido con el error asociado al campo lista `evidencias`", () => {
    const r = gestionarSchema.safeParse(devueltaSin("evidencia"));
    expect(r.success).toBe(false);
    if (!r.success) {
      // Feature 119 (R6): la evidencia es una LISTA -> el error cuelga de `evidencias`.
      expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
    }
  });
});

describe("Feature 73 · el motivo SIGUE obligatorio y no lo sustituye la causa (R7/R8/R12)", () => {
  it("R7: causa valida pero motivo en blanco -> invalido con `motivo requerido`", () => {
    const r = gestionarSchema.safeParse(devuelta({ motivo: "   " }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrorsDe(r.error).motivo).toContain("motivo requerido");
    }
  });

  it("R7: causa valida pero SIN motivo -> invalido (la causa no afloja la validacion del motivo)", () => {
    const r = gestionarSchema.safeParse(devueltaSin("motivo"));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).motivo).toBeDefined();
  });

  it("R8: sin causa Y sin motivo -> AMBOS errores por campo en la MISMA respuesta", () => {
    const r = gestionarSchema.safeParse({ ordenId: "o1", resultado: "devuelta" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fieldErrors = fieldErrorsDe(r.error);
      expect(fieldErrors.causaDevolucion).toBeDefined();
      expect(fieldErrors.motivo).toBeDefined();
    }
  });

  it("R12: el motivo se parsea EXACTAMENTE como se escribio, sin decorarlo con la causa", () => {
    const crudo = "  no vive aqui  ";
    const r = gestionarSchema.safeParse(devuelta({ motivo: crudo }));
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "devuelta") {
      // `motivoSchema` ya hacia trim (feature 36): lo unico que se afirma es que la causa NO
      // se concatena, prefija ni embebe en el texto libre.
      expect(r.data.motivo).toBe(crudo.trim());
      expect(r.data.motivo).not.toMatch(/not_found|Cliente no localizado/);
    }
  });
});

describe("Feature 75 · la evidencia (foto) pasa a ser obligatoria en `devuelta`", () => {
  it("acepta un `devuelta` completo con causa + motivo + evidencia", () => {
    const r = gestionarSchema.safeParse(devuelta());
    expect(r.success).toBe(true);
  });

  it("SIN evidencia -> invalido, con el error asociado al campo lista `evidencias`", () => {
    const r = gestionarSchema.safeParse(devueltaSin("evidencia"));
    expect(r.success).toBe(false);
    if (!r.success) {
      // Feature 119 (R6): la evidencia es una LISTA -> el error cuelga de `evidencias`.
      expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
    }
  });

  it("evidencia no-imagen (pdf) -> invalido en el campo lista `evidencias`", () => {
    const r = gestionarSchema.safeParse(devuelta({ evidencia: { type: "application/pdf", size: 10 } }));
    expect(r.success).toBe(false);
    if (!r.success) {
      // Feature 119 (R8): la foto invalida cuelga del campo lista `evidencias` (validacion por archivo).
      expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
    }
  });
});

describe("Feature 73 · la causa vive SOLO en la rama `devuelta` (R10/R19)", () => {
  it("R10: enviada en `entregada` -> NO aparece en el objeto parseado (no se puede persistir)", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "entregada",
      montoRecibido: 1000,
      metodoPago: "efectivo",
      evidencia: evidenciaValida(),
      causaDevolucion: "not_found",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("causaDevolucion");
  });

  it("R10: enviada en `rechazada` -> NO aparece en el objeto parseado (conserva motivo+evidencia)", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "rechazada",
      motivo: "cliente rechazo",
      evidencia: evidenciaValida(),
      causaDevolucion: "wrong_address",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("causaDevolucion");
  });

  it("R5/R10: enviada en `reprogramada` -> NO aparece en el objeto parseado", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "reprogramada",
      fechaReprogramacion: fechaFuturaISO(),
      motivo: "reagendar",
      causaDevolucion: "wrong_number",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("causaDevolucion");
  });

  it("R19: las otras 3 ramas NO exigen causa (siguen validando sin ella)", () => {
    const entregada = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "entregada",
      montoRecibido: 1000,
      metodoPago: "efectivo",
      evidencia: evidenciaValida(),
    });
    const rechazada = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "rechazada",
      motivo: "cliente rechazo",
      evidencia: evidenciaValida(),
    });
    const reprogramada = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "reprogramada",
      fechaReprogramacion: fechaFuturaISO(),
      motivo: "reagendar",
    });
    expect([entregada.success, rechazada.success, reprogramada.success]).toEqual([true, true, true]);
  });
});

function fechaFuturaISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}
