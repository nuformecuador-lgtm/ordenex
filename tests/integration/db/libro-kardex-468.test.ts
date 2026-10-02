import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import type { VerDetalleMovimientoCompletoServiceResult, VerDetalleMovimientoServiceResult } from "@/lib/interfaces/services/IDetalleMovimientoService";
import { listarLibroCajaCompletoSchema, listarMovimientosSchema } from "@/lib/types/wallet";
import { CRITERIO_INDEMNIZACION, CRITERIO_PAGO_MENSAJERO } from "@/lib/utils/aporte-por-orden";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, type Catalogo459 } from "./_fixtures/caja-459";
import { DIA_C1, DIA_C3, ESPERADO_468, sembrar468, type Escenario468 } from "./_fixtures/libro-468";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 468 / T4, T6, T7, T9 — EL LIBRO EN EXCEL CONTRA POSTGRES DE VERDAD.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se afirma (y por que aqui y no con dobles: en este repo una mutacion del `WHERE` pasa en verde
// por delante de un doble, medido cuatro veces):
//
//   · T4 — el `WHERE` de los dos criterios nuevos: el pago al mensajero de cada cierre trae EXACTAMENTE
//     las ordenes con pago > 0 en ESE cierre, y su suma es `total_pago_mensajero`; la indemnizacion
//     suma el egreso del feed.
//   · T7 (R28) — DIFERENCIAL: para cada movimiento de los cuatro conceptos nuevos, el lote = el detalle
//     de esa fila en pantalla.
//   · T6 (R12/R14/R15/R16) — el saldo de la caja en el kardex es el de la tarjeta (`verResumenCaja`) con
//     el mismo corte; fila a fila cuadra; con un filtro, el saldo de cada fila sigue siendo el de la caja
//     entera.
//   · T9 (R45/R46/R48/R53/R57) — por superficie (caja, tienda, mensajero, /mi-wallet): el TOTAL GENERAL de
//     la hoja 2 es el «Total del periodo» de la hoja 1; cada movimiento aparece en la hoja 2; la hoja 1
//     es la misma con y sin detalle; ninguna guia de otra tienda.
//
// No-vacuidad: cada caso afirma primero que el escenario trae filas de cada tipo. Sin base, se SALTA.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-000000000468", rol: "maestro" };

const VENTANA = listarLibroCajaCompletoSchema.parse({ desde: DIA_C1, hasta: DIA_C3 });

function sumar(xs: readonly string[]): string {
  return xs.reduce((a, x) => a.plus(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);
}

/** Lo comparable entre la pantalla y el lote: guia (o remision), destinatario, resultados y aporte. */
const lineaDeFila = (o: OrdenAporteDTO) => `${o.guia}|${o.destinatario}|${o.resultados.join("+")}|${o.aporte}`;
const lineasDelLote = (d: DetalleDeMovimientoLoteDTO) =>
  d.modo !== "ordenes" ? [] : d.ordenes.map((o) => `${o.guia ?? o.remision}|${o.destinatario}|${o.resultados.join("+")}|${o.aporte}`);

function comoPantalla(r: VerDetalleMovimientoCompletoServiceResult | VerDetalleMovimientoServiceResult) {
  if (r.status === "sin_reparto") return { modo: "sin_reparto", motivo: r.motivo };
  if (r.status !== "ok") throw new Error(`el detalle de la fila respondio ${r.status}`);
  if ("data" in r) {
    expect(r.data.ordenes.length).toBe(r.data.total);
    return { modo: "ordenes", lineas: r.data.ordenes.map(lineaDeFila) };
  }
  return { modo: "ordenes", lineas: r.items.map(lineaDeFila) };
}
const comoLote = (d: DetalleDeMovimientoLoteDTO) =>
  d.modo === "sin_reparto" ? { modo: "sin_reparto", motivo: d.motivo } : { modo: "ordenes", lineas: lineasDelLote(d) };

/**
 * R45/R46 — la invariante de la hoja 2 contra la hoja 1, y que cada movimiento aparezca: uno repartible
 * por sus filas de concepto (mas su diferencia si la tiene), uno no repartible EXACTAMENTE una vez.
 * Devuelve los conteos para que cada caso afirme la no-vacuidad.
 */
function afirmarInvariante(kardex: KardexDTO, porGuia: DetallePorGuiaDTO, ids: readonly string[]) {
  expect(porGuia.totalGeneral, "R45: el TOTAL GENERAL no es el «Total del periodo»").toEqual(kardex.totales);
  // R44 recalculado aqui, independiente del servidor: Σ de cada fila (sin los «Total de la guía»).
  const montos = [...porGuia.bloques.flatMap((b) => b.filas.map((f) => f.monto)), ...porGuia.sinGuia.map((f) => f.monto)];
  for (const columna of ["entra", "sale"] as const) {
    expect(sumar(montos.filter((m) => m.columna === columna).map((m) => m.monto)), columna).toBe(kardex.totales[columna]);
  }
  let repartibles = 0;
  let noRepartibles = 0;
  let diferencias = 0;
  for (const [i, id] of ids.entries()) {
    const enBloques = porGuia.bloques.flatMap((b) => b.filas).filter((f) => f.movimientoId === id);
    const sinGuia = porGuia.sinGuia.filter((f) => f.movimientoId === id);
    if (kardex.filas[i].ordenes === null) {
      expect(enBloques, `R46: un no repartible no va en bloques (${id})`).toEqual([]);
      expect(sinGuia.map((f) => f.tipo), `R46: un no repartible sale UNA vez (${id})`).toEqual(["movimiento"]);
      noRepartibles += 1;
    } else {
      repartibles += 1;
      expect(enBloques.length, `R18/R57: «N guía(s)» = sus filas de concepto (${id})`).toBe(kardex.filas[i].ordenes);
      expect(sinGuia.every((f) => f.tipo === "diferencia")).toBe(true);
      expect(enBloques.length + sinGuia.length, `R46: el repartible ${id} no aparece en la hoja 2`).toBeGreaterThan(0);
      // Su importe entero esta en sus filas mas su diferencia.
      expect(sumar([...enBloques, ...sinGuia].map((f) => f.monto.monto))).toBe(kardex.filas[i].monto.monto);
      diferencias += sinGuia.length;
    }
  }
  return { repartibles, noRepartibles, diferencias };
}

describeSiHayBase("468 — el libro en Excel (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Catalogo459;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const conEscenario = <T>(fn: (e: Escenario468) => Promise<T>) =>
    enTransaccionRevertida459(prisma, async (tx) => fn(await sembrar468(tx, cat)));

  it("T4 R27: el pago al mensajero trae EXACTAMENTE las ordenes con pago > 0 en SU cierre, y suma total_pago_mensajero", async () => {
    await conEscenario(async (e) => {
      const filas = await e.aportes.listarAportesDeCierres({ criterio: CRITERIO_PAGO_MENSAJERO, cierreIds: [e.cierres.C1, e.cierres.C2] });
      const de = (c: string) => filas.filter((f) => f.cierreId === c);
      const claves = (c: string) => de(c).map((f) => f.ordenId).sort();
      const sumaPago = (c: string) => sumar(de(c).flatMap((f) => f.gestiones.map((g) => g.pagoMensajero ?? "0")));
      expect(claves(e.cierres.C1)).toEqual(ESPERADO_468.pagoC1.claves.map(e.ordenDe).sort());
      expect(claves(e.cierres.C2)).toEqual(ESPERADO_468.pagoC2.claves.map(e.ordenDe).sort());
      // Σ aportes = el snapshot del cierre (lo que el feed emitio como egreso y como devengado).
      const cierresDb = await e.cliente.cierreDia.findMany({
        where: { id: { in: [e.cierres.C1, e.cierres.C2] } },
        select: { id: true, totalPagoMensajero: true },
      });
      for (const c of cierresDb) expect(sumaPago(c.id)).toBe(c.totalPagoMensajero.toFixed(2));
      expect(sumaPago(e.cierres.C1)).toBe(ESPERADO_468.pagoC1.total);
      // El conteo usa el MISMO `WHERE`.
      const conteo = await e.aportes.contarAportesPorCierre({ criterio: CRITERIO_PAGO_MENSAJERO, cierreIds: [e.cierres.C1, e.cierres.C2] });
      expect(Object.fromEntries(conteo)).toEqual({ [e.cierres.C1]: 5, [e.cierres.C2]: 2 });

      // La indemnizacion: solo la gestion `incidente` con monto, y suma el egreso del feed.
      const ind = await e.aportes.listarAportesDeCierres({ criterio: CRITERIO_INDEMNIZACION, cierreIds: [e.cierres.C1, e.cierres.C2] });
      expect(ind.map((f) => f.ordenId)).toEqual([e.ordenDe("o5")]);
      const egreso = await e.cliente.walletMovimiento.findFirstOrThrow({
        where: { origenTipo: "cierre_dia", origenId: e.cierres.C2, categoria: "egreso_indemnizacion" },
        select: { monto: true },
      });
      expect(sumar(ind.flatMap((f) => f.gestiones.map((g) => g.indemnizacion ?? "0")))).toBe(egreso.monto.toFixed(2));
      expect(egreso.monto.toFixed(2)).toBe(ESPERADO_468.indemnizacionC2.total);
    });
  });

  it("T7 R28: para cada movimiento de los cuatro conceptos nuevos, el lote = el detalle de esa fila en pantalla", async () => {
    await conEscenario(async (e) => {
      const caja = await e.s.wallet.listarMovimientosCompleto({ ...VENTANA, sortBy: "fecha", sortDir: "asc" }, MAESTRO);
      if (caja.status !== "ok") throw new Error(caja.status);
      const nuevos = caja.items.filter((m) =>
        ["ingreso_cod_recaudado", "egreso_pago_mensajero", "egreso_indemnizacion"].includes(m.categoria),
      );
      const d = await e.lote.detallar(
        { superficie: "caja", movimientos: nuevos.map((m) => ({ id: m.id, categoria: m.categoria, monto: m.monto, origenTipo: m.origenTipo, origenId: m.origenId })) },
        MAESTRO,
      );
      if (d.status !== "ok") throw new Error(d.status);
      let conOrdenes = 0;
      for (const [i, m] of nuevos.entries()) {
        const pantalla = comoPantalla(await e.fila.verDetalleDeMovimientoCompleto({ movimientoId: m.id }, MAESTRO));
        expect(comoLote(d.detalle[i]), `${m.categoria} ${m.monto}`).toEqual(pantalla);
        if (d.detalle[i].modo === "ordenes" && lineasDelLote(d.detalle[i]).length > 0) conOrdenes += 1;
      }
      // cod C1, cod C2, pago C1, pago C2, indemnizacion C2 con ordenes; la de C3 sin ninguna.
      expect(nuevos).toHaveLength(6);
      expect(conOrdenes).toBe(5);

      // El pago devengado del MENSAJERO (oficina): lote = fila.
      const libro = await e.cliente.pagoMensajeroMovimiento.findMany({
        where: { mensajeroId: e.mensajeroId, categoria: "pago_devengado" },
        select: { id: true },
        orderBy: { fechaMovimiento: "asc" },
      });
      expect(libro).toHaveLength(3);
      const dm = await e.lote.detallar({ superficie: "mensajero_oficina", mensajeroId: e.mensajeroId, movimientoIds: libro.map((f) => f.id) }, MAESTRO);
      if (dm.status !== "ok") throw new Error(dm.status);
      for (const [i, f] of libro.entries()) {
        const pantalla = comoPantalla(
          await e.fila.verDetalleDeFilaDeCuenta({ cuenta: { tipo: "mensajero", id: e.mensajeroId }, movimientoId: f.id, page: 1, pageSize: 100 }, MAESTRO),
        );
        expect(comoLote(dm.detalle[i])).toEqual(pantalla);
      }
      expect(dm.detalle.slice(0, 2).every((x) => x.modo === "ordenes" && x.cuadra)).toBe(true);
    });
  });

  it("T6 R12/R14/R15: el saldo de la caja en el kardex es el de la tarjeta con el mismo corte, y cuadra fila a fila", async () => {
    await conEscenario(async (e) => {
      const r = await e.caja.kardex(VENTANA, MAESTRO);
      if (r.status !== "ok") throw new Error(r.status);
      const k = r.kardex;
      // C1: 4 conceptos del feed + contra-entrega + pago; C2: los mismos + indemnizacion; C3: flete,
      // indemnizacion y las dos correcciones del empate.
      expect(r.items.length, "la ventana no trajo los movimientos del escenario").toBe(17);
      // R14: el final es `enCaja` de la tarjeta hasta el fin del periodo; el inicial, hasta su comienzo.
      const tarjetaFin = await e.s.wallet.verResumenCaja(listarMovimientosSchema.parse({ hasta: DIA_C3 }), MAESTRO);
      const tarjetaAntes = await e.s.wallet.verResumenCaja(listarMovimientosSchema.parse({ hasta: "2037-04-09" }), MAESTRO);
      if (tarjetaFin.status !== "ok" || tarjetaAntes.status !== "ok") throw new Error("verResumenCaja");
      expect(k.saldoFinal).toBe(tarjetaFin.resumen.enCaja);
      expect(k.saldoInicial).toBe(tarjetaAntes.resumen.enCaja);
      // R15 recalculado aqui (independiente de la afirmacion del servidor).
      let saldo = new Prisma.Decimal(k.saldoInicial);
      for (const f of k.filas) {
        if (f.monto.columna === "entra") saldo = saldo.plus(f.monto.monto);
        if (f.monto.columna === "sale") saldo = saldo.minus(f.monto.monto);
        expect(f.saldo).toBe(saldo.toFixed(2));
      }
      expect(saldo.toFixed(2)).toBe(k.saldoFinal);
      // Las tres columnas tienen filas (no-vacuidad) y el flete no movio el saldo.
      expect(new Set(k.filas.map((f) => f.monto.columna))).toEqual(new Set(["entra", "sale", "cobrado_a_tiendas"]));
      // El empate: la creada ANTES va primero aunque su id sea mayor.
      const posiciones = e.empate.map((id) => r.items.findIndex((m) => m.id === id));
      expect(posiciones[0]).toBe(posiciones[1] - 1);

      // R14: sin fecha de inicio el saldo inicial es 0,00.
      const sinDesde = await e.caja.kardex(listarLibroCajaCompletoSchema.parse({ hasta: DIA_C3, categoria: "ingreso_flete" }), MAESTRO);
      expect(sinDesde.status === "ok" && sinDesde.kardex.saldoInicial).toBe("0.00");

      // R16: con un filtro de concepto, el saldo de cada fila es el de la caja ENTERA (el mismo que sin
      // filtro), y los totales suman solo lo filtrado.
      const filtrado = await e.caja.kardex({ ...VENTANA, categoria: "egreso_pago_mensajero" }, MAESTRO);
      if (filtrado.status !== "ok") throw new Error(filtrado.status);
      expect(filtrado.items).toHaveLength(2);
      expect(filtrado.kardex.conOtrosFiltros).toBe(true);
      for (const [i, m] of filtrado.items.entries()) {
        expect(filtrado.kardex.filas[i].saldo).toBe(k.filas[r.items.findIndex((x) => x.id === m.id)].saldo);
      }
      expect(filtrado.kardex.totales.sale).toBe(sumar(filtrado.items.map((m) => m.monto)));
    });
  });

  it("T9 R45/R46/R53/R57 — caja: TOTAL GENERAL = Total del periodo, cada movimiento en la hoja 2, hoja 1 identica", async () => {
    await conEscenario(async (e) => {
      const con = await e.caja.kardexConDetalle(VENTANA, MAESTRO);
      const sin = await e.caja.kardex(VENTANA, MAESTRO);
      if (con.status !== "ok" || sin.status !== "ok") throw new Error("se esperaba ok");
      expect(con.items).toEqual(sin.items);
      expect(con.kardex).toEqual(sin.kardex); // R57
      const n = afirmarInvariante(con.kardex, con.porGuia, con.items.map((m) => m.id));
      expect(n.repartibles, "sin repartibles").toBeGreaterThanOrEqual(12);
      expect(n.noRepartibles, "sin no repartibles").toBeGreaterThanOrEqual(2);
      expect(n.diferencias, "las diferencias forzadas de C3 no salieron").toBe(2);
      // R41/R42: el flete de C3 deja 500,00 sin repartir; la indemnizacion de C3, su importe entero.
      const dif = con.porGuia.sinGuia.filter((f) => f.tipo === "diferencia").map((f) => f.monto);
      expect(dif).toEqual([
        { columna: "cobrado_a_tiendas", monto: "500.00" },
        { columna: "sale", monto: "333.33" },
      ]);
      // R38/R39: la guia de o3 es UN bloque con sus dos dias y el destinatario del cierre mas reciente.
      const o3 = con.porGuia.bloques.find((b) => b.remision === e.remisionDe("o3"));
      expect(o3?.cierres).toHaveLength(2);
      expect(o3?.destinatario).toBe("Destinatario o3 nuevo");
      // R37: la guia 9 va antes que las 46800, y la orden sin guia (o7) al final.
      expect(con.porGuia.bloques[0].guia).toBe("9");
      expect(con.porGuia.bloques[con.porGuia.bloques.length - 1].guia).toBeNull();
      // R29: la caja nombra tienda y mensajero.
      expect(o3?.tiendaNombre).toBe("Tienda A 468");
      expect(o3?.mensajeroNombre).toMatch(/^Mensajero 468/);
    });
  });

  it("T9 R45/R46/R48 — tienda (oficina) y /mi-wallet: invariante y solo guias de esa tienda", async () => {
    await conEscenario(async (e) => {
      const entrada = { cuenta: { tipo: "tienda" as const, id: e.tiendaA }, sortBy: "fecha" as const, sortDir: "desc" as const };
      const con = await e.cuenta.kardexConDetalle(entrada, MAESTRO);
      const sin = await e.cuenta.kardex(entrada, MAESTRO);
      if (con.status !== "ok" || sin.status !== "ok") throw new Error("se esperaba ok");
      expect(con.kardex).toEqual(sin.kardex); // R57
      const ids = con.estado.filas.map((f) => (f.ref !== null && "libro" in f.ref ? f.ref.movimientoId : ""));
      const n = afirmarInvariante(con.kardex, con.porGuia, ids);
      expect(n.repartibles).toBeGreaterThanOrEqual(8);
      expect(n.noRepartibles).toBe(1); // el cobro manual
      expect(n.diferencias).toBe(1); // el flete de C3
      // R48: ni una guia de la tienda B, aunque los cierres las mezclen.
      const remisiones = con.porGuia.bloques.map((b) => b.remision);
      for (const ajena of ["o4", "o6"].map(e.remisionDe)) expect(remisiones).not.toContain(ajena);
      expect(con.porGuia.bloques.every((b) => b.tiendaNombre === null)).toBe(true); // R30: la columna no existe
      // R7: aunque la entrada pidiera «Más recientes», el kardex va de la mas antigua a la mas reciente.
      expect(con.estado.filas[0].fecha <= con.estado.filas[con.estado.filas.length - 1].fecha).toBe(true);

      // /mi-wallet de la tienda A: la misma invariante, sin nombres de mensajero (R49).
      const tienda: Actor = { usuarioId: e.tiendaA, rol: "adminTienda" };
      const mi = await e.cuenta.miKardexConDetalle({ sortBy: "fecha", sortDir: "asc" }, tienda);
      if (mi.status !== "ok") throw new Error(mi.status);
      afirmarInvariante(mi.kardex, mi.porGuia, mi.estado.filas.map((f) => (f.ref !== null && "libro" in f.ref ? f.ref.movimientoId : "")));
      expect(mi.porGuia.bloques.length).toBeGreaterThan(0);
      expect(JSON.stringify(mi.porGuia)).not.toContain("Mensajero 468");
      expect(mi.porGuia.totalGeneral).toEqual(con.porGuia.totalGeneral);
    });
  });

  it("T9 R31/R43/R45 — mensajero (oficina): el devengado por guia, el efectivo sin guia, y la invariante", async () => {
    await conEscenario(async (e) => {
      const entrada = { cuenta: { tipo: "mensajero" as const, id: e.mensajeroId }, sortBy: "fecha" as const, sortDir: "asc" as const };
      const con = await e.cuenta.kardexConDetalle(entrada, MAESTRO);
      if (con.status !== "ok") throw new Error(con.status);
      const ids = con.estado.filas.map((f) => (f.ref !== null && "libro" in f.ref ? f.ref.movimientoId : ""));
      const n = afirmarInvariante(con.kardex, con.porGuia, ids);
      expect(n.repartibles).toBe(3); // devengado C1, C2 y C3
      expect(n.noRepartibles).toBe(3); // efectivo C1, efectivo C2 (R43) y la liquidacion
      expect(n.diferencias).toBe(1); // el devengado de C3, sin guias (R42)
      const efectivo = con.porGuia.sinGuia.filter((f) => f.tipo === "movimiento" && f.motivo === "snapshot_del_cierre");
      expect(efectivo).toHaveLength(2);
      // R31: la hoja nombra la tienda de cada guia y no al mensajero (es su propia cuenta).
      expect(new Set(con.porGuia.bloques.map((b) => b.tiendaNombre))).toEqual(new Set(["Tienda A 468", "Tienda B 468"]));
      expect(con.porGuia.bloques.every((b) => b.mensajeroNombre === null)).toBe(true);
      // Σ de la columna «Entra» de los bloques = lo devengado de C1 + C2 (7000 + 3000).
      expect(sumar(con.porGuia.bloques.flatMap((b) => b.filas.map((f) => f.monto.monto)))).toBe("10000.00");
    });
  });
});
