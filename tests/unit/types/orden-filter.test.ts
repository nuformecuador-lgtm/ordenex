import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  listarOrdenesSchema,
  ordenFilterSchema,
  ORDEN_FILTER_FIELDS,
} from "@/lib/types/orden";

// Feature 63/B1 (R6/R7/R11): validacion en el borde del filtro generico `filter`.
// El schema `.strict()` con whitelist es la unica defensa que impide que un nombre
// de columna arbitrario llegue a Prisma (R11).
describe("ordenFilterSchema / listarOrdenesSchema.filter (feature 63)", () => {
  // La whitelist v1 de la feature 63 era exactamente `['status_id']`. La feature 144 la
  // AMPLIO a nueve claves (R30) — es un cambio de contrato deliberado, no una regresion:
  // el invariante que esta feature defiende es que `status_id` SIGUE en la whitelist y
  // que todo lo que no esta en ella se rechaza (los tests de abajo, intactos). El censo
  // exacto de las nueve claves vive en `orden-filter-144.test.ts`.
  it("R8: `status_id` sigue en la whitelist server-side", () => {
    expect(ORDEN_FILTER_FIELDS).toContain("status_id");
  });

  it("R6: listarOrdenesSchema acepta un filter con status_id", () => {
    const parsed = listarOrdenesSchema.parse({
      filter: { status_id: "os-entregada" },
    });
    expect(parsed.filter).toEqual({ status_id: "os-entregada" });
  });

  it("R6/R10: filter es opcional; sin filter el schema valida (sin regresion)", () => {
    const parsed = listarOrdenesSchema.parse({});
    expect(parsed.filter).toBeUndefined();
    // El estatusId escalar preexistente sigue aceptandose.
    const conEscalar = listarOrdenesSchema.parse({ estatusId: "os-x" });
    expect(conEscalar.estatusId).toBe("os-x");
  });

  it("R7/R11: una clave fuera de la whitelist produce ZodError (no llega a Prisma)", () => {
    expect(() => ordenFilterSchema.parse({ tiendaId: "store1" })).toThrow(z.ZodError);
    expect(() =>
      listarOrdenesSchema.parse({ filter: { deletedAt: null } }),
    ).toThrow(z.ZodError);
  });

  it("R11: ni siquiera una columna real fuera de whitelist (estatusId) pasa dentro de filter", () => {
    // `estatusId` es columna real, pero la clave PUBLICA del filtro es `status_id`;
    // usar el nombre interno como clave del filter debe ser rechazado por .strict().
    expect(() =>
      ordenFilterSchema.parse({ estatusId: "os-x" }),
    ).toThrow(z.ZodError);
  });

  it("R7: status_id vacio se rechaza (min(1))", () => {
    expect(() => ordenFilterSchema.parse({ status_id: "" })).toThrow(z.ZodError);
  });

  // Filtro MULTI-ESTADO: el listado unico de /ordenes ofrece un selector de seleccion
  // multiple, asi que `status_id` acepta tambien una LISTA de ids (-> `IN (...)`).
  it("status_id acepta una LISTA de ids", () => {
    const parsed = listarOrdenesSchema.parse({
      filter: { status_id: ["os-a", "os-b"] },
    });
    expect(parsed.filter).toEqual({ status_id: ["os-a", "os-b"] });
  });

  it("una lista VACIA se rechaza (equivaldria a 'ningun estado': se omite el filtro)", () => {
    expect(() => ordenFilterSchema.parse({ status_id: [] })).toThrow(z.ZodError);
  });

  it("un id vacio dentro de la lista se rechaza (min(1) por elemento)", () => {
    expect(() => ordenFilterSchema.parse({ status_id: ["os-a", ""] })).toThrow(
      z.ZodError,
    );
  });
});
