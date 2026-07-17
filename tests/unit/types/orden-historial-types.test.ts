import { describe, it, expect } from "vitest";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 49/R23 — el tipo de origen es un CONJUNTO CERRADO de los call-sites de escritura
// de `orden.estatus_id` (design §1.2/§2). La exhaustividad frente al enum Prisma es de
// compile-time (satisfies + chequeo `_EnsureExhaustive` en el modulo); aqui se verifica el
// contenido en runtime.
// Feature 67 (F1.4-b): el conjunto pasa a 12 con `deshacer_gestion` (migracion
// `*_gestion_orden_anulacion` + su down.sql). A diferencia de la 47/48 —que reutilizaron
// `gestion`/`ajuste_estado`—, el deshacer SI necesita valor propio: el proposito de la feature
// es el RASTRO, y reusar `gestion` haria la linea de tiempo indistinguible de una gestion real.
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
    "deshacer_gestion", // feature 67: CierreDiaRepository.anularGestionYDevolverAGestion
    "carga_api", // feature 88 (D7): createManyOrdenesConGuia (canal integrador por API)
  ];

  it("contiene exactamente los 13 tipos de origen esperados (conjunto cerrado)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(13);
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
