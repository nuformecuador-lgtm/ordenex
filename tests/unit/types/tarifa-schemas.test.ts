import { describe, it, expect } from "vitest";
import { crearTarifaSchema, actualizarTarifaSchema, listarTarifasSchema } from "@/lib/types/tarifa";
import { tarifasConfig } from "@/lib/config/tarifas";

function baseCrear() {
  return {
    tiendaId: "tienda-1",
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

describe("crearTarifaSchema — validacion de creacion (R2/R3/R5/R14/R15)", () => {
  it("acepta un input valido", () => {
    const r = crearTarifaSchema.safeParse(baseCrear());
    expect(r.success).toBe(true);
  });

  it("rechaza tiendaId vacio (R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), tiendaId: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("tiendaId");
  });

  it("rechaza tiendaId ausente (R5/R15)", () => {
    const { tiendaId, ...rest } = baseCrear();
    void tiendaId;
    const r = crearTarifaSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("tiendaId");
  });

  // La tarifa ya no pertenece a una zona ni se identifica por nombre: es de una
  // tienda. Los campos del modelo viejo deben quedar rechazados por strict.
  it("rechaza nombre/zonaId del modelo viejo (strict)", () => {
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), nombre: "Tarifa GAM" }).success).toBe(
      false,
    );
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), zonaId: "zona-1" }).success).toBe(false);
  });

  it("rechaza una columna numerica ausente (R5/R15)", () => {
    const { valorFlete, ...rest } = baseCrear();
    void valorFlete;
    const r = crearTarifaSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFlete");
  });

  it("rechaza monto negativo (R2/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), fulfillment: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("fulfillment");
  });

  it("rechaza valor no numerico (R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), valorFleteGam: "diez" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFleteGam");
  });

  it("rechaza porcentaje > 100 (R3/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), ivaFlete: 150 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("ivaFlete");
  });

  it("rechaza porcentaje negativo (R3/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), comisionCod: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("comisionCod");
  });

  it("acepta porcentaje en el limite 100 (R3)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), ivaComisionCod: 100 });
    expect(r.success).toBe(true);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), extra: "x" });
    expect(r.success).toBe(false);
    // `status` no se acepta en creacion: nace `activo` por default de DB.
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), status: "inactivo" }).success).toBe(false);
  });
});

describe("actualizarTarifaSchema — todos opcionales, strict (R20/R23)", () => {
  it("acepta objeto vacio", () => {
    expect(actualizarTarifaSchema.safeParse({}).success).toBe(true);
  });

  it("acepta cambio de un solo campo", () => {
    expect(actualizarTarifaSchema.safeParse({ tiendaId: "tienda-2" }).success).toBe(true);
  });

  it("rechaza tiendaId vacio (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ tiendaId: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("tiendaId");
  });

  it("acepta status activo|inactivo y rechaza cualquier otro valor (R20/R23)", () => {
    expect(actualizarTarifaSchema.safeParse({ status: "activo" }).success).toBe(true);
    expect(actualizarTarifaSchema.safeParse({ status: "inactivo" }).success).toBe(true);

    const r = actualizarTarifaSchema.safeParse({ status: "borrado" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("status");

    expect(actualizarTarifaSchema.safeParse({ status: "" }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ status: null }).success).toBe(false);
  });

  it("rechaza monto negativo (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ valorFlete: -5 });
    expect(r.success).toBe(false);
  });

  it("rechaza porcentaje fuera de 0..100 (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ comisionCod: 101 });
    expect(r.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarTarifaSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ deletedAt: null }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ createdAt: new Date() }).success).toBe(false);
    // campos del modelo viejo: ya no existen.
    expect(actualizarTarifaSchema.safeParse({ nombre: "Nueva" }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ zonaId: "zona-1" }).success).toBe(false);
  });
});

describe("listarTarifasSchema — paginacion (R18)", () => {
  it("aplica defaults", () => {
    const r = listarTarifasSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(tarifasConfig.DEFAULT_PAGE_SIZE);
    }
  });

  it("rechaza page/pageSize no positivos", () => {
    expect(listarTarifasSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listarTarifasSchema.safeParse({ pageSize: -1 }).success).toBe(false);
    expect(listarTarifasSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it("acota pageSize a MAX_PAGE_SIZE (R18)", () => {
    const r = listarTarifasSchema.safeParse({ pageSize: 100000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pageSize).toBe(tarifasConfig.MAX_PAGE_SIZE);
  });
});
