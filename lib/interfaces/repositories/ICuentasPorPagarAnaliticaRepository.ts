import type { PagoMensajeroMovimientoTipo, WalletTiendaMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";

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

/**
 * Feature 180 (T2.2) — Σ `monto` por `(cubo, tipo)` DENTRO del rango.
 *
 * `indiceCubo` es un indice 0-based dentro del array `cubos` recibido, **no una fecha**: la clave
 * publicable la pone el servicio desde `trocear(rango)` ⟨D4⟩, de modo que el SQL nunca emite una
 * fecha y no puede nacer una segunda definicion del dia de Costa Rica al lado de
 * `lib/utils/fecha-cr.ts`.
 *
 * Esta fila es el MOVIMIENTO del cubo, no el saldo: el acumulado corrido lo construye el servicio
 * ⟨D5⟩ sumando estos componentes sobre el saldo de arrastre de
 * `cuentaPorPagarMensajerosAntesDe`, y aplicando `derivarCuentaPorPagar` una vez por cubo (R17).
 *
 * `suma` es STRING escala 2 (R16). Sin `mensajeroId` (R24).
 */
export interface AgregadoCuboTipo {
  /** Indice 0-based dentro del array `cubos` recibido. */
  readonly indiceCubo: number;
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

  /**
   * Feature 180 ⟨D4⟩ — Σ `monto` por `(cubo, tipo)` sobre `pago_mensajero_movimiento` DENTRO de
   * la ventana `[rango.desde, rango.hasta)`, particionada por los `cubos` recibidos.
   *
   * **R22 — la consulta entra ENTERA.** Ni un parametro suelto de fecha, tienda, zona o mensajero.
   * Los `cubos` NO son un canal alternativo para colar una ventana propia: el servicio los deriva
   * de `trocear(consulta.rango)`, el `WHERE` lo sigue mandando `consulta.rango`, y un test del
   * servicio comprueba que las fronteras usadas son exactamente las de ese troceo.
   *
   * **R24 — ningun id de persona entra ni sale.** La coordenada es un indice de cubo, no una fecha
   * ni una entidad. `cuenta_por_pagar_mensajero` no declara grano `mensajero` en el catalogo: la
   * proteccion no es seudonimizar el id, es que el id NO EXISTA en la respuesta.
   *
   * **R25 — sin `try`/`catch` ni ceros por defecto:** un fallo de base se propaga tal cual.
   *
   * Un cubo sin movimiento NO aparece: la serie densa (R7/R9) la construye el servicio.
   * Orden ESTABLE y explicito por `(indiceCubo, tipo)` (R26).
   */
  cuentaPorPagarMensajerosPorCubo(
    consulta: ConsultaAnalitica,
    cubos: readonly CuboTemporal[],
  ): Promise<readonly AgregadoCuboTipo[]>;

  /**
   * Feature 180 ⟨D5⟩ / R14 — EL SALDO DE ARRASTRE: Σ `monto` por `tipo` (`devengo` / `pago`) de
   * todo el libro **anterior al rango**.
   *
   * **Su UNICA cota es `fecha_movimiento < rango.desde`. NO lleva cota inferior**, y esa omision
   * es la funcionalidad, no un descuido: la cuenta por pagar es un saldo, y un devengo de hace
   * tres años que nadie ha pagado sigue debiendose. Añadir un `>= algo` mutilaria el arrastre y
   * daria una serie que arranca demasiado abajo — una cifra creible por la que alguien paga de
   * menos, que es exactamente el bug caro de este dominio.
   *
   * Es la HERMANA de `cuentaPorPagarMensajerosAlCorte`, que corta en `rango.hasta`; esta corta en
   * `rango.desde`. Juntas son lo que ⟨D5⟩ necesita: el servicio parte de este saldo, le suma cubo
   * a cubo los componentes de `cuentaPorPagarMensajerosPorCubo` (en `Prisma.Decimal`, sumando y
   * solo sumando) y llama a `derivarCuentaPorPagar` una vez por cubo (R17). Asi la ultima fila
   * coincide, campo a campo, con el `total` que ya publica la 127 (R13).
   *
   * **R22** — la consulta entra entera; `rango.desde` no se recibe suelto.
   * **R24** — sin `mensajeroId`, en la firma y en la fila.
   * **R25** — sin `try`/`catch`; un fallo de base se propaga tal cual.
   *
   * Orden ESTABLE por `tipo` (R26).
   */
  cuentaPorPagarMensajerosAntesDe(
    consulta: ConsultaAnalitica,
  ): Promise<readonly CuentaMensajeroAlCorte[]>;

  /**
   * Feature 187 (R1/R6) — UNA LECTURA CONSISTENTE: ejecuta `fn` sobre una instancia de este mismo
   * repositorio ligada a un unico snapshot de la base, y devuelve lo que `fn` devuelva. Gemelo
   * exacto del de `IIngresosAnaliticaRepository`, y a proposito.
   *
   * **QUE GARANTIZA.** Las TRES consultas de `cuenta_por_pagar_mensajero` —el corte
   * (`...AlCorte`), el arrastre (`...AntesDe`) y el movimiento por cubo (`...PorCubo`)— ven la
   * MISMA foto de `pago_mensajero_movimiento`. Esa es la condicion que hace cierta en runtime la
   * invariante R13 de la 180: la ULTIMA fila de la serie acumulada coincide, campo a campo, con el
   * `total`. Las tres lecturas caen a un lado y otro de la misma frontera temporal
   * (`< desde`, `[desde, hasta)`, `< hasta`), asi que una escritura confirmada entre ellas entra en
   * unas y no en otras y descuadra la suma sin que nada falle.
   *
   * **QUE NO GARANTIZA.** No bloquea a nadie, no retrasa ninguna escritura ajena y no promete que
   * lo leido siga vigente cuando la respuesta llegue al usuario. Solo cubre lo que se lea por el
   * repositorio que `fn` recibe.
   *
   * **EL TOTAL SIGUE SIENDO UNA CONSULTA APARTE** (D1 de `design.md` §2, R5): `...AlCorte` produce
   * el total y `...AntesDe` + `...PorCubo` producen la serie. La coincidencia entre la ultima fila
   * y el total sigue siendo una invariante entre caminos distintos, no una tautologia.
   *
   * **VOCABULARIO DE DOMINIO, NO DE ORM** (R6), **SOLO LECTURAS DENTRO** (R3) y **los errores
   * suben tal cual** (R7). Ver la prosa de `IIngresosAnaliticaRepository.enLecturaConsistente`.
   */
  enLecturaConsistente<T>(
    fn: (repo: ICuentasPorPagarAnaliticaRepository) => Promise<T>,
  ): Promise<T>;
}
