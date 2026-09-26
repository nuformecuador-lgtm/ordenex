import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { anularAporteCapitalAction, registrarAporteCapitalAction } from "@/lib/actions/aporte-capital";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  conCandado459,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T B.12 — saldo inicial y aporte de capital, POR LA ACTION, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Igual que `pago-por-cuenta-tienda.test.ts`: el servicio lo construye el `buildService()` real;
// solo se inyecta el actor. El ESTADO de la caja (R14/R21) se lee por `WalletService.verResumenCaja`
// con el lector REAL de `haySaldoInicialVigente` —el mismo cableado que `lib/actions/wallet.ts`—.
//
// PRECONDICION MEDIDA: la base de pruebas NO tiene un saldo inicial vigente (nadie mas lo commitea;
// los archivos de la 459 que lo escriben se serializan con `conCandado459`). Si lo tuviera, el
// primer caso lo dice en rojo con su nombre en vez de pasar por casualidad.
//
// Las cifras (R72/R75: cifra principal y capital suben en el monto; ganancia, «De las tiendas» y
// saldos de tiendas intactos) se miden en `caja-invariante-tiendas.test.ts`, en REPEATABLE READ.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("459/T B.12 — saldo inicial o aporte de capital por la action (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

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

  const deps = (actor: Personas459["maestro"] | null) => ({ getActor: async () => actor });

  /** El ultimo dia admitido para un saldo inicial HOY en esta base (R71), o hoy si la caja esta vacia. */
  async function diaDelSaldoInicial(): Promise<string> {
    const primer = await new WalletMovimientoRepository(prisma).primerDiaDeLaCaja({ excluirCapital: true });
    return primer ?? fechaCalendarioCR(new Date());
  }

  function entrada(over: Record<string, string | undefined>) {
    return formData459({
      claveIdempotencia: randomUUID(),
      clase: "aporte",
      monto: "250000.5",
      fecha: fechaCalendarioCR(new Date()),
      motivo: "Aporte del socio",
      ...over,
    });
  }

  async function estadoDeLaCaja(p: Personas459): Promise<string> {
    const svc = new WalletService(new WalletMovimientoRepository(prisma), prisma, new AporteCapitalRepository(prisma), {
      pagosPorCuenta: new PagoPorCuentaTiendaRepository(prisma),
      aportes: new AporteCapitalRepository(prisma),
      cobros: { estadoDeDocumentos: async () => [] }, ajustes: { estadoDeDocumentos: async () => [] }, // ficha 461: lo exige `LectoresDocumentosCaja`; esta suite no lee cobros
      abonos: { estadoDeDocumentos: async () => [] }, // ficha 457: lo exige `LectoresDocumentosCaja`; esta suite no lee pagos de una tienda a Ordenex
    });
    const r = await svc.verResumenCaja({ page: 1, pageSize: 1 }, p.maestro);
    if (r.status !== "ok") throw new Error(`verResumenCaja: ${JSON.stringify(r)}`);
    return r.resumen.estado;
  }

  async function huella(p: Personas459) {
    const [aportes, caja, historial, tienda] = await Promise.all([
      prisma.aporteCapital.count({ where: { registradoPor: { in: p.usuarios } } }),
      prisma.walletMovimiento.count({ where: { registradoPor: { in: p.usuarios } } }),
      prisma.historialAccion.count({ where: { actorUsuarioId: { in: p.usuarios } } }),
      prisma.walletTiendaMovimiento.count({ where: { registradoPor: { in: p.usuarios } } }),
    ]);
    return { aportes, caja, historial, tienda };
  }

  it("R14/R21/R68/R78: registrar el saldo inicial pone la caja en «saldo»; anularlo la devuelve a «flujo»", async () => {
    await conPersonas(async (p) => {
      expect(await new AporteCapitalRepository(prisma).haySaldoInicialVigente()).toBe(false);
      expect(await estadoDeLaCaja(p)).toBe("flujo");

      const dia = await diaDelSaldoInicial();
      const r = await registrarAporteCapitalAction(
        entrada({ clase: "saldo_inicial", monto: "1500000", fecha: dia, motivo: "Saldo del banco al empezar" }),
        deps(p.maestro),
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("imposible");
      expect(r.aporte).toMatchObject({ clase: "saldo_inicial", monto: "1500000.00", fecha: dia, anulado: false });
      expect(await estadoDeLaCaja(p)).toBe("saldo");

      // R68 — documento, UNA entrada de capital con el mismo monto fechada el inicio de ese dia CR,
      // y la fila del historial sin el motivo (R78).
      const doc = await prisma.aporteCapital.findUniqueOrThrow({ where: { id: r.aporte.id } });
      expect([doc.clase, doc.monto.toFixed(2), doc.motivo, doc.registradoPor]).toEqual([
        "saldo_inicial",
        "1500000.00",
        "Saldo del banco al empezar",
        p.maestro.usuarioId,
      ]);
      const caja = await prisma.walletMovimiento.findMany({ where: { origenId: doc.id } });
      expect(caja.map((c) => [c.tipo, c.categoria, c.origenTipo, c.monto.toFixed(2)])).toEqual([
        ["ingreso", "ingreso_aporte_capital", "aporte_capital", "1500000.00"],
      ]);
      if (dia !== fechaCalendarioCR(new Date())) {
        expect(fechaCalendarioCR(caja[0].fechaMovimiento)).toBe(dia);
      }
      const hist = await prisma.historialAccion.findMany({ where: { entidadId: doc.id } });
      expect(hist.map((h) => [h.accion, h.entidadTipo, h.actorUsuarioId, h.monto?.toFixed(2)])).toEqual([
        ["aporte_capital_registrado", "aporte_capital", p.maestro.usuarioId, "1500000.00"],
      ]);
      expect(JSON.stringify(hist)).not.toContain("Saldo del banco al empezar");
      // R72 — ningun libro de tienda ni de mensajero.
      expect(await prisma.walletTiendaMovimiento.count({ where: { origenId: doc.id } })).toBe(0);
      expect(await prisma.pagoMensajeroMovimiento.count({ where: { registradoPor: p.maestro.usuarioId } })).toBe(0);

      // R74 — anular: su fila, una salida de capital por el monto DEL DOCUMENTO, fechada ahora.
      const antes = Date.now();
      const a = await anularAporteCapitalAction({ aporteId: doc.id, motivo: "Cifra equivocada" }, deps(p.admin));
      expect(a).toEqual({ status: "ok" });
      expect(await estadoDeLaCaja(p)).toBe("flujo");
      expect(await new AporteCapitalRepository(prisma).haySaldoInicialVigente()).toBe(false);

      const trasAnular = await prisma.walletMovimiento.findMany({ where: { origenId: doc.id }, orderBy: { createdAt: "asc" } });
      expect(trasAnular.map((c) => [c.tipo, c.categoria, c.monto.toFixed(2)])).toEqual([
        ["ingreso", "ingreso_aporte_capital", "1500000.00"],
        ["egreso", "egreso_reverso_aporte_capital", "1500000.00"],
      ]);
      expect(trasAnular[1].fechaMovimiento.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(await prisma.aporteCapitalAnulacion.count({ where: { aporteId: doc.id } })).toBe(1);
      const hist2 = await prisma.historialAccion.findMany({ where: { entidadId: doc.id }, orderBy: { createdAt: "asc" } });
      expect(hist2.map((h) => h.accion)).toEqual(["aporte_capital_registrado", "aporte_capital_anulado"]);
      expect(JSON.stringify(hist2)).not.toContain("Cifra equivocada");
      // R75 — la anulacion tampoco toca libros de tiendas.
      expect(await prisma.walletTiendaMovimiento.count({ where: { origenId: doc.id } })).toBe(0);
    });
  }, 120_000);

  it("B.9 (WHERE de `haySaldoInicialVigente`): un APORTE vigente no pone la caja en «saldo»", async () => {
    await conPersonas(async (p) => {
      const r = await registrarAporteCapitalAction(entrada({ clase: "aporte" }), deps(p.maestro));
      expect(r.status).toBe("ok");
      expect(await new AporteCapitalRepository(prisma).haySaldoInicialVigente()).toBe(false);
      expect(await estadoDeLaCaja(p)).toBe("flujo");
      const caja = await prisma.walletMovimiento.findMany({ where: { registradoPor: p.maestro.usuarioId } });
      expect(caja.map((c) => [c.categoria, c.monto.toFixed(2)])).toEqual([["ingreso_aporte_capital", "250000.50"]]);
    });
  }, 120_000);

  it("R70: con un saldo inicial vigente, un segundo -> ya_hay_saldo_inicial sin escribir; R73: la misma clave -> el original", async () => {
    await conPersonas(async (p) => {
      const dia = await diaDelSaldoInicial();
      const clave = randomUUID();
      const uno = await registrarAporteCapitalAction(
        entrada({ clase: "saldo_inicial", fecha: dia, claveIdempotencia: clave }),
        deps(p.maestro),
      );
      expect(uno.status).toBe("ok");
      if (uno.status !== "ok") throw new Error("imposible");
      const trasUno = await huella(p);

      const otro = await registrarAporteCapitalAction(entrada({ clase: "saldo_inicial", fecha: dia }), deps(p.maestro));
      expect(otro).toEqual({ status: "ya_hay_saldo_inicial" });
      // Doble envio del MISMO: el original, no «ya hay uno».
      const repetido = await registrarAporteCapitalAction(
        entrada({ clase: "saldo_inicial", fecha: dia, claveIdempotencia: clave, monto: "1" }),
        deps(p.maestro),
      );
      expect(repetido.status).toBe("ya_registrado");
      if (repetido.status !== "ya_registrado") throw new Error("imposible");
      expect(repetido.aporte.id).toBe(uno.aporte.id);
      expect(repetido.aporte.monto).toBe("250000.50");
      // Un APORTE con la clave de otro documento -> tambien el original, sin escribir.
      const aporteRepetido = await registrarAporteCapitalAction(
        entrada({ clase: "aporte", claveIdempotencia: clave }),
        deps(p.maestro),
      );
      expect(aporteRepetido.status).toBe("ya_registrado");
      expect(await huella(p)).toEqual(trasUno);
      expect(trasUno).toEqual({ aportes: 1, caja: 1, historial: 1, tienda: 0 });
    });
  }, 120_000);

  it("R71: un saldo inicial POSTERIOR al primer dia de la caja (sin capital) -> rechazado con el ultimo dia admitido", async () => {
    await conPersonas(async (p) => {
      const primer = await new WalletMovimientoRepository(prisma).primerDiaDeLaCaja({ excluirCapital: true });
      const hoy = fechaCalendarioCR(new Date());
      // Sin un dia intermedio entre el primero y hoy no hay nada que rechazar: se dice en rojo.
      expect(primer, "la base de pruebas necesita movimientos de caja anteriores a hoy").not.toBeNull();
      expect(primer! < hoy).toBe(true);
      const r = await registrarAporteCapitalAction(entrada({ clase: "saldo_inicial", fecha: hoy }), deps(p.maestro));
      // El texto literal lo fija el test unitario del servicio; aqui, su FORMA con el dia real de
      // la base: en palabras, con año y con tilde (recorrido F2), nunca el ISO.
      const [anio, , dia] = primer!.split("-");
      expect(r.status).toBe("validation_error");
      const mensaje = r.status === "validation_error" ? r.fieldErrors.fecha?.[0] : undefined;
      expect(mensaje).toMatch(
        new RegExp(
          `^El saldo inicial no puede ser posterior al ${Number(dia)} de [a-z]+ de ${anio}, el primer día con movimientos en la caja\\.$`,
        ),
      );
      expect(mensaje).not.toContain(primer!);
      expect(await huella(p)).toEqual({ aportes: 0, caja: 0, historial: 0, tienda: 0 });
    });
  }, 120_000);

  it("R69/R74/R76: validacion, rol y sesion no escriben nada; anular ajeno o dos veces", async () => {
    await conPersonas(async (p) => {
      const rechazos = [
        await registrarAporteCapitalAction(entrada({ clase: undefined }), deps(p.maestro)),
        await registrarAporteCapitalAction(entrada({ clase: "ganancia" }), deps(p.maestro)),
        await registrarAporteCapitalAction(entrada({ monto: "0" }), deps(p.maestro)),
        await registrarAporteCapitalAction(entrada({ motivo: " " }), deps(p.maestro)),
        await registrarAporteCapitalAction(entrada({ fecha: "2999-01-01" }), deps(p.maestro)),
        await registrarAporteCapitalAction(entrada({ sugerido: "1.00" }), deps(p.maestro)),
      ];
      expect(rechazos.map((r) => r.status)).toEqual(Array(6).fill("validation_error"));
      expect(await registrarAporteCapitalAction(entrada({}), deps(p.mensajero))).toEqual({ status: "forbidden" });
      expect(
        await registrarAporteCapitalAction(entrada({}), deps({ usuarioId: p.tiendaId, rol: "adminTienda" })),
      ).toEqual({ status: "forbidden" });
      expect(await registrarAporteCapitalAction(entrada({}), deps(null))).toEqual({ status: "unauthenticated" });
      expect(await huella(p)).toEqual({ aportes: 0, caja: 0, historial: 0, tienda: 0 });

      const r = await registrarAporteCapitalAction(entrada({}), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const trasRegistro = await huella(p);
      expect(await anularAporteCapitalAction({ aporteId: r.aporte.id, motivo: "x" }, deps(p.mensajero))).toEqual({
        status: "forbidden",
      });
      expect((await anularAporteCapitalAction({ aporteId: r.aporte.id, motivo: "  " }, deps(p.maestro))).status).toBe(
        "validation_error",
      );
      expect(await anularAporteCapitalAction({ aporteId: randomUUID(), motivo: "x" }, deps(p.maestro))).toEqual({
        status: "no_encontrado",
      });
      expect(await huella(p)).toEqual(trasRegistro);
      expect(await anularAporteCapitalAction({ aporteId: r.aporte.id, motivo: "uno" }, deps(p.maestro))).toEqual({
        status: "ok",
      });
      const trasAnular = await huella(p);
      expect(await anularAporteCapitalAction({ aporteId: r.aporte.id, motivo: "dos" }, deps(p.maestro))).toEqual({
        status: "ya_anulado",
      });
      expect(await huella(p)).toEqual(trasAnular);
    });
  }, 120_000);
});
