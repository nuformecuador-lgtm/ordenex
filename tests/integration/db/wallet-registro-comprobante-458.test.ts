import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { registrarPagoTiendaAction, registrarRepartoMensajeroAction } from "@/lib/actions/liquidacion";
import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IWalletComprobanteService } from "@/lib/interfaces/services/IWalletComprobanteService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletComprobanteRepository } from "@/lib/repositories/WalletComprobanteRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaCobroTiendaFeedService } from "@/lib/services/CajaCobroTiendaFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { WalletService } from "@/lib/services/WalletService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.11 (R42, R43, R50, R51, R74–R76) — los registros que ganan «a quien», referencia y
// comprobante, contra Postgres y POR SUS SERVER ACTIONS con `FormData`: sueldo/gasto, correccion,
// pago a una tienda, reparto a un mensajero y cobro a una tienda.
//
// Lo que se mide: la anotacion y el comprobante quedan en la MISMA transaccion que el asiento (y
// colgados de SU fila); sin los campos nuevos no se escribe NINGUNA fila lateral (byte a byte el
// registro de antes); un archivo invalido o un almacenamiento caido no registran nada; si el registro
// no se escribe, el objeto se retira; el reenvio de la clave no duplica ni la anotacion ni el objeto.
// El almacenamiento es un doble en memoria; todo lo demas es real.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "c.png", { type: "image/png" });

