import { Prisma } from "@prisma/client";

import type { ConceptoRegistro, EfectoMovimientoDTO, LineaEfectoDTO } from "@/lib/types/efecto-movimiento";
import type { AgregadoCajaRow, WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.4, R44–R47) — «Así queda», PURO. Sin Prisma de base de datos, sin HTTP.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// NO reimplementa ninguna resta (`caja-derivaciones.guardia`): construye las filas HIPOTETICAS que el
// registro produciria y llama a `derivarCaja` sobre lo actual y sobre lo actual + hipoteticas; el
// saldo de la cuenta, con `derivarSaldoTienda` / `derivarCuentaPorPagar` sobre los totales + el monto.

/** Lo que un concepto escribe: sus lineas de caja y su asiento en la cuenta (si lleva cuenta). */
export interface EfectoDeConcepto {
  cuenta: "tienda" | "mensajero" | null;
  caja: readonly { tipo: WalletMovimientoTipo; categoria: WalletMovimientoCategoria }[];
  /** El asiento en el libro de la cuenta: credito/debito de la tienda o pago al mensajero. */
  enCuenta: "credito" | "debito" | "pago" | null;
}

/**
 * design §4.1 — LA tabla: lo que cada concepto escribe hoy por su camino existente (R50). Es la MISMA
 * clave que el enrutado del dialogo (458-C). `Record` TOTAL: un concepto nuevo no compila sin su fila.
 */
export const EFECTO_POR_TIPO: Record<ConceptoRegistro, EfectoDeConcepto> = {
  gasto_ordenex: { cuenta: null, caja: [{ tipo: "egreso", categoria: "egreso_gasto_variable" }], enCuenta: null },
  sueldo: { cuenta: null, caja: [{ tipo: "egreso", categoria: "egreso_sueldo" }], enCuenta: null },
  pago_gasto_tienda: {
    cuenta: "tienda",
    caja: [{ tipo: "egreso", categoria: "egreso_pago_por_cuenta_tienda" }],
    enCuenta: "debito",
  },
  correccion_resta: { cuenta: null, caja: [{ tipo: "egreso", categoria: "egreso_ajuste" }], enCuenta: null },
  pago_a_tienda: { cuenta: "tienda", caja: [{ tipo: "egreso", categoria: "egreso_pago_tienda" }], enCuenta: "debito" },
  // [P2] de la 173: el pago a un mensajero NO toca la caja (la salida ya estaba en el cierre).
  pago_a_mensajero: { cuenta: "mensajero", caja: [], enCuenta: "pago" },
  aporte: { cuenta: null, caja: [{ tipo: "ingreso", categoria: "ingreso_aporte_capital" }], enCuenta: null },
  correccion_suma: { cuenta: null, caja: [{ tipo: "ingreso", categoria: "ingreso_ajuste" }], enCuenta: null },
  tienda_paga_a_ordenex: {
    cuenta: "tienda",
    caja: [{ tipo: "ingreso", categoria: "ingreso_abono_tienda" }],
    enCuenta: "credito",
  },
  cobro_a_tienda: { cuenta: "tienda", caja: [{ tipo: "ingreso", categoria: "ingreso_cobro_tienda" }], enCuenta: "debito" },
};

/** Lo que hay HOY, leido sin filtros. */
export interface EstadoActualParaEfecto {
  caja: readonly AgregadoCajaRow[];
  haySaldoInicialVigente: boolean;
  primerDia: string | null;
  cuenta:
    | { tipo: "tienda"; creditos: string; debitos: string }
    | { tipo: "mensajero"; devengado: string; pagado: string }
    | null;
}

function linea(antes: string, despues: string): LineaEfectoDTO {
  return { antes, despues, cambia: antes !== despues };
}

/**
 * R44–R47 — el efecto de registrar `monto` con `concepto` sobre lo `actual`. `monto` ya validado
 * (STRING positivo, escala ≤ 2). Lanza si la cuenta de `actual` no es la que el concepto pide: es
 * un error de programacion del servicio, no del usuario.
 */
export function efectoDeMovimiento(
  concepto: ConceptoRegistro,
  monto: string,
  actual: EstadoActualParaEfecto,
): EfectoMovimientoDTO {
  const efecto = EFECTO_POR_TIPO[concepto];
  const importe = new Prisma.Decimal(monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

  const opciones = { haySaldoInicialVigente: actual.haySaldoInicialVigente, primerDia: actual.primerDia };
  const antes = derivarCaja(actual.caja, opciones);
  const hipoteticas: AgregadoCajaRow[] = efecto.caja.map((f) => ({ ...f, total: importe }));
  const despues = derivarCaja([...actual.caja, ...hipoteticas], opciones);

  let cuenta: EfectoMovimientoDTO["lineas"]["cuenta"] = null;
  let saldoEnContra = false;
  let superaDisponible: boolean | undefined;

  if (efecto.cuenta !== null) {
    if (actual.cuenta === null || actual.cuenta.tipo !== efecto.cuenta) {
      throw new Error(`efecto-movimiento: «${concepto}» necesita la cuenta de un ${efecto.cuenta}`);
    }
    if (actual.cuenta.tipo === "tienda") {
      const suma = (a: string, b: string) => new Prisma.Decimal(a).add(b).toFixed(2);
      const { creditos, debitos } = actual.cuenta;
      const saldoAntes = derivarSaldoTienda(creditos, debitos);
      const saldoDespues =
        efecto.enCuenta === "credito"
          ? derivarSaldoTienda(suma(creditos, importe), debitos)
          : derivarSaldoTienda(creditos, suma(debitos, importe));
      cuenta = { tipo: "tienda", ...linea(saldoAntes.saldo, saldoDespues.saldo) };
      saldoEnContra = saldoDespues.signo === "negativo"; // R47
      const disponible = new Prisma.Decimal(saldoAntes.saldo);
      if (concepto === "pago_a_tienda") {
        // 172 R31/R32: se paga contra el saldo A FAVOR; sin saldo, o mas de el, no cabe.
        superaDisponible = disponible.lte(0) || new Prisma.Decimal(importe).gt(disponible);
      } else if (concepto === "tienda_paga_a_ordenex") {
        // 457 R14/R15: solo con saldo EN CONTRA, y hasta lo que la tienda debe.
        superaDisponible = disponible.gte(0) || new Prisma.Decimal(importe).gt(disponible.abs());
      }
    } else {
      const { devengado, pagado } = actual.cuenta;
      const antesCuenta = derivarCuentaPorPagar(devengado, pagado);
      const despuesCuenta = derivarCuentaPorPagar(devengado, new Prisma.Decimal(pagado).add(importe));
      cuenta = { tipo: "mensajero", ...linea(antesCuenta.cuentaPorPagar, despuesCuenta.cuentaPorPagar) };
    }
  }

  return {
    lineas: {
      cuenta,
      cifraPrincipal: { ...linea(antes.enCaja, despues.enCaja), rotulo: antes.estado },
      ganancia: linea(antes.ganancia, despues.ganancia),
      deTiendas: linea(antes.deTerceros, despues.deTerceros),
      capital: linea(antes.capital, despues.capital),
    },
    saldoEnContra,
    ...(superaDisponible === undefined ? {} : { superaDisponible }),
  };
}
