import { describe, it, expect } from "vitest";
import {
  crearZonaSchema,
  actualizarZonaSchema,
  listarZonasSchema,
} from "@/lib/types/zona";

// Feature 24. Validacion en el borde (R19) y clamp de paginacion (R24).

const validCrear = {
  nombre: "Zona Sur",
  pagoEntrega: 1000,
  pagoRechazo: 500,
  esGam: false,
  distritoIds: ["d1", "d2"],
};

describe("crearZonaSchema (R19)", () => {
  it("acepta una entrada valida", () => {
    expect(crearZonaSchema.safeParse(validCrear).success).toBe(true);
  });

  it("rechaza nombre vacio", () => {
    const r = crearZonaSchema.safeParse({ ...validCrear, nombre: "" });
    expect(r.success).toBe(false);
  });

  it("rechaza monto negativo", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, pagoEntrega: -1 }).success).toBe(false);
    expect(crearZonaSchema.safeParse({ ...validCrear, pagoRechazo: -0.5 }).success).toBe(false);
  });

  it("rechaza monto no numerico", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, pagoEntrega: "10" }).success).toBe(false);
  });

  it("rechaza conjunto de distritos vacio", () => {
    const r = crearZonaSchema.safeParse({ ...validCrear, distritoIds: [] });
    expect(r.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const r = crearZonaSchema.safeParse({ ...validCrear, hack: 1 });
    expect(r.success).toBe(false);
  });
});

describe("actualizarZonaSchema (R19/R22)", () => {
  it("exige id y permite campos parciales", () => {
    expect(actualizarZonaSchema.safeParse({ id: "z1", nombre: "Nueva" }).success).toBe(true);
    expect(actualizarZonaSchema.safeParse({ id: "z1", distritoIds: [] }).success).toBe(true); // libera todos
    expect(actualizarZonaSchema.safeParse({ nombre: "Nueva" }).success).toBe(false); // sin id
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarZonaSchema.safeParse({ id: "z1", hack: 1 }).success).toBe(false);
  });
});

describe("listarZonasSchema — clamp de pageSize (R24)", () => {
  it("aplica defaults", () => {
    const r = listarZonasSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBeGreaterThan(0);
  });

  it("acota pageSize a MAX_PAGE_SIZE", () => {
    const r = listarZonasSchema.parse({ page: 1, pageSize: 100000 });
    expect(r.pageSize).toBeLessThanOrEqual(100);
  });
});
