import { afterAll, describe, expect, it } from "vitest";

import { conceptosConMovimientosAction } from "@/lib/actions/wallet-filtros";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import type { ConceptosConMovimientosResult } from "@/lib/types/wallet-filtros";

import { sembrarPersonas461 } from "./_fixtures/personas-461";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

// =================================================================================================
// FICHA 458-A (TA.3, R13–R15) — los conceptos del filtro salen de los MOVIMIENTOS, contra Postgres
// =================================================================================================
//
// Memoria «probar el WHERE donde vive»: los tests de servicio usan dobles y no ven el SQL. Aqui el
// conteo corre en la base, por la action, con el servicio y el repositorio REALES sobre una
// transaccion revertida. Las filas se fechan en 2031 y cada caso filtra ese periodo: el conteo es
// EXACTO aunque la base de desarrollo tenga otros movimientos.
//
// Mutacion comprobada (anotada en progress/impl_458-A.md): quitar `tiendaId` del WHERE de
// `contarConceptosTienda` pone rojo «R13 tienda» (se cuela el `ajuste_debito` de la otra tienda).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const EN_PERIODO = new Date("2031-03-10T15:00:00.000Z");
const FUERA = new Date("2031-05-10T15:00:00.000Z");
const PERIODO = { desde: "2031-03-01", hasta: "2031-03-31" };

async function sembrar(tx: TxDeTest) {
  const p = await sembrarPersonas461(tx);
  const base = { origenTipo: "manual" as const, origenId: null };
  await tx.walletTiendaMovimiento.createMany({
    data: [
      { ...base, tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: "100.00", fechaMovimiento: EN_PERIODO },
      { ...base, tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: "200.00", fechaMovimiento: EN_PERIODO },
      { ...base, tiendaId: p.tiendaId, tipo: "debito", categoria: "flete", monto: "10.00", fechaMovimiento: EN_PERIODO },
      // Fuera del periodo: NO cuenta.
      { ...base, tiendaId: p.tiendaId, tipo: "debito", categoria: "comision_cod", monto: "5.00", fechaMovimiento: FUERA },
      // De OTRA tienda, en el periodo: NO cuenta para la primera.
      { ...base, tiendaId: p.otraTiendaId, tipo: "debito", categoria: "ajuste_debito", monto: "7.00", fechaMovimiento: EN_PERIODO },
    ],
  });
  await tx.walletMovimiento.createMany({
    data: [
      { ...base, tipo: "ingreso", categoria: "ingreso_flete", monto: "10.00", fechaMovimiento: EN_PERIODO },
      { ...base, tipo: "egreso", categoria: "egreso_sueldo", monto: "50.00", fechaMovimiento: EN_PERIODO },
      { ...base, tipo: "egreso", categoria: "egreso_sueldo", monto: "60.00", fechaMovimiento: EN_PERIODO },
      { ...base, tipo: "egreso", categoria: "egreso_ajuste", monto: "1.00", fechaMovimiento: FUERA },
    ],
  });
  return p;
}

function deps(tx: TxDeTest, actor: { usuarioId: string; rol: string }) {
  return {
    getActor: async () => actor as never,
    service: new FiltrosWalletService(new FiltrosWalletRepository(tx as never)),
  };
}

function conceptos(r: ConceptosConMovimientosResult) {
  if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
  return r.conceptos;
}

describeSiHayBase("458-A R13–R15 — conceptos con movimientos, contra Postgres por la action", () => {
  const prisma = crearPrismaDeTest();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R13 tienda: solo los conceptos de ESA tienda en el periodo, con su número; en orden del catálogo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrar(tx);
      return conceptosConMovimientosAction({ libro: "tienda", tiendaId: p.tiendaId, ...PERIODO }, deps(tx, p.maestro));
    });
    expect(conceptos(r)).toEqual([
      { categoria: "cod_recaudado", movimientos: 2 },
      { categoria: "flete", movimientos: 1 },
    ]);
  });

  it("R14: `ajuste_debito` (y cualquier concepto sin filas) NO se ofrece; en la otra tienda sí, con 1", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrar(tx);
      const propia = await conceptosConMovimientosAction({ libro: "tienda", tiendaId: p.tiendaId, ...PERIODO }, deps(tx, p.maestro));
      const otra = await conceptosConMovimientosAction({ libro: "tienda", tiendaId: p.otraTiendaId, ...PERIODO }, deps(tx, p.maestro));
      return { propia, otra };
    });
    expect(conceptos(r.propia).map((c) => c.categoria)).not.toContain("ajuste_debito");
    expect(conceptos(r.otra)).toEqual([{ categoria: "ajuste_debito", movimientos: 1 }]);
  });

  it("R13 caja: el periodo recorta y `egreso_gasto` (sin productor) no aparece", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrar(tx);
      const todo = await conceptosConMovimientosAction({ libro: "caja", ...PERIODO }, deps(tx, p.maestro));
      const egresos = await conceptosConMovimientosAction({ libro: "caja", tipo: "egreso", ...PERIODO }, deps(tx, p.maestro));
      return { todo, egresos };
    });
    const todo = conceptos(r.todo);
    expect(todo).toEqual(
      expect.arrayContaining([
        { categoria: "ingreso_flete", movimientos: 1 },
        { categoria: "egreso_sueldo", movimientos: 2 },
      ]),
    );
    expect(todo.map((c) => c.categoria)).not.toContain("egreso_gasto");
    expect(todo.map((c) => c.categoria)).not.toContain("egreso_ajuste"); // fuera del periodo
    expect(conceptos(r.egresos).map((c) => c.categoria)).not.toContain("ingreso_flete");
  });

  it("R15 (servidor): cambiar el periodo deja fuera un concepto sin filas; el cliente conserva el elegido", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrar(tx);
      return conceptosConMovimientosAction(
        { libro: "tienda", tiendaId: p.tiendaId, desde: "2031-05-01", hasta: "2031-05-31" },
        deps(tx, p.maestro),
      );
    });
    expect(conceptos(r)).toEqual([{ categoria: "comision_cod", movimientos: 1 }]);
  });

  it("mi_tienda: la tienda es la de la SESIÓN; no admite un id y otro rol es `forbidden` sin leer", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrar(tx);
      const tienda = { usuarioId: p.tiendaId, rol: "adminTienda" };
      const propia = await conceptosConMovimientosAction({ libro: "mi_tienda", ...PERIODO }, deps(tx, tienda));
      const conId = await conceptosConMovimientosAction(
        { libro: "mi_tienda", tiendaId: p.otraTiendaId, ...PERIODO },
        deps(tx, tienda),
      );
      const maestro = await conceptosConMovimientosAction({ libro: "mi_tienda", ...PERIODO }, deps(tx, p.maestro));
      const tiendaEnCaja = await conceptosConMovimientosAction({ libro: "caja", ...PERIODO }, deps(tx, tienda));
      return { propia, conId, maestro, tiendaEnCaja };
    });
    expect(conceptos(r.propia)).toEqual([
      { categoria: "cod_recaudado", movimientos: 2 },
      { categoria: "flete", movimientos: 1 },
    ]);
    expect(r.conId.status).toBe("validation_error");
    expect(r.maestro).toEqual({ status: "forbidden" });
    expect(r.tiendaEnCaja).toEqual({ status: "forbidden" });
  });
});
