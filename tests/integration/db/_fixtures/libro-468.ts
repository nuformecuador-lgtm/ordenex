import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { Prisma, type GestionResultado, type PrismaClient } from "@prisma/client";

import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { CajaKardexService, CuentaKardexService } from "@/lib/services/LibroKardexService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";

import type { TxDeTest } from "../_postgres-real";
import { montarServicios459, type Catalogo459 } from "./caja-459";
import { montarEstadoCuenta } from "./wallet-458";
import { busquedaPorGuiaDe } from "./busqueda-469";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 468 — EL ESCENARIO DEL LIBRO EN EXCEL (kardex + detalle por guia), CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Todo NUEVO y dentro de una transaccion que SIEMPRE se revierte, en una ventana propia (abril de 2037)
// para que la hoja de la caja solo traiga lo sembrado aqui:
//
//   · tiendas A y B, un mensajero, tres cierres APROBADOS (C1 el 10, C2 el 11, C3 el 12);
//   · C1 y C2: sus movimientos los emiten LOS FEEDS REALES (ingresos de la caja, libro por tienda,
//     contra-entrega de la caja, pago al mensajero —libro y egreso— e indemnizacion). Las gestiones
//     llevan `pago_mensajero` (con un 0,00 y un NULL que el criterio NO debe traer) y una `incidente`
//     con su indemnizacion. o3 esta en los DOS cierres (guia en dos cierres, R38) con otro destinatario
//     en cada uno (R39); o9 esta en C1 sin pago y en C2 con pago (la correlacion con SU cierre);
//     o2 tiene dos gestiones en C1; o7 no tiene guia; o8 tiene la guia 9 (orden numerico, R37) y un
//     pago de 0,00 (aporta al flete, no al pago);
//   · C3: movimientos A MANO que NO cuadran con sus guias (diferencias forzadas, R41/R42): un flete de
//     1500 cuyo unico aporte es 1000, una indemnizacion de un cierre sin incidentes, un debito de flete
//     de la tienda A de 1500 (aporte 1000) y un pago devengado de 999 (gestiones sin pago);
//   · no repartibles: dos correcciones de caja del MISMO instante con `created_at` distinto e ids al
//     reves (solo las ordena bien el `created_at`), un cobro manual a la tienda A y una liquidacion
//     del mensajero; y el pago tomado del efectivo (R43), que emite el feed.

export const DIA_C1 = "2037-04-10";
export const DIA_C2 = "2037-04-11";
export const DIA_C3 = "2037-04-12";
const FECHA = { C1: new Date(`${DIA_C1}T15:00:00.000Z`), C2: new Date(`${DIA_C2}T15:00:00.000Z`), C3: new Date(`${DIA_C3}T15:00:00.000Z`) };

const TARIFA = {
  tarifaValorFleteGam: "1500.00",
  tarifaValorFleteDevuelto: "400.00",
  tarifaValorFleteDevueltoGam: "600.00",
  tarifaComisionCod: "5.00",
  tarifaIvaFlete: "13.00",
  tarifaIvaComisionCod: "13.00",
};

type Cierre = "C1" | "C2" | "C3";

interface Gestion {
  resultado: GestionResultado;
  recibido: string | null;
  pago: string | null;
  indemnizacion?: string;
}

interface Presencia {
  cierre: Cierre;
  numGuia: number | null;
  destinatario?: string;
  valorFlete: string;
  montoCobrar: string | null;
  cobraComision: boolean;
  gestiones: Gestion[];
}

interface OrdenSemilla {
  clave: string;
  tienda: "A" | "B";
  presencias: Presencia[];
}

