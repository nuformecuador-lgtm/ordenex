import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  anularPagoPorCuentaTiendaAction,
  registrarPagoPorCuentaTiendaAction,
} from "@/lib/actions/pago-por-cuenta-tienda";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  acreditar459,
  conCandado459,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T B.12 — el pago por cuenta de una tienda, POR LA ACTION, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se entra por `registrarPagoPorCuentaTiendaAction` / `anularPagoPorCuentaTiendaAction` SIN
// inyectar el servicio: lo construye el `buildService()` real con `getPrismaClient()`. Solo se
// inyecta el actor (no hay cookie de sesion en un test). Lo que se afirma se lee DE LA BASE: el
// documento, el cargo en el libro de la tienda, la salida en la caja y el historial.
//
// Las cifras de la tarjeta (R39/R48: cifra principal y «De las tiendas» bajan y suben en el monto,
// ganancia y capital intactos) se miden en `caja-invariante-tiendas.test.ts`, en REPEATABLE READ:
// aqui se commitea y el libro entero de la caja lo comparten otros archivos que corren a la vez.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("459/T B.12 — pago por cuenta de una tienda por la action (Postgres real)", () => {
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

  function entrada(p: Personas459, over: Record<string, string | undefined> = {}) {
    return formData459({
      claveIdempotencia: randomUUID(),
      tiendaId: p.tiendaId,
      beneficiario: "Facebook Ads",
      monto: "12345.6",
      metodo: "SINPE",
      referencia: "REF-77",
      motivo: "Publicidad de septiembre",
      ...over,
    });
  }

  /** Todo lo que la ficha escribe para una tienda y unas personas: para afirmar «no escribio nada». */
  async function huella(p: Personas459) {
    const [pagos, tienda, caja, historial] = await Promise.all([
      prisma.pagoPorCuentaTienda.count({ where: { tiendaId: { in: p.usuarios } } }),
      prisma.walletTiendaMovimiento.count({ where: { tiendaId: { in: p.usuarios }, registradoPor: { not: null } } }),
      prisma.walletMovimiento.count({ where: { registradoPor: { in: p.usuarios } } }),
      prisma.historialAccion.count({ where: { actorUsuarioId: { in: p.usuarios } } }),
    ]);
    return { pagos, tienda, caja, historial };
  }

  const NADA = { pagos: 0, tienda: 0, caja: 0, historial: 0 };

  it("R29/R30/R43/R53: una sola accion escribe documento, cargo, salida e historial con el MISMO monto e instante", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "50000.00");
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.maestro));
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("imposible");

      // R40/R39 — el saldo devuelto baja exactamente en el monto (50 000,00 − 12 345,60).
      expect(r.saldo.saldo).toBe("37654.40");
      expect(r.pago).toMatchObject({
        beneficiario: "Facebook Ads",
        monto: "12345.60",
        metodo: "SINPE",
        referencia: "REF-77",
        motivo: "Publicidad de septiembre",
        anulado: false,
        tieneComprobante: false,
        tiendaNombre: expect.stringContaining("TiendaE 459"),
      });
      expect(r.pago).not.toHaveProperty("tiendaId");

      const doc = await prisma.pagoPorCuentaTienda.findUniqueOrThrow({ where: { id: r.pago.id } });
      expect({
        tiendaId: doc.tiendaId,
        beneficiario: doc.beneficiario,
        monto: doc.monto.toFixed(2),
        metodo: doc.metodo,
        referencia: doc.referencia,
        motivo: doc.motivo,
        registradoPor: doc.registradoPor,
        comprobantePath: doc.comprobantePath,
      }).toEqual({
        tiendaId: p.tiendaId,
        beneficiario: "Facebook Ads",
        monto: "12345.60",
        metodo: "SINPE",
        referencia: "REF-77",
        motivo: "Publicidad de septiembre",
        registradoPor: p.maestro.usuarioId,
        comprobantePath: null,
      });

      const cargos = await prisma.walletTiendaMovimiento.findMany({ where: { origenId: doc.id } });
      const salidas = await prisma.walletMovimiento.findMany({ where: { origenId: doc.id } });
      expect(cargos.map((c) => [c.tiendaId, c.tipo, c.categoria, c.origenTipo, c.monto.toFixed(2)])).toEqual([
        [p.tiendaId, "debito", "pago_por_cuenta", "pago_por_cuenta_tienda", "12345.60"],
      ]);
      expect(salidas.map((s) => [s.tipo, s.categoria, s.origenTipo, s.monto.toFixed(2)])).toEqual([
        ["egreso", "egreso_pago_por_cuenta_tienda", "pago_por_cuenta_tienda", "12345.60"],
      ]);
      // El MISMO instante en los dos libros.
      expect(salidas[0].fechaMovimiento.toISOString()).toBe(cargos[0].fechaMovimiento.toISOString());

      // R43 — descripciones: beneficiario, motivo, metodo y referencia; la caja ademas la tienda;
      // ningun identificador interno.
      expect(cargos[0].descripcion).toContain("Facebook Ads");
      expect(cargos[0].descripcion).toContain("Publicidad de septiembre");
      expect(cargos[0].descripcion).toContain("REF-77");
      expect(salidas[0].descripcion).toContain("TiendaE 459");
      for (const d of [cargos[0].descripcion ?? "", salidas[0].descripcion ?? ""]) {
        expect(d).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(d).not.toContain(p.tiendaId);
      }

      // R53 — una fila de tipo propio con quien, el importe y el nombre de la tienda; sin texto libre.
      const hist = await prisma.historialAccion.findMany({ where: { entidadId: doc.id } });
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({
        accion: "pago_por_cuenta_tienda_registrado",
        entidadTipo: "pago_por_cuenta_tienda",
        actorUsuarioId: p.maestro.usuarioId,
        actorRol: "maestro",
      });
      expect(hist[0].monto?.toFixed(2)).toBe("12345.60");
      expect(hist[0].entidadEtiqueta).toContain("TiendaE 459");
      const volcado = JSON.stringify(hist[0]);
      for (const libre of ["Facebook Ads", "Publicidad de septiembre", "REF-77"]) {
        expect(volcado).not.toContain(libre);
      }

      // R39 — no toca el libro de ninguna otra tienda ni el de ningun mensajero.
      expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.otraTiendaId } })).toBe(0);
      expect(await prisma.pagoMensajeroMovimiento.count({ where: { registradoPor: p.maestro.usuarioId } })).toBe(0);
      // Y en la caja escribio UNA fila, nada mas.
      expect(await prisma.walletMovimiento.count({ where: { registradoPor: p.maestro.usuarioId } })).toBe(1);
    });
  }, 120_000);

  it("R40: sin saldo, el pago por cuenta se registra igual y devuelve el saldo EN CONTRA con su signo", async () => {
    await conPersonas(async (p) => {
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p, { monto: "700" }), deps(p.maestro));
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("imposible");
      expect(r.saldo.saldo).toBe("-700.00");
      expect(r.saldo.signo).toBe("negativo");
    });
  }, 120_000);

  it("R41: la misma clave dos veces -> el pago original y el saldo actual, sin ninguna fila nueva", async () => {
    await conPersonas(async (p) => {
      const clave = randomUUID();
      const uno = await registrarPagoPorCuentaTiendaAction(entrada(p, { claveIdempotencia: clave }), deps(p.maestro));
      const trasUno = await huella(p);
      const dos = await registrarPagoPorCuentaTiendaAction(
        entrada(p, { claveIdempotencia: clave, monto: "99999" }),
        deps(p.maestro),
      );
      expect(uno.status).toBe("ok");
      expect(dos.status).toBe("ya_registrado");
      if (uno.status !== "ok" || dos.status !== "ya_registrado") throw new Error("imposible");
      expect(dos.pago.id).toBe(uno.pago.id);
      expect(dos.pago.monto).toBe("12345.60");
      expect(dos.saldo.saldo).toBe("-12345.60");
      expect(await huella(p)).toEqual(trasUno);
      expect(trasUno).toEqual({ pagos: 1, tienda: 1, caja: 1, historial: 1 });
    });
  }, 120_000);

  it("R36: tienda inexistente, cuenta que no es tienda o tienda inactiva -> error en `tiendaId`, sin escribir nada", async () => {
    await conPersonas(async (p) => {
      const casos: [string, string][] = [
        [randomUUID(), "La tienda no existe"],
        [p.mensajero.usuarioId, "La cuenta elegida no es una tienda"],
        [p.tiendaInactivaId, "La tienda no esta activa"],
      ];
      for (const [tiendaId, mensaje] of casos) {
        const r = await registrarPagoPorCuentaTiendaAction(entrada(p, { tiendaId }), deps(p.maestro));
        expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: [mensaje] } });
      }
      expect(await huella(p)).toEqual(NADA);
    });
  }, 120_000);

  it("R31–R35/R37/R38: validacion, rol y sesion no escriben nada", async () => {
    await conPersonas(async (p) => {
      const rechazos = [
        await registrarPagoPorCuentaTiendaAction(entrada(p, { beneficiario: " " }), deps(p.maestro)),
        await registrarPagoPorCuentaTiendaAction(entrada(p, { monto: "0" }), deps(p.maestro)),
        await registrarPagoPorCuentaTiendaAction(entrada(p, { motivo: "" }), deps(p.maestro)),
        await registrarPagoPorCuentaTiendaAction(entrada(p, { referencia: undefined }), deps(p.maestro)),
        await registrarPagoPorCuentaTiendaAction(entrada(p, { fecha: "2999-01-01" }), deps(p.maestro)),
        await registrarPagoPorCuentaTiendaAction(entrada(p, { categoria: "ajuste_debito" }), deps(p.maestro)),
      ];
      expect(rechazos.map((r) => r.status)).toEqual(Array(6).fill("validation_error"));
      expect(await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.mensajero))).toEqual({ status: "forbidden" });
      expect(
        await registrarPagoPorCuentaTiendaAction(entrada(p), deps({ usuarioId: p.tiendaId, rol: "adminTienda" })),
      ).toEqual({ status: "forbidden" });
      expect(await registrarPagoPorCuentaTiendaAction(entrada(p), deps(null))).toEqual({ status: "unauthenticated" });
      expect(await huella(p)).toEqual(NADA);
    });
  }, 120_000);

  it("P14: un admin puede registrar", async () => {
    await conPersonas(async (p) => {
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.admin));
      expect(r.status).toBe("ok");
    });
  }, 120_000);

  it("R46/R47/R48/R53: la anulacion deja constancia, abono y entrada por el monto DEL DOCUMENTO, fechados hoy, sin tocar el original", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "20000.00");
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const id = r.pago.id;
      const originalAntes = await prisma.pagoPorCuentaTienda.findUniqueOrThrow({ where: { id } });
      const cargoAntes = await prisma.walletTiendaMovimiento.findFirstOrThrow({ where: { origenId: id } });
      const salidaAntes = await prisma.walletMovimiento.findFirstOrThrow({ where: { origenId: id } });

      const antes = Date.now();
      const a = await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "Se registro dos veces" }, deps(p.admin));
      expect(a.status).toBe("ok");
      if (a.status !== "ok") throw new Error("imposible");
      // R48 — el saldo vuelve a subir exactamente en el monto.
      expect(a.saldo.saldo).toBe("20000.00");

      const anulacion = await prisma.pagoPorCuentaTiendaAnulacion.findMany({ where: { pagoId: id } });
      expect(anulacion.map((x) => [x.motivo, x.anuladoPor])).toEqual([["Se registro dos veces", p.admin.usuarioId]]);

      const tienda = await prisma.walletTiendaMovimiento.findMany({ where: { origenId: id }, orderBy: { createdAt: "asc" } });
      const caja = await prisma.walletMovimiento.findMany({ where: { origenId: id }, orderBy: { createdAt: "asc" } });
      expect(tienda.map((f) => [f.tipo, f.categoria, f.monto.toFixed(2)])).toEqual([
        ["debito", "pago_por_cuenta", "12345.60"],
        ["credito", "pago_por_cuenta_anulado", "12345.60"],
      ]);
      expect(caja.map((f) => [f.tipo, f.categoria, f.monto.toFixed(2)])).toEqual([
        ["egreso", "egreso_pago_por_cuenta_tienda", "12345.60"],
        ["ingreso", "ingreso_reverso_pago_por_cuenta_tienda", "12345.60"],
      ]);
      // R47 — los dos contra-asientos, con el MISMO instante, el de la anulacion.
      expect(tienda[1].fechaMovimiento.toISOString()).toBe(caja[1].fechaMovimiento.toISOString());
      expect(caja[1].fechaMovimiento.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      // R47 — el documento y sus asientos originales, INTACTOS.
      expect(await prisma.pagoPorCuentaTienda.findUniqueOrThrow({ where: { id } })).toEqual(originalAntes);
      expect(await prisma.walletTiendaMovimiento.findUniqueOrThrow({ where: { id: cargoAntes.id } })).toEqual(cargoAntes);
      expect(await prisma.walletMovimiento.findUniqueOrThrow({ where: { id: salidaAntes.id } })).toEqual(salidaAntes);

      const hist = await prisma.historialAccion.findMany({ where: { entidadId: id }, orderBy: { createdAt: "asc" } });
      expect(hist.map((h) => [h.accion, h.actorUsuarioId, h.monto?.toFixed(2)])).toEqual([
        ["pago_por_cuenta_tienda_registrado", p.maestro.usuarioId, "12345.60"],
        ["pago_por_cuenta_tienda_anulado", p.admin.usuarioId, "12345.60"],
      ]);
      expect(JSON.stringify(hist)).not.toContain("Se registro dos veces");
    });
  }, 120_000);

  it("R49/R50/R51/R37/R38: motivo vacio, ya anulado, inexistente, con monto, sin rol -> nada escrito", async () => {
    await conPersonas(async (p) => {
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.maestro));
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const id = r.pago.id;
      const trasRegistro = await huella(p);

      expect((await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "  " }, deps(p.maestro))).status).toBe(
        "validation_error",
      );
      expect(
        (await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "x", monto: "1.00" }, deps(p.maestro))).status,
      ).toBe("validation_error");
      expect(await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "x" }, deps(p.mensajero))).toEqual({
        status: "forbidden",
      });
      expect(await anularPagoPorCuentaTiendaAction({ pagoId: randomUUID(), motivo: "x" }, deps(p.maestro))).toEqual({
        status: "no_encontrado",
      });
      expect(await huella(p)).toEqual(trasRegistro);

      expect((await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "uno" }, deps(p.maestro))).status).toBe("ok");
      const trasAnular = await huella(p);
      expect(await anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "dos" }, deps(p.maestro))).toEqual({
        status: "ya_anulado",
      });
      expect(await huella(p)).toEqual(trasAnular);
      expect(await prisma.pagoPorCuentaTiendaAnulacion.count({ where: { pagoId: id } })).toBe(1);
    });
  }, 120_000);

  it("R97: el pago por cuenta NO aparece en la lista de pagos a la tienda", async () => {
    await conPersonas(async (p) => {
      const r = await registrarPagoPorCuentaTiendaAction(entrada(p), deps(p.maestro));
      expect(r.status).toBe("ok");
      const pagos = await new LiquidacionPagoRepository(prisma).listarPorTienda(p.tiendaId);
      expect(pagos).toEqual([]);
      expect(await prisma.liquidacionPago.count({ where: { tiendaId: p.tiendaId } })).toBe(0);
    });
  }, 120_000);
});
