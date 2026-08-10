import { describe, it, expect } from "vitest";
import type { ZodError } from "zod";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

// ⚠️ Feature 193 (R10), decision humana del 2026-08-10: la gestion pasa a EXIGIR la ubicacion
// del mensajero (o un motivo tecnico de por que falta). Los casos validos de abajo se AMPLIAN
// con `ubicacion` —no se relajan—, mismo criterio que aplicaron la 73 y la 75 al endurecer
// esta misma rama. Lo que cada test AFIRMA no cambia; solo se le anade el dato que el
// contrato nuevo pide. La disyuncion ubicacion/motivo tiene su cobertura propia y exhaustiva
// en `gestion-ubicacion-borde.test.ts`.
const UBICACION_193 = { lat: 9.9281, lng: -84.0907 };

/**
 * `flatten().fieldErrors` de una discriminatedUnion es un tipo UNION (uno por variante), asi
 * que TS no deja indexar por un campo que solo existe en una rama. Se normaliza a un mapa
 * plano: es lo mismo que hace el panel al pintar errores por campo, y lo que consume la Server
 * Action al devolver `fieldErrors`.
 */
function fieldErrorsDe(error: ZodError<unknown>): Record<string, string[] | undefined> {
  return error.flatten().fieldErrors as Record<string, string[] | undefined>;
}

// Feature 158 (R9/R10/R11, Q-B) — el BORDE (zod) de la QUINTA variante de gestion. Este es el
// MISMO schema que usan el panel (cliente) y la Server Action (servidor): validarlo aqui valida
// las dos defensas (R33). La obligatoriedad de causa/motivo/evidencia vive AQUI, no en la base.

const MOTIVO = "la caja llego aplastada y el producto quebrado";

function evidenciaValida() {
  return { type: "image/jpeg", size: 1024 };
}

function incidente(extra: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
    ubicacion: UBICACION_193,
    resultado: "incidente",
    causaIncidente: "danado",
    motivo: MOTIVO,
    evidencias: [evidenciaValida()],
    ...extra,
  };
}

/** `incidente()` sin el campo indicado (para probar su ausencia en el borde). */
function incidenteSin(campo: "causaIncidente" | "motivo" | "evidencias") {
  const base: Record<string, unknown> = incidente();
  delete base[campo];
  return base;
}

function fechaFuturaISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

describe("Feature 158 · R9 — la causa es una lista CERRADA de 3 valores en espanol", () => {
  it.each([...CAUSA_INCIDENTE_SEED])("acepta la causa del catalogo `%s`", (causa) => {
    const r = gestionarSchema.safeParse(incidente({ causaIncidente: causa }));
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "incidente") {
      expect(r.data.causaIncidente).toBe(causa);
      expect(r.data.motivo).toBe(MOTIVO);
    }
  });

  it("R9: la lista tiene EXACTAMENTE 3 valores y son los esperados, ninguno mas", () => {
    expect([...CAUSA_INCIDENTE_SEED]).toEqual(["danado", "perdido", "robado"]);
  });

  it("R9: SIN causa -> invalido, con el error asociado al campo `causaIncidente`", () => {
    const r = gestionarSchema.safeParse(incidenteSin("causaIncidente"));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).causaIncidente).toBeDefined();
  });

  it("R9: causa FUERA de la lista -> invalido (no hay 'Otro' y no se aceptan variantes)", () => {
    for (const invalida of [
      "otro",
      "Otro",
      "OTRO",
      "",
      "dañado", // con enye: el value del enum es `danado`
      "DANADO",
      "damaged", // la traduccion al ingles NO vale (Q-B: los values van en espanol)
      "lost",
      "stolen",
      "peridido", // typo que el spec descarto explicitamente
      "extraviado",
    ]) {
      const r = gestionarSchema.safeParse(incidente({ causaIncidente: invalida }));
      expect(r.success, `deberia rechazar '${invalida}'`).toBe(false);
      if (!r.success) expect(fieldErrorsDe(r.error).causaIncidente).toBeDefined();
    }
  });

  it("R9: las causas de DEVOLUCION (73, en ingles) NO son causas de incidente", () => {
    for (const ajena of CAUSA_DEVOLUCION_SEED) {
      const r = gestionarSchema.safeParse(incidente({ causaIncidente: ajena }));
      expect(r.success, `deberia rechazar la causa de devolucion '${ajena}'`).toBe(false);
    }
  });
});

