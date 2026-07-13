import { describe, it, expect } from "vitest";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 49/R23 — el tipo de origen es un CONJUNTO CERRADO de los 11 call-sites de
// escritura de `orden.estatus_id` (design §1.2/§2). La exhaustividad frente al enum Prisma
// es de compile-time (satisfies + chequeo `_EnsureExhaustive` en el modulo); aqui se
// verifica el contenido en runtime.
describe("ORDEN_HISTORIAL_ORIGEN_TIPO_SEED (R23)", () => {
  const ESPERADOS = [
    "carga_masiva",
    "creacion_manual",
    "generacion_guia",
    "asignacion_bodega",
    "ruteo_satelite",
    "recepcion_satelite",
    "asignacion_satelite",
    "recoleccion",
    "gestion",
    "liberacion_reprogramada",
    "ajuste_estado",
  ];

  it("contiene exactamente los 11 tipos de origen esperados (conjunto cerrado)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(11);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual([...ESPERADOS].sort());
  });

  it("coincide 1:1 con los valores del enum Prisma orden_historial_origen_tipo", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual(
      Object.values(PrismaOrdenHistorialOrigenTipo).sort(),
    );
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).size).toBe(
      ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length,
    );
  });
});
