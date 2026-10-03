import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { VerDetalleMovimientoServiceResult } from "@/lib/interfaces/services/IDetalleMovimientoService";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estadoCuentaCompletoSchema, estadoCuentaSchema, miEstadoCuentaCompletoSchema, miEstadoCuentaSchema, ordenesDeFilaSchema } from "@/lib/types/estado-cuenta";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import { verDetalleDeMovimientoSchema } from "@/lib/types/detalle-movimiento";
import { listarLibroCajaCompletoSchema, listarLibroCajaSchema, type WalletMovimientoDTO } from "@/lib/types/wallet";
import { CRITERIO_DE_APORTE } from "@/lib/utils/aporte-por-orden";
import { OrdenIdentificadaRepository } from "@/lib/repositories/OrdenIdentificadaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type { EstadoCuentaService } from "@/lib/services/EstadoCuentaService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, type Catalogo459 } from "./_fixtures/caja-459";
import { DIA_C1, DIA_C3, sembrar468, type Escenario468 } from "./_fixtures/libro-468";
import { montarEstadoCuenta } from "./_fixtures/wallet-458";
import { busquedaPorGuiaDe } from "./_fixtures/busqueda-469";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 469 / T3, T4, T6, T7, T9, T10, T14 — LA BUSQUEDA POR GUIA, CONTRA POSTGRES DE VERDAD.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Escenario: el de la 468 (`_fixtures/libro-468.ts`: tiendas A y B, un mensajero, C1/C2 emitidos por
// los FEEDS reales y C3 a mano) MAS lo que esta ficha necesita y alli no estaba:
//
//   · guias VIVAS en `orden.num_guia` (la 468 solo congela la de `cierre_detail`; la busqueda identifica
//     por la orden viva, design §2.1);
//   · `o11` de la tienda B, fuera de todo cierre, con la MISMA remision viva que `o1` (R7) y guia propia;
//   · una nota manual de la caja, un ajuste de la tienda A y otro de la tienda B que llevan la guia de
//     `o1` en la descripcion (R10 / R5);
//   · los movimientos de UNA sola orden de `o1` (R14, pregunta abierta 1 aprobada): el cobro por rechazo
//     (caja y tienda, origen `gestion_orden`) y la indemnizacion por incidente (caja, `orden_incidente`);
//     y un cobro por rechazo de OTRA orden (`o2`) que no debe salir.
//
// Por que contra la base: en este repo una mutacion del `WHERE` pasa en verde por delante de un doble
// (medido cuatro veces). El ORACULO de R11 no es el SQL de la busqueda: es el detalle de cada fila.
// No-vacuidad: cada caso afirma primero que el escenario trae las filas que va a mirar. Sin base, se SALTA.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-000000000469", rol: "maestro" };
const VENTANA = { desde: DIA_C1, hasta: DIA_C3 };

interface Escenario469 extends Escenario468 {
  guia: (clave: string) => string;
  remisionViva: (clave: string) => string;
  ec: EstadoCuentaService;
  /** Ids de lo sembrado aqui. */
  notaCaja: string;
  ajusteTiendaA: string;
  ajusteTiendaB: string;
  cobroCajaO1: string[];
  cobroTiendaO1: string;
  incidenteCajaO1: string;
  cobroCajaO2: string;
}

async function sembrar469(tx: TxDeTest, cat: Catalogo459): Promise<Escenario469> {
  const e = await sembrar468(tx, cat);
  const cliente = e.cliente;

  // ── Guias vivas: 9 cifras al azar (caben en int4, R3), unicas en la base ─────────────────────
  const base = 800_000_000 + Math.floor(Math.random() * 90_000_000);
  const guias = new Map<string, number>();
  for (const [i, clave] of ["o1", "o2", "o3", "o4", "o5", "o6", "o9"].entries()) {
    guias.set(clave, base + i * 10);
    await tx.orden.update({ where: { id: e.ordenDe(clave) }, data: { numGuia: base + i * 10 } });
  }
  // o11: tienda B, fuera de cierre, MISMA remision viva que o1 (R7) y guia propia.
  const o1 = await tx.orden.findUniqueOrThrow({ where: { id: e.ordenDe("o1") } });
  const o11 = randomUUID();
  await tx.orden.create({
    data: {
      id: o11,
      numRemision: o1.numRemision,
      numGuia: base + 1000,
      estatusId: o1.estatusId,
      destinatario: "Vivo o11",
      telefonoDest: "00000000",
      tiendaId: e.tiendaB,
      zonaId: o1.zonaId,
      provinciaId: o1.provinciaId,
      cantonId: o1.cantonId,
      producto: "Caja",
      cobraComision: false,
    },
  });
  guias.set("o11", base + 1000);
  const g = (clave: string) => {
    const v = guias.get(clave);
    if (v === undefined) throw new Error(`sin guia viva para ${clave}`);
    return String(v);
  };

  const cajaRepo = new WalletMovimientoRepository(cliente);
  const tiendaRepo = new WalletTiendaMovimientoRepository(cliente);
  const enC3 = (s: number) => new Date(`${DIA_C3}T15:00:00.000Z`).getTime() + s * 1000;
  const fecha = (s: number) => new Date(enC3(s));

  // ── R10 / R5: la guia de o1 escrita en descripciones ─────────────────────────────────────────
  const notaCaja = randomUUID();
  await tx.walletMovimiento.create({
    data: { id: notaCaja, tipo: "ingreso", categoria: "ingreso_ajuste", monto: new Prisma.Decimal("10.00"), origenTipo: "manual", origenId: null, descripcion: `Nota de la guia ${g("o1")}`, fechaMovimiento: fecha(120) },
  });
  const ajusteTiendaA = randomUUID();
  const ajusteTiendaB = randomUUID();
  await tx.walletTiendaMovimiento.create({
    data: { id: ajusteTiendaA, tiendaId: e.tiendaA, tipo: "debito", categoria: "ajuste_debito", monto: new Prisma.Decimal("11.00"), origenTipo: "manual", origenId: null, descripcion: `Ajuste guia ${g("o1")}`, fechaMovimiento: fecha(121) },
  });
  await tx.walletTiendaMovimiento.create({
    data: { id: ajusteTiendaB, tiendaId: e.tiendaB, tipo: "debito", categoria: "ajuste_debito", monto: new Prisma.Decimal("12.00"), origenTipo: "manual", origenId: null, descripcion: `Ajuste guia ${g("o1")}`, fechaMovimiento: fecha(122) },
  });

  // ── R14: los movimientos de UNA sola orden ───────────────────────────────────────────────────
  const gestionRechazo = async (clave: string) => {
    const gestion = await tx.gestionOrden.create({
      data: { ordenId: e.ordenDe(clave), mensajeroId: e.mensajeroId, resultado: "devolucion_a_origen_por_rechazo", cierreId: e.cierres.C3 },
      select: { id: true },
    });
    await e.s.rechazoCobroRepo.crearPendiente(tx, {
      gestionId: gestion.id,
      ordenId: e.ordenDe(clave),
      tiendaId: e.tiendaA,
      montoFlete: "400.00",
      montoIva: "52.00",
      tarifaId: null,
      generadoEl: DIA_C3,
    });
    return gestion.id;
  };
  const gestionO1 = await gestionRechazo("o1");
  const gestionO2 = await gestionRechazo("o2");
  // Los apuntes del cobro aprobado, con el origen que escribe `RechazoTiendaCobroService.aprobar`.
  expect(
    await cajaRepo.crearMovimientos(cliente, [
      { tipo: "ingreso", categoria: "ingreso_flete_devolucion", monto: "400.00", origenTipo: "gestion_orden", origenId: gestionO1, fechaMovimiento: fecha(130) },
      { tipo: "ingreso", categoria: "ingreso_iva_flete_devolucion", monto: "52.00", origenTipo: "gestion_orden", origenId: gestionO1, fechaMovimiento: fecha(130) },
      { tipo: "ingreso", categoria: "ingreso_flete_devolucion", monto: "400.00", origenTipo: "gestion_orden", origenId: gestionO2, fechaMovimiento: fecha(131) },
    ]),
  ).toBe(3);
  expect(
    await tiendaRepo.crearMovimientos(cliente, [
      { tiendaId: e.tiendaA, tipo: "debito", categoria: "flete_devolucion", monto: "400.00", origenTipo: "gestion_orden", origenId: gestionO1, fechaMovimiento: fecha(130) },
    ]),
  ).toBe(1);
  const incidente = await tx.ordenIncidente.create({
    data: { ordenId: e.ordenDe("o1"), causa: "danado", motivo: "Incidente 469", reportadoPor: e.mensajeroId, estado: "aprobado", indemnizacion: new Prisma.Decimal("900.00"), resueltoPor: e.tiendaB, resueltoAt: fecha(140) },
    select: { id: true },
  });
  expect(
    await cajaRepo.crearMovimientos(cliente, [
      { tipo: "egreso", categoria: "egreso_indemnizacion", monto: "900.00", origenTipo: "orden_incidente", origenId: incidente.id, fechaMovimiento: fecha(140) },
    ]),
  ).toBe(1);

  const idsCaja = async (where: Prisma.WalletMovimientoWhereInput) =>
    (await tx.walletMovimiento.findMany({ where, select: { id: true }, orderBy: { categoria: "asc" } })).map((m) => m.id);
  const cobroCajaO1 = await idsCaja({ origenTipo: "gestion_orden", origenId: gestionO1 });
  const [cobroCajaO2] = await idsCaja({ origenTipo: "gestion_orden", origenId: gestionO2 });
  const [incidenteCajaO1] = await idsCaja({ origenTipo: "orden_incidente", origenId: incidente.id });
  const cobroTiendaO1 = (await tx.walletTiendaMovimiento.findFirstOrThrow({ where: { origenTipo: "gestion_orden", origenId: gestionO1 }, select: { id: true } })).id;
  expect(cobroCajaO1).toHaveLength(2);

  return {
    ...e,
    guia: g,
    remisionViva: (clave) => (clave === "o1" || clave === "o11" ? o1.numRemision : `VIVA-${e.remisionDe(clave)}`),
    ec: montarEstadoCuenta(e.s),
    notaCaja,
    ajusteTiendaA,
    ajusteTiendaB,
    cobroCajaO1,
    cobroTiendaO1,
    incidenteCajaO1,
    cobroCajaO2,
  };
}

/** El libro de la caja en la ventana, todas las paginas (pageSize 100 basta: el escenario trae ~25). */
async function libroCaja(e: Escenario469, extra: Record<string, unknown> = {}) {
  const r = await e.s.wallet.listarMovimientos(listarLibroCajaSchema.parse({ ...VENTANA, pageSize: 100, ...extra }), MAESTRO);
  if (r.status !== "ok") throw new Error(r.status);
  expect(r.data.movimientos.length, "el libro no cabe en una pagina: subir pageSize").toBe(r.data.total);
  return r.data;
}

async function cuenta(e: Escenario469, c: { tipo: "tienda" | "mensajero"; id: string }, extra: Record<string, unknown> = {}): Promise<EstadoCuentaDTO> {
  const r = await e.ec.leer(estadoCuentaSchema.parse({ cuenta: c, pageSize: 100, ...extra }), MAESTRO);
  if (r.status !== "ok") throw new Error(r.status);
  expect(r.estado.filas.length).toBe(r.estado.total);
  return r.estado;
}

const idDeFila = (f: FilaEstadoCuentaDTO) => (f.ref !== null && "libro" in f.ref ? f.ref.movimientoId : null);

/** Lo que lista el detalle de una fila (todas sus ordenes), o `null` si no reparte. */
function ordenesDelDetalle(r: VerDetalleMovimientoServiceResult): string[] | null {
  if (r.status === "sin_reparto") return null;
  if (r.status !== "ok") throw new Error(`el detalle respondio ${r.status}`);
  expect(r.data.ordenes.length, "el detalle no cabe en una pagina").toBe(r.data.total);
  return r.data.ordenes.map((o) => o.ordenId);
}

function afirmarInvariante468(kardex: KardexDTO, porGuia: DetallePorGuiaDTO) {
  expect(porGuia.totalGeneral, "R31: el TOTAL GENERAL no es el «Total del periodo»").toEqual(kardex.totales);
  expect(kardex.conOtrosFiltros, "R32: falta el aviso de filtros de la 468").toBe(true);
}

describeSiHayBase("469 — buscar una guia en el libro de la wallet (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Catalogo459;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const conEscenario = <T>(fn: (e: Escenario469) => Promise<T>) =>
    enTransaccionRevertida459(prisma, async (tx) => fn(await sembrar469(tx, cat)));

  it("T3 R3/R4/R5/R7: guia completa, remision sin mayusculas, tiendaId acota y una remision de dos tiendas da las dos", async () => {
    await conEscenario(async (e) => {
      const repo = new OrdenIdentificadaRepository(e.cliente);
      const servicio = busquedaPorGuiaDe(e.cliente);
      const ids = async (termino: string, tiendaId?: string) =>
        (await servicio.identificar({ termino, ...(tiendaId !== undefined ? { tiendaId } : {}) })).sort();
      const o1 = e.ordenDe("o1");
      const o11 = (await e.cliente.orden.findFirstOrThrow({ where: { numGuia: Number(e.guia("o11")) }, select: { id: true } })).id;

      // Guia exacta si; prefijo, sufijo y cero inicial no (R3).
      expect(await ids(e.guia("o1"))).toEqual([o1]);
      expect(await ids(e.guia("o1").slice(0, 8))).toEqual([]);
      expect(await ids(e.guia("o1").slice(1))).toEqual([]);
      expect(await ids(`0${e.guia("o1")}`)).toEqual([]);
      // Remision: igualdad completa y sin mayusculas (R3/R4). Sin tienda, las DOS ordenes (R7).
      const rem = e.remisionViva("o1");
      expect(await ids(rem.toLowerCase())).toEqual([o1, o11].sort());
      expect(await ids(rem.slice(0, -1))).toEqual([]);
      // `%`/`_` no son comodines.
      expect(await ids(`${rem.slice(0, -1)}_`)).toEqual([]);
      // tiendaId acota la remision Y la guia (R5).
      expect(await ids(rem, e.tiendaA)).toEqual([o1]);
      expect(await ids(rem, e.tiendaB)).toEqual([o11]);
      expect(await ids(e.guia("o1"), e.tiendaB)).toEqual([]);
      // Un termino de 10 cifras no revienta el int4: simplemente no identifica (no escribe la rama de la guia).
      expect(await ids("9999999999")).toEqual([]);
      // El repositorio sin `guia` no escribe esa rama: un termino numerico solo casa por remision.
      expect(await repo.identificar({ termino: e.guia("o1") })).toEqual([]);
    });
  });

  it("T4 R9: la orden esta en el cierre pero no aporta a ese concepto ⇒ cierresDondeAporta no la trae", async () => {
    await conEscenario(async (e) => {
      // No-vacuidad: o9 esta en C1 (novedad, sin pago) y en C2 (entregada); o4 (sin comision) en C1.
      const pares = await e.cliente.cierreDetail.findMany({ where: { ordenId: { in: [e.ordenDe("o9"), e.ordenDe("o4")] } }, select: { cierreId: true, ordenId: true } });
      expect(pares).toHaveLength(3);
      const flete = await e.aportes.cierresDondeAporta({ criterio: CRITERIO_DE_APORTE.ingreso_flete, pares });
      expect(flete.map((p) => `${p.cierreId}|${p.ordenId}`).sort()).toEqual(
        [`${e.cierres.C1}|${e.ordenDe("o4")}`, `${e.cierres.C2}|${e.ordenDe("o9")}`].sort(),
      );
      // C1 SI tiene comision (o1, o2…), pero o4 no cobra comision: no aporta.
      const comisionC1 = await e.cliente.walletMovimiento.count({ where: { origenTipo: "cierre_dia", origenId: e.cierres.C1, categoria: "ingreso_comision_cod" } });
      expect(comisionC1).toBe(1);
      expect(await e.aportes.cierresDondeAporta({ criterio: CRITERIO_DE_APORTE.ingreso_comision_cod, pares })).toEqual([]);
      // tiendaId acota: o4 es de la tienda B.
      expect(await e.aportes.cierresDondeAporta({ criterio: CRITERIO_DE_APORTE.ingreso_flete, pares, tiendaId: e.tiendaA })).toEqual([
        { cierreId: e.cierres.C2, ordenId: e.ordenDe("o9") },
      ]);
    });
  });

  it("T9 R8/R9/R11/R12/R15 — caja: diferencial «sale» ⇔ «su detalle lista la orden», para cada fila repartible", async () => {
    await conEscenario(async (e) => {
      const entero = await libroCaja(e);
      const repartibles = entero.movimientos.filter((m) => m.origenTipo === "cierre_dia");
      expect(repartibles.length, "el escenario no trajo filas de cierre").toBeGreaterThanOrEqual(15);
      const detalle = new Map<string, string[] | null>();
      for (const m of repartibles) {
        detalle.set(m.id, ordenesDelDetalle(await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: m.id, pageSize: 100 }), MAESTRO)));
      }
      let positivos = 0;
      let negativosEnSuCierre = 0;
      for (const clave of ["o1", "o3", "o4", "o5", "o9"]) {
        const r = await libroCaja(e, { q: e.guia(clave) });
        expect(r.modoBusqueda, clave).toBe("guia");
        const salen = new Set(r.movimientos.map((m) => m.id));
        expect(salen.size, `R15: una fila repetida para ${clave}`).toBe(r.movimientos.length);
        const cierresDeLaOrden = new Set(
          (await e.cliente.cierreDetail.findMany({ where: { ordenId: e.ordenDe(clave) }, select: { cierreId: true } })).map((c) => c.cierreId),
        );
        for (const m of repartibles) {
          const lista = detalle.get(m.id) ?? null;
          const aporta = lista !== null && lista.includes(e.ordenDe(clave));
          expect(salen.has(m.id), `R11 ${clave}: ${m.categoria} de ${m.origenId}`).toBe(aporta);
          if (aporta) positivos += 1;
          else if (m.origenId !== null && cierresDeLaOrden.has(m.origenId)) negativosEnSuCierre += 1;
        }
      }
      expect(positivos, "el diferencial no encontro ni una fila que salga").toBeGreaterThanOrEqual(15);
      expect(negativosEnSuCierre, "R9: ninguna fila del cierre de la orden quedo fuera (el diferencial no mide nada)").toBeGreaterThanOrEqual(10);

      // R12: los cuatro conceptos de la 468 alcanzables (o1 en C1: contra-entrega y pago; o5 en C2: indemnizacion).
      const cats = async (clave: string) => (await libroCaja(e, { q: e.guia(clave) })).movimientos.filter((m) => m.origenTipo === "cierre_dia").map((m) => m.categoria).sort();
      expect(await cats("o1")).toEqual(
        ["egreso_pago_mensajero", "ingreso_cod_recaudado", "ingreso_comision_cod", "ingreso_flete", "ingreso_iva_comision_cod", "ingreso_iva_flete"].sort(),
      );
      expect(await cats("o5")).toContain("egreso_indemnizacion");
      // R9 escrito: o9 esta en C1 y en C1 no aporta a nada; en C2 solo flete, IVA y pago.
      const o9 = (await libroCaja(e, { q: e.guia("o9") })).movimientos;
      expect(o9.every((m) => m.origenId === e.cierres.C2)).toBe(true);
      expect(o9.map((m) => m.categoria).sort()).toEqual(["egreso_pago_mensajero", "ingreso_flete", "ingreso_iva_flete"]);
    });
  });

  it("T6/T9 R10/R14/R16/R19/R20/R22/R7 — caja: sin el texto, con los de una sola orden, AND con filtros, total exacto y orden", async () => {
    await conEscenario(async (e) => {
      const g1 = e.guia("o1");
      // No-vacuidad de R10: la busqueda de TEXTO de esa cifra si encuentra la nota (la de la 463).
      const texto = await libroCaja(e, { q: `guia ${g1}` });
      expect(texto.modoBusqueda).toBe("texto");
      expect(texto.movimientos.map((m) => m.id)).toEqual([e.notaCaja]);

      const r = await libroCaja(e, { q: g1 });
      const ids = r.movimientos.map((m) => m.id);
      expect(ids, "R10: la nota con la guia en la descripcion salio").not.toContain(e.notaCaja);
      // R14: el cobro por rechazo (sus dos apuntes) y la indemnizacion por incidente de o1, y NO el cobro de o2.
      for (const id of [...e.cobroCajaO1, e.incidenteCajaO1]) expect(ids).toContain(id);
      expect(ids).not.toContain(e.cobroCajaO2);
      expect(r.total).toBe(6 + 3); // R19: los 6 de C1 + los 3 de una sola orden

      // R7: la remision compartida con o11 (tienda B, sin dinero) da lo mismo que la guia de o1.
      const porRemision = await libroCaja(e, { q: e.remisionViva("o1").toLowerCase() });
      expect(porRemision.modoBusqueda).toBe("guia");
      expect(porRemision.movimientos.map((m) => m.id).sort()).toEqual([...ids].sort());

      // R16: AND con concepto, Entra/Sale y periodo.
      const flete = await libroCaja(e, { q: g1, categoria: "ingreso_flete" });
      expect(flete.movimientos.map((m) => m.origenId)).toEqual([e.cierres.C1]);
      const egresos = await libroCaja(e, { q: g1, tipo: "egreso" });
      expect(egresos.movimientos.map((m) => m.categoria).sort()).toEqual(["egreso_indemnizacion", "egreso_pago_mensajero"]);
      const soloC3 = await libroCaja(e, { q: g1, desde: DIA_C3 });
      expect(soloC3.movimientos.map((m) => m.id).sort()).toEqual([...e.cobroCajaO1, e.incidenteCajaO1].sort());

      // R19/R20: paginas de 2 en los dos sentidos = la lectura entera; asc = desc al reves.
      const paginas = async (sortDir: "asc" | "desc") => {
        const filas: WalletMovimientoDTO[] = [];
        for (let page = 1; ; page += 1) {
          const p = await e.s.wallet.listarMovimientos(listarLibroCajaSchema.parse({ ...VENTANA, q: g1, sortDir, page, pageSize: 2 }), MAESTRO);
          if (p.status !== "ok") throw new Error(p.status);
          expect(p.data.total).toBe(r.total);
          filas.push(...p.data.movimientos);
          if (p.data.movimientos.length < 2) break;
        }
        return filas.map((m) => m.id);
      };
      const desc = await paginas("desc");
      const asc = await paginas("asc");
      expect(desc).toEqual(ids);
      expect(asc).toEqual([...desc].reverse());

      // R22: la guia de o11 identifica una orden (tienda B) que no aporta a nada: modo guia, 0 filas.
      const vacia = await libroCaja(e, { q: e.guia("o11") });
      expect(vacia.modoBusqueda).toBe("guia");
      expect(vacia.total).toBe(0);
      // R6: un termino que no identifica nada es la busqueda de texto de siempre.
      const nada = await libroCaja(e, { q: "zzz-469-no-existe" });
      expect(nada.modoBusqueda).toBe("texto");
    });
  });

  it("T7/T9 R13/R16/R17/R18/R19 — mensajero: el devengado si, el efectivo no; corrido y tarjetas intactos", async () => {
    await conEscenario(async (e) => {
      const c = { tipo: "mensajero" as const, id: e.mensajeroId };
      const entera = await cuenta(e, c);
      const efectivoC2 = entera.filas.filter((f) => f.categoria === "pago_efectivo");
      expect(efectivoC2.length, "el escenario no trajo el pago tomado del efectivo").toBe(2);

      const r = await cuenta(e, c, { q: e.guia("o9") });
      expect(r.modoBusqueda).toBe("guia");
      expect(r.filas.map((f) => f.categoria)).toEqual(["pago_devengado"]); // R13: sin pago_efectivo
      const id = idDeFila(r.filas[0]);
      // R11: ese devengado es el de C2 y su detalle lista a o9.
      const det = ordenesDelDetalle(await e.fila.verDetalleDeFilaDeCuenta(ordenesDeFilaSchema.parse({ cuenta: c, movimientoId: id, pageSize: 100 }), MAESTRO));
      expect(det).toContain(e.ordenDe("o9"));
      // R17: el corrido de la fila encontrada es el de la cuenta entera.
      const corrido = new Map(entera.filas.map((f) => [idDeFila(f), f.saldoCorrido]));
      expect(r.filas[0].saldoCorrido).toBe(corrido.get(id));
      // R18: las tarjetas no cambian.
      const tarjetas = (x: EstadoCuentaDTO) => [x.saldoInicial, x.abonos, x.cargos, x.saldoFinal, x.saldoActual];
      expect(tarjetas(r)).toEqual(tarjetas(entera));
      // R16: AND con el cierre: con C1 no sale nada (o9 esta en C1 pero no aporta).
      const enC1 = await cuenta(e, c, { q: e.guia("o9"), cierreId: e.cierres.C1 });
      expect(enC1.total).toBe(0);
      expect(enC1.modoBusqueda).toBe("guia");
    });
  });

  it("T7/T9 R5/R10/R11/R14/R17/R18/R19/R20 — tienda (oficina) y /mi-wallet", async () => {
    await conEscenario(async (e) => {
      const g1 = e.guia("o1");
      const cA = { tipo: "tienda" as const, id: e.tiendaA };
      const entera = await cuenta(e, cA);
      const r = await cuenta(e, cA, { q: g1 });
      expect(r.modoBusqueda).toBe("guia");
      const ids = r.filas.map(idDeFila);
      // R10: el ajuste con la guia en la descripcion no sale. R14: el cobro por rechazo de o1 si.
      expect(ids).not.toContain(e.ajusteTiendaA);
      expect(r.filas.some((f) => f.origenTipo === "gestion_orden")).toBe(true);
      // R11 (diferencial en la tienda): cada fila de cierre sale ⇔ su detalle (acotado a la tienda) lista o1.
      const deCierre = entera.filas.filter((f) => f.origenTipo === "cierre_dia");
      expect(deCierre.length).toBeGreaterThanOrEqual(8);
      let salen = 0;
      for (const f of deCierre) {
        const det = ordenesDelDetalle(await e.fila.verDetalleDeFilaDeCuenta(ordenesDeFilaSchema.parse({ cuenta: cA, movimientoId: idDeFila(f), pageSize: 100 }), MAESTRO));
        const aporta = det !== null && det.includes(e.ordenDe("o1"));
        expect(ids.includes(idDeFila(f)), `R11 tienda: ${f.categoria}`).toBe(aporta);
        if (aporta) salen += 1;
      }
      expect(salen).toBe(5); // flete, IVA, comision, IVA comision y contra-entrega de C1
      expect(r.total).toBe(salen + 1); // R19: + el cobro por rechazo
      // R17/R18.
      const clave = (f: FilaEstadoCuentaDTO) => idDeFila(f) ?? `${f.fecha}|${f.categoria}|${f.origenTipo}|${f.cargo}|${f.abono}`;
      const corrido = new Map(entera.filas.map((f) => [clave(f), f.saldoCorrido]));
      expect(corrido.size, "dos filas de la cuenta comparten clave").toBe(entera.filas.length);
      for (const f of r.filas) expect(f.saldoCorrido, `R17: ${f.categoria}`).toBe(corrido.get(clave(f)));
      expect([r.saldoInicial, r.abonos, r.cargos, r.saldoFinal]).toEqual([entera.saldoInicial, entera.abonos, entera.cargos, entera.saldoFinal]);
      // R20.
      const asc = await cuenta(e, cA, { q: g1, sortDir: "asc" });
      expect(asc.filas.map(idDeFila)).toEqual([...ids].reverse());

      // R5: en la tienda B la guia de o1 (tienda A) es una busqueda de TEXTO, identica a la de la 463:
      // encuentra el ajuste de B que la lleva en la descripcion, y nada mas.
      const cB = { tipo: "tienda" as const, id: e.tiendaB };
      const b = await cuenta(e, cB, { q: g1 });
      expect(b.modoBusqueda).toBe("texto");
      expect(b.filas.map(idDeFila)).toEqual([e.ajusteTiendaB]);
      const tiendaB: Actor = { usuarioId: e.tiendaB, rol: "adminTienda" };
      const mi = await e.ec.leerMiTienda(miEstadoCuentaSchema.parse({ q: g1, pageSize: 100 }), tiendaB);
      if (mi.status !== "ok") throw new Error(mi.status);
      expect(mi.estado.modoBusqueda).toBe("texto");
      expect(mi.estado.filas.map(idDeFila)).toEqual([e.ajusteTiendaB]);
      // /mi-wallet de A: lo mismo que la oficina de A.
      const miA = await e.ec.leerMiTienda(miEstadoCuentaSchema.parse({ q: g1, pageSize: 100 }), { usuarioId: e.tiendaA, rol: "adminTienda" });
      if (miA.status !== "ok") throw new Error(miA.status);
      expect(miA.estado.modoBusqueda).toBe("guia");
      expect(miA.estado.filas.map(idDeFila)).toEqual(ids);
    });
  });

  it("T10 R25/R26/R27/R28/R29 — el detalle con la guia destacada", async () => {
    await conEscenario(async (e) => {
      const caja = await libroCaja(e);
      const fleteC1 = caja.movimientos.find((m) => m.origenId === e.cierres.C1 && m.categoria === "ingreso_flete");
      if (fleteC1 === undefined) throw new Error("sin flete de C1");
      // La lista entera: o1, o2, o4 (guias congeladas 46801/2/4) y o7 sin guia al final.
      const entero = await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteC1.id, pageSize: 100 }), MAESTRO);
      if (entero.status !== "ok") throw new Error(entero.status);
      const posO4 = entero.data.ordenes.findIndex((o) => o.ordenId === e.ordenDe("o4"));
      expect(posO4, "o4 no esta en la pagina 2 o despues con pageSize 1").toBeGreaterThanOrEqual(1);
      const filaO4 = entero.data.ordenes[posO4];

      // R25/R27: con pageSize 1 y la pagina 1 (donde NO esta o4), o4 sale destacada con el MISMO aporte.
      const p1 = await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteC1.id, pageSize: 1, resaltar: e.guia("o4") }), MAESTRO);
      if (p1.status !== "ok") throw new Error(p1.status);
      expect(p1.data.destacadas.map((o) => [o.ordenId, o.aporte])).toEqual([[filaO4.ordenId, filaO4.aporte]]);
      expect(p1.data.ordenes.map((o) => o.resaltada)).toEqual([false]);
      // R26: en SU pagina, solo ella va resaltada.
      const suya = await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteC1.id, pageSize: 1, page: posO4 + 1, resaltar: e.guia("o4") }), MAESTRO);
      if (suya.status !== "ok") throw new Error(suya.status);
      expect(suya.data.ordenes.map((o) => [o.ordenId, o.resaltada])).toEqual([[filaO4.ordenId, true]]);
      // R28: sin resaltar, nada destacado ni resaltado.
      expect(entero.data.destacadas).toEqual([]);
      expect(entero.data.ordenes.every((o) => o.resaltada === false)).toBe(true);
      // Una orden identificada que NO aporta a ese concepto (o9 esta en C1 sin aportar al flete) no se destaca.
      const o9 = await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteC1.id, pageSize: 100, resaltar: e.guia("o9") }), MAESTRO);
      if (o9.status !== "ok") throw new Error(o9.status);
      expect(o9.data.destacadas).toEqual([]);

      // R29: la tienda B abre SU flete de C1 (o4 aporta): con la guia de o1 (tienda A) nada; con la de o4, o4.
      const tiendaB: Actor = { usuarioId: e.tiendaB, rol: "adminTienda" };
      const fleteB = await e.cliente.walletTiendaMovimiento.findFirstOrThrow({ where: { tiendaId: e.tiendaB, origenTipo: "cierre_dia", origenId: e.cierres.C1, categoria: "flete" }, select: { id: true } });
      const ajena = await e.fila.verDetalleDeMiMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteB.id, pageSize: 100, resaltar: e.guia("o1") }), tiendaB);
      if (ajena.status !== "ok") throw new Error(ajena.status);
      expect(ajena.data.ordenes.length).toBeGreaterThan(0);
      expect(ajena.data.destacadas).toEqual([]);
      expect(ajena.data.ordenes.every((o) => !o.resaltada)).toBe(true);
      const propia = await e.fila.verDetalleDeMiMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: fleteB.id, pageSize: 100, resaltar: e.guia("o4") }), tiendaB);
      if (propia.status !== "ok") throw new Error(propia.status);
      expect(propia.data.destacadas.map((o) => o.ordenId)).toEqual([e.ordenDe("o4")]);

      // Un movimiento sin reparto sigue sin reparto aunque llegue `resaltar`.
      const sin = await e.fila.verDetalleDeMovimiento(verDetalleDeMovimientoSchema.parse({ movimientoId: e.incidenteCajaO1, resaltar: e.guia("o1") }), MAESTRO);
      expect(sin.status).toBe("sin_reparto");
    });
  });

  it("T14 R30/R31/R32 — la descarga con busqueda por guia: mismas filas que la pantalla y la hoja 2 cuadra", async () => {
    await conEscenario(async (e) => {
      const g1 = e.guia("o1");
      // Caja.
      const pantalla = await libroCaja(e, { q: g1 });
      const caja = await e.caja.kardexConDetalle(listarLibroCajaCompletoSchema.parse({ ...VENTANA, q: g1 }), MAESTRO);
      if (caja.status !== "ok") throw new Error(caja.status);
      expect(caja.items.length).toBeGreaterThan(0);
      expect(caja.items.map((m) => m.id).sort()).toEqual(pantalla.movimientos.map((m) => m.id).sort()); // R30
      afirmarInvariante468(caja.kardex, caja.porGuia); // R31/R32
      expect(caja.porGuia.bloques.length).toBeGreaterThan(0);
      // R31: un bloque por cada guia que aporta a algun movimiento de la hoja 1 (las de C1, no solo o1).
      expect(caja.porGuia.bloques.length).toBeGreaterThan(1);

      // Tienda A (oficina) y /mi-wallet de A.
      const cA = { tipo: "tienda" as const, id: e.tiendaA };
      const pantallaA = await cuenta(e, cA, { q: g1 });
      const tienda = await e.cuenta.kardexConDetalle(estadoCuentaCompletoSchema.parse({ cuenta: cA, q: g1 }), MAESTRO);
      if (tienda.status !== "ok") throw new Error(tienda.status);
      expect(tienda.estado.filas.map(idDeFila).sort()).toEqual(pantallaA.filas.map(idDeFila).sort());
      afirmarInvariante468(tienda.kardex, tienda.porGuia);
      const mi = await e.cuenta.miKardexConDetalle(miEstadoCuentaCompletoSchema.parse({ q: g1 }), { usuarioId: e.tiendaA, rol: "adminTienda" });
      if (mi.status !== "ok") throw new Error(mi.status);
      expect(mi.estado.filas.map(idDeFila).sort()).toEqual(pantallaA.filas.map(idDeFila).sort());
      afirmarInvariante468(mi.kardex, mi.porGuia);

      // Mensajero.
      const cM = { tipo: "mensajero" as const, id: e.mensajeroId };
      const pantallaM = await cuenta(e, cM, { q: e.guia("o9") });
      const men = await e.cuenta.kardexConDetalle(estadoCuentaCompletoSchema.parse({ cuenta: cM, q: e.guia("o9") }), MAESTRO);
      if (men.status !== "ok") throw new Error(men.status);
      expect(men.estado.filas.map(idDeFila)).toEqual(pantallaM.filas.map(idDeFila));
      expect(men.estado.filas).toHaveLength(1);
      afirmarInvariante468(men.kardex, men.porGuia);
    });
  });
});