export const SEMILLA_468: OrdenSemilla[] = [
  { clave: "o1", tienda: "A", presencias: [{ cierre: "C1", numGuia: 46801, valorFlete: "1000.00", montoCobrar: "10000.00", cobraComision: true, gestiones: [{ resultado: "entregado", recibido: "10000.00", pago: "1500.00" }] }] },
  {
    clave: "o2",
    tienda: "A",
    presencias: [
      {
        cierre: "C1",
        numGuia: 46802,
        valorFlete: "2000.00",
        montoCobrar: "3000.00",
        cobraComision: true,
        gestiones: [
          { resultado: "reprogramado", recibido: null, pago: "500.00" },
          { resultado: "entregado", recibido: "3000.00", pago: "1500.00" },
        ],
      },
    ],
  },
  {
    clave: "o3",
    tienda: "A",
    presencias: [
      { cierre: "C1", numGuia: 46803, destinatario: "Destinatario o3 viejo", valorFlete: "3000.00", montoCobrar: "7500.00", cobraComision: true, gestiones: [{ resultado: "reprogramado", recibido: "500.00", pago: "500.00" }] },
      { cierre: "C2", numGuia: 46803, destinatario: "Destinatario o3 nuevo", valorFlete: "3000.00", montoCobrar: "7500.00", cobraComision: true, gestiones: [{ resultado: "entregado", recibido: "7000.00", pago: "1500.00" }] },
    ],
  },
  { clave: "o4", tienda: "B", presencias: [{ cierre: "C1", numGuia: 46804, valorFlete: "4444.44", montoCobrar: "2000.00", cobraComision: false, gestiones: [{ resultado: "entregado", recibido: "2000.00", pago: "1500.00" }] }] },
  { clave: "o5", tienda: "A", presencias: [{ cierre: "C2", numGuia: 46805, valorFlete: "5000.00", montoCobrar: "1000.00", cobraComision: true, gestiones: [{ resultado: "incidente", recibido: null, pago: "0.00", indemnizacion: "12000.00" }] }] },
  { clave: "o6", tienda: "B", presencias: [{ cierre: "C2", numGuia: 46806, valorFlete: "6666.66", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "entregado", recibido: null, pago: null }] }] },
  { clave: "o7", tienda: "A", presencias: [{ cierre: "C1", numGuia: null, valorFlete: "777.77", montoCobrar: "1500.00", cobraComision: true, gestiones: [{ resultado: "entregado", recibido: "1500.00", pago: "1500.00" }] }] },
  { clave: "o8", tienda: "A", presencias: [{ cierre: "C2", numGuia: 9, valorFlete: "800.00", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "entregado", recibido: null, pago: "0.00" }] }] },
  {
    clave: "o9",
    tienda: "A",
    presencias: [
      { cierre: "C1", numGuia: 46809, valorFlete: "900.00", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "novedad", recibido: null, pago: null }] },
      { cierre: "C2", numGuia: 46809, valorFlete: "900.00", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "entregado", recibido: null, pago: "1500.00" }] },
    ],
  },
  { clave: "o10", tienda: "A", presencias: [{ cierre: "C3", numGuia: 46810, valorFlete: "1000.00", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "entregado", recibido: null, pago: null }] }] },
];

/** Lo esperado del escenario, escrito a mano (el criterio del pago y de la indemnizacion). */
export const ESPERADO_468 = {
  /** C1: o1 1500, o2 500+1500, o3 500, o4 1500, o7 1500 (o9 sin pago en C1 NO). */
  pagoC1: { claves: ["o1", "o2", "o3", "o4", "o7"], total: "7000.00" },
  /** C2: o3 1500, o9 1500 (o5 0,00, o6 NULL y o8 0,00 NO). */
  pagoC2: { claves: ["o3", "o9"], total: "3000.00" },
  indemnizacionC2: { claves: ["o5"], total: "12000.00" },
  /** El efectivo entregado en cada cierre (el pago tomado del efectivo es min(P, E)). */
  efectivoC1: "5000.00",
  efectivoC2: "9000.00",
};

