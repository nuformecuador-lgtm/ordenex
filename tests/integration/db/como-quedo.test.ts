import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { comoQuedoAction } from "@/lib/actions/como-quedo";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { ComoQuedoRepository } from "@/lib/repositories/ComoQuedoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { ComoQuedoService } from "@/lib/services/ComoQuedoService";
import type { ComoQuedoDTO, ComoQuedoResult } from "@/lib/types/como-quedo";
import { listarMovimientosSchema, type AgregadoCajaRow, type WalletMovimientoCategoria, type WalletMovimientoTipo } from "@/lib/types/wallet";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.13 (R58, parte servidor) — «Cómo quedó» contra Postgres, sobre el escenario de la
// fase 0 de la 459. Lo esperado se calcula APARTE: se leen los libros enteros en su orden (`fecha,
// created_at, id`), se corta el PREFIJO hasta la fila en JS, se suma por categoria con Decimal y se
// deriva. El servicio, en cambio, compara tuplas en SQL. Si la posicion o la contrapartida se
// equivocan, los dos caminos discrepan.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface FilaCaja { id: string; categoria: string; tipo: string; monto: string; origen_tipo: string; origen_id: string | null }
interface FilaCuenta { id: string; tipo: string; monto: string; origen_tipo: string; origen_id: string | null }

function agregar(filas: FilaCaja[]): AgregadoCajaRow[] {
  const m = new Map<string, AgregadoCajaRow>();
  for (const f of filas) {
    const k = `${f.categoria}|${f.tipo}`;
    const prev = m.get(k);
    const total = new Prisma.Decimal(prev?.total ?? 0).add(f.monto).toFixed(2);
    m.set(k, { categoria: f.categoria as WalletMovimientoCategoria, tipo: f.tipo as WalletMovimientoTipo, total });
  }
  return [...m.values()];
}

function sumar(filas: FilaCuenta[], tipo: string): string {
  return filas.filter((f) => f.tipo === tipo).reduce((a, f) => a.add(f.monto), new Prisma.Decimal(0)).toFixed(2);
}

interface Medida {
  r: Record<string, ComoQuedoResult>;
  esperado: Record<string, ComoQuedoDTO>;
  resumenSinFiltros: { enCaja: string; ganancia: string; deTerceros: string; capital: string };
  pagoConReverso: boolean;
}

