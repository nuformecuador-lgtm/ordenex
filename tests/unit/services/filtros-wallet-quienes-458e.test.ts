import { describe, expect, it, vi } from "vitest";

import { quienesDelLibroCajaAction } from "@/lib/actions/wallet-filtros";
import type { IFiltrosWalletRepository } from "@/lib/interfaces/repositories/IFiltrosWalletRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { FiltrosWalletService, opcionesDeQuienes } from "@/lib/services/FiltrosWalletService";
import { A_QUIEN_NOMBRE_MAX, aQuienFiltroSchema } from "@/lib/types/libro-caja-a-quien";
import { PAGO_POR_CUENTA_BENEFICIARIO_MAX } from "@/lib/types/pago-por-cuenta-tienda";
import { listarMovimientosCompletoSchema, listarMovimientosDeFilaSchema, listarMovimientosSchema } from "@/lib/types/wallet";
import { conceptosConMovimientosSchema, quienesDelLibroCajaSchema } from "@/lib/types/wallet-filtros";

// Ficha 458-E (TE.2, R59) — el selector «A quién» del libro de la caja: rol ANTES de leer, busqueda
// sin mayusculas ni tildes, orden alfabetico, tope con `hayMas`; y el borde `.strict()` con `.uuid()`.
// El WHERE y las opciones contra Postgres: `tests/integration/db/libro-caja-filtro-a-quien.test.ts`.

const MAESTRO = { usuarioId: "m", rol: "maestro" } as Actor;
const ADMIN = { usuarioId: "a", rol: "admin" } as Actor;
const TIENDA = { usuarioId: "t", rol: "adminTienda" } as Actor;
const MENSAJERO = { usuarioId: "g", rol: "mensajero" } as Actor;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const FILAS = {
  cuentas: [
    { tipo: "tienda" as const, cuentaId: UUID_A, nombre: "Zapatería Ñandú", movimientos: 4 },
    { tipo: "mensajero" as const, cuentaId: UUID_B, nombre: "Álvaro Pérez", movimientos: 2 },
  ],
  nombres: [
    { nombre: "Cartonera del Valle", movimientos: 2 },
    { nombre: "alquiler bodega", movimientos: 1 },
  ],
};

function repo(): IFiltrosWalletRepository & { quienesDelLibroCaja: ReturnType<typeof vi.fn> } {
  return {
    contarConceptosCaja: vi.fn(),
    contarConceptosTienda: vi.fn(),
    cierresDeTienda: vi.fn(),
    cierresDeMensajero: vi.fn(),
    quienesDelLibroCaja: vi.fn(async () => FILAS),
  } as never;
}

describe("opcionesDeQuienes (R59)", () => {
  it("une cuentas y nombres, en orden alfabetico sin tildes; `valor` es el `aQuien` del filtro", () => {
    const r = opcionesDeQuienes(FILAS, undefined, 10);
    expect(r.hayMas).toBe(false);
    expect(r.opciones).toEqual([
      { valor: { nombre: "alquiler bodega" }, clase: "nombre", nombre: "alquiler bodega", movimientos: 1 },
      { valor: { tipo: "mensajero", id: UUID_B }, clase: "mensajero", nombre: "Álvaro Pérez", movimientos: 2 },
      { valor: { nombre: "Cartonera del Valle" }, clase: "nombre", nombre: "Cartonera del Valle", movimientos: 2 },
      { valor: { tipo: "tienda", id: UUID_A }, clase: "tienda", nombre: "Zapatería Ñandú", movimientos: 4 },
    ]);
  });

  it("la busqueda es por nombre, sin mayusculas ni tildes", () => {
    expect(opcionesDeQuienes(FILAS, "alvaro", 10).opciones.map((o) => o.nombre)).toEqual(["Álvaro Pérez"]);
    expect(opcionesDeQuienes(FILAS, "ZAPATERIA", 10).opciones.map((o) => o.nombre)).toEqual(["Zapatería Ñandú"]);
    expect(opcionesDeQuienes(FILAS, "  ", 10).opciones).toHaveLength(4);
    expect(opcionesDeQuienes(FILAS, "nadie", 10)).toEqual({ opciones: [], hayMas: false });
  });

  it("el tope recorta y dice `hayMas`; justo en el tope, no", () => {
    expect(opcionesDeQuienes(FILAS, undefined, 3)).toMatchObject({ hayMas: true });
    expect(opcionesDeQuienes(FILAS, undefined, 3).opciones).toHaveLength(3);
    expect(opcionesDeQuienes(FILAS, undefined, 4).hayMas).toBe(false);
  });
});