export interface Escenario468 {
  cierres: Record<Cierre, string>;
  tiendaA: string;
  tiendaB: string;
  mensajeroId: string;
  cliente: PrismaClient;
  s: ReturnType<typeof montarServicios459>;
  aportes: CierreAporteRepository;
  cajaRepo: WalletMovimientoRepository;
  lote: DetalleEnLoteService;
  fila: DetalleMovimientoService;
  caja: CajaKardexService;
  cuenta: CuentaKardexService;
  /** El id de la orden de cada clave. */
  ordenDe: (clave: string) => string;
  remisionDe: (clave: string) => string;
  /** Las dos correcciones del mismo instante: [la creada antes (id MAYOR), la creada despues (id MENOR)]. */
  empate: [string, string];
}

export async function sembrar468(tx: TxDeTest, cat: Catalogo459): Promise<Escenario468> {
  const s = montarServicios459(tx);
  const cliente = s.cliente as unknown as PrismaClient;
  const sufijo = randomUUID().slice(0, 8);
  const tarifa = await tx.tarifa.findFirst({ select: { id: true } });
  expect(tarifa, "la base no tiene ni una tarifa a la que apuntar `cierre_detail.tarifa_id`").not.toBeNull();
  const estatusId = cat.estatus.get("entregado");
  expect(estatusId, "falta el estatus «entregado»").toBeDefined();

  let n = 0;
  const crearUsuario = async (prefijo: string, rolId: string) => {
    const clave = `${sufijo}-${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `${prefijo} 468`,
        email: `${prefijo.toLowerCase()}468-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa",
        cedula: `468-${prefijo}-${clave}`,
        tipoIdentificacionId: cat.tipoIdentificacionId,
        rolId,
        estado: "activo",
        fulfillment: false,
      },
      select: { id: true },
    });
    return u.id;
  };
  const mensajeroId = await crearUsuario("Mensajero", cat.rolId.mensajero);
  const tiendaA = await crearUsuario("TiendaA", cat.rolId.adminTienda);
  const tiendaB = await crearUsuario("TiendaB", cat.rolId.adminTienda);
  const tienda = { A: tiendaA, B: tiendaB };
  const nombreTienda = { A: "Tienda A 468", B: "Tienda B 468" };

  // P de cada cierre = Σ pago_mensajero de sus gestiones (lo que la aprobacion congela).
  const pagoDe = (c: Cierre) =>
    SEMILLA_468.flatMap((o) => o.presencias.filter((p) => p.cierre === c).flatMap((p) => p.gestiones))
      .reduce((a, g) => a.plus(new Prisma.Decimal(g.pago ?? "0")), new Prisma.Decimal(0));
  const cierres: Record<Cierre, string> = { C1: randomUUID(), C2: randomUUID(), C3: randomUUID() };
  for (const c of ["C1", "C2", "C3"] as const) {
    await tx.cierreDia.create({
      data: {
        id: cierres[c],
        mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_central",
        destinoZonaId: cat.centralZonaId,
        solicitadoAt: FECHA[c],
        totalPagoMensajero: pagoDe(c),
        totalEfectivo: new Prisma.Decimal(c === "C1" ? ESPERADO_468.efectivoC1 : c === "C2" ? ESPERADO_468.efectivoC2 : "0.00"),
      },
    });
  }

  const ordenes = new Map<string, string>();
  const remisiones = new Map<string, string>();
  for (const o of SEMILLA_468) {
    const ordenId = randomUUID();
    const remision = `REM-468-${o.clave}-${sufijo}`;
    ordenes.set(o.clave, ordenId);
    remisiones.set(o.clave, remision);
    await tx.orden.create({
      data: {
        id: ordenId,
        numRemision: `VIVA-${remision}`,
        estatusId: estatusId!,
        destinatario: `Vivo ${o.clave}`,
        telefonoDest: "00000000",
        tiendaId: tienda[o.tienda],
        zonaId: cat.centralZonaId,
        provinciaId: cat.fks.provinciaId,
        cantonId: cat.fks.cantonId,
        producto: "Caja",
        cobraComision: o.presencias[0].cobraComision,
      },
    });
    for (const p of o.presencias) {
      await tx.cierreDetail.create({
        data: {
          cierreId: cierres[p.cierre],
          ordenId,
          montoCobrar: p.montoCobrar === null ? null : new Prisma.Decimal(p.montoCobrar),
          cobraComision: p.cobraComision,
          zonaId: cat.centralZonaId,
          tiendaId: tienda[o.tienda],
          esCentral: false,
          esZonaEspecial: false,
          tarifaId: tarifa!.id,
          tarifaValorFlete: new Prisma.Decimal(p.valorFlete),
          tarifaValorFleteGam: new Prisma.Decimal(TARIFA.tarifaValorFleteGam),
          tarifaValorFleteDevuelto: new Prisma.Decimal(TARIFA.tarifaValorFleteDevuelto),
          tarifaValorFleteDevueltoGam: new Prisma.Decimal(TARIFA.tarifaValorFleteDevueltoGam),
          tarifaComisionCod: new Prisma.Decimal(TARIFA.tarifaComisionCod),
          tarifaIvaFlete: new Prisma.Decimal(TARIFA.tarifaIvaFlete),
          tarifaIvaComisionCod: new Prisma.Decimal(TARIFA.tarifaIvaComisionCod),
          numGuia: p.numGuia,
          numRemision: remision,
          destinatario: p.destinatario ?? `Destinatario ${o.clave}`,
          producto: "Caja",
          tiendaNombre: nombreTienda[o.tienda],
          zonaNombre: "Zona 468",
          provinciaNombre: "Provincia 468",
          cantonNombre: "Canton 468",
        },
      });
      for (const g of p.gestiones) {
        await tx.gestionOrden.create({
          data: {
            ordenId,
            mensajeroId,
            resultado: g.resultado,
            montoRecibido: g.recibido === null ? null : new Prisma.Decimal(g.recibido),
            pagoMensajero: g.pago === null ? null : new Prisma.Decimal(g.pago),
            indemnizacion: g.indemnizacion === undefined ? null : new Prisma.Decimal(g.indemnizacion),
            cierreId: cierres[p.cierre],
          },
        });
      }
    }
  }

  // ── C1 y C2: LOS FEEDS REALES, fechados en la ventana propia ─────────────────────────────────
  const cajaRepo = new WalletMovimientoRepository(cliente);
  const tiendaRepo = new WalletTiendaMovimientoRepository(cliente);
  const mensajeroRepo = new PagoMensajeroMovimientoRepository(cliente);
  const conFecha = <T extends object>(movs: T[], fecha: Date) => movs.map((m) => ({ ...m, fechaMovimiento: fecha }));
  for (const c of ["C1", "C2"] as const) {
    const id = cierres[c];
    const caja = conFecha(await new WalletFeedService().construirMovimientosDeIngreso(id, tx), FECHA[c]);
    expect(caja.length, `el feed de la caja no emitio nada para ${c}`).toBeGreaterThan(0);
    expect(await cajaRepo.crearMovimientos(cliente, caja)).toBe(caja.length);
    const porTienda = conFecha(await new WalletTiendaFeedService().construirMovimientosPorTienda(id, tx), FECHA[c]);
    expect(await tiendaRepo.crearMovimientos(cliente, porTienda)).toBe(porTienda.length);
    const cod = conFecha(await new CajaCodFeedService().construirIngresoCod(id, tx), FECHA[c]);
    expect(cod, `el contra-entrega de ${c}`).toHaveLength(1);
    expect(await cajaRepo.crearMovimientos(cliente, cod)).toBe(1);
    const pago = await new WalletMensajeroFeedService().construirMovimientosDePago(id, tx);
    expect(pago.libro.map((m) => m.categoria), `el libro del mensajero en ${c}`).toEqual(["pago_devengado", "pago_efectivo"]);
    expect(await mensajeroRepo.crearMovimientos(cliente, conFecha(pago.libro, FECHA[c]))).toBe(2);
    expect(await cajaRepo.crearMovimientos(cliente, conFecha(pago.egresoCaja, FECHA[c]))).toBe(1);
    const ind = conFecha(await new WalletIndemnizacionFeedService().construirEgresoIndemnizacion(id, tx), FECHA[c]);
    expect(await cajaRepo.crearMovimientos(cliente, ind)).toBe(ind.length);
  }

  // ── C3: diferencias FORZADAS (los importes no los dio un feed) ───────────────────────────────
  const enC3 = (segundos: number) => new Date(FECHA.C3.getTime() + segundos * 1000);
  expect(
    await cajaRepo.crearMovimientos(cliente, [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1500.00", origenTipo: "cierre_dia", origenId: cierres.C3, fechaMovimiento: enC3(1) },
      { tipo: "egreso", categoria: "egreso_indemnizacion", monto: "333.33", origenTipo: "cierre_dia", origenId: cierres.C3, fechaMovimiento: enC3(2) },
    ]),
  ).toBe(2);
  expect(
    await tiendaRepo.crearMovimientos(cliente, [
      { tiendaId: tiendaA, tipo: "debito", categoria: "flete", monto: "1500.00", origenTipo: "cierre_dia", origenId: cierres.C3, fechaMovimiento: enC3(1) },
      { tiendaId: tiendaA, tipo: "debito", categoria: "cobro_manual", monto: "250.00", origenTipo: "manual", origenId: null, descripcion: "Cobro 468", fechaMovimiento: enC3(3) },
    ]),
  ).toBe(2);
  expect(
    await mensajeroRepo.crearMovimientos(cliente, [
      { mensajeroId, tipo: "devengo", categoria: "pago_devengado", monto: "999.00", origenTipo: "cierre_dia", origenId: cierres.C3, fechaMovimiento: enC3(1) },
      { mensajeroId, tipo: "pago", categoria: "liquidacion", monto: "700.00", origenTipo: "pago_mensajero", origenId: randomUUID(), fechaMovimiento: enC3(3) },
    ]),
  ).toBe(2);

  // ── El empate de la caja: mismo instante, `created_at` distinto e ids AL REVES ────────────────
  const prefijo = randomUUID().slice(0, 8);
  const antes = `${prefijo}-0000-4000-8000-000000000002`; // creada ANTES, id MAYOR
  const despues = `${prefijo}-0000-4000-8000-000000000001`; // creada DESPUES, id MENOR
  const instante = enC3(60);
  await tx.walletMovimiento.create({
    data: { id: antes, tipo: "ingreso", categoria: "ingreso_ajuste", monto: new Prisma.Decimal("4000.00"), origenTipo: "manual", origenId: null, descripcion: "Correccion 468 A", fechaMovimiento: instante, createdAt: new Date(instante.getTime() + 1000) },
  });
  await tx.walletMovimiento.create({
    data: { id: despues, tipo: "egreso", categoria: "egreso_ajuste", monto: new Prisma.Decimal("2500.00"), origenTipo: "manual", origenId: null, descripcion: "Correccion 468 B", fechaMovimiento: instante, createdAt: new Date(instante.getTime() + 2000) },
  });

  const aportes = new CierreAporteRepository(cliente);
  const ecRepo = new EstadoCuentaRepository(cliente);
  const lote = new DetalleEnLoteService(aportes, tiendaRepo, ecRepo);
  return {
    cierres,
    tiendaA,
    tiendaB,
    mensajeroId,
    cliente,
    s,
    aportes,
    cajaRepo,
    lote,
    fila: new DetalleMovimientoService(cajaRepo, tiendaRepo, aportes, ecRepo, busquedaPorGuiaDe(cliente)),
    caja: new CajaKardexService(s.wallet, cajaRepo, lote),
    cuenta: new CuentaKardexService(montarEstadoCuenta(s), lote),
    ordenDe: (clave) => {
      const id = ordenes.get(clave);
      if (id === undefined) throw new Error(`sin orden para ${clave}`);
      return id;
    },
    remisionDe: (clave) => {
      const r = remisiones.get(clave);
      if (r === undefined) throw new Error(`sin remision para ${clave}`);
      return r;
    },
    empate: [antes, despues],
  };
}
