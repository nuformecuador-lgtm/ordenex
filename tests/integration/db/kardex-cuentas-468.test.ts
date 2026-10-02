import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import { CuentaKardexService } from "@/lib/services/LibroKardexService";
import type { EstadoCuentaCompletoInput } from "@/lib/types/estado-cuenta";
import type { KardexDTO } from "@/lib/types/libro-kardex";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, type Catalogo459 } from "./_fixtures/caja-459";
import { montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 468 / T5 — EL KARDEX DE LAS CUENTAS (tienda, mensajero, bodega) CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Sobre el escenario de la fotografia de la 458 (filas con instantes fijos y EMPATES controlados: dos
// filas del mismo instante con `created_at` distinto e id al reves), que es justo lo que hace falta para
// que «cada saldo = el anterior + Entra − Sale» mida el orden de verdad:
//
//   · R11/R13/R15 — sin otros filtros, el saldo de cada fila es su `saldoCorrido`, cada uno es el anterior
//     + Entra − Sale, y el ultimo (y inicial + Σ Entra − Σ Sale) es el saldo final de la tarjeta;
//   · R9 — en la bodega, lo declarado va a «Entra» (sube lo que tiene por entregar);
//   · R16 — con un chip, `conOtrosFiltros` y los totales suman solo las filas devueltas.
//
// MUTACION EJECUTADA (impl_468): el lado que sube en la bodega al reves → el kardex de la bodega no cuadra
// (el servicio lanza) y este caso se pone rojo. No-vacuidad: cada cuenta afirma su numero de filas.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

function recalcular(k: KardexDTO): string {
  let saldo = new Prisma.Decimal(k.saldoInicial);
  for (const f of k.filas) {
    if (f.monto.columna === "entra") saldo = saldo.plus(f.monto.monto);
    else if (f.monto.columna === "sale") saldo = saldo.minus(f.monto.monto);
    expect(f.saldo, "R15: el saldo de la fila no es el anterior + Entra − Sale").toBe(saldo.toFixed(2));
  }
  return saldo.toFixed(2);
}

describeSiHayBase("468 — el kardex de las cuentas (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Catalogo459;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("T5 R9/R11/R13/R15/R16: tienda, mensajero y bodega — saldo por fila, cuadre fila a fila y chip", async () => {
    await enTransaccionRevertida459(prisma, async (tx) => {
      const s = montarServicios459(tx);
      const esc = await sembrarEscenario458(tx, cat);
      const ec = montarEstadoCuenta(s);
      const servicio = new CuentaKardexService(
        ec,
        new DetalleEnLoteService(new CierreAporteRepository(s.cliente), new WalletTiendaMovimientoRepository(s.cliente), new EstadoCuentaRepository(s.cliente)),
      );
      const maestro: Actor = esc.maestro;
      const cuentas = [
        { cuenta: { tipo: "tienda" as const, id: esc.tiendaC }, minimo: 6 },
        { cuenta: { tipo: "mensajero" as const, id: esc.mensajeroM }, minimo: 6 },
        { cuenta: { tipo: "bodega" as const, id: esc.zonaZ }, minimo: 3 },
      ];
      for (const { cuenta, minimo } of cuentas) {
        const entrada: EstadoCuentaCompletoInput = { cuenta, sortBy: "fecha", sortDir: "desc" };
        const r = await servicio.kardex(entrada, maestro);
        if (r.status !== "ok") throw new Error(`${cuenta.tipo}: ${JSON.stringify(r)}`);
        expect(r.estado.filas.length, `${cuenta.tipo}: el escenario no trajo filas`).toBeGreaterThanOrEqual(minimo);
        // R11: el saldo de cada fila ES el `saldoCorrido` que pinta la pantalla.
        expect(r.kardex.filas.map((f) => f.saldo)).toEqual(r.estado.filas.map((f) => f.saldoCorrido));
        // R13: el inicial y el final son los de la tarjeta.
        expect([r.kardex.saldoInicial, r.kardex.saldoFinal]).toEqual([r.estado.saldoInicial, r.estado.saldoFinal]);
        // R15, recalculado aqui.
        expect(recalcular(r.kardex), cuenta.tipo).toBe(r.kardex.saldoFinal);
        // Y es la pantalla en orden ascendente: el kardex forzo el orden aunque se pidiera «desc» (R7).
        const pantalla = await ec.leerCompleto({ cuenta, sortBy: "fecha", sortDir: "asc" }, maestro);
        if (pantalla.status !== "ok") throw new Error(pantalla.status);
        expect(r.estado.filas).toEqual(pantalla.estado.filas);
      }

      // R9 — la bodega: lo declarado va a «Entra».
      const bodega = await servicio.kardex({ cuenta: { tipo: "bodega", id: esc.zonaZ }, sortBy: "fecha", sortDir: "asc" }, maestro);
      if (bodega.status !== "ok") throw new Error(bodega.status);
      for (const [i, f] of bodega.estado.filas.entries()) {
        expect(bodega.kardex.filas[i].monto.columna).toBe(f.cargo !== null ? "entra" : "sale");
        expect(bodega.kardex.filas[i].ordenes).toBeNull();
      }
      expect(bodega.kardex.filas.some((f) => f.monto.columna === "entra")).toBe(true);
      expect(bodega.kardex.filas.some((f) => f.monto.columna === "sale")).toBe(true);

      // R16 — con un chip: `conOtrosFiltros` y los totales de SOLO lo devuelto.
      const chip = await servicio.kardex({ cuenta: { tipo: "tienda", id: esc.tiendaC }, chip: "cierres", sortBy: "fecha", sortDir: "asc" }, maestro);
      if (chip.status !== "ok") throw new Error(chip.status);
      expect(chip.kardex.conOtrosFiltros).toBe(true);
      expect(chip.estado.filas.length).toBeGreaterThan(0);
      const suma = (col: "entra" | "sale") =>
        chip.kardex.filas
          .filter((f) => f.monto.columna === col)
          .reduce((a, f) => a.plus(f.monto.monto), new Prisma.Decimal(0))
          .toFixed(2);
      expect(chip.kardex.totales).toEqual({ entra: suma("entra"), sale: suma("sale"), cobradoATiendas: null });
    });
  });
});
