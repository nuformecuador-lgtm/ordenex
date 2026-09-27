import { randomInt } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { listarMovimientosDeTiendaAction } from "@/lib/actions/wallet-tienda";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";

import { sembrarPersonas461 } from "./_fixtures/personas-461";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

// =================================================================================================
// FICHA 458-A (TA.2, R5–R8) — el origen legible, contra Postgres real y POR LA ACTION
// =================================================================================================
//
// Los tests de servicio usan un repositorio falso y no ven el SQL (memoria «probar el WHERE donde
// vive»). Aqui la lectura de las entidades (cierre + mensajero, gestion + guia de su orden) corre en
// la base, por `listarMovimientosDeTiendaAction` con el servicio y el repositorio REALES sobre la
// transaccion. Todo va en una transaccion revertida: no queda ni una fila.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function sembrar(tx: TxDeTest) {
  const p = await sembrarPersonas461(tx);
  const zona = await tx.zona.findFirst({ select: { id: true } });
  const fks = await tx.orden.findFirst({
    select: { estatusId: true, zonaId: true, provinciaId: true, cantonId: true },
  });
  if (zona === null || fks === null) throw new Error("base sin sembrar: faltan zona u orden");
  // Un mensajero con segundo apellido, como 11 de los 22 de produccion: el origen lo nombra entero.
  await tx.usuario.update({
    where: { id: p.mensajeroId },
    data: { nombre: "Juan", primerApellido: "Pérez", segundoApellido: "Mora" },
  });
  // 04:30Z del 13 = 22:30 del 12 de septiembre en Costa Rica: el dia del origen es el de CR.
  const cierre = await tx.cierreDia.create({
    data: {
      mensajeroId: p.mensajeroId,
      estado: "aprobado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: zona.id,
      solicitadoAt: new Date("2026-09-13T04:30:00.000Z"),
    },
    select: { id: true },
  });
  const numGuia = 970_000_000 + randomInt(0, 9_999_999);
  const orden = await tx.orden.create({
    data: {
      numGuia,
      numRemision: `R-458A-${numGuia}`,
      destinatario: "Destinatario 458-A",
      telefonoDest: "88880000",
      producto: "Producto 458-A",
      estatusId: fks.estatusId,
      tiendaId: p.tiendaId,
      zonaId: fks.zonaId,
      provinciaId: fks.provinciaId,
      cantonId: fks.cantonId,
    },
    select: { id: true },
  });
  const gestion = await tx.gestionOrden.create({
    data: { ordenId: orden.id, mensajeroId: p.mensajeroId, resultado: "devolucion_a_origen_por_rechazo" },
    select: { id: true },
  });
  await tx.walletTiendaMovimiento.createMany({
    data: [
      {
        tiendaId: p.tiendaId,
        tipo: "credito",
        categoria: "cod_recaudado",
        monto: "5000.00",
        origenTipo: "cierre_dia",
        origenId: cierre.id,
        fechaMovimiento: new Date("2026-09-13T04:30:00.000Z"),
      },
      {
        tiendaId: p.tiendaId,
        tipo: "debito",
        categoria: "flete_devolucion",
        monto: "1800.00",
        origenTipo: "gestion_orden",
        origenId: gestion.id,
        fechaMovimiento: new Date("2026-09-14T15:00:00.000Z"),
      },
    ],
  });
  return { p, cierre, numGuia };
}

describeSiHayBase("458-A R5–R8 — el origen legible sale de la base, por la action", () => {
  const prisma = crearPrismaDeTest();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("maestro: cierre con día CR y mensajero + enlace; flete por rechazo con su guía + enlace", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const res = await listarMovimientosDeTiendaAction(
        { tiendaId: e.p.tiendaId, page: 1, pageSize: 20 },
        {
          getActor: async () => e.p.maestro,
          service: new WalletTiendaService(new WalletTiendaMovimientoRepository(tx as never)),
          origenes: new OrigenLegibleService(new OrigenLegibleRepository(tx as never)),
        },
      );
      return { e, res };
    });
    if (r.res.status !== "ok") throw new Error(`esperado ok, llego ${r.res.status}`);
    const porCategoria = new Map(r.res.data.movimientos.map((m) => [m.categoria, m.origen]));
    const cierre = porCategoria.get("cod_recaudado");
    const rechazo = porCategoria.get("flete_devolucion");
    expect(r.res.data.movimientos).toHaveLength(2);

    // Escrito a mano (revision m6): compararlo contra `etiquetaDeCuenta(...)` estaria siempre verde.
    expect(cierre?.texto).toBe("Cierre del día · 2026-09-12 · Juan Pérez Mora");
    expect(cierre?.enlace?.href).toBe(`/cierres-admin?cierre=${r.e.cierre.id}`);
    expect(rechazo?.texto).toBe(`Gestión de orden · cobro por rechazo · guía ${r.e.numGuia}`);
    expect(rechazo?.enlace).toEqual({
      etiqueta: `Ver en órdenes la guía ${r.e.numGuia}`,
      href: `/ordenes?q=${r.e.numGuia}`,
    });
    for (const o of [cierre, rechazo]) {
      expect(o?.texto).not.toMatch(UUID);
      expect(o?.enlace?.etiqueta).not.toMatch(UUID);
    }
  });
});
