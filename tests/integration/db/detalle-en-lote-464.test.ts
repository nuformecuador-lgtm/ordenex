import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Prisma, type PrismaClient, type GestionResultado } from "@prisma/client";

import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import { CajaConDetalleService, EstadoCuentaConDetalleService } from "@/lib/services/LibroConDetalleService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenAporteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import type { VerDetalleMovimientoCompletoServiceResult, VerDetalleMovimientoServiceResult } from "@/lib/interfaces/services/IDetalleMovimientoService";
import { listarLibroCajaCompletoSchema } from "@/lib/types/wallet";
import { CRITERIO_COD_RECAUDADO, CRITERIO_DE_APORTE, type CriterioDeAporte } from "@/lib/utils/aporte-por-orden";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, type Catalogo459 } from "./_fixtures/caja-459";
import { montarEstadoCuenta } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 464 / T4 + T6 — EL DETALLE POR ORDEN EN LOTE, CONTRA POSTGRES DE VERDAD.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Por que contra Postgres: en este repo esta medido (cuatro veces seguidas) que una mutacion del `WHERE`
// pasa en verde por delante de un doble. Lo que esta ficha promete es una propiedad del `WHERE` del lote
// (el `OR` de `buildWhere` con la gestion CORRELACIONADA con su cierre, y la tienda al final).
//
// Escenario (todo NUEVO y dentro de una transaccion que SIEMPRE se revierte):
//   · dos tiendas (A, B), un mensajero, dos cierres APROBADOS (C1, C2);
//   · o3 de la tienda A esta en LOS DOS cierres: en C1 se reprogramo (recaudo 500), en C2 se entrego.
//     Es la orden que un `cierreId IN (...)` plano metería en el flete de C1 (por su gestion de C2);
//   · o2 tiene DOS gestiones en C1 (reprogramado + entregado);
//   · o4 y o6 son de la tienda B, en los mismos cierres que las de A;
//   · o7 no tiene guia congelada (nulls last).
//   Los movimientos los emiten LOS FEEDS REALES (el importe no lo escribe el test), fechados en una
//   ventana propia (marzo de 2035) para aislar la caja del resto de la base local.
//
// Lo que se afirma:
//   · T4 — `contarAportesPorCierre`/`listarAportesDeCierres` = `listarOrdenesQueAportan` cierre a cierre,
//     para los SIETE criterios y los tres alcances (sin tienda, A, B); y los hechos concretos de arriba
//     (o3 NO esta en el flete de C1; sus gestiones en C2 son solo las de C2; la tienda A no ve a o4).
//   · R21 — DIFERENCIAL: para cada movimiento, el lote = el detalle de esa fila en pantalla
//     (`verDetalleDeMovimientoCompleto`, `verDetalleDeFilaDeCuenta`, `verDetalleDeMiMovimientoCompleto`).
//   · R22 — en cada movimiento con reparto, Σ aportes = su monto (que emitio el feed real) y `cuadra`.
//   · R14/R36 — la hoja de movimientos con detalle = la del completo sin detalle, mismos filtros y orden.
//   · R34 — en la tienda (oficina y /mi-wallet) ninguna orden de la otra tienda.
//   · R39/R40 — con el tope por debajo de las filas de detalle: `limite_excedido` «detalle» y CERO
//     lecturas de ordenes (se espia el repositorio real).
//
// No-vacuidad: conteos exactos del escenario; ningun `if (!x) return;`. Sin base, la suite se SALTA.

