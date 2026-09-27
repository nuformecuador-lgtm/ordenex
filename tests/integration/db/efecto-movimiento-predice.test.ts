import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { PrevisualizarMovimientoService } from "@/lib/services/PrevisualizarMovimientoService";
import type { ConceptoRegistro, EfectoMovimientoDTO } from "@/lib/types/efecto-movimiento";
import { listarMovimientosSchema } from "@/lib/types/wallet";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.12 (R44, R50) — «Así queda» PREDICE lo que queda: contra Postgres, para cada uno
// de los diez conceptos, se pide el efecto y luego se registra por el camino REAL de ese concepto
// (sus servicios de la 45/172/205/334/457/459/461). Lo que la caja y la cuenta dicen DESPUES tiene que
// ser, cifra a cifra, lo que la previsualizacion dijo. Si `EFECTO_POR_TIPO` se equivoca de categoria
// para un concepto, el camino real escribe otra cosa y este test lo ve.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Paso {
  concepto: ConceptoRegistro;
  efecto: EfectoMovimientoDTO;
  real: { enCaja: string; ganancia: string; deTiendas: string; capital: string; cuenta: string | null };
  registro: string;
}

describeSiHayBase("458-B/TB.12 — «Así queda» predice lo que queda (Postgres real)", () => {
  let prisma: PrismaClient;
  let pasos: Paso[] | undefined;
  let fallo: unknown;

  function p(): Paso[] {
    if (fallo !== undefined) throw fallo;
    if (pasos === undefined) throw new Error("la medida no llego a tomarse");
    return pasos;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      pasos = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario459(tx, cat);
        const c = s.cliente;
        const tiendaRepo = new WalletTiendaMovimientoRepository(c);
        const mensajeroRepo = new PagoMensajeroMovimientoRepository(c);
        const previa = new PrevisualizarMovimientoService(
          new WalletMovimientoRepository(c),
          new AporteCapitalRepository(c),
          tiendaRepo,
          new UserRepository(c),
          mensajeroRepo,
        );
        const m: Actor = esc.maestro;
        const hoy = fechaCalendarioCR(new Date());
        const resumen = async () => {
          const r = await s.wallet.verResumenCaja(listarMovimientosSchema.parse({}), m);
          if (r.status !== "ok") throw new Error("resumen");
          return r.resumen;
        };
        const saldoTienda = async (id: string) => {
          const a = await tiendaRepo.agregarSaldoPorTienda(id, {});
          return derivarSaldoTienda(a.creditos, a.debitos).saldo;
        };
        const saldoMensajero = async (id: string) => {
          const a = await mensajeroRepo.agregarCuentaPorPagar(id, {});
          return derivarCuentaPorPagar(a.devengado, a.pagado).cuentaPorPagar;
        };

        const out: Paso[] = [];
        async function paso(
          concepto: ConceptoRegistro,
          monto: string,
          cuenta: { tipo: "tienda" | "mensajero"; id: string } | null,
          registrar: () => Promise<{ status: string }>,
        ) {
          const pedido = await previa.previsualizar({ concepto, monto, ...(cuenta ? { cuentaId: cuenta.id } : {}) }, m);
          if (pedido.status !== "ok") throw new Error(`${concepto}: previsualizar ${JSON.stringify(pedido)}`);
          const r = await registrar();
          const despues = await resumen();
          out.push({
            concepto,
            efecto: pedido.efecto,
            registro: r.status,
            real: {
              enCaja: despues.enCaja,
              ganancia: despues.ganancia,
              deTiendas: despues.deTerceros,
              capital: despues.capital,
              cuenta: cuenta === null ? null : cuenta.tipo === "tienda" ? await saldoTienda(cuenta.id) : await saldoMensajero(cuenta.id),
            },
          });
        }

        const k = () => randomUUID();
        await paso("sueldo", "11.00", null, () =>
          s.egresos.registrarEgreso({ tipoEgreso: "sueldo", monto: "11.00", descripcion: "Sueldo", claveIdempotencia: k() }, m),
        );
        await paso("gasto_ordenex", "12.00", null, () =>
          s.egresos.registrarEgreso({ tipoEgreso: "gasto_variable", monto: "12.00", descripcion: "Gasto", claveIdempotencia: k() }, m),
        );
        await paso("correccion_resta", "13.00", null, () =>
          s.wallet.registrarMovimientoManual({ tipo: "egreso", categoria: "egreso_ajuste", monto: "13.00", descripcion: "Faltante", claveIdempotencia: k() }, m),
        );
        await paso("correccion_suma", "14.00", null, () =>
          s.wallet.registrarMovimientoManual({ tipo: "ingreso", categoria: "ingreso_ajuste", monto: "14.00", descripcion: "Sobrante", claveIdempotencia: k() }, m),
        );
        await paso("aporte", "15.00", null, () =>
          s.aporteCapital.registrar({ claveIdempotencia: k(), clase: "aporte", monto: "15.00", fecha: hoy, motivo: "Aporte" }, null, m),
        );
        const A = { tipo: "tienda" as const, id: esc.tiendaA };
        const B = { tipo: "tienda" as const, id: esc.tiendaB };
        await paso("pago_gasto_tienda", "16.00", A, () =>
          s.pagoPorCuenta.registrar(
            { claveIdempotencia: k(), tiendaId: esc.tiendaA, beneficiario: "Imprenta", monto: "16.00", metodo: "efectivo", motivo: "Etiquetas" },
            null,
            m,
          ),
        );
        await paso("pago_a_tienda", "1.00", A, () =>
          s.liquidacion.registrarPagoTienda({ claveIdempotencia: k(), tiendaId: esc.tiendaA, monto: "1.00", metodo: "efectivo", fechaPago: hoy }, m),
        );
        await paso("pago_a_mensajero", "1.00", { tipo: "mensajero", id: esc.mensajeroId }, () =>
          s.liquidacion.registrarRepartoMensajero({ claveIdempotencia: k(), mensajeroId: esc.mensajeroId, monto: "1.00", metodo: "efectivo", fechaPago: hoy }, m),
        );
        // El cobro deja a la tienda B en contra (R47) y asi la tienda B puede pagarle a Ordenex (457).
        const cobro = new Prisma.Decimal(await saldoTienda(esc.tiendaB)).abs().add("50.00").toFixed(2);
        await paso("cobro_a_tienda", cobro, B, () =>
          s.cobroTienda.registrarCobro({ claveIdempotencia: k(), tiendaId: esc.tiendaB, monto: cobro, descripcion: "Bolsas" }, m),
        );
        await paso("tienda_paga_a_ordenex", "20.00", B, () =>
          s.abonoTienda.registrar(
            { claveIdempotencia: k(), tiendaId: esc.tiendaB, monto: "20.00", metodo: "efectivo", motivo: "Abono", fechaPago: hoy },
            null,
            m,
          ),
        );
        return out;
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("anti-vacuidad: los diez conceptos se previsualizaron y se registraron `ok`", () => {
    expect(p().map((x) => x.concepto).sort()).toEqual(
      [
        "aporte",
        "cobro_a_tienda",
        "correccion_resta",
        "correccion_suma",
        "gasto_ordenex",
        "pago_a_mensajero",
        "pago_a_tienda",
        "pago_gasto_tienda",
        "sueldo",
        "tienda_paga_a_ordenex",
      ].sort(),
    );
    for (const x of p()) expect(x.registro, x.concepto).toBe("ok");
  });

  it("R44/R50: despues de registrar, la caja dice EXACTAMENTE lo que «Así queda» dijo (cifra, ganancia, tiendas, capital)", () => {
    for (const x of p()) {
      const l = x.efecto.lineas;
      expect(
        { enCaja: l.cifraPrincipal.despues, ganancia: l.ganancia.despues, deTiendas: l.deTiendas.despues, capital: l.capital.despues },
        x.concepto,
      ).toEqual({ enCaja: x.real.enCaja, ganancia: x.real.ganancia, deTiendas: x.real.deTiendas, capital: x.real.capital });
    }
  });

  it("R44: y la cuenta afectada queda con el saldo que se previo", () => {
    for (const x of p()) expect(x.efecto.lineas.cuenta?.despues ?? null, x.concepto).toBe(x.real.cuenta);
  });

  it("R45: cada concepto mueve lo que dice la tabla de design §4.1 y dice «no cambia» en lo demas", () => {
    const cambia = Object.fromEntries(
      p().map((x) => {
        const l = x.efecto.lineas;
        return [x.concepto, [l.cifraPrincipal.cambia, l.ganancia.cambia, l.deTiendas.cambia, l.capital.cambia]];
      }),
    );
    //                                cifra   ganancia tiendas capital
    expect(cambia).toEqual({
      gasto_ordenex: [true, true, false, false],
      sueldo: [true, true, false, false],
      pago_gasto_tienda: [true, false, true, false],
      correccion_resta: [true, true, false, false],
      pago_a_tienda: [true, false, true, false],
      pago_a_mensajero: [false, false, false, false],
      aporte: [true, false, false, true],
      correccion_suma: [true, true, false, false],
      tienda_paga_a_ordenex: [true, false, true, false],
      cobro_a_tienda: [false, true, true, false],
    });
  });

  it("R47: el cobro que deja a la tienda en contra lo avisa", () => {
    expect(p().find((x) => x.concepto === "cobro_a_tienda")?.efecto.saldoEnContra).toBe(true);
  });
});
