import { describe, it, expect } from "vitest";
import {
  crearPlantillaSchema,
  actualizarPlantillaSchema,
  cambiarEstadoPlantillaSchema,
  listarPlantillasSchema,
} from "@/lib/types/plantilla-mensaje";

// Feature 107 — T3 (R7, R9, R11, R22, R25).

describe("R9: crear rechaza nombre vacio", () => {
  it("nombre vacio -> error en `nombre`", () => {
    const r = crearPlantillaSchema.safeParse({ nombre: "", cuerpo: "Hola" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "nombre")).toBe(true);
  });
});

describe("R11: crear rechaza cuerpo vacio", () => {
  it("cuerpo vacio -> error en `cuerpo`", () => {
    const r = crearPlantillaSchema.safeParse({ nombre: "Bienvenida", cuerpo: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "cuerpo")).toBe(true);
  });
});

describe("el cliente NO envia variables ni estado (.strict())", () => {
  it("crear rechaza campos desconocidos", () => {
    const r = crearPlantillaSchema.safeParse({
      nombre: "X",
      cuerpo: "Hola {{usuario}}",
      variables: ["usuario"],
    });
    expect(r.success).toBe(false);
  });

  it("crear valido parsea solo nombre y cuerpo", () => {
    const r = crearPlantillaSchema.safeParse({ nombre: "X", cuerpo: "Hola {{usuario}}" });
    expect(r.success).toBe(true);
  });
});

describe("R22: actualizar aplica las mismas reglas, parcial", () => {
  it("permite solo cuerpo", () => {
    expect(actualizarPlantillaSchema.safeParse({ cuerpo: "Nuevo" }).success).toBe(true);
  });
  it("rechaza nombre vacio y campos extra", () => {
    expect(actualizarPlantillaSchema.safeParse({ nombre: "" }).success).toBe(false);
    expect(actualizarPlantillaSchema.safeParse({ estado: "inactivo" }).success).toBe(false);
  });
});

describe("R25: cambiarEstado solo acepta destino inactivo", () => {
  it("acepta inactivo", () => {
    expect(cambiarEstadoPlantillaSchema.safeParse({ estado: "inactivo" }).success).toBe(true);
  });
  it("rechaza activo/pending/refused y cualquier otro", () => {
    for (const estado of ["activo", "pending", "refused", "borrado"]) {
      expect(cambiarEstadoPlantillaSchema.safeParse({ estado }).success).toBe(false);
    }
  });
});

describe("R7: listar clampa pageSize a la cota maxima", () => {
  it("aplica defaults y clamp", () => {
    const r = listarPlantillasSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBeGreaterThan(0);
    const big = listarPlantillasSchema.parse({ pageSize: 100000 });
    expect(big.pageSize).toBeLessThanOrEqual(100);
  });
});