const tope = vi.hoisted(() => ({ valor: 0 }));
vi.mock("@/lib/config/descarga", async (original) => {
  const real = await original<typeof import("@/lib/config/descarga")>();
  tope.valor = real.descargaConfig.MAX_FILAS;
  return {
    ...real,
    descargaConfig: new Proxy(real.descargaConfig, {
      get: (objetivo, prop, receptor) => (prop === "MAX_FILAS" ? tope.valor : Reflect.get(objetivo, prop, receptor)),
    }),
  };
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-000000000464", rol: "maestro" };

const TARIFA = {
  tarifaValorFleteGam: "1500.00",
  tarifaValorFleteDevuelto: "400.00",
  tarifaValorFleteDevueltoGam: "600.00",
  tarifaComisionCod: "5.00",
  tarifaIvaFlete: "13.00",
  tarifaIvaComisionCod: "13.00",
};

interface Presencia {
  cierre: "C1" | "C2";
  numGuia: number | null;
  valorFlete: string;
  montoCobrar: string | null;
  cobraComision: boolean;
  gestiones: Array<{ resultado: GestionResultado; montoRecibido: string | null }>;
}

interface OrdenSemilla {
  clave: string;
  tienda: "A" | "B";
  presencias: Presencia[];
}

const SEMILLA: OrdenSemilla[] = [
  {
    clave: "o1",
    tienda: "A",
    presencias: [
      { cierre: "C1", numGuia: 46401, valorFlete: "1000.00", montoCobrar: "10000.00", cobraComision: true, gestiones: [{ resultado: "entregado", montoRecibido: "10000.00" }] },
    ],
  },
  {
    clave: "o2",
    tienda: "A",
    presencias: [
      {
        cierre: "C1",
        numGuia: 46402,
        valorFlete: "2000.00",
        montoCobrar: "3000.00",
        cobraComision: true,
        gestiones: [
          { resultado: "reprogramado", montoRecibido: null },
          { resultado: "entregado", montoRecibido: "3000.00" },
        ],
      },
    ],
  },
  {
    clave: "o3",
    tienda: "A",
    presencias: [
      { cierre: "C1", numGuia: 46403, valorFlete: "3000.00", montoCobrar: "7500.00", cobraComision: true, gestiones: [{ resultado: "reprogramado", montoRecibido: "500.00" }] },
      { cierre: "C2", numGuia: 46403, valorFlete: "3000.00", montoCobrar: "7500.00", cobraComision: true, gestiones: [{ resultado: "entregado", montoRecibido: "7000.00" }] },
    ],
  },
  {
    clave: "o4",
    tienda: "B",
    presencias: [
      { cierre: "C1", numGuia: 46404, valorFlete: "4444.44", montoCobrar: "2000.00", cobraComision: false, gestiones: [{ resultado: "entregado", montoRecibido: "2000.00" }] },
    ],
  },
  {
    clave: "o5",
    tienda: "A",
    presencias: [
      { cierre: "C2", numGuia: 46405, valorFlete: "5000.00", montoCobrar: "1000.00", cobraComision: true, gestiones: [{ resultado: "devolucion_a_origen_por_rechazo", montoRecibido: null }] },
    ],
  },
  {
    clave: "o6",
    tienda: "B",
    presencias: [
      { cierre: "C2", numGuia: 46406, valorFlete: "6666.66", montoCobrar: null, cobraComision: false, gestiones: [{ resultado: "entregado", montoRecibido: null }] },
    ],
  },
  {
    clave: "o7",
    tienda: "A",
    presencias: [
      { cierre: "C1", numGuia: null, valorFlete: "777.77", montoCobrar: "1500.00", cobraComision: true, gestiones: [{ resultado: "entregado", montoRecibido: "1500.00" }] },
    ],
  },
];

/** Los dias (CR) de la ventana propia de la caja: nada mas de la base local cae aqui. */
const DIA_C1 = "2035-03-10";
const DIA_C2 = "2035-03-11";
const FECHA_C1 = new Date(`${DIA_C1}T15:00:00.000Z`);
const FECHA_C2 = new Date(`${DIA_C2}T15:00:00.000Z`);

interface Escenario {
  c1: string;
  c2: string;
  tiendaA: string;
  tiendaB: string;
  cliente: PrismaClient;
  s: ReturnType<typeof montarServicios459>;
  fila: DetalleMovimientoService;
  aportes: CierreAporteRepository;
  lote: DetalleEnLoteService;
  remisionDe: (clave: string) => string;
}

async function sembrar(tx: TxDeTest, cat: Catalogo459): Promise<Escenario> {
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
        nombre: `${prefijo} 464`,
        email: `${prefijo.toLowerCase()}464-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa",
        cedula: `464-${prefijo}-${clave}`,
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
  const nombreTienda = { A: "Tienda A 464", B: "Tienda B 464" };

  const cierres = { C1: randomUUID(), C2: randomUUID() };
  for (const [clave, id] of Object.entries(cierres)) {
    await tx.cierreDia.create({
      data: {
        id,
        mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_central",
        destinoZonaId: cat.centralZonaId,
        solicitadoAt: clave === "C1" ? FECHA_C1 : FECHA_C2,
      },
    });
  }

  const remisiones = new Map<string, string>();
  for (const o of SEMILLA) {
    const ordenId = randomUUID();
    const remision = `REM-464-${o.clave}-${sufijo}`;
    remisiones.set(o.clave, remision);
    await tx.orden.create({
      data: {
        id: ordenId,
        numRemision: `VIVA-${remision}`, // R29: la orden VIVA dice otra cosa que el snapshot
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
      const cierreId = cierres[p.cierre];
      await tx.cierreDetail.create({
        data: {
          cierreId,
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
          destinatario: `Destinatario ${o.clave}`,
          producto: "Caja",
          tiendaNombre: nombreTienda[o.tienda],
          zonaNombre: "Zona 464",
          provinciaNombre: "Provincia 464",
          cantonNombre: "Canton 464",
        },
      });
      for (const g of p.gestiones) {
        await tx.gestionOrden.create({
          data: {
            ordenId,
            mensajeroId,
            resultado: g.resultado,
            montoRecibido: g.montoRecibido === null ? null : new Prisma.Decimal(g.montoRecibido),
            cierreId,
          },
        });
      }
    }
  }

  // Los movimientos los emiten LOS FEEDS REALES, fechados en la ventana propia.
  const cajaRepo = new WalletMovimientoRepository(cliente);
  const tiendaRepo = new WalletTiendaMovimientoRepository(cliente);
  for (const [clave, cierreId] of Object.entries(cierres)) {
    const fecha = clave === "C1" ? FECHA_C1 : FECHA_C2;
    const caja = (await new WalletFeedService().construirMovimientosDeIngreso(cierreId, tx)).map((m) => ({
      ...m,
      fechaMovimiento: fecha,
    }));
    expect(caja.length, `el feed de la caja no emitio nada para ${clave}`).toBeGreaterThan(0);
    expect(await cajaRepo.crearMovimientos(cliente, caja)).toBe(caja.length);
    const porTienda = (await new WalletTiendaFeedService().construirMovimientosPorTienda(cierreId, tx)).map((m) => ({
      ...m,
      fechaMovimiento: fecha,
    }));
    expect(porTienda.length, `el feed por tienda no emitio nada para ${clave}`).toBeGreaterThan(0);
    expect(await tiendaRepo.crearMovimientos(cliente, porTienda)).toBe(porTienda.length);
  }
  // Un movimiento de cierre SIN reparto en la misma ventana (su importe es un snapshot del cierre).
  await cajaRepo.crearMovimientos(cliente, [
    {
      tipo: "egreso",
      categoria: "egreso_pago_mensajero",
      monto: "12345.67",
      origenTipo: "cierre_dia",
      origenId: cierres.C1,
      fechaMovimiento: new Date(FECHA_C1.getTime() + 60_000),
    },
  ]);

  const aportes = new CierreAporteRepository(cliente);
  return {
    c1: cierres.C1,
    c2: cierres.C2,
    tiendaA,
    tiendaB,
    cliente,
    s,
    aportes,
    fila: new DetalleMovimientoService(cajaRepo, tiendaRepo, aportes, new EstadoCuentaRepository(cliente)),
    lote: new DetalleEnLoteService(aportes, tiendaRepo),
    remisionDe: (clave) => {
      const r = remisiones.get(clave);
      if (r === undefined) throw new Error(`sin remision para ${clave}`);
      return r;
    },
  };
}

/** Una orden comparable entre la pantalla y el lote: lo que se pinta, en el mismo orden. */
type Linea = string;
const lineaDeFila = (o: OrdenAporteDTO): Linea =>
  `${o.guia}|${o.destinatario}|${o.resultados.join("+")}|${o.aporte}`;
const lineasDelLote = (d: DetalleDeMovimientoLoteDTO): Linea[] => {
  if (d.modo !== "ordenes") return [];
  return d.ordenes.map((o) => `${o.guia ?? o.remision}|${o.destinatario}|${o.resultados.join("+")}|${o.aporte}`);
};

function comoPantalla(
  r: VerDetalleMovimientoCompletoServiceResult | VerDetalleMovimientoServiceResult,
): { modo: "ordenes"; lineas: Linea[] } | { modo: "sin_reparto"; motivo: string } {
  if (r.status === "sin_reparto") return { modo: "sin_reparto", motivo: r.motivo };
  if (r.status !== "ok") throw new Error(`el detalle de la fila respondio ${r.status}`);
  if ("data" in r) {
    expect(r.data.ordenes.length, "la pagina de la fila no trae el conjunto entero").toBe(r.data.total);
    return { modo: "ordenes", lineas: r.data.ordenes.map(lineaDeFila) };
  }
  return { modo: "ordenes", lineas: r.items.map(lineaDeFila) };
}

function comoLote(d: DetalleDeMovimientoLoteDTO): { modo: "ordenes"; lineas: Linea[] } | { modo: "sin_reparto"; motivo: string } {
  return d.modo === "sin_reparto" ? { modo: "sin_reparto", motivo: d.motivo } : { modo: "ordenes", lineas: lineasDelLote(d) };
}

const CRITERIOS: Array<[string, CriterioDeAporte]> = [
  ...Object.entries(CRITERIO_DE_APORTE),
  ["cod_recaudado", CRITERIO_COD_RECAUDADO],
];

/** Lo comparable de una fila del repositorio (sin `cierreId`). */
const filaComparable = (f: OrdenAporteRow) => ({
  ordenId: f.ordenId,
  numGuia: f.numGuia,
  numRemision: f.numRemision,
  destinatario: f.destinatario,
  tiendaNombre: f.tiendaNombre,
  orden: f.orden,
  gestiones: f.gestiones,
});

describeSiHayBase("464 — detalle por orden en lote (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Catalogo459;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const conEscenario = <T>(fn: (e: Escenario) => Promise<T>) =>
    enTransaccionRevertida459(prisma, async (tx) => fn(await sembrar(tx, cat)));

  it("T4: conteo y filas del lote = listarOrdenesQueAportan cierre a cierre (7 criterios x 3 alcances)", async () => {
    await conEscenario(async (e) => {
      let filasVistas = 0;
      for (const [nombre, criterio] of CRITERIOS) {
        for (const tiendaId of [undefined, e.tiendaA, e.tiendaB]) {
          const cierreIds = [e.c1, e.c2];
          const conteos = await e.aportes.contarAportesPorCierre({ criterio, cierreIds, tiendaId });
          const lote = await e.aportes.listarAportesDeCierres({ criterio, cierreIds, tiendaId });
          for (const cierreId of cierreIds) {
            const una = await e.aportes.listarOrdenesQueAportan({
              cierreId,
              criterio,
              tiendaId,
              rango: { skip: 0, take: 1000 },
            });
            const delLote = lote.filter((f) => f.cierreId === cierreId).map(filaComparable);
            expect(delLote, `${nombre} / ${cierreId === e.c1 ? "C1" : "C2"} / ${tiendaId ?? "caja"}`).toEqual(
              una.items.map(filaComparable),
            );
            expect(conteos.get(cierreId) ?? 0).toBe(una.total);
            filasVistas += delLote.length;
          }
        }
      }
      expect(filasVistas, "el escenario no produjo filas: la comparacion no habria medido nada").toBeGreaterThan(20);
    });
  });

  it("T4: los hechos del escenario — la gestion correlacionada con SU cierre, la tienda al final, nulls last", async () => {
    await conEscenario(async (e) => {
      const flete = CRITERIO_DE_APORTE.ingreso_flete;
      const filas = await e.aportes.listarAportesDeCierres({ criterio: flete, cierreIds: [e.c1, e.c2] });
      const enC1 = filas.filter((f) => f.cierreId === e.c1).map((f) => f.numRemision);
      const enC2 = filas.filter((f) => f.cierreId === e.c2).map((f) => f.numRemision);
      // o3 se REPROGRAMO en C1: no aporta flete a C1 aunque tenga una gestion entregada (en C2).
      expect(enC1).toEqual([e.remisionDe("o1"), e.remisionDe("o2"), e.remisionDe("o4"), e.remisionDe("o7")]);
      expect(enC2).toEqual([e.remisionDe("o3"), e.remisionDe("o6")]);
      const conteo = await e.aportes.contarAportesPorCierre({ criterio: flete, cierreIds: [e.c1, e.c2] });
      expect(Object.fromEntries(conteo)).toEqual({ [e.c1]: 4, [e.c2]: 2 });

      // Las gestiones de o3 en C2 son SOLO las de C2 (no arrastra la reprogramada de C1).
      const cod = await e.aportes.listarAportesDeCierres({ criterio: CRITERIO_COD_RECAUDADO, cierreIds: [e.c1, e.c2] });
      const o3 = cod.filter((f) => f.numRemision === e.remisionDe("o3"));
      expect(o3).toHaveLength(2);
      expect(new Map(o3.map((f) => [f.cierreId, f.gestiones]))).toEqual(
        new Map([
          [e.c1, [{ resultado: "reprogramado", montoRecibido: "500.00" }]],
          [e.c2, [{ resultado: "entregado", montoRecibido: "7000.00" }]],
        ]),
      );
      // o2: sus DOS gestiones de C1, en el orden del detalle de la fila. Dentro de la transaccion del
      // test las dos comparten `created_at` (now() es el de la transaccion): las ordena el desempate
      // por `id`, el MISMO en la fila y en el lote (lo que se afirma es la igualdad, no un orden fijo).
      const o2 = cod.find((f) => f.numRemision === e.remisionDe("o2"));
      expect([...(o2?.gestiones.map((g) => g.resultado) ?? [])].sort()).toEqual(["entregado", "reprogramado"]);
      const o2Fila = await e.aportes.listarOrdenesQueAportan({
        cierreId: e.c1,
        criterio: CRITERIO_COD_RECAUDADO,
        rango: { skip: 0, take: 100 },
      });
      expect(o2?.gestiones).toEqual(o2Fila.items.find((f) => f.numRemision === e.remisionDe("o2"))?.gestiones);

      // R34: con la tienda A, ni una orden de B, en ninguno de los dos cierres.
      const deA = await e.aportes.listarAportesDeCierres({ criterio: flete, cierreIds: [e.c1, e.c2], tiendaId: e.tiendaA });
      expect(deA.filter((f) => f.cierreId === e.c1).map((f) => f.numRemision)).toEqual([
        e.remisionDe("o1"),
        e.remisionDe("o2"),
        e.remisionDe("o7"),
      ]);
      expect(deA.filter((f) => f.cierreId === e.c2).map((f) => f.numRemision)).toEqual([e.remisionDe("o3")]);
      expect(deA.every((f) => f.tiendaNombre === "Tienda A 464")).toBe(true);
      expect(deA).toHaveLength(4);
      const conteoA = await e.aportes.contarAportesPorCierre({ criterio: flete, cierreIds: [e.c1, e.c2], tiendaId: e.tiendaA });
      expect(Object.fromEntries(conteoA)).toEqual({ [e.c1]: 3, [e.c2]: 1 });

      // Cabeceras: las dos, en una consulta.
      const cab = await e.aportes.cabecerasDeCierres([e.c1, e.c2, randomUUID()]);
      expect([...cab.keys()].sort()).toEqual([e.c1, e.c2].sort());
      expect(cab.get(e.c1)?.fecha).toBe(FECHA_C1.toISOString());
      expect(cab.get(e.c1)?.mensajeroNombre).toMatch(/^Mensajero 464/);
    });
  });

  it("R14/R21/R22/R36 — caja: la hoja de movimientos es la de siempre y cada detalle = el de su fila", async () => {
    await conEscenario(async (e) => {
      const entrada = listarLibroCajaCompletoSchema.parse({ desde: DIA_C1, hasta: DIA_C2, sortDir: "asc" });
      const orquestador = new CajaConDetalleService(e.s.wallet, e.lote);
      const conDetalle = await orquestador.cajaConDetalle(entrada, MAESTRO);
      const sinDetalle = await e.s.wallet.listarMovimientosCompleto(entrada, MAESTRO);
      if (conDetalle.status !== "ok" || sinDetalle.status !== "ok") throw new Error("se esperaba ok en los dos");
      // R14/R36: mismas filas, mismo orden, mismo total.
      expect(conDetalle.items).toEqual(sinDetalle.items);
      expect(conDetalle.total).toBe(sinDetalle.total);
      expect(conDetalle.detalle.map((d) => d.movimientoId)).toEqual(sinDetalle.items.map((m) => m.id));
      // El escenario: 2 cierres x (flete, iva flete, comision, iva comision) + devolucion en C2 + el pago al mensajero.
      expect(conDetalle.items.length).toBeGreaterThanOrEqual(9);

      let conOrdenes = 0;
      for (const [i, m] of conDetalle.items.entries()) {
        const d = conDetalle.detalle[i];
        const pantalla = comoPantalla(await e.fila.verDetalleDeMovimientoCompleto({ movimientoId: m.id }, MAESTRO));
        expect(comoLote(d), `${m.categoria} de ${m.origenId === e.c1 ? "C1" : "C2"}`).toEqual(pantalla);
        if (d.modo === "ordenes") {
          conOrdenes += 1;
          // R22: Σ aportes = el monto que emitio el feed real, y el servidor lo dice.
          expect({ suma: d.suma, cuadra: d.cuadra }, m.categoria).toEqual({ suma: m.monto, cuadra: true });
          expect(d.ordenes.every((o) => o.tiendaNombre !== null)).toBe(true);
          expect(d.cierre.mensajeroNombre).toMatch(/^Mensajero 464/);
        }
      }
      expect(conOrdenes, "ningun movimiento con reparto: el diferencial no habria medido nada").toBeGreaterThanOrEqual(8);
      // R29: remision y destinatario son los CONGELADOS en el cierre, no los de la orden viva.
      const ordenes = conDetalle.detalle.flatMap((d) => (d.modo === "ordenes" ? d.ordenes : []));
      expect(ordenes.length).toBeGreaterThan(10);
      for (const o of ordenes) {
        expect(o.remision).toMatch(/^REM-464-/);
        expect(o.destinatario).toMatch(/^Destinatario o\d$/);
      }
      const pago = conDetalle.detalle.find((d) => d.modo === "sin_reparto");
      expect(pago).toMatchObject({ modo: "sin_reparto", motivo: "snapshot_del_cierre" });
      // El flete de C1 tiene sus 4 ordenes, o3 incluida NO.
      const fleteC1 = conDetalle.items.findIndex((m) => m.categoria === "ingreso_flete" && m.origenId === e.c1);
      const dC1 = conDetalle.detalle[fleteC1];
      expect(dC1.modo === "ordenes" && dC1.ordenes.map((o) => o.remision)).toEqual([
        e.remisionDe("o1"),
        e.remisionDe("o2"),
        e.remisionDe("o4"),
        e.remisionDe("o7"),
      ]);
      expect(dC1.modo === "ordenes" && dC1.ordenes[3].guia).toBeNull(); // o7: sin guia, al final
    });
  });

  it("R21/R22/R34 — tienda en la oficina: cada detalle = el de su fila, y solo ordenes de esa tienda", async () => {
    await conEscenario(async (e) => {
      const orquestador = new EstadoCuentaConDetalleService(montarEstadoCuenta(e.s), e.lote);
      const cuenta = { tipo: "tienda" as const, id: e.tiendaA };
      const entrada = { cuenta, sortBy: "fecha" as const, sortDir: "desc" as const };
      const r = await orquestador.tiendaConDetalle(entrada, MAESTRO);
      const sin = await montarEstadoCuenta(e.s).leerCompleto(entrada, MAESTRO);
      if (r.status !== "ok" || sin.status !== "ok") throw new Error("se esperaba ok");
      expect(r.estado).toEqual(sin.estado); // R14/R36
      expect(r.detalle).toHaveLength(r.estado.filas.length);
      expect(r.estado.filas.length).toBeGreaterThanOrEqual(8);

      let conOrdenes = 0;
      for (const [i, f] of r.estado.filas.entries()) {
        const d = r.detalle[i];
        if (f.ref === null || !("libro" in f.ref)) throw new Error("fila de tienda sin ref de libro");
        expect(d.movimientoId).toBe(f.ref.movimientoId);
        const pantalla = comoPantalla(
          await e.fila.verDetalleDeFilaDeCuenta({ cuenta, movimientoId: f.ref.movimientoId, page: 1, pageSize: 100 }, MAESTRO),
        );
        expect(comoLote(d), f.categoria).toEqual(pantalla);
        if (d.modo === "ordenes") {
          conOrdenes += 1;
          expect({ suma: d.suma, cuadra: d.cuadra }, f.categoria).toEqual({ suma: f.cargo ?? f.abono, cuadra: true });
          // R34: ninguna orden de B, y la columna de tienda no existe en la vista de UNA tienda.
          for (const o of d.ordenes) {
            expect([e.remisionDe("o4"), e.remisionDe("o6")]).not.toContain(o.remision);
            expect(o.tiendaNombre).toBeNull();
          }
          expect(d.cierre.mensajeroNombre).toMatch(/^Mensajero 464/);
        }
      }
      expect(conOrdenes).toBeGreaterThanOrEqual(8);
    });
  });

  it("R5/R21/R22/R34 — /mi-wallet: cada detalle = el de su fila, sin nombres de Ordenex ni de otra tienda", async () => {
    await conEscenario(async (e) => {
      const tiendaB: Actor = { usuarioId: e.tiendaB, rol: "adminTienda" };
      const orquestador = new EstadoCuentaConDetalleService(montarEstadoCuenta(e.s), e.lote);
      const r = await orquestador.miTiendaConDetalle({ sortBy: "fecha", sortDir: "asc" }, tiendaB);
      if (r.status !== "ok") throw new Error(`se esperaba ok: ${r.status}`);
      expect(r.detalle).toHaveLength(r.estado.filas.length);
      let conOrdenes = 0;
      for (const [i, f] of r.estado.filas.entries()) {
        const d = r.detalle[i];
        if (f.ref === null || !("libro" in f.ref)) throw new Error("fila sin ref");
        const pantalla = comoPantalla(
          await e.fila.verDetalleDeMiMovimientoCompleto({ movimientoId: f.ref.movimientoId }, tiendaB),
        );
        expect(comoLote(d), f.categoria).toEqual(pantalla);
        if (d.modo === "ordenes") {
          conOrdenes += 1;
          expect(d.cuadra).toBe(true);
          expect(d.cierre.mensajeroNombre).toBeNull();
          for (const o of d.ordenes) {
            expect([e.remisionDe("o4"), e.remisionDe("o6")]).toContain(o.remision);
            expect(o.tiendaNombre).toBeNull();
          }
        }
      }
      expect(conOrdenes).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(r.detalle)).not.toContain("Mensajero 464");

      // Y la tienda A con el MISMO lote de ids de B: el ledger de A no los tiene -> no hay detalle ajeno.
      const idsDeB = r.estado.filas.flatMap((f) => (f.ref !== null && "libro" in f.ref ? [f.ref.movimientoId] : []));
      await expect(
        e.lote.detallar({ superficie: "mi_wallet", movimientoIds: idsDeB }, { usuarioId: e.tiendaA, rol: "adminTienda" }),
      ).rejects.toThrow(/no pertenece al libro de la tienda/);
    });
  });

  it("R39/R40 — con el tope por debajo del detalle: limite «detalle» y CERO lecturas de ordenes", async () => {
    const original = tope.valor;
    try {
      await conEscenario(async (e) => {
        // Solo el flete: 2 movimientos (C1, C2) y 6 filas de detalle (4 + 2).
        const entrada = listarLibroCajaCompletoSchema.parse({ desde: DIA_C1, hasta: DIA_C2, categoria: "ingreso_flete" });
        const listar = vi.spyOn(e.aportes, "listarAportesDeCierres");
        const cabeceras = vi.spyOn(e.aportes, "cabecerasDeCierres");
        const orquestador = new CajaConDetalleService(e.s.wallet, e.lote);

        tope.valor = 5;
        expect(await orquestador.cajaConDetalle(entrada, MAESTRO)).toEqual({
          status: "limite_excedido",
          hoja: "detalle",
          total: 6,
          limite: 5,
        });
        expect(listar).not.toHaveBeenCalled();
        expect(cabeceras).not.toHaveBeenCalled();

        tope.valor = 6; // frontera: exactamente el tope SI sale
        const ok = await orquestador.cajaConDetalle(entrada, MAESTRO);
        expect(ok.status).toBe("ok");
        expect(listar).toHaveBeenCalled();

        tope.valor = 1; // y por debajo de la hoja de movimientos, el aviso de siempre (R38)
        expect(await orquestador.cajaConDetalle(entrada, MAESTRO)).toEqual({
          status: "limite_excedido",
          hoja: "movimientos",
          total: 2,
          limite: 1,
        });
      });
    } finally {
      tope.valor = original;
    }
  });
});
