import { describe, it, expect } from "vitest";

import { BUSQUEDA_LIBRO_MAX_CHARS, BUSQUEDA_LIBRO_MIN_CHARS, CAMPOS_ORDEN_LIBRO } from "@/lib/config/libro-wallet";
import {
  estadoCuentaCompletoSchema,
  estadoCuentaSchema,
  miEstadoCuentaCompletoSchema,
  miEstadoCuentaSchema,
} from "@/lib/types/estado-cuenta";
import {
  listarLibroCajaCompletoSchema,
  listarLibroCajaSchema,
  listarMovimientosDeFilaSchema,
  listarMovimientosSchema,
} from "@/lib/types/wallet";
import { listarSaldosTiendasCompletoSchema, listarSaldosTiendasPaginadoSchema } from "@/lib/types/wallet-tienda";

// FICHA 463 / T1 — los contratos de borde del libro de las wallets (design §2).
//
// Las cifras de la caja (resumen, desglose, detalle de una fila de la composicion) parsean el esquema
// SIN termino ni orden y son `.strict()`: un `q`, `sortBy` o `sortDir` es `validation_error` (R14). El
// libro (pagina y descarga) y los cuatro estados de cuenta llevan termino y orden, con «Mas recientes»
// por defecto (R34) y una lista blanca cerrada de campos y direcciones (R40).

const CUENTA = { tipo: "tienda", id: "00000000-0000-4000-8000-000000000463" } as const;

describe("463/T1 — contratos del libro", () => {
  it("las constantes: minimo 3 (el de /ordenes), y solo se ordena por fecha", () => {
    expect(BUSQUEDA_LIBRO_MIN_CHARS).toBe(3);
    expect(BUSQUEDA_LIBRO_MAX_CHARS).toBe(100);
    expect(CAMPOS_ORDEN_LIBRO).toEqual(["fecha"]);
  });

  describe("R14 — el borde de las cifras rechaza el termino y el orden", () => {
    const deFila = { fila: "egreso_pago_mensajero" };
    for (const extra of [{ q: "abcd" }, { sortDir: "desc" }, { sortDir: "asc" }, { sortBy: "fecha" }]) {
      it(`resumen/desglose (listarMovimientosSchema) con ${JSON.stringify(extra)} ⇒ error`, () => {
        expect(listarMovimientosSchema.safeParse(extra).success).toBe(false);
      });
      it(`detalle de una fila (listarMovimientosDeFilaSchema) con ${JSON.stringify(extra)} ⇒ error`, () => {
        expect(listarMovimientosDeFilaSchema.safeParse({ ...deFila, ...extra }).success).toBe(false);
      });
    }
    it("control: sin termino ni orden, los dos siguen aceptando su entrada de siempre", () => {
      expect(listarMovimientosSchema.safeParse({ tipo: "ingreso" }).success).toBe(true);
      expect(listarMovimientosDeFilaSchema.safeParse(deFila).success).toBe(true);
    });
  });

  describe("el libro de la caja: termino y orden", () => {
    it("R34: por defecto «Mas recientes» por fecha, en la pagina y en la descarga", () => {
      expect(listarLibroCajaSchema.parse({})).toMatchObject({ sortBy: "fecha", sortDir: "desc", page: 1 });
      expect(listarLibroCajaCompletoSchema.parse({})).toEqual({ sortBy: "fecha", sortDir: "desc" });
    });

    it("acepta asc y el termino recortado; conserva los filtros de la wallet", () => {
      const r = listarLibroCajaSchema.parse({ q: "  Pedro  ", sortDir: "asc", tipo: "egreso", aQuien: { nombre: "Pedro" } });
      expect(r).toMatchObject({ q: "Pedro", sortDir: "asc", tipo: "egreso", aQuien: { nombre: "Pedro" } });
    });

    it("R40: direccion o campo no admitidos ⇒ error (pagina y descarga)", () => {
      for (const s of [listarLibroCajaSchema, listarLibroCajaCompletoSchema]) {
        expect(s.safeParse({ sortDir: "ASC" }).success).toBe(false);
        expect(s.safeParse({ sortDir: "arriba" }).success).toBe(false);
        expect(s.safeParse({ sortBy: "monto" }).success).toBe(false);
        expect(s.safeParse({ sortBy: "created_at" }).success).toBe(false);
      }
    });

    it("R24: termino por debajo del minimo (tras recortar) o por encima del maximo ⇒ error", () => {
      expect(listarLibroCajaSchema.safeParse({ q: "ab" }).success).toBe(false);
      expect(listarLibroCajaSchema.safeParse({ q: "   ab   " }).success).toBe(false);
      expect(listarLibroCajaSchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
      expect(listarLibroCajaSchema.safeParse({ q: "abc" }).success).toBe(true);
    });

    it("sigue siendo .strict(): una clave ajena y, en la descarga, page/pageSize ⇒ error", () => {
      expect(listarLibroCajaSchema.safeParse({ tiendaId: "x" }).success).toBe(false);
      expect(listarLibroCajaCompletoSchema.safeParse({ page: 1 }).success).toBe(false);
    });
  });

  describe("los cuatro esquemas del estado de cuenta: termino y orden", () => {
    const casos = [
      ["estadoCuentaSchema", estadoCuentaSchema, { cuenta: CUENTA }],
      ["estadoCuentaCompletoSchema", estadoCuentaCompletoSchema, { cuenta: CUENTA }],
      ["miEstadoCuentaSchema", miEstadoCuentaSchema, {}],
      ["miEstadoCuentaCompletoSchema", miEstadoCuentaCompletoSchema, {}],
    ] as const;

    for (const [nombre, schema, base] of casos) {
      it(`${nombre}: default «Mas recientes» (R34/R47)`, () => {
        expect(schema.parse(base)).toMatchObject({ sortBy: "fecha", sortDir: "desc" });
      });
      it(`${nombre}: acepta asc y el termino recortado`, () => {
        expect(schema.parse({ ...base, sortDir: "asc", q: "  liquidacion " })).toMatchObject({ sortDir: "asc", q: "liquidacion" });
      });
      it(`${nombre}: R40 direccion o campo invalidos y R24 termino corto ⇒ error`, () => {
        expect(schema.safeParse({ ...base, sortDir: "x" }).success).toBe(false);
        expect(schema.safeParse({ ...base, sortBy: "monto" }).success).toBe(false);
        expect(schema.safeParse({ ...base, q: "ab" }).success).toBe(false);
      });
    }
  });

  describe("R45 — saldos de tiendas: `busqueda` en la pagina y en la descarga", () => {
    it("acepta `busqueda` y sigue rechazando `tiendaId`", () => {
      expect(listarSaldosTiendasPaginadoSchema.parse({ busqueda: "ferre" })).toMatchObject({ busqueda: "ferre", page: 1 });
      expect(listarSaldosTiendasCompletoSchema.parse({ busqueda: "ferre" })).toEqual({ busqueda: "ferre" });
      expect(listarSaldosTiendasPaginadoSchema.safeParse({ tiendaId: "x" }).success).toBe(false);
      expect(listarSaldosTiendasCompletoSchema.safeParse({ busqueda: "x", page: 1 }).success).toBe(false);
    });
  });
});
