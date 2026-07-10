import { describe, it, expect } from "vitest";
import { crearCobroSchema, actualizarCobroSchema, listarCobrosSchema } from "@/lib/types/cobro";
import { cobrosConfig } from "@/lib/config/cobros";

function baseCrear() {
  return {
    nombre: "Tarifa GAM",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
  };
}

describe("crearCobroSchema — validacion de creacion (R2/R3/R5/R14/R15)", () => {
  it("acepta un input valido", () => {
    const r = crearCobroSchema.safeParse(baseCrear());
    expect(r.success).toBe(true);
  });

  it("rechaza nombre vacio (R5/R15)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), nombre: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("nombre");
  });

  it("rechaza nombre ausente (R5/R15)", () => {
    const { nombre, ...rest } = baseCrear();
    void nombre;
    const r = crearCobroSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("nombre");
  });

  it("rechaza una columna numerica ausente (R5/R15)", () => {
    const { valorFlete, ...rest } = baseCrear();
    void valorFlete;
    const r = crearCobroSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFlete");
  });

  it("rechaza monto negativo (R2/R5/R15)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), fulfillment: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("fulfillment");
  });

  it("rechaza valor no numerico (R15)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), valorFleteGam: "diez" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFleteGam");
  });

  it("rechaza porcentaje > 100 (R3/R5/R15)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), ivaFlete: 150 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("ivaFlete");
  });

  it("rechaza porcentaje negativo (R3/R5/R15)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), comisionCod: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("comisionCod");
  });

  it("acepta porcentaje en el limite 100 (R3)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), ivaComisionCod: 100 });
    expect(r.success).toBe(true);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const r = crearCobroSchema.safeParse({ ...baseCrear(), extra: "x" });
    expect(r.success).toBe(false);
  });
});

describe("actualizarCobroSchema — todos opcionales, strict (R20/R23)", () => {
  it("acepta objeto vacio", () => {
    expect(actualizarCobroSchema.safeParse({}).success).toBe(true);
  });

  it("acepta cambio de un solo campo", () => {
    expect(actualizarCobroSchema.safeParse({ nombre: "Nueva" }).success).toBe(true);
  });

  it("rechaza nombre vacio (R20/R23)", () => {
    const r = actualizarCobroSchema.safeParse({ nombre: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("nombre");
  });

  it("rechaza monto negativo (R20/R23)", () => {
    const r = actualizarCobroSchema.safeParse({ valorFlete: -5 });
    expect(r.success).toBe(false);
  });

  it("rechaza porcentaje fuera de 0..100 (R20/R23)", () => {
    const r = actualizarCobroSchema.safeParse({ comisionCod: 101 });
    expect(r.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarCobroSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(actualizarCobroSchema.safeParse({ deletedAt: null }).success).toBe(false);
    expect(actualizarCobroSchema.safeParse({ createdAt: new Date() }).success).toBe(false);
  });
});

describe("listarCobrosSchema — paginacion (R18)", () => {
  it("aplica defaults", () => {
    const r = listarCobrosSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(cobrosConfig.DEFAULT_PAGE_SIZE);
    }
  });

  it("rechaza page/pageSize no positivos", () => {
    expect(listarCobrosSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listarCobrosSchema.safeParse({ pageSize: -1 }).success).toBe(false);
    expect(listarCobrosSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it("acota pageSize a MAX_PAGE_SIZE (R18)", () => {
    const r = listarCobrosSchema.safeParse({ pageSize: 100000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pageSize).toBe(cobrosConfig.MAX_PAGE_SIZE);
  });
});
