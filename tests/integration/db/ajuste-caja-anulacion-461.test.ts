import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { anularAjusteCajaAction, listarMovimientosAction, registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { AjusteCajaService } from "@/lib/services/AjusteCajaService";

import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";
import { cargarCatalogo459, leerCajaEntera, montarServicios459 } from "./_fixtures/caja-459";
import { conCandado459, limpiar459, sembrarPersonas459, type Personas459 } from "./_fixtures/escrituras-459";
import { sembrarPersonas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R69, R70, R71 (auditoria de la wallet, D3) — ANULAR UNA CORRECCION DE CAJA, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Parte 1 (transaccion revertida, servicios reales sobre la tx, reloj fijo): la constancia, el
// contra-asiento OPUESTO por el monto de la correccion, el historial, R7 al centimo y la ganancia de
// vuelta a su valor previo; `ya_anulado`, `no_encontrado` y `forbidden` sin filas; y el `documento`
// que el libro pinta (R71: la original con `ajuste_caja`, el contra-asiento con `null`).
//
// Parte 2 (COMMITEADA, por las Server Actions y su composition root real): registrar una correccion
// y anularla por `anularAjusteCajaAction`; el `.strict()` del borde; y DOS anulaciones a la vez
// (el UNIQUE es el candado: una sola constancia, un solo contra-asiento).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const AHORA = new Date("2026-09-25T21:15:33.123Z");
const suma = (xs: string[]) => xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);

describeSiHayBase("461/R69–R71 — anular una correccion de caja (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    await cargarCatalogo459(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** El servicio REAL de la anulacion, cableado como `buildAjusteCajaService()` pero sobre la tx del test. */
  function servicioDe(tx: TxDeTest, ahora: () => Date = () => AHORA) {
    const c = clienteConSavepoint(tx);
    return new AjusteCajaService(
      new WalletMovimientoRepository(c),
      new AjusteCajaAnulacionRepository(c),
      (fn) => c.$transaction((t) => fn(t as never)),
      ahora,
    );
  }

  it("R69: una correccion que SUMO se anula con un `egreso_ajuste` por su monto, con constancia e historial; la ganancia y la cifra vuelven al centimo y R7 se cumple", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const s = montarServicios459(tx);
      const antes = (await leerCajaEntera(s, p.maestro)).resumen;

      const registro = await s.wallet.registrarMovimientoManual(
        { claveIdempotencia: randomUUID(), tipo: "ingreso", categoria: "ingreso_ajuste", monto: "1000.25", descripcion: "Sobrante de caja" },
        p.maestro,
      );
      if (registro.status !== "ok") throw new Error(`registro: ${registro.status}`);
      const conCorreccion = (await leerCajaEntera(s, p.maestro)).resumen;
      const libroAntes = await s.wallet.listarMovimientos({ page: 1, pageSize: 50 }, p.maestro);

      const r = await servicioDe(tx).anular({ movimientoId: registro.movimiento.id, motivo: "Se registro dos veces" }, p.admin);
      const despues = (await leerCajaEntera(s, p.maestro)).resumen;
      const libroDespues = await s.wallet.listarMovimientos({ page: 1, pageSize: 50 }, p.maestro);
      if (libroAntes.status !== "ok" || libroDespues.status !== "ok") throw new Error("libro");

      const constancia = await tx.ajusteCajaAnulacion.findUnique({ where: { movimientoId: registro.movimiento.id } });
      const contra = await tx.walletMovimiento.findMany({ where: { origenTipo: "manual", origenId: registro.movimiento.id } });
      const historial = await tx.historialAccion.findMany({
        where: { entidadId: registro.movimiento.id, accion: "wallet_movimiento_manual_anulado" },
      });
      const original = await tx.walletMovimiento.findUniqueOrThrow({ where: { id: registro.movimiento.id } });
      const filaAntes = libroAntes.data.movimientos.find((x) => x.id === registro.movimiento.id);
      const filaDespues = libroDespues.data.movimientos.find((x) => x.id === registro.movimiento.id);
      const filaContra = libroDespues.data.movimientos.find((x) => x.id === contra[0]?.id);
      return { r, antes, conCorreccion, despues, constancia, contra, historial, original, filaAntes, filaDespues, filaContra, actor: p.admin.usuarioId };
    });

    expect(m.r).toEqual({ status: "ok" });

    // La constancia: motivo, quien, cuando.
    expect(m.constancia).toMatchObject({ motivo: "Se registro dos veces", anuladoPor: m.actor });

    // El contra-asiento: OPUESTO exacto, por el monto DE LA CORRECCION, origen manual/id, con el reloj.
    expect(m.contra).toHaveLength(1);
    expect(m.contra[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      origenTipo: "manual",
      descripcion: "Anulación · Sobrante de caja",
      registradoPor: m.actor,
      claveIdempotencia: null, // R67: el contra-asiento es automatico, sin clave
    });
    expect(m.contra[0].monto.toFixed(2)).toBe("1000.25");
    expect(m.contra[0].fechaMovimiento.toISOString()).toBe(AHORA.toISOString());

    // El historial: UNA fila, con el importe y la categoria; nunca el motivo (texto libre).
    expect(m.historial).toHaveLength(1);
    expect(m.historial[0].monto?.toFixed(2)).toBe("1000.25");
    expect(m.historial[0].entidadEtiqueta).not.toContain("Se registro dos veces");

    // La correccion original no se toca (R69: nada se edita ni se borra).
    expect(m.original.monto.toFixed(2)).toBe("1000.25");
    expect(m.original.origenId).toBeNull();

    // Las cifras: la correccion subio ganancia y cifra en 1 000,25; la anulacion las devuelve AL CENTIMO.
    expect(new Prisma.Decimal(m.conCorreccion.ganancia).sub(m.antes.ganancia).toFixed(2)).toBe("1000.25");
    expect(new Prisma.Decimal(m.conCorreccion.enCaja).sub(m.antes.enCaja).toFixed(2)).toBe("1000.25");
    expect(m.despues.ganancia).toBe(m.antes.ganancia);
    expect(m.despues.enCaja).toBe(m.antes.enCaja);
    expect(m.despues.deTerceros).toBe(m.antes.deTerceros);
    // R7 en los tres momentos.
    for (const r of [m.antes, m.conCorreccion, m.despues]) {
      expect(suma([r.ganancia, r.deTerceros, r.capital])).toBe(r.enCaja);
    }

    // R71: el libro marca la ORIGINAL como documento `ajuste_caja` (antes sin anular, despues anulada) y
    // el contra-asiento no lleva documento.
    expect(m.filaAntes?.documento).toEqual({ tipo: "ajuste_caja", anulado: false, tieneComprobante: false });
    expect(m.filaDespues?.documento).toEqual({ tipo: "ajuste_caja", anulado: true, tieneComprobante: false });
    expect(m.filaContra?.documento).toBeNull();
  });

  it("R69: una correccion que RESTO se anula con un `ingreso_ajuste`; la cifra y la ganancia suben lo que habian bajado", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const s = montarServicios459(tx);
      const antes = (await leerCajaEntera(s, p.maestro)).resumen;
      const registro = await s.wallet.registrarMovimientoManual(
        { claveIdempotencia: randomUUID(), tipo: "egreso", categoria: "egreso_ajuste", monto: "500.10", descripcion: "Faltante" },
        p.maestro,
      );
      if (registro.status !== "ok") throw new Error(`registro: ${registro.status}`);
      const conCorreccion = (await leerCajaEntera(s, p.maestro)).resumen;
      const r = await servicioDe(tx).anular({ movimientoId: registro.movimiento.id, motivo: "Error" }, p.maestro);
      const despues = (await leerCajaEntera(s, p.maestro)).resumen;
      const contra = await tx.walletMovimiento.findMany({ where: { origenTipo: "manual", origenId: registro.movimiento.id } });
      return { r, antes, conCorreccion, despues, contra };
    });
    expect(m.r).toEqual({ status: "ok" });
    expect(m.contra).toHaveLength(1);
    expect(m.contra[0]).toMatchObject({ tipo: "ingreso", categoria: "ingreso_ajuste" });
    expect(m.contra[0].monto.toFixed(2)).toBe("500.10");
    expect(new Prisma.Decimal(m.antes.ganancia).sub(m.conCorreccion.ganancia).toFixed(2)).toBe("500.10");
    expect(m.despues.ganancia).toBe(m.antes.ganancia);
    expect(m.despues.enCaja).toBe(m.antes.enCaja);
  });

  it("R70: el segundo intento es `ya_anulado` sin filas nuevas; el contra-asiento, un sueldo, el reverso de un egreso y un id inexistente son `no_encontrado`; sin acceso total, `forbidden` sin leer", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const s = montarServicios459(tx);
      const correccion = await s.wallet.registrarMovimientoManual(
        { claveIdempotencia: randomUUID(), tipo: "ingreso", categoria: "ingreso_ajuste", monto: "10.00", descripcion: "x" },
        p.maestro,
      );
      const sueldo = await s.egresos.registrarEgreso(
        { claveIdempotencia: randomUUID(), tipoEgreso: "sueldo", monto: "20.00", descripcion: "y" },
        p.maestro,
      );
      if (correccion.status !== "ok" || sueldo.status !== "ok") throw new Error("semilla");
      const reverso = await s.egresos.reversarEgreso({ movimientoId: sueldo.movimiento.id }, p.maestro);
      if (reverso.status !== "ok") throw new Error("reverso");
      const reversoFila = await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "gasto", origenId: sueldo.movimiento.id } });

      const svc = servicioDe(tx);
      const filasAntes = await tx.walletMovimiento.count();
      const primera = await svc.anular({ movimientoId: correccion.movimiento.id, motivo: "uno" }, p.maestro);
      const filasTrasPrimera = await tx.walletMovimiento.count();
      const segunda = await svc.anular({ movimientoId: correccion.movimiento.id, motivo: "dos" }, p.maestro);
      const contraId = (await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "manual", origenId: correccion.movimiento.id } })).id;
      const elContra = await svc.anular({ movimientoId: contraId, motivo: "x" }, p.maestro);
      const elSueldo = await svc.anular({ movimientoId: sueldo.movimiento.id, motivo: "x" }, p.maestro);
      const elReverso = await svc.anular({ movimientoId: reversoFila.id, motivo: "x" }, p.maestro);
      const inexistente = await svc.anular({ movimientoId: randomUUID(), motivo: "x" }, p.maestro);
      const filasFinal = await tx.walletMovimiento.count();
      const constancias = await tx.ajusteCajaAnulacion.count({ where: { anuladoPor: p.maestro.usuarioId } });

      // Sin acceso total: nada se lee ni se escribe (una segunda correccion, intacta).
      const otra = await s.wallet.registrarMovimientoManual(
        { claveIdempotencia: randomUUID(), tipo: "ingreso", categoria: "ingreso_ajuste", monto: "11.00", descripcion: "z" },
        p.maestro,
      );
      if (otra.status !== "ok") throw new Error("otra");
      const tienda = await svc.anular({ movimientoId: otra.movimiento.id, motivo: "x" }, { usuarioId: p.tiendaId, rol: "adminTienda" });
      const constanciaDeOtra = await tx.ajusteCajaAnulacion.count({ where: { movimientoId: otra.movimiento.id } });
      return { primera, segunda, elContra, elSueldo, elReverso, inexistente, tienda, filasAntes, filasTrasPrimera, filasFinal, constancias, constanciaDeOtra };
    });
    expect(m.primera).toEqual({ status: "ok" });
    expect(m.segunda).toEqual({ status: "ya_anulado" });
    expect(m.elContra).toEqual({ status: "no_encontrado" });
    expect(m.elSueldo).toEqual({ status: "no_encontrado" });
    expect(m.elReverso).toEqual({ status: "no_encontrado" });
    expect(m.inexistente).toEqual({ status: "no_encontrado" });
    expect(m.tienda).toEqual({ status: "forbidden" });
    expect(m.filasTrasPrimera - m.filasAntes).toBe(1); // el contra-asiento, y solo el
    expect(m.filasFinal).toBe(m.filasTrasPrimera); // ninguno de los rechazos escribio
    expect(m.constancias).toBe(1);
    expect(m.constanciaDeOtra).toBe(0);
  });

  // ── Parte 2: por las Server Actions, COMMITEADO (composition root real) ─────────────────────

  async function conPersonas(cuerpo: (p: Personas459) => Promise<void>): Promise<void> {
    await conCandado459(prisma, async () => {
      let p: Personas459 | null = null;
      try {
        p = await sembrarPersonas459(prisma);
        await cuerpo(p);
      } finally {
        await limpiar459(prisma, p);
      }
    });
  }

  it("R69/R71 por la action: registrar y anular con el composition root real; el libro pinta el documento; `.strict()` rechaza `monto`", async () => {
    await conPersonas(async (p) => {
      const deps = { getActor: async () => p.maestro };
      const registro = await registrarMovimientoManualAction(
        { claveIdempotencia: randomUUID(), tipo: "egreso", categoria: "egreso_ajuste", monto: "77.70", descripcion: "Faltante 461" },
        deps,
      );
      if (registro.status !== "ok") throw new Error(`registro: ${JSON.stringify(registro)}`);
      const id = registro.movimiento.id;

      const conMonto = await anularAjusteCajaAction({ movimientoId: id, motivo: "x", monto: "1.00" }, deps);
      expect(conMonto.status).toBe("validation_error");
      expect(await prisma.ajusteCajaAnulacion.count({ where: { movimientoId: id } })).toBe(0);

      const sinSesion = await anularAjusteCajaAction({ movimientoId: id, motivo: "x" }, { getActor: async () => null });
      expect(sinSesion).toEqual({ status: "unauthenticated" });

      const r = await anularAjusteCajaAction({ movimientoId: id, motivo: "Duplicada" }, deps);
      expect(r).toEqual({ status: "ok" });
      expect(await prisma.ajusteCajaAnulacion.count({ where: { movimientoId: id } })).toBe(1);
      const contra = await prisma.walletMovimiento.findMany({ where: { origenTipo: "manual", origenId: id } });
      expect(contra).toHaveLength(1);
      expect(contra[0]).toMatchObject({ tipo: "ingreso", categoria: "ingreso_ajuste" });
      expect(contra[0].monto.toFixed(2)).toBe("77.70");
      expect(await prisma.historialAccion.count({ where: { entidadId: id, accion: "wallet_movimiento_manual_anulado" } })).toBe(1);

      const libro = await listarMovimientosAction({ page: 1, pageSize: 100 }, deps);
      if (libro.status !== "ok") throw new Error("libro");
      expect(libro.data.movimientos.find((m) => m.id === id)?.documento).toEqual({ tipo: "ajuste_caja", anulado: true, tieneComprobante: false });
      expect(libro.data.movimientos.find((m) => m.id === contra[0].id)?.documento).toBeNull();
    });
  }, 120_000);

  it("R70: DOS anulaciones simultaneas de la misma correccion -> una constancia, un contra-asiento, un historial", async () => {
    await conPersonas(async (p) => {
      const deps = { getActor: async () => p.maestro };
      const registro = await registrarMovimientoManualAction(
        { claveIdempotencia: randomUUID(), tipo: "ingreso", categoria: "ingreso_ajuste", monto: "3000.00", descripcion: "Carrera 461" },
        deps,
      );
      if (registro.status !== "ok") throw new Error(`registro: ${JSON.stringify(registro)}`);
      const id = registro.movimiento.id;
      const respuestas = await Promise.all([
        anularAjusteCajaAction({ movimientoId: id, motivo: "uno" }, deps),
        anularAjusteCajaAction({ movimientoId: id, motivo: "dos" }, deps),
      ]);
      expect(respuestas.map((x) => x.status).sort()).toEqual(["ok", "ya_anulado"]);
      expect(await prisma.ajusteCajaAnulacion.count({ where: { movimientoId: id } })).toBe(1);
      expect(await prisma.walletMovimiento.count({ where: { origenTipo: "manual", origenId: id } })).toBe(1);
      expect(await prisma.historialAccion.count({ where: { entidadId: id, accion: "wallet_movimiento_manual_anulado" } })).toBe(1);
    });
  }, 120_000);
});
