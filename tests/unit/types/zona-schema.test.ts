import { describe, it, expect } from "vitest";
import {
  crearZonaSchema,
  actualizarZonaSchema,
  listarZonasSchema,
} from "@/lib/types/zona";

// Feature 24 / feature 54 (reconciliacion PR #40). Validacion en el borde (R19) y
// clamp de paginacion (R24). El schema nuevo lleva cobroVehiculo + tarifas + esCentral
// (default false), SIN pagoEntrega/pagoRechazo/esGam.

const validCrear = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritoIds: ["d1", "d2"],
  tarifas: [],
};

describe("crearZonaSchema (R19)", () => {
  it("acepta una entrada valida (esCentral opcional por default)", () => {
    expect(crearZonaSchema.safeParse(validCrear).success).toBe(true);
  });

  it("aplica esCentral=false por default", () => {
    const r = crearZonaSchema.parse(validCrear);
    expect(r.esCentral).toBe(false);
  });

  it("acepta esCentral=true explicito", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, esCentral: true }).success).toBe(true);
  });

  it("rechaza nombre vacio", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, nombre: "" }).success).toBe(false);
  });

  it("rechaza conjunto de distritos vacio", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, distritoIds: [] }).success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, hack: 1 }).success).toBe(false);
  });

  it("cobroVehiculo=true exige >=1 tarifa con vehiculoId", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, cobroVehiculo: true, tarifas: [] }).success).toBe(false);
    expect(
      crearZonaSchema.safeParse({
        ...validCrear,
        cobroVehiculo: true,
        tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
      }).success,
    ).toBe(true);
  });

  it("cobroVehiculo=false rechaza tarifa con vehiculoId y >1 tarifa", () => {
    expect(
      crearZonaSchema.safeParse({
        ...validCrear,
        cobroVehiculo: false,
        tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
      }).success,
    ).toBe(false);
  });
});

describe("actualizarZonaSchema (R19/R22)", () => {
  it("comparte forma con crearZonaSchema (reemplazo completo, id viaja aparte)", () => {
    expect(actualizarZonaSchema.safeParse(validCrear).success).toBe(true);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarZonaSchema.safeParse({ ...validCrear, hack: 1 }).success).toBe(false);
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
