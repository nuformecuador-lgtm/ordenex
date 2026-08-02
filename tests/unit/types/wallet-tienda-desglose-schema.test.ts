import { describe, it, expect } from "vitest";
import {
  listarMovimientosDeTiendaCompletoSchema,
  listarMovimientosDeTiendaSchema,
  listarMovimientosTiendaSchema,
} from "@/lib/types/wallet-tienda";

// Feature 171 / T1.1 (R22/R25) — schemas de borde del desglose de UNA tienda.
//
// `tiendaId` REQUERIDO es lo que hace que «entrada que no identifica una tienda» se resuelva
// en el borde, sin consultar la base (R25). Y `.strict()` en el modo completo es la PRIMERA de
// las tres barreras contra ampliar el alcance con una clave extra (R24).

describe("listarMovimientosDeTiendaSchema (R22/R25)", () => {
  it("R25: sin `tiendaId` -> error, con el campo senalado", () => {
    const r = listarMovimientosDeTiendaSchema.safeParse({ page: 1, pageSize: 20 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(Object.keys(r.error.flatten().fieldErrors)).toContain("tiendaId");
  });

  it("R25: `tiendaId` vacio -> error (una cadena vacia no identifica una tienda)", () => {
    const r = listarMovimientosDeTiendaSchema.safeParse({ tiendaId: "" });
    expect(r.success).toBe(false);
  });

  it("R25: `tiendaId` que no es cadena -> error", () => {
    expect(listarMovimientosDeTiendaSchema.safeParse({ tiendaId: 42 }).success).toBe(false);
    expect(listarMovimientosDeTiendaSchema.safeParse({ tiendaId: null }).success).toBe(false);
  });

  it("R22: con `tiendaId` valido acepta y aplica los MISMOS defaults de paginacion que el listado propio", () => {
    const r = listarMovimientosDeTiendaSchema.parse({ tiendaId: "t1" });
    const base = listarMovimientosTiendaSchema.parse({});
    expect(r.tiendaId).toBe("t1");
    expect(r.page).toBe(base.page);
    expect(r.pageSize).toBe(base.pageSize);
  });

  it("R18/R22: hereda los tres filtros del listado (cierre, concepto, rango de fechas)", () => {
    const r = listarMovimientosDeTiendaSchema.parse({
      tiendaId: "t1",
      page: 3,
      pageSize: 50,
      cierreId: "c1",
      categoria: "iva_comision_cod",
      desde: "2026-07-01T00:00:00.000Z",
      hasta: "2026-07-31T00:00:00.000Z",
    });
    expect(r).toMatchObject({
      tiendaId: "t1",
      page: 3,
      pageSize: 50,
      cierreId: "c1",
      categoria: "iva_comision_cod",
    });
    expect(r.desde).toBeInstanceOf(Date);
    expect(r.hasta).toBeInstanceOf(Date);
  });

  it("R44: `pago_tienda` es un valor ACEPTADO del filtro por concepto (lo necesita la 172)", () => {
    const r = listarMovimientosDeTiendaSchema.parse({ tiendaId: "t1", categoria: "pago_tienda" });
    expect(r.categoria).toBe("pago_tienda");
  });

  it("una categoria inventada se rechaza en el borde", () => {
    const r = listarMovimientosDeTiendaSchema.safeParse({ tiendaId: "t1", categoria: "no_existe" });
    expect(r.success).toBe(false);
  });
});

describe("listarMovimientosDeTiendaCompletoSchema (R24/R25/R37)", () => {
  it("R25: sigue exigiendo `tiendaId`", () => {
    expect(listarMovimientosDeTiendaCompletoSchema.safeParse({}).success).toBe(false);
    expect(listarMovimientosDeTiendaCompletoSchema.safeParse({ tiendaId: "" }).success).toBe(false);
  });

  it("R37: rechaza `page` y `pageSize` — el modo completo NO pagina", () => {
    expect(
      listarMovimientosDeTiendaCompletoSchema.safeParse({ tiendaId: "t1", page: 1 }).success,
    ).toBe(false);
    expect(
      listarMovimientosDeTiendaCompletoSchema.safeParse({ tiendaId: "t1", pageSize: 20 }).success,
    ).toBe(false);
  });

  it("R24: `.strict()` rechaza cualquier clave extra (primera barrera contra ampliar el alcance)", () => {
    const r = listarMovimientosDeTiendaCompletoSchema.safeParse({
      tiendaId: "t1",
      todasLasTiendas: true,
    });
    expect(r.success).toBe(false);
  });

  it("R37: acepta el `tiendaId` + los MISMOS filtros que el listado, sin paginacion", () => {
    const r = listarMovimientosDeTiendaCompletoSchema.parse({
      tiendaId: "t1",
      cierreId: "c1",
      categoria: "flete",
    });
    expect(r).toMatchObject({ tiendaId: "t1", cierreId: "c1", categoria: "flete" });
    expect(r).not.toHaveProperty("page");
    expect(r).not.toHaveProperty("pageSize");
  });

  it("resuelve EXACTAMENTE los mismos filtros que el paginado (ningun conjunto distinto en el archivo)", () => {
    const entrada = {
      tiendaId: "t1",
      cierreId: "c1",
      categoria: "comision_cod" as const,
      desde: "2026-07-01T00:00:00.000Z",
      hasta: "2026-07-31T00:00:00.000Z",
    };
    const paginado = listarMovimientosDeTiendaSchema.parse(entrada);
    const completo = listarMovimientosDeTiendaCompletoSchema.parse(entrada);

    const { page: _p, pageSize: _ps, ...filtrosPaginado } = paginado;
    void _p;
    void _ps;
    expect(completo).toEqual(filtrosPaginado);
  });
});
