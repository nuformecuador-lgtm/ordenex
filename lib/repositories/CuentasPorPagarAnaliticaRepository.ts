import { Prisma, type PrismaClient } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type {
  CuentaMensajeroAlCorte,
  ICuentasPorPagarAnaliticaRepository,
  SaldoTiendaAlCorte,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";

// Feature 127 (T C.3) — repositorio de las DOS CUENTAS POR PAGAR.
//
// ⟨D3(a)⟩ / R21 — ESTO ES UN SALDO AL CORTE, NO UN FLUJO DEL PERIODO. Los dos metodos agregan
// con `fecha_movimiento < rango.hasta` y **SIN COTA INFERIOR**: `rango.desde` se ignora, y esa
// omision es la funcionalidad. El nombre lo fija el catalogo y dice "cuenta por pagar": un
// devengo de hace tres meses que nadie ha pagado SIGUE debiendose hoy. Añadir
// `fecha_movimiento >= rango.desde` mutila el saldo con todo lo anterior a la ventana y produce
// una cifra que parece razonable y por la que alguien paga de menos. El DTO lo declara ademas
// con `esAcumulado: true` (R43) para que la 132 no lo grafique como serie.
//
// SIN FILTRO DE CATEGORIA, y esto es una decision declarada (S12 en `progress/impl_127_C.md`):
// el saldo de una cuenta por pagar es el LIBRO ENTERO hasta el corte, que es exactamente lo que
// `derivarSaldoTienda` y `derivarCuentaPorPagar` calculan para `/mi-wallet`. Las dos metricas
// declaran en el catalogo TODAS las categorias de su enum, asi que un `categoria IN (...)` seria
// hoy un no-op — y el dia que el enum gane un valor antes que el catalogo, dejaria de serlo en
// silencio y descuadraria esta cifra respecto de la que la tienda ve. Dos cifras del mismo
// dinero es el bug caro de esta feature (R20).
//
// R14 — NINGUN identificador de mensajero sale de aqui. `cuenta_por_pagar_mensajero` no declara
// grano `mensajero`, asi que se agrega por `tipo` y punto: no hay `mensajeroId` en el resultado
// y no puede haberlo. La proteccion no es seudonimizar el id, es que el id no exista.
//
// SOLO CONSULTAS (R30): la resta con signo la hacen `derivarSaldoTienda` y
// `derivarCuentaPorPagar` en el servicio. Aqui no hay ni un `.sub(`. Sin `try/catch` (R32).
// No se usa `consulta.alcance` (R9).

/** Cliente Prisma MINIMO: los dos ledgers que las dos metricas declaran. */
type CuentasPorPagarPrismaClient = Pick<
  PrismaClient,
  "walletTiendaMovimiento" | "pagoMensajeroMovimiento"
>;

/** `Decimal | null` -> STRING escala 2 (S1/R27). Nunca pasa por `number`. */
function importe(valor: Prisma.Decimal | null): string {
  return (valor ?? new Prisma.Decimal(0)).toFixed(2);
}

export class CuentasPorPagarAnaliticaRepository implements ICuentasPorPagarAnaliticaRepository {
  constructor(private readonly prisma: CuentasPorPagarPrismaClient) {}

  /**
   * `groupBy(tienda_id, tipo)` + `_sum(monto)` con la UNICA cota `fecha_movimiento < hasta`.
   *
   * El desglose por `tipo` (`credito` / `debito`) es lo que `derivarSaldoTienda` necesita para
   * producir el saldo con signo; aqui no se resta. `orderBy` por `(tienda_id, tipo)` para que la
   * secuencia de filas no dependa del plan de la base (R28).
   */
  async saldoPorTiendaAlCorte(consulta: ConsultaAnalitica): Promise<readonly SaldoTiendaAlCorte[]> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tiendaId", "tipo"],
      where: { fechaMovimiento: { lt: consulta.rango.hasta } },
      _sum: { monto: true },
      orderBy: [{ tiendaId: "asc" }, { tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tiendaId: g.tiendaId,
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }

  /**
   * `groupBy(tipo)` + `_sum(monto)` con la UNICA cota `fecha_movimiento < hasta`, del libro
   * COMPLETO y sin desglose por persona (R14).
   *
   * El par `devengo` / `pago` es lo que `derivarCuentaPorPagar` convierte en la cuenta con
   * signo. `orderBy` por `tipo` (R28).
   */
  async cuentaPorPagarMensajerosAlCorte(
    consulta: ConsultaAnalitica,
  ): Promise<readonly CuentaMensajeroAlCorte[]> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where: { fechaMovimiento: { lt: consulta.rango.hasta } },
      _sum: { monto: true },
      orderBy: [{ tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }
}
