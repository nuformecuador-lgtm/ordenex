import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";

import { sembrarPersonas461 } from "./_fixtures/personas-461";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

// =================================================================================================
// FICHA 458-A (R33, B1 de la revision) — el HISTORIAL nombra la cuenta como la TABLA, contra Postgres
// =================================================================================================
//
// La revision encontro que el historial del cobro decia «Tania Tienda» al registrar y «Tania» al
// anular, y que el de los pagos y repartos de un mensajero decia «Juan Pérez» donde la tabla de la
// wallet dice «Juan Pérez Mora». Medido en produccion: 11 de los 22 mensajeros tienen segundo
// apellido. Aqui corren los repositorios REALES sobre una transaccion revertida (no queda ni una fila)
// y lo que se afirma se lee de `historial_accion` y de la lectura de la tabla de la wallet.
//
// Los nombres esperados van ESCRITOS A MANO: compararlos contra `etiquetaDeCuenta(...)` estaria
// siempre verde (memoria «asercion contra su propia fuente»).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

async function etiquetasDe(tx: TxDeTest, entidadId: string) {
  const filas = await tx.historialAccion.findMany({
    where: { entidadId },
    select: { accion: true, entidadEtiqueta: true },
  });
  // Dentro de UNA transaccion `now()` es el mismo instante y `accion` es un enum (su orden SQL es el
  // de declaracion): se ordena por el texto de la accion, aqui.
  return filas
    .map((f) => [String(f.accion), f.entidadEtiqueta])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

describeSiHayBase("458-A R33 — historial y tabla nombran la misma cuenta igual (Postgres real)", () => {
  const prisma = crearPrismaDeTest();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cobro a una tienda: el registro y la anulacion llevan la MISMA etiqueta, y es la de la tabla", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrarPersonas461(tx);
      // El escenario de la revision: la tienda «Tania» con primer apellido «Tienda».
      await tx.usuario.update({
        where: { id: p.tiendaId },
        data: { nombre: "Tania", primerApellido: "Tienda", segundoApellido: null },
      });
      const cobro = await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: p.tiendaId,
          tipo: "debito",
          categoria: "cobro_manual",
          monto: "2500.00",
          origenTipo: "manual",
          descripcion: "Etiquetas 458-A",
          registradoPor: p.maestro.usuarioId,
        },
        select: { id: true },
      });
      const libro = new WalletTiendaMovimientoRepository(tx as never);
      await libro.registrarCobroEnHistorial(tx as never, {
        cobroId: cobro.id,
        tiendaId: p.tiendaId,
        monto: "2500.00",
        actorUsuarioId: p.maestro.usuarioId,
      });
      const anulado = await new CobroTiendaAnulacionRepository(tx as never).anular(tx as never, {
        cobroId: cobro.id,
        motivo: "Cobro repetido",
        anuladoPor: p.maestro.usuarioId,
      });
      const tabla = (await libro.listarSaldosTodasTiendas()).find((s) => s.tiendaId === p.tiendaId);
      return { anulado, historial: await etiquetasDe(tx, cobro.id), tabla: tabla?.tiendaNombre };
    });

    expect(r.anulado).toEqual({ status: "anulado" });
    expect(r.historial).toEqual([
      ["cobro_tienda_anulado", "Tania Tienda"],
      ["cobro_tienda_registrado", "Tania Tienda"],
    ]);
    expect(r.tabla).toBe("Tania Tienda");
  });

  it("mensajero con segundo apellido: pago suelto, su anulacion, reparto y su anulacion = la tabla de mensajeros", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const p = await sembrarPersonas461(tx);
      await tx.usuario.update({
        where: { id: p.mensajeroId },
        data: { nombre: "Juan", primerApellido: "Pérez", segundoApellido: "Mora" },
      });
      const zona = await tx.zona.findFirst({ select: { id: true } });
      if (zona === null) throw new Error("base sin sembrar: falta una zona");
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
      // La fila que pone al mensajero en la tabla de `/wallet/mensajeros`.
      await tx.pagoMensajeroMovimiento.create({
        data: {
          mensajeroId: p.mensajeroId,
          tipo: "devengo",
          categoria: "pago_devengado",
          monto: "4000.00",
          origenTipo: "cierre_dia",
          origenId: cierre.id,
        },
      });

      const pagos = new LiquidacionPagoRepository(tx as never);
      const repartos = new LiquidacionRepartoRepository(tx as never);
      const suelto = await pagos.crear(tx as never, {
        claveIdempotencia: randomUUID(),
        mensajeroId: p.mensajeroId,
        tiendaId: null,
        cierreId: cierre.id,
        monto: "1000.00",
        metodo: "SINPE",
        referencia: null,
        nota: null,
        fechaPago: new Date("2026-09-13T00:00:00.000Z"),
        registradoPor: p.maestro.usuarioId,
        repartoId: null,
      });
      if (suelto.status !== "creado") throw new Error(`pago: ${suelto.status}`);
      await pagos.anular(tx as never, {
        pagoId: suelto.pago.id,
        motivo: "Monto equivocado",
        anuladoPor: p.maestro.usuarioId,
      });

      const reparto = await repartos.crear(tx as never, {
        claveIdempotencia: randomUUID(),
        mensajeroId: p.mensajeroId,
        montoTotal: "2000.00",
        registradoPor: p.maestro.usuarioId,
      });
      if (reparto.status !== "creado") throw new Error(`reparto: ${reparto.status}`);
      await repartos.registrarAnulacion(tx as never, {
        repartoId: reparto.reparto.id,
        anuladoPor: p.maestro.usuarioId,
        montoAnulado: "2000.00",
      });

      const tabla = (
        await new PagoMensajeroMovimientoRepository(tx as never).listarCuentasPorPagarTodos()
      ).find((c) => c.mensajeroId === p.mensajeroId);
      return {
        pago: await etiquetasDe(tx, suelto.pago.id),
        reparto: await etiquetasDe(tx, reparto.reparto.id),
        tabla: tabla?.mensajeroNombre,
      };
    });

    expect(r.tabla).toBe("Juan Pérez Mora");
    expect(r.pago).toEqual([
      ["pago_anulado", "Juan Pérez Mora"],
      ["pago_mensajero_registrado", "Juan Pérez Mora"],
    ]);
    expect(r.reparto).toEqual([
      ["reparto_anulado", "Juan Pérez Mora"],
      ["reparto_mensajero_registrado", "Juan Pérez Mora"],
    ]);
  });
});
