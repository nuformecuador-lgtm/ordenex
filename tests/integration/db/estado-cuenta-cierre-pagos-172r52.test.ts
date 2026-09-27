import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { cierresDeLaCuentaAction } from "@/lib/actions/wallet-filtros";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import type { CierresDeLaCuentaResult } from "@/lib/types/wallet-filtros";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO, VerEstadoCuentaResult } from "@/lib/types/estado-cuenta";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, type Catalogo459 } from "./_fixtures/caja-459";
import { T4, leerEstadoCuenta, montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-D (revision B1) — 172 R52 en el ESTADO DE CUENTA del mensajero, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// 172 R52: «MIENTRAS el desglose de un mensajero esté filtrado por un cierre, el sistema DEBE incluir
// en él los pagos registrados contra ese cierre y sus anulaciones». El desglose retirado lo cumplia
// (`PagoMensajeroMovimientoRepository.buildFiltrosWhere`); el estado de cuenta que lo sustituye en
// `/wallet/mensajeros/[id]` lo cumple en `EstadoCuentaRepository` (`cierreDeMensajeroSql`).
//
// Los pagos son REALES: los escribe `LiquidacionService` (documento `liquidacion_pago` con su
// `cierre_id`, movimiento `liquidacion` y, al anular, el documento `liquidacion_anulacion` y el
// contra-asiento `ajuste_devengo`). Los cierres son filas de `cierre_dia` aprobadas.
//
// Escenario (mensajero M del escenario de la 458, que ya trae 6 filas a mano de OTROS cierres y dos
// `pago_mensajero` SIN documento, que no deben colarse):
//   cierre A  aprobado, P 4 500 / E 2 000 → feed: devengo 4 500 + pago_efectivo 2 000
//             pago A1 1 000 contra A → ANULADO («Monto equivocado 52»)
//             pago A2   500 contra A → vigente
//   cierre B  aprobado, P 1 500 / E 0     → feed: devengo 1 500
//             pago B1   300 contra B     → NO debe salir al filtrar por A
//   mensajero N, cierre N con un pago de 200 → filtrar a M por el cierre de N da 0 filas.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Medida {
  ids: {
    feedA: string[];
    pagoA1: string;
    anulacionA1: string;
    pagoA2: string;
    pagoB1: string;
    pagoN: string;
  };
  enteroM: EstadoCuentaDTO;
  cierreA: EstadoCuentaDTO;
  cierreB: EstadoCuentaDTO;
  cierreNSobreM: EstadoCuentaDTO;
  cierreN: EstadoCuentaDTO;
  porLaAction: VerEstadoCuentaResult;
  cierres: { A: string; B: string };
  selector: CierresDeLaCuentaResult;
}

async function crearCierreAprobado(
  tx: TxDeTest,
  cat: Catalogo459,
  mensajeroId: string,
  totales: { pago: string; efectivo: string },
): Promise<string> {
  const id = randomUUID();
  await tx.cierreDia.create({
    data: {
      id,
      mensajeroId,
      estado: "aprobado",
      destinoTipo: "bodega_central",
      destinoZonaId: cat.centralZonaId,
      solicitadoAt: T4,
      totalPagoMensajero: totales.pago,
      totalEfectivo: totales.efectivo,
    },
  });
  return id;
}

/** Lo que el feed del mensajero escribe AL APROBAR un cierre (devengo y, si hubo efectivo, su pago). */
async function feedDelCierre(
  tx: TxDeTest,
  mensajeroId: string,
  cierreId: string,
  totales: { pago: string; efectivo: string },
): Promise<string[]> {
  const ids: string[] = [];
  const filas = [
    { tipo: "devengo" as const, categoria: "pago_devengado" as const, monto: totales.pago },
    ...(totales.efectivo === "0.00"
      ? []
      : [{ tipo: "pago" as const, categoria: "pago_efectivo" as const, monto: totales.efectivo }]),
  ];
  for (const [i, f] of filas.entries()) {
    const fila = await tx.pagoMensajeroMovimiento.create({
      data: {
        mensajeroId,
        tipo: f.tipo,
        categoria: f.categoria,
        monto: f.monto,
        origenTipo: "cierre_dia",
        origenId: cierreId,
        descripcion: `172r52 ${f.categoria}`,
        registradoPor: null,
        fechaMovimiento: new Date(T4.getTime() + 60_000 + i * 1000),
        createdAt: new Date(T4.getTime() + 60_000 + i * 1000),
      },
      select: { id: true },
    });
    ids.push(fila.id);
  }
  return ids;
}