describe("Feature 158 · R10 (Q-B) — la evidencia es OBLIGATORIA en las TRES causas", () => {
  it.each([...CAUSA_INCIDENTE_SEED])(
    "R10: causa `%s` SIN lista de evidencias -> invalido por campo",
    (causa) => {
      const base = incidenteSin("evidencias");
      const r = gestionarSchema.safeParse({ ...base, causaIncidente: causa });
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
    },
  );

  it.each([...CAUSA_INCIDENTE_SEED])(
    "R10: causa `%s` con lista de evidencias VACIA -> invalido (min 1)",
    (causa) => {
      const r = gestionarSchema.safeParse(incidente({ causaIncidente: causa, evidencias: [] }));
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
    },
  );

  // ESTE es el caso que fija la decision del humano. `perdido` y `robado` no tienen paquete que
  // fotografiar y aun asi la foto se exige: se le planteo la objecion y eligio esto. Si alguien
  // "arregla" el spec haciendo la evidencia opcional en esas dos causas, este caso lo caza.
  it("R10 (Q-B): `perdido` y `robado` NO estan exentos de la foto, aunque no haya paquete", () => {
    for (const causa of ["perdido", "robado"] as const) {
      const sinFoto = gestionarSchema.safeParse({
        ordenId: "o1",
        ubicacion: UBICACION_193,
        resultado: "incidente",
        causaIncidente: causa,
        motivo: "me asaltaron en la parada",
      });
      expect(sinFoto.success, `${causa} sin foto deberia ser invalido`).toBe(false);
      const conFoto = gestionarSchema.safeParse(incidente({ causaIncidente: causa }));
      expect(conFoto.success, `${causa} con una foto deberia ser valido`).toBe(true);
    }
  });

  it("R10: aplica los MISMOS limites por archivo que el resto de resultados con foto", () => {
    const pdf = gestionarSchema.safeParse(
      incidente({ evidencias: [{ type: "application/pdf", size: 10 }] }),
    );
    expect(pdf.success).toBe(false);
    const vacio = gestionarSchema.safeParse(
      incidente({ evidencias: [{ type: "image/jpeg", size: 0 }] }),
    );
    expect(vacio.success).toBe(false);
    const enorme = gestionarSchema.safeParse(
      incidente({ evidencias: [{ type: "image/jpeg", size: 999_999_999 }] }),
    );
    expect(enorme.success).toBe(false);
  });

  it("R10: una lista de N fotos validas se acepta (1..N, no solo 1)", () => {
    const r = gestionarSchema.safeParse(
      incidente({ evidencias: [evidenciaValida(), evidenciaValida()] }),
    );
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "incidente") {
      expect(r.data.evidencias).toHaveLength(2);
    }
  });
});

