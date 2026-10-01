import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { verMiEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";
import { CRONOLOGICO, leerEstadoCuenta, montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-D (cierre) — VUELVE a `/mi-wallet` el resumen de tres cifras de la 172 (R55 `[P5]`, N1),
// contra Postgres: las cifras tienen que CUADRAR con la tarjeta y con el saldo corrido.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La tienda C del escenario de la 458 (`_fixtures/wallet-458.ts`):
//   a favor : cod_recaudado 10 000 + ajuste_credito 3 000 (la devolución del pago anulado)  = 13 000
//   cargos  : flete 2 000 + cobro_manual 1 500 + comision_cod 300                            =  3 800
//   pagado  : pago_tienda 3 000 (ANULADO: N1, sigue contando) + pago_por_cuenta 1 000       =  4 000
//   saldo   : 13 000 − 3 800 − 4 000                                                        =  5 200
// Los importes son LITERALES a propósito (el contrato): compararlos contra `derivarDesgloseTienda` sería
// comparar la función consigo misma.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RESUMEN_C = { aFavor: "13000.00", cargos: "3800.00", pagado: "4000.00", saldo: "5200.00", signo: "positivo" };

interface Medida {
  entero: EstadoCuentaDTO;
  conPeriodo: EstadoCuentaDTO;
  conChip: EstadoCuentaDTO;
  pagina2: EstadoCuentaDTO;
  completo: EstadoCuentaDTO;
  porLaAccion: EstadoCuentaDTO;
  oficinaTienda: EstadoCuentaDTO;
  oficinaMensajero: EstadoCuentaDTO;
  saldoPorOtroCamino: string;
  descuadre: string;
}

describeSiHayBase("458-D cierre — el resumen de tres cifras de /mi-wallet contra Postgres (172 R55/N1)", () => {
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
        const tiendaC: Actor = { usuarioId: esc.tiendaC, rol: "adminTienda" };
        const deLaTienda = async (input: Record<string, unknown> = {}) => {
          const r = await ec.leerMiTienda({ page: 1, pageSize: 50, ...CRONOLOGICO, ...input }, tiendaC);
          if (r.status !== "ok") throw new Error(`mi estado de cuenta: ${JSON.stringify(r)}`);
          return r.estado;
        };
        const completo = await ec.leerMiTiendaCompleto({ ...CRONOLOGICO }, tiendaC);
        if (completo.status !== "ok") throw new Error(`completo: ${JSON.stringify(completo)}`);
        const accion = await verMiEstadoCuentaAction({}, { getActor: async () => tiendaC, service: ec });
        if (accion.status !== "ok") throw new Error(`accion: ${JSON.stringify(accion)}`);

        // El saldo por un camino INDEPENDIENTE del servicio: la resta por TIPO sobre la base.
        const [{ saldo }] = await tx.$queryRaw<{ saldo: string }[]>`
          SELECT COALESCE(SUM(CASE WHEN tipo = 'credito' THEN monto ELSE -monto END), 0)::numeric(14,2)::text AS saldo
          FROM wallet_tienda_movimiento WHERE tienda_id = ${esc.tiendaC}`;

        const base = {
          entero: await deLaTienda(),
          conPeriodo: await deLaTienda({ desde: "2026-09-12", hasta: "2026-09-12" }),
          conChip: await deLaTienda({ chip: "pagos" }),
          pagina2: await deLaTienda({ page: 2, pageSize: 3 }),
          completo: completo.estado,
          porLaAccion: accion.estado,
          oficinaTienda: await leerEstadoCuenta(ec, esc.maestro, { cuenta: { tipo: "tienda", id: esc.tiendaC } }),
          oficinaMensajero: await leerEstadoCuenta(ec, esc.maestro, { cuenta: { tipo: "mensajero", id: esc.mensajeroM } }),
          saldoPorOtroCamino: saldo,
        };

        // El guardia del cuadre: si la clasificacion por CATEGORIA divergiera de la resta por TIPO (la base
        // ya lo impide con `wallet_tienda_movimiento_tipo_categoria_check`, asi que se simula en la lectura
        // con una fila agregada de mas), la lectura tiene que fallar ruidosa, no enseñar tres cifras que
        // no suman la tarjeta.
        const real = EstadoCuentaRepository.prototype.desgloseDeTienda;
        const espia = vi
          .spyOn(EstadoCuentaRepository.prototype, "desgloseDeTienda")
          .mockImplementation(async function (this: EstadoCuentaRepository, tiendaId: string) {
            return [...(await real.call(this, tiendaId)), { tipo: "debito", categoria: "flete", total: "100.00" }];
          });
        const descuadre = await ec.leerMiTienda({ page: 1, pageSize: 50, ...CRONOLOGICO }, tiendaC).then(
          (r) => `respondio ${r.status}`,
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        );
        espia.mockRestore();
        return { ...base, descuadre };
      });
    } catch (e) {
      fallo = e;
    }
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R55: las tres cifras son las del contrato de la 172 (el pago NO engorda los cargos; N1: el anulado sigue en «Ya pagado»)", () => {
    expect(m().entero.resumen).toEqual(RESUMEN_C);
  });

  it("R55: A tu favor − Cargos − Ya pagado = la tarjeta = el corrido de la ultima fila = la base", () => {
    const { entero, saldoPorOtroCamino } = m();
    expect(entero.resumen?.saldo).toBe(entero.saldoActual);
    expect(entero.filas[entero.filas.length - 1].saldoCorrido).toBe(entero.saldoActual);
    expect(entero.saldoActual).toBe(saldoPorOtroCamino);
    expect(saldoPorOtroCamino).toBe("5200.00");
  });

  it("R55: es de la cuenta ENTERA — el periodo, el chip y la pagina no lo cambian; la descarga y la accion traen el mismo", () => {
    const { conPeriodo, conChip, pagina2, completo, porLaAccion } = m();
    for (const e of [conPeriodo, conChip, pagina2, completo, porLaAccion]) expect(e.resumen).toEqual(RESUMEN_C);
    // Control: los filtros SI mueven el extracto (si no, la comparacion de arriba no mediria nada).
    expect(conChip.total).toBeLessThan(m().entero.total);
    expect(pagina2.page).toBe(2);
  });

  it("R55: solo la propia tienda lo recibe — la oficina (tienda o mensajero) no", () => {
    expect(m().oficinaTienda.resumen).toBeNull();
    expect(m().oficinaMensajero.resumen).toBeNull();
  });

  it("R55: si las cifras no cuadran con la tarjeta, la lectura falla ruidosa en vez de enseñarlas", () => {
    expect(m().descuadre).toMatch(/el resumen no cuadra/);
  });
});
