import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  anularAbonoTiendaAction,
  obtenerComprobanteAbonoAction,
  registrarAbonoTiendaAction,
} from "@/lib/actions/abono-tienda";
import { listarMovimientosAction } from "@/lib/actions/wallet";
import type { CajaBackfillClient } from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaBackfillTesoreriaService } from "@/lib/services/CajaBackfillTesoreriaService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import type { AgregadoCajaRow, WalletMovimientoCategoria } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA, derivarCaja } from "@/lib/utils/caja-tesoreria";
import { fechaCalendarioCR, inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  conCandado459,
  endeudar457,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 457 / T5.1 — el pago de una tienda a Ordenex, POR LA ACTION, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se entra por `registrarAbonoTiendaAction` / `anularAbonoTiendaAction` / `obtenerComprobanteAbonoAction`
// SIN inyectar el servicio: lo construye el `buildService()` real con `getPrismaClient()`. Solo se
// inyecta el actor (no hay cookie de sesion en un test). Lo que se afirma se lee DE LA BASE: el
// documento, el credito en el libro de la tienda, la entrada en la caja y el historial (R1, R17–R23, R31,
// R74), y R19/R39 se miden con `derivarCaja` sobre las filas REALES del documento.
//
// La deuda se siembra con un cobro como los de la 381 (`endeudar457`): la tienda queda en contra.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describeSiHayBase("457/T5.1 — pago de una tienda a Ordenex por la action (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Siembra personas, corre el cuerpo con el candado de la ficha y limpia SIEMPRE. */
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

  function entrada(p: Personas459, over: Record<string, string | Blob | undefined> = {}) {
    return formData459({
      claveIdempotencia: randomUUID(),
      tiendaId: p.tiendaId,
      monto: "4000",
      metodo: "SINPE",
      referencia: "123456",
      motivo: "Pago de lo que debía por los fletes de septiembre",
      fechaPago: "2026-09-20",
      ...over,
    });
  }

  /** Todo lo que la ficha escribe para unas personas: para afirmar «no escribio nada». */
  async function huella(p: Personas459) {
    const [abonos, anulaciones, tienda, caja, historial] = await Promise.all([
      prisma.abonoTienda.count({ where: { tiendaId: { in: p.usuarios } } }),
      prisma.abonoTiendaAnulacion.count({ where: { anuladoPor: { in: p.usuarios } } }),
      prisma.walletTiendaMovimiento.count({ where: { tiendaId: { in: p.usuarios }, registradoPor: { not: null } } }),
      prisma.walletMovimiento.count({ where: { registradoPor: { in: p.usuarios } } }),
      prisma.historialAccion.count({ where: { actorUsuarioId: { in: p.usuarios } } }),
    ]);
    return { abonos, anulaciones, tienda, caja, historial };
  }
  const NADA = { abonos: 0, anulaciones: 0, tienda: 0, caja: 0, historial: 0 };

  /** Las filas de la caja de los documentos de estas personas, agregadas como las lee `derivarCaja`. */
  async function agregadoDeCaja(ids: string[]): Promise<AgregadoCajaRow[]> {
    const filas = await prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where: { origenTipo: "abono_tienda", origenId: { in: ids } },
      _sum: { monto: true },
    });
    return filas.map((f) => ({ categoria: f.categoria, tipo: f.tipo, total: new Prisma.Decimal(f._sum.monto ?? 0).toFixed(2) }));
  }

  it("R1/R5/R17/R18/R20/R21/R22: una sola accion escribe documento, credito, entrada e historial con el MISMO string y el MISMO instante", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p, { monto: "4000.5" }), deps(p.maestro));
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("imposible");

      // R18 — el saldo devuelto sube exactamente en el monto y sigue en contra: −10 000,00 + 4 000,50.
      expect(r.saldo).toEqual({ creditos: "4000.50", debitos: "10000.00", saldo: "-5999.50", signo: "negativo" });
      expect(r.abono).toMatchObject({
        monto: "4000.50",
        metodo: "SINPE",
        referencia: "123456",
        motivo: "Pago de lo que debía por los fletes de septiembre",
        fechaPago: "2026-09-20",
        anulado: false,
        tieneComprobante: false,
        tiendaNombre: expect.stringContaining("TiendaE 459"),
      });
      expect(r.abono).not.toHaveProperty("tiendaId");

      // R1 — el documento, con la fecha REAL como dia calendario.
      const doc = await prisma.abonoTienda.findUniqueOrThrow({ where: { id: r.abono.id } });
      expect({
        tiendaId: doc.tiendaId,
        monto: doc.monto.toFixed(2),
        metodo: doc.metodo,
        referencia: doc.referencia,
        motivo: doc.motivo,
        fechaPago: doc.fechaPago.toISOString(),
        registradoPor: doc.registradoPor,
        comprobantePath: doc.comprobantePath,
      }).toEqual({
        tiendaId: p.tiendaId,
        monto: "4000.50",
        metodo: "SINPE",
        referencia: "123456",
        motivo: "Pago de lo que debía por los fletes de septiembre",
        fechaPago: "2026-09-20T00:00:00.000Z",
        registradoPor: p.maestro.usuarioId,
        comprobantePath: null,
      });

      // R17 — el credito y la entrada, con el mismo string (R5) y el mismo instante (R20: 06:00Z del dia real).
      const creditos = await prisma.walletTiendaMovimiento.findMany({ where: { origenId: doc.id } });
      const entradas = await prisma.walletMovimiento.findMany({ where: { origenId: doc.id } });
      expect(creditos.map((c) => [c.tiendaId, c.tipo, c.categoria, c.origenTipo, c.monto.toFixed(2)])).toEqual([
        [p.tiendaId, "credito", "abono_tienda", "abono_tienda", "4000.50"],
      ]);
      expect(entradas.map((e) => [e.tipo, e.categoria, e.origenTipo, e.monto.toFixed(2)])).toEqual([
        ["ingreso", "ingreso_abono_tienda", "abono_tienda", "4000.50"],
      ]);
      expect(creditos[0].fechaMovimiento.toISOString()).toBe("2026-09-20T06:00:00.000Z");
      expect(entradas[0].fechaMovimiento.toISOString()).toBe(creditos[0].fechaMovimiento.toISOString());
      expect(entradas[0].fechaMovimiento.toISOString()).toBe(inicioDelDiaCREnUtc("2026-09-20").toISOString());

      // R21 — descripciones: motivo, metodo y referencia; la caja ademas la tienda; ningun identificador.
      expect(creditos[0].descripcion).toBe("Pago de lo que debía por los fletes de septiembre · SINPE · 123456");
      expect(entradas[0].descripcion).toMatch(/^TiendaE 459 .* · Pago de lo que debía por los fletes de septiembre · SINPE · 123456$/);
      for (const d of [creditos[0].descripcion ?? "", entradas[0].descripcion ?? ""]) {
        expect(d).not.toMatch(UUID);
        expect(d).not.toContain(p.tiendaId);
      }

      // R61/R63 — UNA fila del historial de tipo propio, con el importe y el nombre de la tienda; sin texto libre.
      const hist = await prisma.historialAccion.findMany({ where: { entidadId: doc.id } });
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({
        accion: "abono_tienda_registrado",
        entidadTipo: "abono_tienda",
        actorUsuarioId: p.maestro.usuarioId,
        actorRol: "maestro",
      });
      expect(hist[0].monto?.toFixed(2)).toBe("4000.50");
      expect(hist[0].entidadEtiqueta).toContain("TiendaE 459");
      const volcado = JSON.stringify(hist[0]);
      for (const libre of ["Pago de lo que debía", "123456", "abonos-tienda"]) expect(volcado).not.toContain(libre);

      // R22 — ni otra tienda, ni el libro de mensajeros, ni una categoria propia o de capital en la caja.
      expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.otraTiendaId } })).toBe(0);
      expect(await prisma.pagoMensajeroMovimiento.count({ where: { registradoPor: p.maestro.usuarioId } })).toBe(0);
      const deCaja = await prisma.walletMovimiento.findMany({ where: { registradoPor: p.maestro.usuarioId } });
      expect(deCaja).toHaveLength(1);
      expect(deCaja.map((f) => NATURALEZA_POR_CATEGORIA[f.categoria as WalletMovimientoCategoria])).toEqual(["terceros"]);
    });
  }, 120_000);

  it("R19/R39: sobre las filas REALES, registrar sube «Entro», la cifra y «De las tiendas» en el monto; anular sube «Salio» y las baja; ganancia y capital en 0,00", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const tras = derivarCaja(await agregadoDeCaja([r.abono.id]));
      expect([tras.entradas, tras.salidas, tras.enCaja, tras.ganancia, tras.deTerceros, tras.capital]).toEqual([
        "4000.00",
        "0.00",
        "4000.00",
        "0.00",
        "4000.00",
        "0.00",
      ]);
      const a = await anularAbonoTiendaAction({ abonoId: r.abono.id, motivo: "Referencia equivocada" }, deps(p.maestro));
      expect(a.status).toBe("ok");
      const anulado = derivarCaja(await agregadoDeCaja([r.abono.id]));
      expect([anulado.entradas, anulado.salidas, anulado.enCaja, anulado.ganancia, anulado.deTerceros, anulado.capital]).toEqual([
        "4000.00",
        "4000.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
      ]);
    });
  }, 120_000);

  it("R14: sin saldo en contra (cero o a favor) -> sin_deuda con el saldo, sin escribir nada", async () => {
    await conPersonas(async (p) => {
      const cero = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      expect(cero).toEqual({ status: "sin_deuda", saldo: { creditos: "0.00", debitos: "0.00", saldo: "0.00", signo: "cero" } });
      await prisma.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("500.00"), origenTipo: "manual", origenId: null },
      });
      const aFavor = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      expect(aFavor.status).toBe("sin_deuda");
      if (aFavor.status !== "sin_deuda") throw new Error("imposible");
      expect(aFavor.saldo.saldo).toBe("500.00");
      expect(await huella(p)).toEqual(NADA);
    });
  }, 120_000);

  it("R15/R66: por encima de la deuda -> excede con la deuda del servidor; EXACTAMENTE la deuda deja el saldo en 0,00", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      expect(await registrarAbonoTiendaAction(entrada(p, { monto: "10000.01" }), deps(p.maestro))).toEqual({
        status: "excede",
        deuda: "10000.00",
      });
      expect(await huella(p)).toEqual(NADA);
      const exacto = await registrarAbonoTiendaAction(entrada(p, { monto: "10000.00" }), deps(p.maestro));
      expect(exacto.status).toBe("ok");
      if (exacto.status !== "ok") throw new Error("imposible");
      expect(exacto.saldo).toEqual({ creditos: "10000.00", debitos: "10000.00", saldo: "0.00", signo: "cero" });
      // Y ahora ya no hay nada que pagar.
      expect((await registrarAbonoTiendaAction(entrada(p, { monto: "1.00" }), deps(p.maestro))).status).toBe("sin_deuda");
    });
  }, 120_000);

  it("R25: la misma clave dos veces -> el pago original y el saldo actual, sin ninguna fila nueva", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const clave = randomUUID();
      const uno = await registrarAbonoTiendaAction(entrada(p, { claveIdempotencia: clave }), deps(p.maestro));
      const trasUno = await huella(p);
      const dos = await registrarAbonoTiendaAction(entrada(p, { claveIdempotencia: clave, monto: "9999" }), deps(p.maestro));
      expect(uno.status).toBe("ok");
      expect(dos.status).toBe("ya_registrado");
      if (uno.status !== "ok" || dos.status !== "ya_registrado") throw new Error("imposible");
      expect(dos.abono.id).toBe(uno.abono.id);
      expect(dos.abono.monto).toBe("4000.00");
      expect(dos.saldo.saldo).toBe("-6000.00");
      expect(await huella(p)).toEqual(trasUno);
      expect(trasUno).toEqual({ abonos: 1, anulaciones: 0, tienda: 1, caja: 1, historial: 1 });
    });
  }, 120_000);

  it("R10/R11: tienda inexistente o cuenta que no es tienda -> error en tiendaId; una tienda INACTIVA con deuda SI paga", async () => {
    await conPersonas(async (p) => {
      for (const [tiendaId, mensaje] of [
        [randomUUID(), "La tienda no existe"],
        [p.mensajero.usuarioId, "La cuenta elegida no es una tienda"],
      ] as const) {
        expect(await registrarAbonoTiendaAction(entrada(p, { tiendaId }), deps(p.maestro))).toEqual({
          status: "validation_error",
          fieldErrors: { tiendaId: [mensaje] },
        });
      }
      expect(await huella(p)).toEqual(NADA);
      await endeudar457(prisma, p.tiendaInactivaId, "3000.00");
      const inactiva = await registrarAbonoTiendaAction(entrada(p, { tiendaId: p.tiendaInactivaId, monto: "3000" }), deps(p.maestro));
      expect(inactiva.status).toBe("ok");
      if (inactiva.status !== "ok") throw new Error("imposible");
      expect(inactiva.saldo.saldo).toBe("0.00");
    });
  }, 120_000);

  it("R2/R3/R4–R9/R12/R13: validacion, rol y sesion no escriben nada", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const rechazos = [
        await registrarAbonoTiendaAction(entrada(p, { monto: "0" }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { motivo: " " }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { referencia: undefined }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { referencia: "r".repeat(61) }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { fechaPago: "2999-01-01" }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { claveIdempotencia: "x" }), deps(p.maestro)),
        await registrarAbonoTiendaAction(entrada(p, { categoria: "ajuste_credito" }), deps(p.maestro)),
      ];
      expect(rechazos.map((r) => r.status)).toEqual(Array(7).fill("validation_error"));
      expect(await registrarAbonoTiendaAction(entrada(p), deps(p.mensajero))).toEqual({ status: "forbidden" });
      expect(await registrarAbonoTiendaAction(entrada(p), deps({ usuarioId: p.tiendaId, rol: "adminTienda" }))).toEqual({
        status: "forbidden",
      });
      expect(await registrarAbonoTiendaAction(entrada(p), deps(null))).toEqual({ status: "unauthenticated" });
      expect(await huella(p)).toEqual(NADA);
      // Un admin puede registrar.
      expect((await registrarAbonoTiendaAction(entrada(p), deps(p.admin))).status).toBe("ok");
    });
  }, 120_000);

  it("R31–R33/R36–R39: la anulacion deja constancia, debito y egreso por el monto DEL DOCUMENTO, al inicio del dia CR de hoy, sin tocar el original", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const id = r.abono.id;
      const originalAntes = await prisma.abonoTienda.findUniqueOrThrow({ where: { id } });
      const creditoAntes = await prisma.walletTiendaMovimiento.findFirstOrThrow({ where: { origenId: id } });
      const entradaAntes = await prisma.walletMovimiento.findFirstOrThrow({ where: { origenId: id } });

      const a = await anularAbonoTiendaAction({ abonoId: id, motivo: "Referencia equivocada" }, deps(p.admin));
      expect(a.status).toBe("ok");
      if (a.status !== "ok") throw new Error("imposible");
      // R38 — el saldo vuelve a estar en contra por la deuda entera.
      expect(a.saldo).toEqual({ creditos: "4000.00", debitos: "14000.00", saldo: "-10000.00", signo: "negativo" });

      const anulacion = await prisma.abonoTiendaAnulacion.findMany({ where: { abonoId: id } });
      expect(anulacion.map((x) => [x.motivo, x.anuladoPor])).toEqual([["Referencia equivocada", p.admin.usuarioId]]);

      const tienda = await prisma.walletTiendaMovimiento.findMany({ where: { origenId: id }, orderBy: { createdAt: "asc" } });
      const caja = await prisma.walletMovimiento.findMany({ where: { origenId: id }, orderBy: { createdAt: "asc" } });
      expect(tienda.map((f) => [f.tipo, f.categoria, f.monto.toFixed(2)])).toEqual([
        ["credito", "abono_tienda", "4000.00"],
        ["debito", "abono_tienda_anulado", "4000.00"],
      ]);
      expect(caja.map((f) => [f.tipo, f.categoria, f.monto.toFixed(2)])).toEqual([
        ["ingreso", "ingreso_abono_tienda", "4000.00"],
        ["egreso", "egreso_reverso_abono_tienda", "4000.00"],
      ]);
      // R32 — los dos contra-asientos con el MISMO instante: el inicio del dia de HOY en Costa Rica.
      const hoy = inicioDelDiaCREnUtc(fechaCalendarioCR(new Date())).toISOString();
      expect(tienda[1].fechaMovimiento.toISOString()).toBe(hoy);
      expect(caja[1].fechaMovimiento.toISOString()).toBe(hoy);
      // R33 — el documento y sus asientos originales, INTACTOS.
      expect(await prisma.abonoTienda.findUniqueOrThrow({ where: { id } })).toEqual(originalAntes);
      expect(await prisma.walletTiendaMovimiento.findUniqueOrThrow({ where: { id: creditoAntes.id } })).toEqual(creditoAntes);
      expect(await prisma.walletMovimiento.findUniqueOrThrow({ where: { id: entradaAntes.id } })).toEqual(entradaAntes);
      // R62/R63 — la segunda fila del historial, de tipo propio, sin el motivo.
      const hist = await prisma.historialAccion.findMany({ where: { entidadId: id }, orderBy: { createdAt: "asc" } });
      expect(hist.map((h) => [h.accion, h.actorUsuarioId, h.monto?.toFixed(2)])).toEqual([
        ["abono_tienda_registrado", p.maestro.usuarioId, "4000.00"],
        ["abono_tienda_anulado", p.admin.usuarioId, "4000.00"],
      ]);
      expect(JSON.stringify(hist)).not.toContain("Referencia equivocada");

      // R36/R37/R34/R35 — ya anulado, inexistente, con monto, sin motivo, sin rol: nada mas se escribe.
      const trasAnular = await huella(p);
      expect(await anularAbonoTiendaAction({ abonoId: id, motivo: "dos" }, deps(p.maestro))).toEqual({ status: "ya_anulado" });
      expect(await anularAbonoTiendaAction({ abonoId: randomUUID(), motivo: "x" }, deps(p.maestro))).toEqual({ status: "no_encontrado" });
      expect((await anularAbonoTiendaAction({ abonoId: id, motivo: "x", monto: "1.00" }, deps(p.maestro))).status).toBe("validation_error");
      expect((await anularAbonoTiendaAction({ abonoId: id, motivo: "  " }, deps(p.maestro))).status).toBe("validation_error");
      expect(await anularAbonoTiendaAction({ abonoId: id, motivo: "x" }, deps(p.mensajero))).toEqual({ status: "forbidden" });
      expect(await anularAbonoTiendaAction({ abonoId: id, motivo: "x" }, deps(null))).toEqual({ status: "unauthenticated" });
      expect(await huella(p)).toEqual(trasAnular);
      expect(await prisma.abonoTiendaAnulacion.count({ where: { abonoId: id } })).toBe(1);
    });
  }, 120_000);

  it("R41: el libro de la caja trae `documento.tipo === \"abono_tienda\"` en la entrada original y `null` en el reverso", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const filasDe = async (categoria: WalletMovimientoCategoria) => {
        const l = await listarMovimientosAction({ page: 1, pageSize: 100, categoria }, deps(p.maestro));
        if (l.status !== "ok") throw new Error(`listar: ${JSON.stringify(l)}`);
        return l.data.movimientos.filter((m) => m.origenId === r.abono.id);
      };
      const [vigente] = await filasDe("ingreso_abono_tienda");
      expect(vigente?.documento).toEqual({ tipo: "abono_tienda", anulado: false, tieneComprobante: false });
      await anularAbonoTiendaAction({ abonoId: r.abono.id, motivo: "x" }, deps(p.maestro));
      const [anulado] = await filasDe("ingreso_abono_tienda");
      expect(anulado?.documento).toEqual({ tipo: "abono_tienda", anulado: true, tieneComprobante: false });
      const [reverso] = await filasDe("egreso_reverso_abono_tienda");
      expect(reverso).toBeDefined();
      expect(reverso?.documento).toBeNull();
    });
  }, 120_000);

  it("R42–R44: sin comprobante -> sin_comprobante para acceso total y para la tienda dueña; una tienda ajena -> no_encontrado", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      expect(await obtenerComprobanteAbonoAction({ abonoId: r.abono.id }, deps(p.maestro))).toEqual({ status: "sin_comprobante" });
      expect(await obtenerComprobanteAbonoAction({ abonoId: r.abono.id }, deps({ usuarioId: p.tiendaId, rol: "adminTienda" }))).toEqual({
        status: "sin_comprobante",
      });
      expect(await obtenerComprobanteAbonoAction({ abonoId: r.abono.id }, deps({ usuarioId: p.otraTiendaId, rol: "adminTienda" }))).toEqual({
        status: "no_encontrado",
      });
      expect(await obtenerComprobanteAbonoAction({ abonoId: r.abono.id }, deps(p.mensajero))).toEqual({ status: "forbidden" });
    });
  }, 120_000);

  it("R65 (T8.3): Σ creditos `abono_tienda` = Σ `ingreso_abono_tienda` por origen; tras anular, Σ debitos = Σ reversos; con filas", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const a = await registrarAbonoTiendaAction(entrada(p, { monto: "1500.25" }), deps(p.maestro));
      const b = await registrarAbonoTiendaAction(entrada(p, { monto: "2000.00" }), deps(p.maestro));
      if (a.status !== "ok" || b.status !== "ok") throw new Error("registro");
      const ids = [a.abono.id, b.abono.id];
      const suma = async (libro: "tienda" | "caja", categoria: string) => {
        const filas =
          libro === "tienda"
            ? await prisma.walletTiendaMovimiento.findMany({ where: { origenTipo: "abono_tienda", origenId: { in: ids }, categoria: categoria as never } })
            : await prisma.walletMovimiento.findMany({ where: { origenTipo: "abono_tienda", origenId: { in: ids }, categoria: categoria as never } });
        return { n: filas.length, total: filas.reduce((acc, f) => acc.add(f.monto), new Prisma.Decimal(0)).toFixed(2) };
      };
      expect(await suma("tienda", "abono_tienda")).toEqual({ n: 2, total: "3500.25" });
      expect(await suma("caja", "ingreso_abono_tienda")).toEqual({ n: 2, total: "3500.25" });
      await anularAbonoTiendaAction({ abonoId: a.abono.id, motivo: "x" }, deps(p.maestro));
      expect(await suma("tienda", "abono_tienda_anulado")).toEqual({ n: 1, total: "1500.25" });
      expect(await suma("caja", "egreso_reverso_abono_tienda")).toEqual({ n: 1, total: "1500.25" });
      // Por origen, uno a uno.
      for (const id of ids) {
        const cred = await prisma.walletTiendaMovimiento.findFirstOrThrow({ where: { origenId: id, categoria: "abono_tienda" } });
        const ing = await prisma.walletMovimiento.findFirstOrThrow({ where: { origenId: id, categoria: "ingreso_abono_tienda" } });
        expect(cred.monto.toFixed(2)).toBe(ing.monto.toFixed(2));
      }
    });
  }, 120_000);

  it("R74: el pago de una tienda NO aparece en los pagos de Ordenex a la tienda, ni en su suma, ni lo ve el backfill de la 173 ni las migraciones de datos", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const repo = new LiquidacionPagoRepository(prisma);
      expect(await repo.listarPorTienda(p.tiendaId)).toEqual([]);
      expect(await repo.sumarVigentesPorTienda(p.tiendaId)).toBe("0.00");

      // m5 de la revision: lo que protege R74 NO es que el servicio no escriba `liquidacion_pago` (eso
      // siempre era verde), sino que los LECTORES no tomen el pago. Se ejecutan los lectores REALES:
      //
      // (1) El registro retroactivo de la 173, EN SECO («simular»: no escribe), sobre la base entera.
      //     Lee `cierre_dia`, `liquidacion_pago` y `liquidacion_anulacion`, no la tabla del pago
      //     (`CajaBackfillTesoreriaService.dePagosATienda`). Si alguna vez leyera `abono_tienda` —su
      //     forma es la de un pago a tienda: monto, metodo, referencia, fecha, tienda—, el pago saldria
      //     como un «pago a tienda» pendiente de su EGRESO en la caja: la mutacion m5 lo pone rojo aqui.
      const backfill = new CajaBackfillTesoreriaService({
        cliente: prisma as unknown as CajaBackfillClient,
        codFeed: new CajaCodFeedService(),
        crearPuertoDePago: (r2) => new CajaPagoTiendaFeedService(r2),
        cajaRepo: new WalletMovimientoRepository(prisma),
        ahora: () => new Date(),
      });
      const informe = await backfill.ejecutar("simular");
      expect(informe.insertadas).toBe(0);
      expect(informe.pendientes.filter((f) => f.documentoId === r.abono.id)).toEqual([]);
      expect(informe.pendientes.filter((f) => f.movimiento.origenId === r.abono.id)).toEqual([]);

      // (2) Las migraciones de datos de la 459/461 toman los `cobro_manual` DEBITO del libro de la
      //     tienda. El pago dejo UNA fila en ese libro (no se afirma sobre el vacio) y no cumple ese filtro.
      const delPago = await prisma.walletTiendaMovimiento.findMany({
        where: { origenId: r.abono.id },
        select: { tipo: true, categoria: true },
      });
      expect(delPago).toEqual([{ tipo: "credito", categoria: "abono_tienda" }]);
      expect(delPago.filter((f) => f.categoria === "cobro_manual" && f.tipo === "debito")).toEqual([]);
      expect(await prisma.walletMovimiento.count({ where: { origenId: r.abono.id, origenTipo: { in: ["cobro_manual_reclasificado", "cobro_tienda_completado"] } } })).toBe(0);
    });
  }, 120_000);
});
