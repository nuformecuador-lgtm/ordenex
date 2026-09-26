import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletComprobanteRepository } from "@/lib/repositories/WalletComprobanteRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaCobroTiendaFeedService } from "@/lib/services/CajaCobroTiendaFeedService";
import { AjusteCajaService } from "@/lib/services/AjusteCajaService";
import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import { WalletService } from "@/lib/services/WalletService";
import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B — revision M1: `tieneComprobante` de la CORRECCION de caja y del COBRO de Ordenex a
// una tienda lo decide la base (`wallet_comprobante`), no un `false` fijo. Contra Postgres: se
// registran, por sus actions con `FormData`, una correccion y un cobro CON comprobante y otros dos
// SIN; se leen por los lectores del libro (el WHERE vive en el repositorio) y por
// `WalletService.listarMovimientos`, que es lo que la pantalla consume.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "c.png", { type: "image/png" });

function fd(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

interface Medida {
  status: Record<string, string>;
  lector: { ajustes: EstadoDocumentoCaja[]; cobros: EstadoDocumentoCaja[] };
  libro: Record<string, WalletMovimientoDTO["documento"] | null>;
  ids: Record<string, string>;
  /** m6: `adjuntar` sobre movimientos anulados (y un control sin anular). */
  adjuntar: Record<string, unknown>;
  anulaciones: Record<string, string>;
}

describeSiHayBase("458-B/M1 — «tiene comprobante» de la correccion y del cobro lo decide la base (Postgres real)", () => {
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
        const storage: IFileStorage = { upload: async ({ path }) => path, remove: async () => undefined };
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
        const wallet = new WalletService(cajaRepo, c, new AporteCapitalRepository(c), {} as never, puerto);
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
        const getActor = async () => actor;
        const claves: Record<string, string> = {};
        const clave = (n: string) => (claves[n] = randomUUID());
        const status: Record<string, string> = {};

        const correccion = (n: string, conComprobante: boolean) =>
          registrarMovimientoManualAction(
            fd({
              tipo: "egreso",
              categoria: "egreso_ajuste",
              monto: "12.00",
              descripcion: `Faltante ${n}`,
              claveIdempotencia: clave(n),
              ...(conComprobante ? { comprobante: png() } : {}),
            }),
            { getActor, service: wallet },
          );
        const cobrar = (n: string, conComprobante: boolean) =>
          registrarCobroTiendaAction(
            fd({
              claveIdempotencia: clave(n),
              tiendaId: esc.tiendaB,
              monto: "5.00",
              descripcion: `Bolsas ${n}`,
              ...(conComprobante ? { comprobante: png() } : {}),
            }),
            { getActor, service: cobro },
          );
        status.correccionCon = (await correccion("correccionCon", true)).status;
        status.correccionSin = (await correccion("correccionSin", false)).status;
        status.cobroCon = (await cobrar("cobroCon", true)).status;
        status.cobroSin = (await cobrar("cobroSin", false)).status;

        const ids: Record<string, string> = {};
        for (const n of ["correccionCon", "correccionSin"]) {
          ids[n] = (await tx.walletMovimiento.findFirstOrThrow({ where: { claveIdempotencia: claves[n] }, select: { id: true } })).id;
        }
        for (const n of ["cobroCon", "cobroSin"]) {
          ids[n] = (await tx.walletTiendaMovimiento.findFirstOrThrow({ where: { claveIdempotencia: claves[n] }, select: { id: true } })).id;
        }

        // El WHERE donde vive: los dos lectores, en lote.
        const lector = {
          ajustes: await new AjusteCajaAnulacionRepository(c).estadoDeDocumentos([ids.correccionCon, ids.correccionSin]),
          cobros: await new CobroTiendaAnulacionRepository(c).estadoDeDocumentos([ids.cobroCon, ids.cobroSin]),
        };

        // Y lo que la pantalla recibe: el `documento` de cada fila del libro de la caja.
        const libro: Medida["libro"] = {};
        const ajustes = await s.wallet.listarMovimientos({ page: 1, pageSize: 100, categoria: "egreso_ajuste" }, actor);
        const cargos = await s.wallet.listarMovimientos({ page: 1, pageSize: 100, categoria: "ingreso_cobro_tienda" }, actor);
        if (ajustes.status !== "ok" || cargos.status !== "ok") throw new Error("el libro no respondio ok");
        for (const n of ["correccionCon", "correccionSin"]) {
          libro[n] = ajustes.data.movimientos.find((x) => x.id === ids[n])?.documento ?? null;
        }
        for (const n of ["cobroCon", "cobroSin"]) {
          libro[n] = cargos.data.movimientos.find((x) => x.origenId === ids[n])?.documento ?? null;
        }
        // ── m6: `adjuntar` rechaza un movimiento ANULADO, en los cuatro caminos laterales ─────────
        const anulaciones: Record<string, string> = {};
        const egresos = new WalletEgresoService(cajaRepo, c, puerto);
        const sueldo = await registrarEgresoAdministrativoAction(
          { tipoEgreso: "sueldo", monto: "30.00", descripcion: "Sueldo m6", claveIdempotencia: clave("sueldo") },
          { getActor, service: egresos },
        );
        const control = await registrarEgresoAdministrativoAction(
          { tipoEgreso: "sueldo", monto: "31.00", descripcion: "Sueldo control m6", claveIdempotencia: clave("control") },
          { getActor, service: egresos },
        );
        status.sueldo = sueldo.status;
        status.control = control.status;
        ids.sueldo = (await tx.walletMovimiento.findFirstOrThrow({ where: { claveIdempotencia: claves.sueldo }, select: { id: true } })).id;
        ids.control = (await tx.walletMovimiento.findFirstOrThrow({ where: { claveIdempotencia: claves.control }, select: { id: true } })).id;
        anulaciones.sueldo = (await s.egresoAnulacion.anular({ movimientoId: ids.sueldo, motivo: "m6" }, actor)).status;
        anulaciones.correccion = (
          await new AjusteCajaService(cajaRepo, new AjusteCajaAnulacionRepository(c), runTx).anular(
            { movimientoId: ids.correccionSin, motivo: "m6" },
            actor,
          )
        ).status;
        anulaciones.cobro = (await cobro.anular({ cobroId: ids.cobroSin, motivo: "m6" }, actor)).status;
        const pagoAnulado = await tx.liquidacionAnulacion.findFirstOrThrow({
          where: { pago: { tiendaId: { in: [esc.tiendaA, esc.tiendaB] } } },
          select: { pagoId: true },
        });
        const archivo = { contentType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };
        const adjuntar = {
          sueldo: await puerto.adjuntar({ libro: "caja", movimientoId: ids.sueldo }, archivo, actor),
          correccion: await puerto.adjuntar({ libro: "caja", movimientoId: ids.correccionSin }, archivo, actor),
          cobro: await puerto.adjuntar({ libro: "tienda", movimientoId: ids.cobroSin }, archivo, actor),
          pago: await puerto.adjuntar({ documento: "liquidacion_pago", id: pagoAnulado.pagoId }, archivo, actor),
          control: await puerto.adjuntar({ libro: "caja", movimientoId: ids.control }, archivo, actor),
        };
        return { status, lector, libro, ids, adjuntar, anulaciones };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("los registros responden ok", () => {
    expect(m().status).toEqual({
      correccionCon: "ok",
      correccionSin: "ok",
      cobroCon: "ok",
      cobroSin: "ok",
      sueldo: "ok",
      control: "ok",
    });
  });

  it("m6: `adjuntar` sobre un movimiento ANULADO responde `no_admite: anulado` en los cuatro caminos; sin anular, ok", () => {
    expect(m().anulaciones).toEqual({ sueldo: "ok", correccion: "ok", cobro: "ok" });
    const anulado = { status: "no_admite", motivo: "anulado" };
    expect(m().adjuntar).toEqual({ sueldo: anulado, correccion: anulado, cobro: anulado, pago: anulado, control: { status: "ok" } });
  });

  it("el lector de las correcciones: la que lleva comprobante `true`, la otra `false`", () => {
    const { lector, ids } = m();
    expect(lector.ajustes).toEqual([
      { id: ids.correccionCon, anulado: false, tieneComprobante: true },
      { id: ids.correccionSin, anulado: false, tieneComprobante: false },
    ]);
  });

  it("el lector de los cobros: el que lleva comprobante `true`, el otro `false`", () => {
    const { lector, ids } = m();
    expect(lector.cobros).toEqual([
      { id: ids.cobroCon, anulado: false, tieneComprobante: true },
      { id: ids.cobroSin, anulado: false, tieneComprobante: false },
    ]);
  });

  it("el libro de la caja entrega el mismo `tieneComprobante` en el documento de cada fila", () => {
    const { libro } = m();
    expect(libro.correccionCon?.tieneComprobante).toBe(true);
    expect(libro.correccionSin?.tieneComprobante).toBe(false);
    expect(libro.cobroCon?.tieneComprobante).toBe(true);
    expect(libro.cobroSin?.tieneComprobante).toBe(false);
    // No-vacuidad: las cuatro filas estan en el libro con su documento.
    expect(Object.values(libro).every((d) => d !== null)).toBe(true);
  });
});
