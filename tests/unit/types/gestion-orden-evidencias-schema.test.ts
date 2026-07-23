import { describe, it, expect } from "vitest";
import type { ZodError } from "zod";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { gestionConfig } from "@/lib/config/gestion";

// Feature 119 (R5/R6/R7/R8) — el BORDE (zod) de la evidencia MULTIPLE. Mismo schema para
// cliente (panel) y servidor (Server Action): validarlo aqui valida las dos defensas. La
// evidencia paso de UNA foto a una LISTA `evidencias` de 1..N (tope R7), con validacion por
// archivo (R8). El panel ya migro a multi-seleccion (envia `evidencias`), asi que el puente
// singular `evidencia`->`evidencias` se retiro y aqui solo se valida el contrato de lista.

const MAX = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

function fieldErrorsDe(error: ZodError<unknown>): Record<string, string[] | undefined> {
  return error.flatten().fieldErrors as Record<string, string[] | undefined>;
}

function fotoValida() {
  return { type: "image/jpeg", size: 1024 };
}

function fotos(n: number) {
  return Array.from({ length: n }, () => fotoValida());
}

function fechaFuturaISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

// Bases validas por rama, parametrizadas por la lista de fotos.
function entregada(evidencias: unknown[]) {
  return { ordenId: "o1", resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo", evidencias };
}
function rechazada(evidencias: unknown[]) {
  return { ordenId: "o1", resultado: "rechazada", motivo: "cliente rechazo", evidencias };
}
function devuelta(evidencias: unknown[]) {
  return { ordenId: "o1", resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "no vive", evidencias };
}

const RAMAS_CON_FOTO = [
  ["entregada", entregada],
  ["rechazada", rechazada],
  ["devuelta", devuelta],
] as const;

describe("R5: las 3 ramas con foto aceptan una LISTA de 1..MAX evidencias", () => {
  it.each(RAMAS_CON_FOTO)("%s: acepta 1 foto y acepta MAX fotos", (_nombre, build) => {
    expect(gestionarSchema.safeParse(build(fotos(1))).success).toBe(true);
    expect(gestionarSchema.safeParse(build(fotos(MAX))).success).toBe(true);
  });

  it("reprogramada NO lleva evidencias (rama sin foto, sigue valida)", () => {
    const r = gestionarSchema.safeParse({
      ordenId: "o1",
      resultado: "reprogramada",
      fechaReprogramacion: fechaFuturaISO(),
      motivo: "reagendar",
    });
    expect(r.success).toBe(true);
  });
});

describe("R6: lista con menos de 1 elemento -> validation_error en `evidencias`", () => {
  it.each(RAMAS_CON_FOTO)("%s: lista vacia -> invalido", (_nombre, build) => {
    const r = gestionarSchema.safeParse(build([]));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
  });

  it.each(RAMAS_CON_FOTO)("%s: campo `evidencias` ausente -> invalido", (_nombre, build) => {
    const base = build([]) as Record<string, unknown>;
    delete base.evidencias;
    const r = gestionarSchema.safeParse(base);
    expect(r.success).toBe(false);
  });
});

describe("R7: por encima del maximo configurado -> validation_error", () => {
  it.each(RAMAS_CON_FOTO)("%s: MAX+1 fotos -> invalido en `evidencias`", (_nombre, build) => {
    const r = gestionarSchema.safeParse(build(fotos(MAX + 1)));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
  });

  it("el maximo por defecto es 3 (gate F1.4), sobreescribible por env", () => {
    // El schema se ligo a `gestionConfig.MAX_EVIDENCIAS_POR_GESTION` al cargar; por defecto 3.
    expect(MAX).toBe(3);
  });
});

describe("R8: validacion POR ARCHIVO — una foto invalida invalida el envio", () => {
  it.each(RAMAS_CON_FOTO)("%s: una foto no-imagen entre validas -> invalido", (_nombre, build) => {
    const r = gestionarSchema.safeParse(build([fotoValida(), { type: "application/pdf", size: 10 }]));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
  });

  it.each(RAMAS_CON_FOTO)("%s: una foto sobre el tamano maximo entre validas -> invalido", (_nombre, build) => {
    const grande = { type: "image/png", size: gestionConfig.MAX_FILE_BYTES + 1 };
    const r = gestionarSchema.safeParse(build([fotoValida(), grande]));
    expect(r.success).toBe(false);
  });
});

// El puente singular `evidencia`->`evidencias` se RETIRO al migrar el panel a multi-seleccion:
// el schema ya NO acepta el campo singular. Un objeto con `evidencia` (y sin `evidencias`) cae
// en `min(1)` -> invalido, con el error colgando del campo lista `evidencias`.
describe("sin puente: el campo singular `evidencia` ya no se pliega", () => {
  it.each(["entregada", "rechazada", "devuelta"] as const)("%s: `evidencia` sin `evidencias` -> invalido", (nombre) => {
    const raw =
      nombre === "entregada"
        ? { ordenId: "o1", resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo", evidencia: fotoValida() }
        : nombre === "rechazada"
          ? { ordenId: "o1", resultado: "rechazada", motivo: "x", evidencia: fotoValida() }
          : { ordenId: "o1", resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "x", evidencia: fotoValida() };
    const r = gestionarSchema.safeParse(raw);
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsDe(r.error).evidencias).toBeDefined();
  });
});
