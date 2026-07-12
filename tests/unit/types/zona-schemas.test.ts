import { describe, it, expect } from "vitest";
import { crearZonaSchema, listarZonasSchema } from "@/lib/types/zona";

function base(overrides: Record<string, unknown> = {}) {
  return {
    nombre: "GAM",
    cobroVehiculo: false,
    distritoIds: ["d1"],
    tarifas: [],
    ...overrides,
  };
}

const tarifaSinVeh = { cobroEntregado: 10, cobroRechazado: 5 };
const tarifaConVeh = (vehiculoId: string) => ({ cobroEntregado: 10, cobroRechazado: 5, vehiculoId });

describe("crearZonaSchema — base", () => {
  it("acepta zona minima (cobroVehiculo=false, sin tarifas)", () => {
    expect(crearZonaSchema.safeParse(base()).success).toBe(true);
  });

  it("rechaza distritoIds vacio", () => {
    const r = crearZonaSchema.safeParse(base({ distritoIds: [] }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("distritoIds");
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(crearZonaSchema.safeParse(base({ extra: 1 })).success).toBe(false);
  });
});

describe("crearZonaSchema — regla cobroVehiculo=true", () => {
  it("acepta >=1 tarifa todas con vehiculoId distinto", () => {
    const r = crearZonaSchema.safeParse(
      base({ cobroVehiculo: true, tarifas: [tarifaConVeh("v1"), tarifaConVeh("v2")] }),
    );
    expect(r.success).toBe(true);
  });

  it("rechaza cobroVehiculo=true sin tarifas", () => {
    const r = crearZonaSchema.safeParse(base({ cobroVehiculo: true, tarifas: [] }));
    expect(r.success).toBe(false);
  });

  it("rechaza una tarifa sin vehiculoId cuando cobroVehiculo=true", () => {
    const r = crearZonaSchema.safeParse(
      base({ cobroVehiculo: true, tarifas: [tarifaConVeh("v1"), tarifaSinVeh] }),
    );
    expect(r.success).toBe(false);
  });

  it("rechaza vehiculoId repetido cuando cobroVehiculo=true", () => {
    const r = crearZonaSchema.safeParse(
      base({ cobroVehiculo: true, tarifas: [tarifaConVeh("v1"), tarifaConVeh("v1")] }),
    );
    expect(r.success).toBe(false);
  });
});

describe("crearZonaSchema — regla cobroVehiculo=false", () => {
  it("acepta exactamente una tarifa sin vehiculoId", () => {
    const r = crearZonaSchema.safeParse(base({ cobroVehiculo: false, tarifas: [tarifaSinVeh] }));
    expect(r.success).toBe(true);
  });

  it("rechaza mas de una tarifa cuando cobroVehiculo=false", () => {
    const r = crearZonaSchema.safeParse(
      base({ cobroVehiculo: false, tarifas: [tarifaSinVeh, tarifaSinVeh] }),
    );
    expect(r.success).toBe(false);
  });

  it("rechaza una tarifa con vehiculoId cuando cobroVehiculo=false", () => {
    const r = crearZonaSchema.safeParse(
      base({ cobroVehiculo: false, tarifas: [tarifaConVeh("v1")] }),
    );
    expect(r.success).toBe(false);
  });
});

describe("listarZonasSchema — include", () => {
  it("aplica defaults y sin include", () => {
    const r = listarZonasSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.page).toBe(1);
  });

  it("acepta include ['tarifas']", () => {
    expect(listarZonasSchema.safeParse({ include: ["tarifas"] }).success).toBe(true);
  });

  it("rechaza include con valores fuera del catalogo", () => {
    expect(listarZonasSchema.safeParse({ include: ["distritos"] }).success).toBe(false);
  });
});
