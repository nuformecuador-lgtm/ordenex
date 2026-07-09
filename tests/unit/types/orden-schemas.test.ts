import { describe, it, expect } from "vitest";
import {
  crearOrdenSchema,
  actualizarOrdenSchema,
  listarOrdenesSchema,
} from "@/lib/types/orden";
import { ordenesConfig } from "@/lib/config/ordenes";

function baseCrear() {
  return {
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    peso: 1.5,
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
  };
}

describe("crearOrdenSchema — validacion de creacion (R25/R26/R12/R14a)", () => {
  it("acepta un input valido minimo (sin opcionales)", () => {
    const r = crearOrdenSchema.safeParse(baseCrear());
    expect(r.success).toBe(true);
  });

  it("rechaza num_remision ausente (R26/R9)", () => {
    const { numRemision, ...rest } = baseCrear();
    void numRemision;
    const r = crearOrdenSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("numRemision");
  });

  it("rechaza peso negativo (R26/R13)", () => {
    const r = crearOrdenSchema.safeParse({ ...baseCrear(), peso: -3 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("peso");
  });

  it("rechaza peso no numerico (R26/R13)", () => {
    const r = crearOrdenSchema.safeParse({ ...baseCrear(), peso: "pesado" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("peso");
  });

  it("rechaza zonaId/provinciaId/cantonId ausentes (R12/R26)", () => {
    const { zonaId, provinciaId, cantonId, ...rest } = baseCrear();
    void zonaId;
    void provinciaId;
    void cantonId;
    const r = crearOrdenSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = r.error.flatten().fieldErrors;
      expect(fe).toHaveProperty("zonaId");
      expect(fe).toHaveProperty("provinciaId");
      expect(fe).toHaveProperty("cantonId");
    }
  });

  it("rechaza destinatario/telefonoDest/producto ausentes (R26)", () => {
    const r = crearOrdenSchema.safeParse({
      numRemision: "REM-2",
      peso: 1,
      zonaId: "z1",
      provinciaId: "p1",
      cantonId: "c1",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = r.error.flatten().fieldErrors;
      expect(fe).toHaveProperty("destinatario");
      expect(fe).toHaveProperty("telefonoDest");
      expect(fe).toHaveProperty("producto");
    }
  });

  it("acepta distritoId/estatusId/notas/tiendaId opcionales (R12/R14a)", () => {
    const r = crearOrdenSchema.safeParse({
      ...baseCrear(),
      distritoId: "d1",
      estatusId: "os1",
      notas: "fragil",
      tiendaId: "t1",
    });
    expect(r.success).toBe(true);
  });
});

describe("actualizarOrdenSchema — todos opcionales, sin inmutables", () => {
  it("acepta objeto vacio", () => {
    expect(actualizarOrdenSchema.safeParse({}).success).toBe(true);
  });

  it("rechaza campos inmutables (numGuia/id/numRemision) por strict", () => {
    expect(actualizarOrdenSchema.safeParse({ numGuia: 5 }).success).toBe(false);
    expect(actualizarOrdenSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(actualizarOrdenSchema.safeParse({ numRemision: "R" }).success).toBe(false);
  });

  it("acepta cambio de estatusId solo", () => {
    expect(actualizarOrdenSchema.safeParse({ estatusId: "os2" }).success).toBe(true);
  });
});

describe("listarOrdenesSchema — paginacion/orden (R30/R31/R32/R33)", () => {
  it("aplica defaults", () => {
    const r = listarOrdenesSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.sortBy).toBe("created_at");
      expect(r.data.sortDir).toBe("desc");
    }
  });

  it("rechaza page/pageSize no positivos (R32)", () => {
    expect(listarOrdenesSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listarOrdenesSchema.safeParse({ pageSize: -1 }).success).toBe(false);
    expect(listarOrdenesSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it("rechaza sortBy fuera de la lista blanca (R31/R32)", () => {
    expect(listarOrdenesSchema.safeParse({ sortBy: "peso" }).success).toBe(false);
    expect(listarOrdenesSchema.safeParse({ sortBy: "deleted_at" }).success).toBe(false);
  });

  it("rechaza sortDir invalido (R31/R32)", () => {
    expect(listarOrdenesSchema.safeParse({ sortDir: "up" }).success).toBe(false);
  });

  it("acota pageSize a MAX_PAGE_SIZE (R33)", () => {
    const r = listarOrdenesSchema.safeParse({ pageSize: 100000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pageSize).toBe(ordenesConfig.MAX_PAGE_SIZE);
  });
});