describe("FiltrosWalletService.quienesDelLibroCaja (R59, R82)", () => {
  it("rol sin acceso total → forbidden SIN tocar el repositorio", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r0 = repo();
      expect(await new FiltrosWalletService(r0).quienesDelLibroCaja({}, actor)).toEqual({ status: "forbidden" });
      expect(r0.quienesDelLibroCaja).not.toHaveBeenCalled();
    }
  });

  it("maestro y admin leen con el periodo y la direccion; el tope es el inyectado", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const r0 = repo();
      const desde = new Date("2026-09-01T06:00:00.000Z");
      const r = await new FiltrosWalletService(r0, { quienes: 2 }).quienesDelLibroCaja({ tipo: "egreso", desde }, actor);
      expect(r0.quienesDelLibroCaja).toHaveBeenCalledWith({ tipo: "egreso", desde, hasta: undefined });
      expect(r).toMatchObject({ status: "ok", hayMas: true });
    }
  });
});

describe("quienesDelLibroCajaAction — el borde", () => {
  it("sin sesion `unauthenticated` antes de validar ni leer", async () => {
    const r0 = repo();
    const r = await quienesDelLibroCajaAction({ cuenta: "x" }, { getActor: async () => null, service: new FiltrosWalletService(r0) });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(r0.quienesDelLibroCaja).not.toHaveBeenCalled();
  });

  it("una clave de mas es `validation_error` sin leer", async () => {
    const r0 = repo();
    const r = await quienesDelLibroCajaAction({ tiendaId: UUID_A }, { getActor: async () => MAESTRO, service: new FiltrosWalletService(r0) });
    expect(r.status).toBe("validation_error");
    expect(r0.quienesDelLibroCaja).not.toHaveBeenCalled();
  });
});

describe("schemas del filtro «A quién» (design §6)", () => {
  it("el tope del nombre es el del campo «A quién» al registrar (no se inventa)", () => {
    expect(A_QUIEN_NOMBRE_MAX).toBe(PAGO_POR_CUENTA_BENEFICIARIO_MAX);
  });

  it("acepta una cuenta con uuid o un nombre (recortado); rechaza el resto", () => {
    expect(aQuienFiltroSchema.parse({ tipo: "tienda", id: UUID_A })).toEqual({ tipo: "tienda", id: UUID_A });
    expect(aQuienFiltroSchema.parse({ tipo: "mensajero", id: UUID_B })).toEqual({ tipo: "mensajero", id: UUID_B });
    expect(aQuienFiltroSchema.parse({ nombre: "  Cartonera  " })).toEqual({ nombre: "Cartonera" });
    for (const malo of [
      { tipo: "bodega", id: UUID_A },
      { tipo: "tienda", id: "tienda-a" },
      { tipo: "tienda", id: UUID_A, nombre: "x" },
      { nombre: "   " },
      { nombre: "x".repeat(A_QUIEN_NOMBRE_MAX + 1) },
      { id: UUID_A },
      {},
    ]) {
      expect(aQuienFiltroSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it("el libro, la descarga, el detalle de fila, los conceptos de la caja y el selector son `.strict()` y aceptan `aQuien`", () => {
    const aQuien = { tipo: "tienda", id: UUID_A };
    expect(listarMovimientosSchema.parse({ aQuien }).aQuien).toEqual(aQuien);
    expect(listarMovimientosCompletoSchema.parse({ aQuien }).aQuien).toEqual(aQuien);
    expect(listarMovimientosDeFilaSchema.parse({ aQuien, fila: "otros_egresos" }).aQuien).toEqual(aQuien);
    const conceptos = conceptosConMovimientosSchema.parse({ libro: "caja", aQuien });
    expect(conceptos.libro === "caja" ? conceptos.aQuien : null).toEqual(aQuien);
    expect(listarMovimientosSchema.safeParse({ quien: aQuien }).success).toBe(false);
    expect(listarMovimientosCompletoSchema.safeParse({ quien: aQuien }).success).toBe(false);
    expect(listarMovimientosDeFilaSchema.safeParse({ fila: "otros_egresos", quien: aQuien }).success).toBe(false);
    expect(quienesDelLibroCajaSchema.safeParse({ aQuien }).success).toBe(false);
    // La tienda y `mi_tienda` no admiten «A quién»: su cuenta ya es una.
    expect(conceptosConMovimientosSchema.safeParse({ libro: "tienda", tiendaId: UUID_A, aQuien }).success).toBe(false);
  });
});