function fd(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

interface Medida {
  r: Record<string, { status: string }>;
  anotaciones: Record<string, { contraparteNombre: string | null; referencia: string | null }[]>;
  comprobantes: Record<string, string[]>;
  movimientosPorClave: Record<string, number>;
  objetosVivos: string[];
  retiradosPorFalloDeRegistro: string[];
  errorDelRegistroFallido: string;
  pagosDelReparto: number;
}

describeSiHayBase("458-B/TB.11 — registros con «a quien», referencia y comprobante (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario459(tx, cat);
        const c = s.cliente;
        const runTx = <T,>(fn: (t: never) => Promise<T>): Promise<T> => c.$transaction((t) => fn(t as never)) as Promise<T>;

        const vivos = new Set<string>();
        const storage: IFileStorage = {
          upload: async ({ path }) => {
            vivos.add(path);
            return path;
          },
          remove: async (paths) => {
            for (const p of paths) vivos.delete(p);
          },
        };
        const urls: ISignedUrlProvider = { createSignedUrl: async (p) => p, createSignedUrls: async () => ({}) };
        const puerto = new WalletComprobanteService(
          new WalletComprobanteRepository(c),
          new WalletAnulacionService(new WalletAnulacionDestinoRepository(c)),
          storage,
          urls,
          runTx,
        );
        const cajaRepo = new WalletMovimientoRepository(c);
        const tiendaRepo = new WalletTiendaMovimientoRepository(c);
        const egresos = new WalletEgresoService(cajaRepo, c, puerto);
        // `registrarMovimientoManual` no lee los documentos del libro: los lectores no intervienen.
        const wallet = new WalletService(cajaRepo, c, new AporteCapitalRepository(c), {} as never, puerto);
        const montarLiquidacion = (p: IWalletComprobanteService) =>
          new LiquidacionService(
            new LiquidacionPagoRepository(c),
            tiendaRepo,
            new PagoMensajeroMovimientoRepository(c),
            runTx,
            new CajaPagoTiendaFeedService(cajaRepo),
            new LiquidacionRepartoRepository(c),
            undefined,
            undefined,
            p,
          );
        const liquidacion = montarLiquidacion(puerto);
        const cobro = new CobroTiendaService(
          tiendaRepo,
          new UserRepository(c),
          new CajaCobroTiendaFeedService(cajaRepo),
          new CobroTiendaAnulacionRepository(c),
          runTx,
          undefined,
          puerto,
        );
        const actor = esc.maestro;
        const hoy = fechaCalendarioCR(new Date());
        const claves: Record<string, string> = {};
        const clave = (n: string) => (claves[n] = randomUUID());
        const r: Record<string, { status: string }> = {};

        // A. Sueldo con los tres campos nuevos; B. el MISMO envio otra vez.
        const envioSueldo = () =>
          fd({
            tipoEgreso: "sueldo",
            monto: "250.00",
            descripcion: "Sueldo septiembre",
            claveIdempotencia: claves.sueldo,
            contraparteNombre: "  Ana Mora  ",
            referencia: "SINPE 99",
            comprobante: png(),
          });
        clave("sueldo");
        r.sueldo = await registrarEgresoAdministrativoAction(envioSueldo(), { getActor: async () => actor, service: egresos });
        r.sueldoOtraVez = await registrarEgresoAdministrativoAction(envioSueldo(), { getActor: async () => actor, service: egresos });

        // C. Gasto como objeto, con «a quien» y sin referencia ni comprobante (458-C D5: «a quien» es
        // obligatorio en el gasto; sin el, C2 no escribe nada).
        r.gastoDeHoy = await registrarEgresoAdministrativoAction(
          { tipoEgreso: "gasto_variable", monto: "40.00", descripcion: "Cinta", claveIdempotencia: clave("gasto"), contraparteNombre: "Ferretería" },
          { getActor: async () => actor, service: egresos },
        );
        // C2. FICHA 458-C (D5): el mismo gasto SIN «a quien» cae en el borde y no escribe NADA.
        r.gastoSinAQuien = await registrarEgresoAdministrativoAction(
          { tipoEgreso: "gasto_variable", monto: "41.00", descripcion: "Cinta", claveIdempotencia: clave("sinAQuien") },
          { getActor: async () => actor, service: egresos },
        );
        // D. Correccion con solo «a quien» (opcional, D5) y un campo de referencia vacio.
        r.correccion = await registrarMovimientoManualAction(
          fd({
            tipo: "egreso",
            categoria: "egreso_ajuste",
            monto: "12.00",
            descripcion: "Faltante",
            claveIdempotencia: clave("correccion"),
            contraparteNombre: "Cajero",
            referencia: "   ",
          }),
          { getActor: async () => actor, service: wallet },
        );
        // E. Archivo de un tipo no admitido: nada se registra.
        r.invalido = await registrarEgresoAdministrativoAction(
          fd({
            tipoEgreso: "sueldo",
            monto: "10.00",
            descripcion: "x",
            contraparteNombre: "Ana",
            claveIdempotencia: clave("invalido"),
            comprobante: new File(["hola"], "c.txt", { type: "text/plain" }),
          }),
          { getActor: async () => actor, service: egresos },
        );
        // F. Almacenamiento caido: `comprobante_no_guardado` y nada se registra.
        const caido = new WalletComprobanteService(
          new WalletComprobanteRepository(c),
          new WalletAnulacionService(new WalletAnulacionDestinoRepository(c)),
          { upload: async () => { throw new Error("bucket caido"); }, remove: async () => undefined },
          urls,
          runTx,
        );
        r.caido = await registrarEgresoAdministrativoAction(
          fd({ tipoEgreso: "sueldo", monto: "10.00", descripcion: "x", contraparteNombre: "Ana", claveIdempotencia: clave("caido"), comprobante: png() }),
          { getActor: async () => actor, service: new WalletEgresoService(cajaRepo, c, caido) },
        );
        // G. El registro NO se escribe con el objeto ya subido (la fila del comprobante viola su CHECK
        // de tipo): la transaccion entera revierte y el objeto se RETIRA.
        const retirados: string[] = [];
        const roto: IWalletComprobanteService = {
          ...puerto,
          subir: async () => ({ status: "ok", guardado: { storagePath: "pagos/roto.png", contentType: "text/plain" } }),
          registrarEnTx: (t, d, g, u) => puerto.registrarEnTx(t, d, g, u),
          retirar: async (g) => {
            retirados.push(g.storagePath);
          },
          adjuntar: puerto.adjuntar.bind(puerto),
          ver: puerto.ver.bind(puerto),
        };
        let errorDelRegistroFallido = "";
        try {
          await montarLiquidacion(roto).registrarPagoTienda(
            { claveIdempotencia: clave("roto"), tiendaId: esc.tiendaA, monto: "1.00", metodo: "efectivo", fechaPago: hoy },
            actor,
            { contentType: "image/png", bytes: new Uint8Array([1]) },
          );
        } catch (error) {
          errorDelRegistroFallido = error instanceof Error ? error.message : String(error);
        }

        // H. Pago a una tienda con comprobante; K. el mismo camino sin comprobante (objeto).
        r.pagoTienda = await registrarPagoTiendaAction(
          fd({ claveIdempotencia: clave("pagoTienda"), tiendaId: esc.tiendaA, monto: "1.00", metodo: "efectivo", fechaPago: hoy, comprobante: png() }),
          { getActor: async () => actor, service: liquidacion },
        );
        r.pagoTiendaDeHoy = await registrarPagoTiendaAction(
          { claveIdempotencia: clave("pagoTiendaDeHoy"), tiendaId: esc.tiendaA, monto: "1.00", metodo: "efectivo", fechaPago: hoy },
          { getActor: async () => actor, service: liquidacion },
        );
        // I. Reparto a un mensajero con comprobante.
        r.reparto = await registrarRepartoMensajeroAction(
          fd({ claveIdempotencia: clave("reparto"), mensajeroId: esc.mensajeroId, monto: "1.00", metodo: "efectivo", fechaPago: hoy, comprobante: png() }),
          { getActor: async () => actor, service: liquidacion },
        );
        // J. Cobro a una tienda con comprobante.
        r.cobro = await registrarCobroTiendaAction(
          fd({ claveIdempotencia: clave("cobro"), tiendaId: esc.tiendaB, monto: "5.00", descripcion: "Bolsas", comprobante: png() }),
          { getActor: async () => actor, service: cobro },
        );

        // ── La medida ───────────────────────────────────────────────────────────────────────
        const movimientosPorClave: Record<string, number> = {};
        const anotaciones: Medida["anotaciones"] = {};
        const comprobantes: Medida["comprobantes"] = {};
        for (const n of ["sueldo", "gasto", "sinAQuien", "correccion", "invalido", "caido"]) {
          const filas = await tx.walletMovimiento.findMany({ where: { claveIdempotencia: claves[n] }, select: { id: true } });
          movimientosPorClave[n] = filas.length;
          const ids = filas.map((f) => f.id);
          anotaciones[n] = await tx.walletAnotacion.findMany({
            where: { movimientoId: { in: ids } },
            select: { contraparteNombre: true, referencia: true },
          });
          comprobantes[n] = (await tx.walletComprobante.findMany({ where: { cajaMovimientoId: { in: ids } }, select: { storagePath: true } })).map((x) => x.storagePath);
        }
        const pagoDe = async (n: string) =>
          (await tx.liquidacionPago.findMany({ where: { claveIdempotencia: { startsWith: claves[n] } }, select: { id: true } })).map((x) => x.id);
        for (const n of ["pagoTienda", "pagoTiendaDeHoy", "reparto", "roto"]) {
          const ids = await pagoDe(n);
          movimientosPorClave[n] = ids.length;
          comprobantes[n] = (await tx.walletComprobante.findMany({ where: { liquidacionPagoId: { in: ids } }, select: { storagePath: true } })).map((x) => x.storagePath);
        }
        const cobroFila = await tx.walletTiendaMovimiento.findMany({ where: { claveIdempotencia: claves.cobro }, select: { id: true } });
        movimientosPorClave.cobro = cobroFila.length;
        comprobantes.cobro = (await tx.walletComprobante.findMany({ where: { tiendaMovimientoId: { in: cobroFila.map((x) => x.id) } }, select: { storagePath: true } })).map((x) => x.storagePath);

        return {
          r,
          anotaciones,
          comprobantes,
          movimientosPorClave,
          objetosVivos: [...vivos].sort(),
          retiradosPorFalloDeRegistro: retirados,
          errorDelRegistroFallido,
          pagosDelReparto: movimientosPorClave.reparto,
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R42/R74: el sueldo deja su anotacion (recortada) y su comprobante colgados de SU fila, en la misma transaccion", () => {
    expect(m().r.sueldo.status).toBe("ok");
    expect(m().movimientosPorClave.sueldo).toBe(1);
    expect(m().anotaciones.sueldo).toEqual([{ contraparteNombre: "Ana Mora", referencia: "SINPE 99" }]);
    expect(m().comprobantes.sueldo).toHaveLength(1);
    expect(m().comprobantes.sueldo[0]).toMatch(/^movimientos-caja\/[0-9a-f-]{36}\.png$/);
  });

  it("R51/R76: el reenvio de la MISMA clave responde `ya_registrado` sin duplicar anotacion ni comprobante, y retira el objeto nuevo", () => {
    expect(m().r.sueldoOtraVez.status).toBe("ya_registrado");
    expect(m().anotaciones.sueldo).toHaveLength(1);
    expect(m().comprobantes.sueldo).toHaveLength(1);
  });

  it("R43/R50 + 458-C D5: el gasto con solo «a quien» deja su anotacion y ningun comprobante; sin «a quien» no escribe NADA", () => {
    expect(m().r.gastoDeHoy.status).toBe("ok");
    expect(m().anotaciones.gasto).toEqual([{ contraparteNombre: "Ferretería", referencia: null }]);
    expect(m().comprobantes.gasto).toEqual([]);
    // D5 contra Postgres: `validation_error` en «a quien» y cero filas con esa clave.
    expect(m().r.gastoSinAQuien).toEqual({
      status: "validation_error",
      fieldErrors: { contraparteNombre: ["Escribí a quién se le pagó."] },
    });
    expect(m().movimientosPorClave.sinAQuien).toBe(0);
    expect(m().anotaciones.sinAQuien).toEqual([]);
    expect(m().r.pagoTiendaDeHoy.status).toBe("ok");
    expect(m().comprobantes.pagoTiendaDeHoy).toEqual([]);
  });

  it("D5/R42: la correccion con solo «a quien» deja la anotacion sin referencia (un campo en blanco es ausente)", () => {
    expect(m().r.correccion.status).toBe("ok");
    expect(m().anotaciones.correccion).toEqual([{ contraparteNombre: "Cajero", referencia: null }]);
    expect(m().comprobantes.correccion).toEqual([]);
  });

  it("R75: un archivo no admitido es `validation_error` bajo el campo y NO registra el movimiento", () => {
    expect(m().r.invalido).toMatchObject({ status: "validation_error", fieldErrors: { comprobante: [expect.any(String)] } });
    expect(m().movimientosPorClave.invalido).toBe(0);
  });

  it("R76: si el comprobante no se puede guardar, `comprobante_no_guardado` y NO se registra el movimiento", () => {
    expect(m().r.caido).toEqual({ status: "comprobante_no_guardado" });
    expect(m().movimientosPorClave.caido).toBe(0);
  });

  it("R76: si el movimiento no se registra con el comprobante ya guardado, se revierte TODO y el archivo se retira", () => {
    expect(m().errorDelRegistroFallido).not.toBe("");
    expect(m().movimientosPorClave.roto).toBe(0);
    expect(m().comprobantes.roto).toEqual([]);
    expect(m().retiradosPorFalloDeRegistro).toEqual(["pagos/roto.png"]);
  });

  it("R74: el pago a una tienda, el reparto (una fila por pago, el mismo objeto) y el cobro llevan su comprobante en SU columna", () => {
    expect(m().r.pagoTienda.status).toBe("ok");
    expect(m().comprobantes.pagoTienda).toHaveLength(1);
    expect(m().comprobantes.pagoTienda[0]).toMatch(/^pagos\//);
    expect(m().r.reparto.status).toBe("ok");
    expect(m().pagosDelReparto).toBeGreaterThan(0);
    expect(m().comprobantes.reparto).toHaveLength(m().pagosDelReparto);
    expect(new Set(m().comprobantes.reparto).size).toBe(1);
    expect(m().r.cobro.status).toBe("ok");
    expect(m().comprobantes.cobro).toHaveLength(1);
    expect(m().comprobantes.cobro[0]).toMatch(/^cobros-tienda\//);
  });

  it("R76: ningun objeto huerfano — los vivos son exactamente los que tienen fila", () => {
    const conFila = new Set([
      ...m().comprobantes.sueldo,
      ...m().comprobantes.pagoTienda,
      ...m().comprobantes.reparto,
      ...m().comprobantes.cobro,
    ]);
    expect(m().objetosVivos).toEqual([...conFila].sort());
  });
});
