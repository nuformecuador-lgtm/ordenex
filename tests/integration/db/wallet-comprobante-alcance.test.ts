import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import * as acciones from "@/lib/actions/wallet-comprobante";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { adjuntarComprobanteAction, verComprobanteAction } from "@/lib/actions/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletComprobanteRepository } from "@/lib/repositories/WalletComprobanteRepository";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";
import type { AdjuntarComprobanteResult, VerComprobanteResult } from "@/lib/types/wallet-comprobante-lateral";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.10 (R74–R80) — el comprobante LATERAL contra Postgres: adjuntar despues (una vez,
// a la columna de SU destino), el UNIQUE como R79 y el alcance de la tienda (R77/R78), sobre el
// escenario de la fase 0 de la 459 (tiendas A y B, cierres, pagos de la 172, cobros de Ordenex).
//
// El almacenamiento es un doble en memoria (el bucket no es de la base); todo lo demas es real: el
// repositorio, el clasificador de la anulacion, la transaccion y las Server Actions.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PNG = () => new File([new Uint8Array([137, 80, 78, 71])], "comprobante.png", { type: "image/png" });

function formData(destino: DestinoMovimiento): FormData {
  const fd = new FormData();
  fd.append("destino", JSON.stringify(destino));
  fd.append("comprobante", PNG());
  return fd;
}

interface Medida {
  adjuntos: Record<string, AdjuntarComprobanteResult>;
  vistas: Record<string, VerComprobanteResult>;
  filas: { caja: string | null; tienda: string | null; pago: string | null; storagePath: string; subidoPor: string }[];
  segundoPorRepo: "creado" | "ya_tiene";
  objetosVivos: string[];
  subidas: number;
  subidasDelSegundo: number;
  maestroId: string;
  ids: { sueldo: string; pagoTiendaA: string; filaPagoTiendaA: string; cobroB: string };
}

describeSiHayBase("458-B/TB.10 — comprobante lateral: una vez, a su destino, y la tienda solo ve lo suyo (Postgres real)", () => {
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
        const pago = await s.pagoPorCuenta.registrar(
          { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaA, beneficiario: "Imprenta Ruiz", monto: "100.00", metodo: "efectivo", motivo: "Etiquetas" },
          null,
          esc.maestro,
        );
        if (pago.status !== "ok") throw new Error(`pago por cuenta: ${JSON.stringify(pago)}`);

        const vivos = new Set<string>();
        let subidas = 0;
        const storage: IFileStorage = {
          upload: async ({ path }) => {
            subidas += 1;
            vivos.add(path);
            return path;
          },
          remove: async (paths) => {
            for (const p of paths) vivos.delete(p);
          },
        };
        const urls: ISignedUrlProvider = {
          createSignedUrl: async (path, ttl) => `https://firmada.test/${path}?ttl=${ttl}`,
          createSignedUrls: async () => ({}),
        };
        const repo = new WalletComprobanteRepository(s.cliente);
        const servicio = new WalletComprobanteService(
          repo,
          new WalletAnulacionService(new WalletAnulacionDestinoRepository(s.cliente)),
          storage,
          urls,
          (fn) => s.cliente.$transaction((t) => fn(t)),
        );
        const como = (actor: Actor) => ({ getActor: async () => actor, service: servicio });
        const tiendaA: Actor = { usuarioId: esc.tiendaA, rol: "adminTienda" };
        const tiendaB: Actor = { usuarioId: esc.tiendaB, rol: "adminTienda" };

        // FICHA 458-B (revision m6): `adjuntar` rechaza lo ANULADO, y el escenario 459 reversa su sueldo
        // (R72) y anula un pago a la tienda A. Estos casos miden el destino y el alcance, no la
        // anulacion (esa va en `wallet-documento-comprobante-458.test.ts`): se eligen los NO anulados.
        // El sueldo del escenario esta reversado: se registra uno nuevo por su action real.
        const claveSueldo = randomUUID();
        const nuevoSueldo = await registrarEgresoAdministrativoAction(
          { tipoEgreso: "sueldo", monto: "25.00", descripcion: "Sueldo sin anular", claveIdempotencia: claveSueldo },
          { getActor: async () => esc.maestro, service: s.egresos },
        );
        if (nuevoSueldo.status !== "ok") throw new Error(`sueldo: ${JSON.stringify(nuevoSueldo)}`);
        const sueldo = await tx.walletMovimiento.findFirstOrThrow({ where: { claveIdempotencia: claveSueldo }, select: { id: true } });
        const cierre = await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "cierre_dia" }, select: { id: true } });
        const cajaDelGasto = await tx.walletMovimiento.findFirstOrThrow({
          where: { origenTipo: "pago_por_cuenta_tienda", origenId: pago.pago.id },
          select: { id: true },
        });
        // El pago a la tienda A del escenario esta anulado: se registra uno nuevo por el servicio real.
        const clavePago = randomUUID();
        const nuevoPago = await s.liquidacion.registrarPagoTienda(
          { claveIdempotencia: clavePago, tiendaId: esc.tiendaA, monto: "1.00", metodo: "efectivo", fechaPago: fechaCalendarioCR(new Date()) },
          esc.maestro,
        );
        if (nuevoPago.status !== "ok") throw new Error(`pago a la tienda A: ${JSON.stringify(nuevoPago)}`);
        const pagoNuevo = await tx.liquidacionPago.findFirstOrThrow({ where: { claveIdempotencia: clavePago }, select: { id: true } });
        const filaPagoTiendaA = await tx.walletTiendaMovimiento.findFirstOrThrow({
          where: { tiendaId: esc.tiendaA, categoria: "pago_tienda", origenTipo: "pago_tienda", origenId: pagoNuevo.id },
          select: { id: true, origenId: true },
        });
        const cobroB = await tx.walletTiendaMovimiento.findFirstOrThrow({
          where: { tiendaId: esc.tiendaB, categoria: "cobro_manual", origenTipo: "manual" },
          select: { id: true },
        });
        const inexistente = randomUUID();

        const CAJA = (id: string): DestinoMovimiento => ({ libro: "caja", movimientoId: id });
        const TIENDA = (id: string): DestinoMovimiento => ({ libro: "tienda", movimientoId: id });

        const adjuntos: Record<string, AdjuntarComprobanteResult> = {};
        adjuntos.sueldo = await adjuntarComprobanteAction(formData(CAJA(sueldo.id)), como(esc.maestro));
        const subidasTrasElPrimero = subidas;
        adjuntos.sueldoOtraVez = await adjuntarComprobanteAction(formData(CAJA(sueldo.id)), como(esc.maestro));
        const subidasDelSegundo = subidas - subidasTrasElPrimero;
        adjuntos.pagoTiendaA = await adjuntarComprobanteAction(formData(TIENDA(filaPagoTiendaA.id)), como(esc.maestro));
        adjuntos.cobroB = await adjuntarComprobanteAction(formData(TIENDA(cobroB.id)), como(esc.maestro));
        adjuntos.pagoDeUnGasto = await adjuntarComprobanteAction(formData(CAJA(cajaDelGasto.id)), como(esc.maestro));
        adjuntos.cierre = await adjuntarComprobanteAction(formData(CAJA(cierre.id)), como(esc.maestro));
        adjuntos.inexistente = await adjuntarComprobanteAction(formData(CAJA(inexistente)), como(esc.maestro));
        adjuntos.comoTienda = await adjuntarComprobanteAction(formData(TIENDA(cobroB.id)), como(tiendaB));

        // R79 en la BASE: el UNIQUE del destino, sin el pre-chequeo del servicio.
        const segundoPorRepo = await repo.crear(
          s.cliente,
          { caja: sueldo.id },
          { storagePath: "movimientos-caja/intruso.png", contentType: "image/png", subidoPor: esc.maestro.usuarioId },
        );

        const vistas: Record<string, VerComprobanteResult> = {};
        vistas.maestroSueldo = await verComprobanteAction({ destino: CAJA(sueldo.id) }, como(esc.maestro));
        vistas.tiendaASueldo = await verComprobanteAction({ destino: CAJA(sueldo.id) }, como(tiendaA));
        // Una fila de la caja SIN comprobante posible (la de un cierre): a la tienda, `no_encontrado`,
        // no `sin_comprobante` (que confirmaria que existe).
        vistas.tiendaACierre = await verComprobanteAction({ destino: CAJA(cierre.id) }, como(tiendaA));
        vistas.tiendaASuPago =await verComprobanteAction({ destino: TIENDA(filaPagoTiendaA.id) }, como(tiendaA));
        vistas.tiendaASuPagoPorDocumento = await verComprobanteAction(
          { destino: { documento: "liquidacion_pago", id: filaPagoTiendaA.origenId as string } },
          como(tiendaA),
        );
        vistas.tiendaBPagoDeA = await verComprobanteAction({ destino: TIENDA(filaPagoTiendaA.id) }, como(tiendaB));
        vistas.tiendaBDocumentoDeA = await verComprobanteAction(
          { destino: { documento: "liquidacion_pago", id: filaPagoTiendaA.origenId as string } },
          como(tiendaB),
        );
        vistas.tiendaBInexistente = await verComprobanteAction({ destino: TIENDA(inexistente) }, como(tiendaB));
        vistas.tiendaBSuCobro = await verComprobanteAction({ destino: TIENDA(cobroB.id) }, como(tiendaB));
        vistas.tiendaAGastoPropioSinComprobante = await verComprobanteAction(
          { destino: { documento: "pago_por_cuenta_tienda", id: pago.pago.id } },
          como(tiendaA),
        );
        vistas.tiendaBGastoDeA = await verComprobanteAction(
          { destino: { documento: "pago_por_cuenta_tienda", id: pago.pago.id } },
          como(tiendaB),
        );

        const filas = await tx.walletComprobante.findMany({
          where: { subidoPor: esc.maestro.usuarioId },
          select: { cajaMovimientoId: true, tiendaMovimientoId: true, liquidacionPagoId: true, storagePath: true, subidoPor: true },
        });
        return {
          adjuntos,
          subidasDelSegundo,
          vistas,
          filas: filas.map((f) => ({ caja: f.cajaMovimientoId, tienda: f.tiendaMovimientoId, pago: f.liquidacionPagoId, storagePath: f.storagePath, subidoPor: f.subidoPor })),
          segundoPorRepo,
          objetosVivos: [...vivos].sort(),
          subidas,
          maestroId: esc.maestro.usuarioId,
          ids: { sueldo: sueldo.id, pagoTiendaA: filaPagoTiendaA.origenId as string, filaPagoTiendaA: filaPagoTiendaA.id, cobroB: cobroB.id },
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R74/D6: adjuntar despues escribe UNA fila en la columna de SU destino (caja, tienda o pago de la 172), con quien la subio", () => {
    expect(m().adjuntos.sueldo).toEqual({ status: "ok" });
    expect(m().adjuntos.pagoTiendaA).toEqual({ status: "ok" });
    expect(m().adjuntos.cobroB).toEqual({ status: "ok" });
    const porDestino = m().filas.map((f) => [f.caja, f.tienda, f.pago]).sort();
    expect(porDestino).toEqual(
      [
        [m().ids.sueldo, null, null],
        [null, m().ids.cobroB, null],
        [null, null, m().ids.pagoTiendaA],
      ].sort(),
    );
    for (const f of m().filas) expect(f.subidoPor).toBe(m().maestroId);
    const carpetas = m().filas.map((f) => f.storagePath.split("/")[0]).sort();
    expect(carpetas).toEqual(["cobros-tienda", "movimientos-caja", "pagos"]);
  });

  it("R79: el segundo comprobante del mismo destino es `ya_tiene`, sin subir nada; y la BASE lo impide aunque se salte el servicio", () => {
    expect(m().adjuntos.sueldoOtraVez).toEqual({ status: "ya_tiene" });
    expect(m().subidasDelSegundo).toBe(0);
    expect(m().segundoPorRepo).toBe("ya_tiene");
    expect(m().filas.filter((f) => f.caja === m().ids.sueldo)).toHaveLength(1);
  });

  it("R76: no queda ningun objeto huerfano: los vivos son exactamente los de las filas", () => {
    expect(m().objetosVivos).toEqual(m().filas.map((f) => f.storagePath).sort());
    expect(m().subidas).toBe(3);
  });

  it("D6: el pago de un gasto lo lleva en SU documento; lo que produce un cierre no admite; lo inexistente, `no_encontrado`; una tienda no adjunta", () => {
    expect(m().adjuntos.pagoDeUnGasto).toEqual({ status: "no_admite", motivo: "en_su_documento" });
    expect(m().adjuntos.cierre).toEqual({ status: "no_admite", motivo: "no_admite" });
    expect(m().adjuntos.inexistente).toEqual({ status: "no_encontrado" });
    expect(m().adjuntos.comoTienda).toEqual({ status: "forbidden" });
  });

  it("R77/R80: el acceso total ve el comprobante por un enlace temporal con su rotulo; la ruta no viaja fuera de la URL", () => {
    const r = m().vistas.maestroSueldo;
    expect(r).toMatchObject({ status: "ok", contentType: "image/png", rotulo: { fuente: "caja", categoria: "egreso_sueldo" } });
    if (r.status !== "ok") throw new Error("inalcanzable");
    expect(r.url).toMatch(/^https:\/\/firmada\.test\/movimientos-caja\/.+\?ttl=\d+$/);
    expect(r.rotulo.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(r.rotulo)).not.toContain("movimientos-caja");
  });

  it("R78: la tienda ve el comprobante de SU pago, por la fila de su libro y por el documento; y el de SU cobro", () => {
    expect(m().vistas.tiendaASuPago).toMatchObject({ status: "ok", rotulo: { fuente: "documento", categoria: "liquidacion_pago" } });
    expect(m().vistas.tiendaASuPagoPorDocumento).toMatchObject({ status: "ok" });
    expect(m().vistas.tiendaBSuCobro).toMatchObject({ status: "ok", rotulo: { fuente: "tienda", categoria: "cobro_manual" } });
    expect(m().vistas.tiendaAGastoPropioSinComprobante).toEqual({ status: "sin_comprobante" });
  });

  it("R77/R78: la tienda NO ve la caja ni lo de otra tienda, y lo ajeno se responde IGUAL que lo inexistente", () => {
    const NO = { status: "no_encontrado" };
    expect(m().vistas.tiendaASueldo).toEqual(NO);
    expect(m().vistas.tiendaACierre).toEqual(NO);
    expect(m().vistas.tiendaBPagoDeA).toEqual(NO);
    expect(m().vistas.tiendaBDocumentoDeA).toEqual(NO);
    expect(m().vistas.tiendaBGastoDeA).toEqual(NO);
    expect(m().vistas.tiendaBInexistente).toEqual(NO);
  });

  it("R79: no hay superficie para reemplazar ni borrar: el borde exporta SOLO adjuntar y ver", () => {
    expect(Object.keys(acciones).sort()).toEqual(["adjuntarComprobanteAction", "verComprobanteAction"]);
  });
});
