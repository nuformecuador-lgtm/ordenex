import type { PagoMensajeroMovimientoTipo, WalletTiendaMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";

// Feature 127 (T A.2) — contrato del repositorio de las DOS CUENTAS POR PAGAR:
// `cuenta_por_pagar_tienda` (lo que Ordenex le debe entregar a cada tienda) y
// `cuenta_por_pagar_mensajero` (lo devengado y no pagado a los mensajeros).
//
// ⟨D3(a)⟩ / R21 — ESTO ES UN SALDO AL CORTE, NO UN FLUJO DEL PERIODO. Los dos metodos agregan
// con `fecha_movimiento < rango.hasta` y **sin cota inferior**: `rango.desde` se ignora a
// proposito. El nombre lo fija el catalogo y dice "cuenta por pagar"; servir el flujo del
// periodo bajo ese nombre es el error que se descubre cuando alguien paga de menos. Añadir
// `fecha_movimiento >= rango.desde` mutila el saldo con todo devengo anterior a la ventana.
// El DTO lo declara ademas con `esAcumulado: true` (R43) para que la 132 no lo sume entre
// fechas ni lo grafique como serie acumulativa.
//
// R14 — NINGUN identificador de mensajero cruza este contrato. `cuenta_por_pagar_mensajero`
// no declara grano `mensajero` en el catalogo, asi que se sirve UN TOTAL, no filas por
// persona. La seudonimizacion de la 122 (R38/R39) es inalcanzable aqui —`adminTienda` es el
// unico rol con politica `seudonima` y tiene las ocho financieras `prohibido`—, asi que la
// proteccion no es sustituir el id: es que el id NO EXISTA en la respuesta.
//
// LA CONSULTA ENTRA ENTERA (R7); no se usa `consulta.alcance` (R9). SOLO CONSULTAS (R30): la
// resta la hacen `derivarSaldoTienda` y `derivarCuentaPorPagar` en el servicio, que son las
// funciones que ya producen el saldo que la tienda ve en `/mi-wallet`. Reimplementar aqui
// `creditos − debitos` crearia una segunda definicion de "saldo" que puede divergir de la
// primera, y ese es el bug caro de esta feature: dos cifras del mismo dinero (R20).

/** Σ `monto` por `(tienda_id, tipo)` hasta el corte. STRING escala 2 (S1/R27). */
export interface SaldoTiendaAlCorte {
  readonly tiendaId: string;
  readonly tipo: WalletTiendaMovimientoTipo;
  readonly suma: string;
}

/**
 * Σ `monto` por `tipo` (`devengo` / `pago`) hasta el corte, del libro completo y SIN
 * desglose por mensajero: aqui no hay `mensajeroId` y no puede haberlo (R14).
 */
export interface CuentaMensajeroAlCorte {
  readonly tipo: PagoMensajeroMovimientoTipo;
  readonly suma: string;
}

export interface ICuentasPorPagarAnaliticaRepository {
  /**
   * `groupBy(tienda_id, tipo)` + `_sum(monto)` sobre `wallet_tienda_movimiento` con
   * `fecha_movimiento < rango.hasta`, **sin cota inferior** ⟨D3(a)⟩ R21.
   * Orden estable por `(tienda_id, tipo)` (R28).
   */
  saldoPorTiendaAlCorte(consulta: ConsultaAnalitica): Promise<readonly SaldoTiendaAlCorte[]>;

  /**
   * `groupBy(tipo)` + `_sum(monto)` sobre `pago_mensajero_movimiento` con
   * `fecha_movimiento < rango.hasta`, **sin cota inferior** ⟨D3(a)⟩ R21.
   * Orden estable por `tipo` (R28).
   */
  cuentaPorPagarMensajerosAlCorte(
    consulta: ConsultaAnalitica,
  ): Promise<readonly CuentaMensajeroAlCorte[]>;
}