describe("Feature 158 · R11 — el motivo libre sigue obligatorio y APARTE de la causa", () => {
  it("R11: causa valida pero motivo en blanco -> invalido con `motivo requerido`", () => {
    const r = gestionarSchema.safeParse(incidente({ motivo: "   " }));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).motivo).toContain("motivo requerido");
  });

  it("R11: causa valida pero SIN motivo -> invalido (la causa no afloja el motivo)", () => {
    const r = gestionarSchema.safeParse(incidenteSin("motivo"));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).motivo).toBeDefined();
  });

  it("R9/R10/R11: un envio vacio devuelve los TRES errores por campo a la vez", () => {
    const r = gestionarSchema.safeParse({ ordenId: "o1", resultado: "incidente" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fieldErrors = fieldErrorsDe(r.error);
      expect(fieldErrors.causaIncidente).toBeDefined();
      expect(fieldErrors.motivo).toBeDefined();
      expect(fieldErrors.evidencias).toBeDefined();
    }
  });

  it("R11: el motivo se parsea EXACTAMENTE como se escribio, sin decorarlo con la causa", () => {
    const crudo = "  se cayo del cajon en la curva  ";
    const r = gestionarSchema.safeParse(incidente({ motivo: crudo }));
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "incidente") {
      expect(r.data.motivo).toBe(crudo.trim());
      expect(r.data.motivo).not.toMatch(/danado|Dañado/);
    }
  });
});

describe("Feature 158 · blindaje de la discriminatedUnion (R9/R35)", () => {
  it("R9: `causaIncidente` enviada en las otras CUATRO ramas NO se parsea", () => {
    const casos = [
      {
        ordenId: "o1",
        ubicacion: UBICACION_193,
        resultado: "entregada",
        montoRecibido: 1000,
        metodoPago: "efectivo",
        evidencias: [evidenciaValida()],
        causaIncidente: "danado",
      },
      {
        ordenId: "o1",
        ubicacion: UBICACION_193,
        resultado: "rechazada",
        motivo: "cliente rechazo",
        evidencias: [evidenciaValida()],
        causaIncidente: "robado",
      },
      {
        ordenId: "o1",
        ubicacion: UBICACION_193,
        resultado: "devuelta",
        causaDevolucion: "not_found",
        motivo: "no vive aqui",
        evidencias: [evidenciaValida()],
        causaIncidente: "perdido",
      },
      {
        ordenId: "o1",
        ubicacion: UBICACION_193,
        resultado: "reprogramada",
        fechaReprogramacion: fechaFuturaISO(),
        motivo: "reagendar",
        causaIncidente: "danado",
      },
    ];
    for (const caso of casos) {
      const r = gestionarSchema.safeParse(caso);
      expect(r.success, `${caso.resultado} deberia seguir validando`).toBe(true);
      if (r.success) expect(r.data).not.toHaveProperty("causaIncidente");
    }
  });

  it("R9: `causaDevolucion` enviada en la rama `incidente` NO se parsea (y al reves)", () => {
    const r = gestionarSchema.safeParse(incidente({ causaDevolucion: "not_found" }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("causaDevolucion");
  });

  it("no hay recaudo: `montoRecibido`/`metodoPago` NO existen en la rama `incidente`", () => {
    const r = gestionarSchema.safeParse(
      incidente({ montoRecibido: 5000, metodoPago: "efectivo" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("montoRecibido");
      expect(r.data).not.toHaveProperty("metodoPago");
    }
  });

  it("R35: las cuatro ramas previas siguen validando exactamente igual, sin campos nuevos", () => {
    const entregada = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 1000,
      metodoPago: "efectivo",
      evidencias: [evidenciaValida()],
    });
    const rechazada = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "rechazada",
      motivo: "cliente rechazo",
      evidencias: [evidenciaValida()],
    });
    const reprogramada = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "reprogramada",
      fechaReprogramacion: fechaFuturaISO(),
      motivo: "reagendar",
    });
    const devuelta = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "devuelta",
      causaDevolucion: "not_found",
      motivo: "no vive aqui",
      evidencias: [evidenciaValida()],
    });
    expect([
      entregada.success,
      rechazada.success,
      reprogramada.success,
      devuelta.success,
    ]).toEqual([true, true, true, true]);
  });

  it("un `resultado` fuera de los CINCO conocidos sigue siendo invalido", () => {
    const r = gestionarSchema.safeParse({ ordenId: "o1", resultado: "indemnizada" });
    expect(r.success).toBe(false);
  });
});
