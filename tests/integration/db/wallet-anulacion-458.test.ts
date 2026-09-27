import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { anularCobroRechazoTiendaAction } from "@/lib/actions/rechazo-tienda-cobro";
import { anularEgresoCajaAction, anularMovimientoAction } from "@/lib/actions/wallet-anulacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import type { AnularMovimientoResult } from "@/lib/types/wallet-anulacion";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  leerCajaEntera,
  leerTienda,
  menos,
  montarServicios459,
  sembrarEscenario459,
  type LecturaCaja459,
} from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.8–TB.9 — LA ANULACION UNIFORME, por las ACTIONS, contra Postgres
// (R63–R69, R71–R73, R82). Sobre el escenario de la fase 0 de la 459 (servicios reales).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Todo corre dentro de UNA transaccion REPEATABLE READ que se revierte. Las actions reciben sus
// servicios cableados sobre esa transaccion (los mismos `buildService()` de produccion, con el
// cliente de la tx): se ejercen el schema `.strict()`, el enrutado por destino (con su repositorio
// real), los servicios de cada camino y la normalizacion de la respuesta. Las composition roots SIN
// inyectar se ejercen en `wallet-anulacion-concurrencia.test.ts`, con filas commiteadas.
//
// Lo que se mide:
//   · R63/R64/R68 — anular el cobro por rechazo (tienda A, 1 000 + 130) desde su linea en la caja:
//     2 reversos de cargo, 2 creditos espejo, constancia e historial; ganancia −1 130, «De las
//     tiendas» +1 130, «Entro», «Salio» y la cifra principal SIN cambio (sobre `derivarCaja` de las
//     filas reales, por `verResumenCaja`); R7 y R8 a 0,00.
//   · R73 — el cobro sigue `aprobado` y la cola de pendientes no lo ofrece.
//   · R66 — el segundo intento (desde el libro de la TIENDA) → `ya_anulado`, sin escribir nada mas.
//   · R63/R64 — anular el gasto variable (12 345,67): `ingreso_ajuste` por su monto; cifra y ganancia
//     suben; su fila del libro dice «anulado» aunque el contra-asiento NO este en la pagina (R71).
//   · R72 — el sueldo reversado por la via vieja (sin motivo): «anulado, motivo no registrado», y
//     anularlo ahora responde `ya_anulado` sin dejar constancia.
//   · D8 — la indemnizacion por incidente se anula con origen el incidente.
//   · R65 — una fila del cierre → `no_anulable` (nace_de_un_cierre); un contra-asiento → `contra_asiento`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const COBRO_RECHAZO = "1130.00"; // 1 000,00 + 130,00 (escenario 459, tienda A)
const GASTO_VARIABLE = "12345.67";
const INDEMNIZACION = "700.00";

interface Medida {
  antes: LecturaCaja459;
  trasRechazo: LecturaCaja459;
  saldoAAntes: string;
  saldoATras: string;
  saldoBTras: string;
  saldoBAntes: string;
  respuestas: Record<string, AnularMovimientoResult | { status: string }>;
  cajaDelRechazo: string[];
  tiendaDelRechazo: string[];
  estadoDelCobro: string;
  pendientesConElCobro: number;
  constanciasRechazo: number;
  historialRechazo: number;
  trasGasto: LecturaCaja459;
  reversoDelGasto: string[];
  historialEgreso: number;
  documentoGasto: WalletMovimientoDTO["documento"];
  documentoSueldo: WalletMovimientoDTO["documento"];
  documentosRechazo: WalletMovimientoDTO["documento"][];
  constanciasSueldo: number;
  reversoIndemnizacion: string[];
  cajaTrasSegundoIntento: number;
}