describeSiHayBase("458-D B1 — 172 R52: el filtro por cierre del mensajero trae los pagos de ese cierre y sus anulaciones (Postgres)", () => {
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
        const esc = await sembrarEscenario458(tx, cat);
        const ec = montarEstadoCuenta(s);
        const M = esc.mensajeroM;
        const sufijo = randomUUID().slice(0, 8);
        const hoy = "2026-09-20";

        const totA = { pago: "4500.00", efectivo: "2000.00" };
        const totB = { pago: "1500.00", efectivo: "0.00" };
        const cierreA = await crearCierreAprobado(tx, cat, M, totA);
        const cierreB = await crearCierreAprobado(tx, cat, M, totB);
        const feedA = await feedDelCierre(tx, M, cierreA, totA);
        await feedDelCierre(tx, M, cierreB, totB);

        // Otro mensajero N con su cierre y un pago REAL.
        const N = (
          await tx.usuario.create({
            data: {
              nombre: `MensajeroN 172r52 ${sufijo}`,
              email: `mensajeron-172r52-${sufijo}@example.test`,
              telefono: "88880000",
              passwordHash: "no-se-usa",
              cedula: `172r52-N-${sufijo}`,
              tipoIdentificacionId: cat.tipoIdentificacionId,
              rolId: cat.rolId.mensajero,
              estado: "activo",
              fulfillment: false,
            },
            select: { id: true },
          })
        ).id;
        const totN = { pago: "800.00", efectivo: "0.00" };
        const cierreN = await crearCierreAprobado(tx, cat, N, totN);
        await feedDelCierre(tx, N, cierreN, totN);

        // Los pagos, por el SERVICIO REAL de la 172.
        const pagar = async (cierreId: string, monto: string) => {
          const clave = randomUUID();
          const r = await s.liquidacion.registrarPagoMensajero(
            { claveIdempotencia: clave, cierreId, monto, metodo: "efectivo", fechaPago: hoy },
            esc.maestro,
          );
          if (r.status !== "ok") throw new Error(`pago contra ${cierreId}: ${JSON.stringify(r)}`);
          const doc = await tx.liquidacionPago.findUniqueOrThrow({
            where: { claveIdempotencia: clave },
            select: { id: true, cierreId: true },
          });
          if (doc.cierreId !== cierreId) throw new Error("el documento del pago no quedo atado a su cierre");
          return doc.id;
        };
        const movDe = async (pagoId: string, categoria: "liquidacion" | "ajuste_devengo") =>
          (
            await tx.pagoMensajeroMovimiento.findFirstOrThrow({
              where: { origenTipo: "pago_mensajero", origenId: pagoId, categoria },
              select: { id: true },
            })
          ).id;

        const docA1 = await pagar(cierreA, "1000.00");
        const anulacion = await s.liquidacion.anularPago({ pagoId: docA1, motivo: "Monto equivocado 52" }, esc.maestro);
        if (anulacion.status !== "ok") throw new Error(`anular A1: ${JSON.stringify(anulacion)}`);
        const docA2 = await pagar(cierreA, "500.00");
        const docB1 = await pagar(cierreB, "300.00");
        const docN = await pagar(cierreN, "200.00");

        const cuentaM = { tipo: "mensajero" as const, id: M };
        const leer = (input: Parameters<typeof leerEstadoCuenta>[2]) => leerEstadoCuenta(ec, esc.maestro, input);
        const maestro: Actor = esc.maestro;
        return {
          ids: {
            feedA,
            pagoA1: await movDe(docA1, "liquidacion"),
            anulacionA1: await movDe(docA1, "ajuste_devengo"),
            pagoA2: await movDe(docA2, "liquidacion"),
            pagoB1: await movDe(docB1, "liquidacion"),
            pagoN: await movDe(docN, "liquidacion"),
          },
          enteroM: await leer({ cuenta: cuentaM }),
          cierreA: await leer({ cuenta: cuentaM, cierreId: cierreA }),
          cierreB: await leer({ cuenta: cuentaM, cierreId: cierreB }),
          cierreNSobreM: await leer({ cuenta: cuentaM, cierreId: cierreN }),
          cierreN: await leer({ cuenta: { tipo: "mensajero", id: N }, cierreId: cierreN }),
          cierres: { A: cierreA, B: cierreB },
          selector: await cierresDeLaCuentaAction(
            { cuenta: "mensajero", mensajeroId: M },
            { getActor: async () => maestro, service: new FiltrosWalletService(new FiltrosWalletRepository(tx as never)) },
          ),
          porLaAction: await verEstadoCuentaAction(
            { cuenta: cuentaM, cierreId: cierreA, page: 1, pageSize: 50 },
            { getActor: async () => maestro, service: ec },
          ),
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const idDe = (f: FilaEstadoCuentaDTO) => (f.ref !== null && "movimientoId" in f.ref ? f.ref.movimientoId : "");

  it("172 R52: filtrado por el cierre A trae sus dos filas del cierre, sus dos pagos y la anulacion del primero, y NADA mas", () => {
    const { ids, cierreA } = m();
    expect(cierreA.filas.map(idDe).sort()).toEqual(
      [...ids.feedA, ids.pagoA1, ids.anulacionA1, ids.pagoA2].sort(),
    );
    expect(cierreA.total).toBe(5);
    // Ni el pago contra OTRO cierre del mismo mensajero, ni el de otro mensajero.
    expect(cierreA.filas.map(idDe)).not.toContain(ids.pagoB1);
    expect(cierreA.filas.map(idDe)).not.toContain(ids.pagoN);
  });

  it("172 R52: el pago anulado sale ANULADO con su motivo, y su anulacion como contra-asiento", () => {
    const { ids, cierreA } = m();
    const pago = cierreA.filas.find((f) => idDe(f) === ids.pagoA1);
    const contra = cierreA.filas.find((f) => idDe(f) === ids.anulacionA1);
    expect(pago?.anulacion?.motivo).toBe("Monto equivocado 52");
    expect(pago?.cargo).toBe("1000.00");
    expect(contra?.esContraAsiento).toBe(true);
    expect(contra?.abono).toBe("1000.00");
    const vigente = cierreA.filas.find((f) => idDe(f) === ids.pagoA2);
    expect(vigente?.anulacion).toBeNull();
    expect(vigente?.pago).toEqual({ metodo: "efectivo", referencia: null });
  });

  it("172 R52: el cierre B trae su pago y no los del A; por la action, lo mismo que por el servicio", () => {
    const { ids, cierreB, cierreA, porLaAction } = m();
    expect(cierreB.filas.map(idDe)).toContain(ids.pagoB1);
    expect(cierreB.filas.map(idDe)).not.toContain(ids.pagoA2);
    expect(cierreB.total).toBe(2);
    if (porLaAction.status !== "ok") throw new Error(`se esperaba ok: ${JSON.stringify(porLaAction)}`);
    expect(porLaAction.estado.filas.map(idDe)).toEqual(cierreA.filas.map(idDe));
  });

  it("R12: la cuenta siempre en el WHERE — el cierre de OTRO mensajero, sobre M, da 0 filas (y sobre N trae su pago)", () => {
    const { ids, cierreNSobreM, cierreN } = m();
    expect(cierreNSobreM.filas).toEqual([]);
    expect(cierreNSobreM.total).toBe(0);
    // No-vacuidad: ese cierre SI tiene un pago, y lo ve su mensajero.
    expect(cierreN.filas.map(idDe)).toContain(ids.pagoN);
  });

  it("R21: el corrido de cada fila filtrada es el de la cuenta ENTERA", () => {
    const { enteroM, cierreA } = m();
    const corrido = new Map(enteroM.filas.map((f) => [idDe(f), f.saldoCorrido]));
    for (const f of cierreA.filas) expect(f.saldoCorrido).toBe(corrido.get(idDe(f)));
    expect(cierreA.saldoActual).toBe(enteroM.saldoActual);
  });

  it("R11 + 172 R52: el selector de cierres dice los MISMOS movimientos que trae el filtro (pagos y anulaciones incluidos)", () => {
    const { selector, cierres, cierreA, cierreB } = m();
    if (selector.status !== "ok") throw new Error(`selector: ${JSON.stringify(selector)}`);
    const de = (id: string) => selector.opciones.find((o) => o.cierreId === id)?.movimientos;
    expect(de(cierres.A)).toBe(5);
    expect(de(cierres.A)).toBe(cierreA.total);
    expect(de(cierres.B)).toBe(2);
    expect(de(cierres.B)).toBe(cierreB.total);
  });
});
