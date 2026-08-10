import { describe, it, expect } from "vitest";
import {
  esFechaFutura,
  gestionarSchema,
  recogerSchema,
  validarEvidencia,
} from "@/lib/types/gestion-orden";

// ⚠️ Feature 193 (R10), decision humana del 2026-08-10: la gestion pasa a EXIGIR la ubicacion
// del mensajero (o un motivo tecnico de por que falta). Los casos validos de abajo se AMPLIAN
// con `ubicacion` —no se relajan—, mismo criterio que aplicaron la 73 y la 75 al endurecer
// esta misma rama. Lo que cada test AFIRMA no cambia; solo se le anade el dato que el
// contrato nuevo pide. La disyuncion ubicacion/motivo tiene su cobertura propia y exhaustiva
// en `gestion-ubicacion-borde.test.ts`.
const UBICACION_193 = { lat: 9.9281, lng: -84.0907 };

// Feature 36 — validacion de borde discriminada por resultado (R22/R24/R25/R27/R29).

const FUTURA = fechaRelativaISO(30);
const PASADA = fechaRelativaISO(-1);

function fechaRelativaISO(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function evidenciaValida() {
  return { type: "image/jpeg", size: 1024 };
}

describe("recogerSchema (R16)", () => {
  it("acepta un conjunto no vacio de ordenIds", () => {
    expect(recogerSchema.safeParse({ ordenIds: ["o1", "o2"] }).success).toBe(true);
    expect(recogerSchema.safeParse({ ordenIds: ["o1"] }).success).toBe(true);
  });

  it("rechaza lista vacia", () => {
    expect(recogerSchema.safeParse({ ordenIds: [] }).success).toBe(false);
  });
});

describe("validarEvidencia (R24)", () => {
  it("rechaza archivo ausente, no-imagen y sobre el maximo", () => {
    expect(validarEvidencia(undefined)).not.toBeNull();
    expect(validarEvidencia({ type: "application/pdf", size: 10 })).not.toBeNull();
    expect(validarEvidencia({ type: "image/jpeg", size: 999 }, 100)).not.toBeNull();
  });

  it("acepta imagen jpeg/png/webp dentro del limite", () => {
    expect(validarEvidencia({ type: "image/jpeg", size: 10 })).toBeNull();
    expect(validarEvidencia({ type: "image/png", size: 10 })).toBeNull();
    expect(validarEvidencia({ type: "image/webp", size: 10 })).toBeNull();
  });
});

describe("esFechaFutura (R25)", () => {
  it("true solo para fechas posteriores a hoy", () => {
    expect(esFechaFutura(FUTURA)).toBe(true);
    expect(esFechaFutura(PASADA)).toBe(false);
    expect(esFechaFutura("no-fecha")).toBe(false);
  });
});

describe("gestionarSchema — ENTREGADA (R22/R24)", () => {
  it("valida con monto>0, metodo enum y foto imagen", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 100,
      metodoPago: "efectivo",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(true);
  });

  it("R22: sin foto -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 100,
      metodoPago: "efectivo",
    });
    expect(r.success).toBe(false);
  });

  it("monto 0 (entrega sin cobro) -> valido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 0,
      metodoPago: "efectivo",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(true);
  });

  it("R22: monto negativo -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: -1,
      metodoPago: "efectivo",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(false);
  });

  it("R22: metodo de pago fuera del enum -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 100,
      metodoPago: "tarjeta",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(false);
  });

  it("R24: foto no-imagen -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "entregada",
      montoRecibido: 100,
      metodoPago: "SINPE",
      evidencias: [{ type: "application/pdf", size: 10 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("gestionarSchema — REPROGRAMAR (R25)", () => {
  it("valida con fecha futura + motivo", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "reprogramada",
      fechaReprogramacion: FUTURA,
      motivo: "cliente no estaba",
    });
    expect(r.success).toBe(true);
  });

  it("R25: fecha no futura -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "reprogramada",
      fechaReprogramacion: PASADA,
      motivo: "cliente no estaba",
    });
    expect(r.success).toBe(false);
  });

  it("R25: motivo vacio -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "reprogramada",
      fechaReprogramacion: FUTURA,
      motivo: "   ",
    });
    expect(r.success).toBe(false);
  });
});

// Feature 73 (R6): la rama `devuelta` ahora exige TAMBIEN una causa tipificada. Los dos casos
// de abajo se AMPLIAN con `causaDevolucion` (no se relajan): sin ella, un `devuelta` valido de
// la 36 ya no parsea —que es exactamente lo que pide R6— y el caso del motivo vacio pasaria por
// el motivo EQUIVOCADO (le faltaria la causa, no el motivo). Lo que cada test AFIRMA no cambia.
// El resto de la 36 (R22/R24/R25/R29) queda intacto: la causa vive SOLO en esta rama (R10).
// Feature 75: la rama `devuelta` gana TAMBIEN evidencia obligatoria (espejo de rechazada). Los
// casos validos se AMPLIAN con `evidencia`; se suma un caso de ausencia de foto -> invalido.
describe("gestionarSchema — DEVOLUCION (R27, + causa de la 73/R6, + evidencia de la 75)", () => {
  it("valida con motivo no vacio, causa y foto", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "devuelta",
      causaDevolucion: "wrong_address",
      motivo: "direccion inexistente",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(true);
  });

  it("R27: motivo vacio -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "devuelta",
      causaDevolucion: "wrong_address",
      motivo: "",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(false);
  });

  it("Feature 75/119: sin foto -> invalido, con el error en el campo lista `evidencias`", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "devuelta",
      causaDevolucion: "wrong_address",
      motivo: "direccion inexistente",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fieldErrors = r.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      // Feature 119 (R6): la evidencia es ahora una LISTA -> el error cuelga de `evidencias`.
      expect(fieldErrors.evidencias).toBeDefined();
    }
  });

  it("Feature 75: foto no-imagen -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "devuelta",
      causaDevolucion: "wrong_address",
      motivo: "direccion inexistente",
      evidencias: [{ type: "application/pdf", size: 10 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("gestionarSchema — RECHAZO (R29)", () => {
  it("valida con foto + motivo", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "rechazada",
      motivo: "cliente rechazo",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(true);
  });

  it("R29: sin foto -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "rechazada",
      motivo: "cliente rechazo",
    });
    expect(r.success).toBe(false);
  });

  it("R29: sin motivo -> invalido", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      ubicacion: UBICACION_193,
      resultado: "rechazada",
      motivo: "",
      evidencias: [evidenciaValida()],
    });
    expect(r.success).toBe(false);
  });
});
