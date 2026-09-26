import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { anularEgresoCajaAction, anularMovimientoAction } from "@/lib/actions/wallet-anulacion";
import { autoriaDelLibroCajaAction } from "@/lib/actions/libro-caja-autoria";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { LibroCajaAutoriaRepository } from "@/lib/repositories/LibroCajaAutoriaRepository";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { LibroCajaAutoriaService } from "@/lib/services/LibroCajaAutoriaService";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { DocumentoCajaDTO, WalletMovimientoCategoria } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  montarServicios459,
  sembrarEscenario459,
} from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-C — REVISIÓN (B3 y M1), contra Postgres, sobre el escenario de la fase 0 de la 459 (todos
// los caminos que escriben en la caja, por sus servicios REALES).
//
// B3 (R71): el servidor ya ANULABA desde la caja el pago de Ordenex a una tienda (172) y el premio del
// ranking (293) (`WalletAnulacionService.rutaDeCaja`), pero sus filas llegaban al libro con
// `documento: null` y la pantalla decía «Vigente» aunque estuvieran anuladas. Ahora el libro
// (`WalletService.listarMovimientos`, la lectura REAL de /wallet) les da documento con el estado
// DERIVADO de la base: la `liquidacion_anulacion` del pago, el reverso de caja del premio. Sus
// contra-asientos siguen en `null`.
//
// M1 (R58): «quién anuló, cuándo y con qué motivo» y «cómo» (método y referencia) llegan al panel por la
// autoría de la fila (`autoriaDelLibroCajaAction`), leídos de la constancia de CADA documento. Los
// valores esperados se leen de las tablas (no de la función que se prueba) o son los literales que el
// escenario escribió.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Medida {
  documentos: Record<string, DocumentoCajaDTO | null | "no_esta">;
  autoria: Record<string, AutoriaDeFilaDTO | undefined>;
  maestro: string;
  hoy: string;
  diaAnulacionPremio: string;
  anularGasto: string;
}