describeSiHayBase("⭑ 458-B/TB.9 — la anulacion uniforme por las actions (Postgres real)", () => {
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
    const getActor = async () => actor;
    // Las actions, cableadas sobre la tx (los mismos servicios que su `buildService()`).
    const deps = {
      getActor,
      router: new WalletAnulacionService(new WalletAnulacionDestinoRepository(s.cliente)),
      caminos: {
        rechazo_tienda_cobro: (cobroId: string, motivo: string, a: Actor) =>
          anularCobroRechazoTiendaAction({ cobroId, motivo }, { getActor: async () => a, service: s.rechazoCobro }),
        egreso_caja: (movimientoId: string, motivo: string, a: Actor) =>
          anularEgresoCajaAction({ movimientoId, motivo }, { getActor: async () => a, egresos: s.egresoAnulacion }),
      },
    };
    const respuestas: Medida["respuestas"] = {};

    // ── 1. El cobro por rechazo, desde su linea de FLETE en la caja ─────────────────────────
    const antes = await leerCajaEntera(s, actor);
    const saldoAAntes = (await leerTienda(s, actor, esc.tiendaA)).saldo;
    const saldoBAntes = (await leerTienda(s, actor, esc.tiendaB)).saldo;
    const lineaFlete = await tx.walletMovimiento.findFirstOrThrow({
      where: { origenTipo: "gestion_orden", categoria: "ingreso_flete_devolucion", registradoPor: actor.usuarioId },
      select: { id: true, origenId: true },
    });
    respuestas.rechazo = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: lineaFlete.id }, motivo: "Se cobró por un rechazo que no fue" },
      deps,
    );
    const gestionId = lineaFlete.origenId as string;
    const trasRechazo = await leerCajaEntera(s, actor);
    const saldoATras = (await leerTienda(s, actor, esc.tiendaA)).saldo;
    const saldoBTras = (await leerTienda(s, actor, esc.tiendaB)).saldo;
    const filas = (xs: { categoria: string; monto: Prisma.Decimal; tipo: string }[]) =>
      xs.map((x) => `${x.tipo}|${x.categoria}|${x.monto.toFixed(2)}`).sort();
    const cajaDelRechazo = filas(
      await tx.walletMovimiento.findMany({ where: { origenTipo: "gestion_orden", origenId: gestionId } }),
    );
    const tiendaDelRechazo = filas(
      await tx.walletTiendaMovimiento.findMany({ where: { origenTipo: "gestion_orden", origenId: gestionId } }),
    );
    const cobro = await tx.rechazoTiendaCobro.findUniqueOrThrow({ where: { gestionId }, select: { id: true, estado: true } });
    const pendientes = await s.rechazoCobro.listarPendientes(actor);
    const pendientesConElCobro =
      pendientes.status === "ok" ? pendientes.items.filter((i) => i.id === cobro.id).length : -1;
    const constanciasRechazo = await tx.rechazoTiendaCobroAnulacion.count({ where: { cobroId: cobro.id } });
    const historialRechazo = await tx.historialAccion.count({
      where: { accion: "cobro_rechazo_tienda_anulado", entidadId: cobro.id },
    });

    // ── 2. Segundo intento, desde el DEBITO de la tienda (R66) ──────────────────────────────
    const debito = await tx.walletTiendaMovimiento.findFirstOrThrow({
      where: { origenTipo: "gestion_orden", origenId: gestionId, categoria: "flete_devolucion" },
      select: { id: true },
    });
    const cajaAntesDelSegundo = await tx.walletMovimiento.count();
    respuestas.rechazoOtraVez = await anularMovimientoAction(
      { destino: { libro: "tienda", movimientoId: debito.id }, motivo: "otra vez" },
      deps,
    );
    const cajaTrasSegundoIntento = (await tx.walletMovimiento.count()) - cajaAntesDelSegundo;

    // ── 3. El gasto variable (R63/R64/R71) ─────────────────────────────────────────────────
    const gasto = await tx.walletMovimiento.findFirstOrThrow({
      where: { categoria: "egreso_gasto_variable", registradoPor: actor.usuarioId },
      select: { id: true },
    });
    respuestas.gasto = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: gasto.id }, motivo: "Factura duplicada" },
      deps,
    );
    const trasGasto = await leerCajaEntera(s, actor);
    const reversoDelGasto = (
      await tx.walletMovimiento.findMany({ where: { origenTipo: "gasto", origenId: gasto.id } })
    ).map((f) => `${f.tipo}|${f.categoria}|${f.monto.toFixed(2)}|${f.descripcion}`);
    const historialEgreso = await tx.historialAccion.count({ where: { accion: "egreso_caja_anulado", entidadId: gasto.id } });
    // R71: la pagina SOLO trae gastos variables (el contra-asiento es un ingreso: no esta en ella).
    const paginaGastos = await s.wallet.listarMovimientos({ page: 1, pageSize: 100, categoria: "egreso_gasto_variable" }, actor);
    const documentoGasto =
      paginaGastos.status === "ok" ? (paginaGastos.data.movimientos.find((x) => x.id === gasto.id)?.documento ?? null) : null;

    // ── 4. El sueldo reversado por la via vieja (R72) ──────────────────────────────────────
    const sueldo = await tx.walletMovimiento.findFirstOrThrow({
      where: { categoria: "egreso_sueldo", registradoPor: actor.usuarioId },
      select: { id: true },
    });
    const paginaSueldos = await s.wallet.listarMovimientos({ page: 1, pageSize: 100, categoria: "egreso_sueldo" }, actor);
    const documentoSueldo =
      paginaSueldos.status === "ok" ? (paginaSueldos.data.movimientos.find((x) => x.id === sueldo.id)?.documento ?? null) : null;
    respuestas.sueldo = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: sueldo.id }, motivo: "ya estaba" },
      deps,
    );
    const constanciasSueldo = await tx.ajusteCajaAnulacion.count({ where: { movimientoId: sueldo.id } });

    // R71: las DOS lineas del rechazo dicen «anulado» (filtro por su categoria: el reverso no esta).
    const paginaRechazo = await s.wallet.listarMovimientos({ page: 1, pageSize: 200, categoria: "ingreso_flete_devolucion" }, actor);
    const paginaIva = await s.wallet.listarMovimientos({ page: 1, pageSize: 200, categoria: "ingreso_iva_flete_devolucion" }, actor);
    const documentosRechazo = [paginaRechazo, paginaIva].map((p) =>
      p.status === "ok" ? (p.data.movimientos.find((x) => x.origenId === gestionId)?.documento ?? null) : null,
    );

    // ── 5. La indemnizacion por incidente (D8) ─────────────────────────────────────────────
    const incidenteId = randomUUID();
    const indemnizacion = await tx.walletMovimiento.create({
      data: {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: new Prisma.Decimal(INDEMNIZACION),
        origenTipo: "orden_incidente",
        origenId: incidenteId,
      },
      select: { id: true },
    });
    respuestas.indemnizacion = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: indemnizacion.id }, motivo: "Se pagó por error" },
      deps,
    );
    const reversoIndemnizacion = (
      await tx.walletMovimiento.findMany({ where: { origenTipo: "orden_incidente", origenId: incidenteId } })
    )
      .map((f) => `${f.tipo}|${f.categoria}|${f.monto.toFixed(2)}`)
      .sort();

    // ── 6. R65: lo que no se anula ────────────────────────────────────────────────────────
    const delCierre = await tx.walletMovimiento.findFirstOrThrow({
      where: { origenTipo: "cierre_dia", origenId: esc.cierreId, categoria: "ingreso_flete" },
      select: { id: true },
    });
    respuestas.delCierre = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: delCierre.id }, motivo: "x" },
      deps,
    );
    const reverso = await tx.walletMovimiento.findFirstOrThrow({
      where: { origenTipo: "gasto", origenId: gasto.id, categoria: "ingreso_ajuste" },
      select: { id: true },
    });
    respuestas.contraAsiento = await anularMovimientoAction(
      { destino: { libro: "caja", movimientoId: reverso.id }, motivo: "x" },
      deps,
    );

    return {
      antes,
      trasRechazo,
      saldoAAntes,
      saldoATras,
      saldoBAntes,
      saldoBTras,
      respuestas,
      cajaDelRechazo,
      tiendaDelRechazo,
      estadoDelCobro: cobro.estado,
      pendientesConElCobro,
      constanciasRechazo,
      historialRechazo,
      trasGasto,
      reversoDelGasto,
      historialEgreso,
      documentoGasto,
      documentoSueldo,
      documentosRechazo,
      constanciasSueldo,
      reversoIndemnizacion,
      cajaTrasSegundoIntento,
    };
  }

  const d = (a: LecturaCaja459, b: LecturaCaja459, f: (l: LecturaCaja459) => string) => menos(f(b), f(a));

  it("las respuestas: cada anulacion por su camino; el segundo intento `ya_anulado`; lo del cierre y los contra-asientos `no_anulable`", () => {
    expect(m().respuestas).toEqual({
      rechazo: { status: "ok", camino: "rechazo_tienda_cobro" },
      rechazoOtraVez: { status: "ya_anulado", camino: "rechazo_tienda_cobro" },
      gasto: { status: "ok", camino: "egreso_caja" },
      sueldo: { status: "ya_anulado", camino: "egreso_caja" },
      indemnizacion: { status: "ok", camino: "egreso_caja" },
      delCierre: { status: "no_anulable", motivo: "nace_de_un_cierre" },
      contraAsiento: { status: "no_anulable", motivo: "contra_asiento" },
    });
  });

  it("R64: el cobro por rechazo deja DOS reversos de cargo y DOS creditos espejo, cada uno por el monto de su original", () => {
    expect(m().cajaDelRechazo).toEqual([
      "egreso|egreso_reverso_flete_devolucion|1000.00",
      "egreso|egreso_reverso_iva_flete_devolucion|130.00",
      "ingreso|ingreso_flete_devolucion|1000.00",
      "ingreso|ingreso_iva_flete_devolucion|130.00",
    ]);
    expect(m().tiendaDelRechazo).toEqual([
      "credito|flete_devolucion_anulado|1000.00",
      "credito|iva_flete_devolucion_anulado|130.00",
      "debito|flete_devolucion|1000.00",
      "debito|iva_flete_devolucion|130.00",
    ]);
    expect(m().constanciasRechazo).toBe(1);
    expect(m().historialRechazo).toBe(1);
  });

  it("R68: ganancia −1 130,00 y «De las tiendas» +1 130,00; «Entro», «Salio», la cifra principal y el capital NO cambian; la tienda A sube 1 130,00", () => {
    const { antes, trasRechazo } = m();
    expect({
      ganancia: d(antes, trasRechazo, (l) => l.resumen.ganancia),
      deTerceros: d(antes, trasRechazo, (l) => l.resumen.deTerceros),
      enCaja: d(antes, trasRechazo, (l) => l.resumen.enCaja),
      entradas: d(antes, trasRechazo, (l) => l.resumen.entradas),
      salidas: d(antes, trasRechazo, (l) => l.resumen.salidas),
      capital: d(antes, trasRechazo, (l) => l.resumen.capital),
    }).toEqual({
      ganancia: `-${COBRO_RECHAZO}`,
      deTerceros: COBRO_RECHAZO,
      enCaja: "0.00",
      entradas: "0.00",
      salidas: "0.00",
      capital: "0.00",
    });
    expect(menos(m().saldoATras, m().saldoAAntes)).toBe(COBRO_RECHAZO);
    expect(menos(m().saldoBTras, m().saldoBAntes)).toBe("0.00");
  });

  it("R68/R91: R7 y R8 siguen en 0,00 tras la anulacion (sobre el libro entero y sobre la diferencia)", () => {
    const r = m().trasRechazo.resumen;
    const mas = (a: string, b: string) => menos(a, menos("0.00", b));
    expect(menos(r.enCaja, mas(mas(r.ganancia, r.deTerceros), r.capital))).toBe("0.00");
    // R8 por diferencia: lo que subio «De las tiendas» es lo que subieron los saldos de A y B.
    const deltaTerceros = d(m().antes, m().trasRechazo, (l) => l.resumen.deTerceros);
    const deltaSaldos = mas(menos(m().saldoATras, m().saldoAAntes), menos(m().saldoBTras, m().saldoBAntes));
    expect(menos(deltaTerceros, deltaSaldos)).toBe("0.00");
  });

  it("R73: el cobro sigue `aprobado` y la cola de pendientes no lo ofrece", () => {
    expect(m().estadoDelCobro).toBe("aprobado");
    expect(m().pendientesConElCobro).toBe(0);
  });

  it("R66: el segundo intento (desde el libro de la tienda) no escribe ni una fila en la caja", () => {
    expect(m().cajaTrasSegundoIntento).toBe(0);
  });

  it("R63/R64: el gasto variable se anula con UN `ingreso_ajuste` por su monto y sin uuid en el texto; cifra y ganancia suben lo mismo", () => {
    expect(m().reversoDelGasto).toEqual([`ingreso|ingreso_ajuste|${GASTO_VARIABLE}|Anulación de: Cajas de carton 459`]);
    expect(m().historialEgreso).toBe(1);
    expect({
      enCaja: d(m().trasRechazo, m().trasGasto, (l) => l.resumen.enCaja),
      ganancia: d(m().trasRechazo, m().trasGasto, (l) => l.resumen.ganancia),
      deTerceros: d(m().trasRechazo, m().trasGasto, (l) => l.resumen.deTerceros),
      capital: d(m().trasRechazo, m().trasGasto, (l) => l.resumen.capital),
    }).toEqual({ enCaja: GASTO_VARIABLE, ganancia: GASTO_VARIABLE, deTerceros: "0.00", capital: "0.00" });
  });

  it("R71: el gasto se lee «anulado» aunque su contra-asiento NO este en la pagina; las dos lineas del rechazo tambien", () => {
    expect(m().documentoGasto).toEqual({ tipo: "egreso_caja", anulado: true, tieneComprobante: false });
    expect(m().documentosRechazo).toEqual([
      { tipo: "rechazo_tienda_cobro", anulado: true, tieneComprobante: false },
      { tipo: "rechazo_tienda_cobro", anulado: true, tieneComprobante: false },
    ]);
  });

  it("R72: el sueldo reversado por la via vieja se lee «anulado, motivo no registrado»; anularlo ahora no deja constancia", () => {
    expect(m().documentoSueldo).toEqual({ tipo: "egreso_caja", anulado: true, tieneComprobante: false, motivoNoRegistrado: true });
    expect(m().constanciasSueldo).toBe(0);
  });

  it("D8: la indemnizacion se anula con un `ingreso_ajuste` de origen EL INCIDENTE, por su monto", () => {
    expect(m().reversoIndemnizacion).toEqual([
      `egreso|egreso_indemnizacion|${INDEMNIZACION}`,
      `ingreso|ingreso_ajuste|${INDEMNIZACION}`,
    ]);
  });
});