describeSiHayBase("458-B/TB.13 — «Cómo quedó» (Postgres real)", () => {
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
        const maestro = esc.maestro;
        const servicio = new ComoQuedoService(new ComoQuedoRepository(c), new WalletMovimientoRepository(c), new AporteCapitalRepository(c));
        const deps = (actor: Actor) => ({ getActor: async () => actor, service: servicio });
        const ver = (libro: "caja" | "tienda" | "mensajero", movimientoId: string, actor: Actor = maestro) =>
          comoQuedoAction({ destino: { libro, movimientoId } }, deps(actor));

        const cajaEntera = await tx.$queryRaw<FilaCaja[]>`
          SELECT id, categoria::text AS categoria, tipo::text AS tipo, monto::text AS monto, origen_tipo::text AS origen_tipo, origen_id
          FROM wallet_movimiento ORDER BY fecha_movimiento, created_at, id`;
        const tiendaEntera = (tiendaId: string) => tx.$queryRaw<FilaCuenta[]>`
          SELECT id, tipo::text AS tipo, monto::text AS monto, origen_tipo::text AS origen_tipo, origen_id
          FROM wallet_tienda_movimiento WHERE tienda_id = ${tiendaId} ORDER BY fecha_movimiento, created_at, id`;
        const mensajeroEntero = (mensajeroId: string) => tx.$queryRaw<FilaCuenta[]>`
          SELECT id, tipo::text AS tipo, monto::text AS monto, origen_tipo::text AS origen_tipo, origen_id
          FROM pago_mensajero_movimiento WHERE mensajero_id = ${mensajeroId} ORDER BY fecha_movimiento, created_at, id`;

        const haySaldo = await new AporteCapitalRepository(c).haySaldoInicialVigente();
        const primerDia = await new WalletMovimientoRepository(c).primerDiaDeLaCaja();
        const cajaHasta = (id: string): ComoQuedoDTO["caja"] => {
          const i = cajaEntera.findIndex((f) => f.id === id);
          if (i < 0) throw new Error(`fila de caja ${id} no esta`);
          const d = derivarCaja(agregar(cajaEntera.slice(0, i + 1)), { haySaldoInicialVigente: haySaldo, primerDia });
          return { cifraPrincipal: d.enCaja, rotulo: d.estado, ganancia: d.ganancia, deTiendas: d.deTerceros, capital: d.capital };
        };
        const tiendaHasta = (filas: FilaCuenta[], id: string) => {
          const pre = filas.slice(0, filas.findIndex((f) => f.id === id) + 1);
          return derivarSaldoTienda(sumar(pre, "credito"), sumar(pre, "debito")).saldo;
        };

        const r: Record<string, ComoQuedoResult> = {};
        const esperado: Record<string, ComoQuedoDTO> = {};

        // 1. La ULTIMA linea de la caja: «Cómo quedó» == el resumen sin filtros.
        const ultima = cajaEntera[cajaEntera.length - 1];
        r.ultima = await ver("caja", ultima.id);
        const resumen = await s.wallet.verResumenCaja(listarMovimientosSchema.parse({}), maestro);
        if (resumen.status !== "ok") throw new Error("resumen");

        // 2. Una linea del medio (el sueldo del escenario): el prefijo, derivado aparte.
        const sueldo = cajaEntera.find((f) => f.categoria === "egreso_sueldo");
        if (sueldo === undefined) throw new Error("el escenario no tiene sueldo");
        r.sueldo = await ver("caja", sueldo.id);
        esperado.sueldo = { caja: cajaHasta(sueldo.id), cuenta: null };

        // 3. Un pago a la tienda A en la caja → la cuenta afectada es la tienda A, tras SU debito (y no
        //    tras el credito de su anulacion, que comparte origen): la contrapartida mas cercana.
        const pagosA = cajaEntera.filter((f) => f.categoria === "egreso_pago_tienda");
        const conReverso = pagosA.find((p) => cajaEntera.some((f) => f.categoria === "ingreso_reverso_pago_tienda" && f.origen_id === p.origen_id));
        const pago = conReverso ?? pagosA[0];
        const libroDePago = await tiendaEntera((await tx.liquidacionPago.findUniqueOrThrow({ where: { id: pago.origen_id as string } })).tiendaId as string);
        const debito = libroDePago.find((f) => f.origen_tipo === "pago_tienda" && f.origen_id === pago.origen_id && f.tipo === "debito");
        if (debito === undefined) throw new Error("sin debito del pago");
        const tiendaDelPago = (await tx.walletTiendaMovimiento.findUniqueOrThrow({ where: { id: debito.id } })).tiendaId;
        r.pago = await ver("caja", pago.id);
        esperado.pago = { caja: cajaHasta(pago.id), cuenta: { tipo: "tienda", id: tiendaDelPago, saldo: tiendaHasta(libroDePago, debito.id) } };

        // 4. El debito de un cobro de Ordenex a la tienda B (su libro) → la caja tras SU cargo.
        const libroB = await tiendaEntera(esc.tiendaB);
        const cobro = libroB.find((f) => f.origen_tipo === "manual" && f.tipo === "debito");
        if (cobro === undefined) throw new Error("sin cobro de la tienda B");
        const cargo = cajaEntera.find((f) => f.categoria === "ingreso_cobro_tienda" && f.origen_id === cobro.id);
        if (cargo === undefined) throw new Error("sin cargo del cobro");
        r.cobro = await ver("tienda", cobro.id);
        esperado.cobro = { caja: cajaHasta(cargo.id), cuenta: { tipo: "tienda", id: esc.tiendaB, saldo: tiendaHasta(libroB, cobro.id) } };

        // 5. Un pago al mensajero (su libro): NO tiene linea de caja ([P2] de la 173); su cuenta, tras el.
        const libroM = await mensajeroEntero(esc.mensajeroId);
        const liquidacion = libroM.find((f) => f.origen_tipo === "pago_mensajero");
        if (liquidacion === undefined) throw new Error("sin pago al mensajero");
        const preM = libroM.slice(0, libroM.findIndex((f) => f.id === liquidacion.id) + 1);
        r.mensajero = await ver("mensajero", liquidacion.id);
        esperado.mensajero = {
          caja: null,
          cuenta: { tipo: "mensajero", id: esc.mensajeroId, saldo: derivarCuentaPorPagar(sumar(preM, "devengo"), sumar(preM, "pago")).cuentaPorPagar },
        };

        // 6. Alcance y existencia.
        r.comoTienda = await ver("caja", ultima.id, { usuarioId: esc.tiendaA, rol: "adminTienda" });
        r.inexistente = await ver("tienda", randomUUID());
        r.sinSesion = await comoQuedoAction({ destino: { libro: "caja", movimientoId: ultima.id } }, { getActor: async () => null, service: servicio });

        return {
          r,
          esperado,
          resumenSinFiltros: {
            enCaja: resumen.resumen.enCaja,
            ganancia: resumen.resumen.ganancia,
            deTerceros: resumen.resumen.deTerceros,
            capital: resumen.resumen.capital,
          },
          pagoConReverso: conReverso !== undefined,
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R58: tras la ULTIMA linea, «Cómo quedó» coincide con el resumen sin filtros", () => {
    const r = m().r.ultima;
    if (r.status !== "ok") throw new Error(JSON.stringify(r));
    expect({
      enCaja: r.comoQuedo.caja?.cifraPrincipal,
      ganancia: r.comoQuedo.caja?.ganancia,
      deTerceros: r.comoQuedo.caja?.deTiendas,
      capital: r.comoQuedo.caja?.capital,
    }).toEqual(m().resumenSinFiltros);
  });

  it("R58: una linea del medio da la caja de su PREFIJO (derivado aparte)", () => {
    expect(m().r.sueldo).toEqual({ status: "ok", comoQuedo: m().esperado.sueldo });
  });

  it("R58: un pago a una tienda en la caja da la tienda tras SU debito (la contrapartida mas cercana)", () => {
    expect(m().r.pago).toEqual({ status: "ok", comoQuedo: m().esperado.pago });
  });

  it("anti-vacuidad: el pago medido tiene anulacion (asi la contrapartida mas cercana importa)", () => {
    expect(m().pagoConReverso).toBe(true);
  });

  it("R58: el debito de un cobro da la caja tras SU cargo y la tienda tras el", () => {
    expect(m().r.cobro).toEqual({ status: "ok", comoQuedo: m().esperado.cobro });
  });

  it("R58/[P2]: un pago al mensajero no tiene linea de caja; su cuenta, tras el", () => {
    expect(m().r.mensajero).toEqual({ status: "ok", comoQuedo: m().esperado.mensajero });
  });

  it("R82: una tienda `forbidden`; lo inexistente `no_encontrado`; sin sesion `unauthenticated`", () => {
    expect(m().r.comoTienda).toEqual({ status: "forbidden" });
    expect(m().r.inexistente).toEqual({ status: "no_encontrado" });
    expect(m().r.sinSesion).toEqual({ status: "unauthenticated" });
  });
});