describeSiHayBase("458-C revisión B3/M1 — el pago a una tienda y el premio en el libro; quién anuló y cómo (Postgres real)", () => {
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
      medida = await enTransaccionRevertida459(prisma, async (tx) => medir(tx, cat));
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: TxDeTest, cat: Awaited<ReturnType<typeof cargarCatalogo459>>): Promise<Medida> {
    const s = montarServicios459(tx);
    const esc = await sembrarEscenario459(tx, cat);
    const actor: Actor = esc.maestro;

    // Un gasto anulado por la vía UNIFORME (con constancia) y una referencia anotada a mano.
    const gasto = await tx.walletMovimiento.findFirstOrThrow({
      where: { categoria: "egreso_gasto_variable", registradoPor: actor.usuarioId },
      select: { id: true },
    });
    await tx.walletAnotacion.create({
      data: { movimientoId: gasto.id, contraparteNombre: "Cartonera del Valle", referencia: "FACT-458C" },
    });
    const anulado = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: gasto.id }, motivo: "Factura duplicada 458-C" },
      {
        getActor: async () => actor,
        router: new WalletAnulacionService(new WalletAnulacionDestinoRepository(s.cliente)),
        caminos: {
          egreso_caja: (movimientoId: string, motivo: string, a: Actor) =>
            anularEgresoCajaAction({ movimientoId, motivo }, { getActor: async () => a, egresos: s.egresoAnulacion }),
        },
      },
    );

    // Las filas del escenario, por lo que el ESCENARIO escribió (no por la función que se prueba).
    const pagoA = await tx.liquidacionPago.findFirstOrThrow({ where: { tiendaId: esc.tiendaA }, select: { id: true } });
    const pagoB = await tx.liquidacionPago.findFirstOrThrow({ where: { tiendaId: esc.tiendaB }, select: { id: true } });
    const fila = async (categoria: WalletMovimientoCategoria, origenTipo: string, origenId: string) =>
      tx.walletMovimiento.findFirstOrThrow({
        where: { categoria, origenTipo: origenTipo as never, origenId },
        select: { id: true, fechaMovimiento: true, createdAt: true },
      });
    const filas = {
      pagoAnulado: await fila("egreso_pago_tienda", "pago_tienda", pagoA.id),
      reversoPagoAnulado: await fila("ingreso_reverso_pago_tienda", "pago_tienda", pagoA.id),
      pagoVigente: await fila("egreso_pago_tienda", "pago_tienda", pagoB.id),
      premioAnulado: await fila("egreso_pago_mensajero", "ranking_snapshot_fila", esc.filaPremioId),
      reversoPremio: await fila("ingreso_ajuste", "ranking_snapshot_fila", esc.filaPremioId),
      gastoAnulado: { id: gasto.id },
    };

    // B3 — el libro REAL (lo que lee /wallet), acotado por categoría y, el premio, por su día.
    const buscar = async (categoria: WalletMovimientoCategoria, id: string, desde?: Date, hasta?: Date) => {
      const r = await s.wallet.listarMovimientos({ page: 1, pageSize: 100, categoria, desde, hasta }, actor);
      if (r.status !== "ok") throw new Error(`el libro no respondio ok: ${r.status}`);
      const f = r.data.movimientos.find((x) => x.id === id);
      return f === undefined ? ("no_esta" as const) : f.documento;
    };
    const diaPremio = filas.premioAnulado.fechaMovimiento;
    const documentos = {
      pagoAnulado: await buscar("egreso_pago_tienda", filas.pagoAnulado.id),
      pagoVigente: await buscar("egreso_pago_tienda", filas.pagoVigente.id),
      reversoPagoAnulado: await buscar("ingreso_reverso_pago_tienda", filas.reversoPagoAnulado.id),
      premioAnulado: await buscar(
        "egreso_pago_mensajero",
        filas.premioAnulado.id,
        new Date(diaPremio.getTime() - 60_000),
        new Date(diaPremio.getTime() + 60_000),
      ),
    };

    // M1 — la autoría de esas filas (la lectura del panel al abrir), sobre la tx.
    const servicio = new LibroCajaAutoriaService(new LibroCajaAutoriaRepository(s.cliente));
    const r = await autoriaDelLibroCajaAction(
      { movimientoIds: Object.values(filas).map((f) => f.id) },
      { getActor: async () => actor, service: servicio },
    );
    if (r.status !== "ok") throw new Error(`autoria: ${JSON.stringify(r)}`);
    const porId = new Map(r.filas.map((f) => [f.movimientoId, f]));
    const autoria = Object.fromEntries(Object.entries(filas).map(([k, f]) => [k, porId.get(f.id)]));

    const maestro = (await tx.usuario.findUniqueOrThrow({ where: { id: actor.usuarioId }, select: { nombre: true } })).nombre;
    return {
      documentos,
      autoria,
      maestro,
      hoy: fechaCalendarioCR(new Date()),
      diaAnulacionPremio: fechaCalendarioCR(filas.reversoPremio.createdAt),
      anularGasto: anulado.status,
    };
  }

  it("anti-vacuidad: el escenario sembró las cuatro filas y la anulación del gasto respondió ok", () => {
    expect(m().anularGasto).toBe("ok");
    for (const k of ["pagoAnulado", "pagoVigente", "reversoPagoAnulado", "premioAnulado"]) {
      expect(m().documentos[k], k).not.toBe("no_esta");
    }
  });

  it("B3/R71: el pago de Ordenex a una tienda ANULADO sale con documento anulado; el vigente, vigente", () => {
    expect(m().documentos.pagoAnulado).toEqual({ tipo: "pago_tienda", anulado: true, tieneComprobante: false });
    expect(m().documentos.pagoVigente).toEqual({ tipo: "pago_tienda", anulado: false, tieneComprobante: false });
  });

  it("B3/R71: el premio del ranking anulado sale anulado; el contra-asiento del pago NO lleva documento", () => {
    expect(m().documentos.premioAnulado).toEqual({ tipo: "premio_del_ranking", anulado: true, tieneComprobante: false });
    expect(m().documentos.reversoPagoAnulado).toBeNull();
  });

  it("M1/R58: el pago anulado dice quién lo anuló, el día y el motivo; y cómo se pagó", () => {
    const a = m().autoria.pagoAnulado;
    expect(a?.anulacion).toEqual({ motivo: "Se pago a la cuenta equivocada", por: m().maestro, fecha: m().hoy });
    expect(a?.como).toEqual({ metodo: "efectivo", referencia: null });
  });

  it("M1/R58: el pago vigente no tiene anulación y su «cómo» lleva la referencia del SINPE", () => {
    const a = m().autoria.pagoVigente;
    expect(a?.anulacion).toBeNull();
    expect(a?.como).toEqual({ metodo: "SINPE", referencia: "SINPE-459-B" });
  });

  it("M1/R58: el premio anulado dice quién, cuándo y el motivo (el de su reverso de caja)", () => {
    const a = m().autoria.premioAnulado;
    expect(a?.anulacion?.por).toBe(m().maestro);
    expect(a?.anulacion?.fecha).toBe(m().diaAnulacionPremio);
    expect(a?.anulacion?.motivo).toMatch(/Premio duplicado$/);
    expect(a?.como).toBeNull();
  });

  it("M1/R58: el gasto anulado por la vía uniforme: su constancia (quién, cuándo, motivo) y la referencia anotada", () => {
    const a = m().autoria.gastoAnulado;
    expect(a?.anulacion).toEqual({ motivo: "Factura duplicada 458-C", por: m().maestro, fecha: m().hoy });
    expect(a?.como).toEqual({ metodo: null, referencia: "FACT-458C" });
  });

  it("M1/R58: los contra-asientos no dicen «anulado por» aunque compartan origen con el documento", () => {
    expect(m().autoria.reversoPagoAnulado?.anulacion).toBeNull();
    expect(m().autoria.reversoPremio?.anulacion).toBeNull();
  });
});
