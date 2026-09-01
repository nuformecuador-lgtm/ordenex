import { Prisma } from "@prisma/client";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import { montoEscala2 } from "@/lib/utils/monto-escala-2";
import {
  COMPOSICION_FILA_OTROS,
  WALLET_EGRESO_CON_FILA_SEED,
  WALLET_EGRESO_NOMBRADO_SEED,
  WALLET_INGRESO_PROPIO_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type CajaResumenDTO,
  type ComposicionFilaId,
  type ComposicionGananciaDTO,
  type ModoComposicionCaja,
  type NaturalezaMovimiento,
  type WalletEgresoNombrado,
  type WalletIngresoPropio,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

/**
 * Feature 173 (design §1.1/§1.2) — la caja principal, partida en DOS cifras.
 *
 * El problema en una frase: mientras la caja solo contuviera dinero DE ORDENEX, «ingresos −
 * egresos» era la ganancia y podia llamarse «balance» sin mentir. En cuanto entra el
 * contra-entrega —dinero DE LAS TIENDAS que solo pasa por la caja— ese numero deja de
 * significar una sola cosa. Esta feature no consiste en meter dos categorias: consiste en
 * partir un numero en dos y nombrarlos.
 *
 * Funcion PURA (R10), money-safe de punta a punta: `Prisma.Decimal` dentro, STRING fuera,
 * `number` en ninguna parte (R7). Se anade AL LADO de `derivarBalance`, que NO se toca (R9):
 * su consumidor vivo es la analitica financiera, que la llama con SUBCONJUNTOS de categorias
 * donde «ingresos − egresos» sigue siendo lo correcto. Es el mismo movimiento que hizo la 171
 * con `derivarDesgloseTienda` al lado de `derivarSaldoTienda`.
 */

/**
 * De quien es el dinero: de Ordenex, o de un tercero que lo tiene aparcado en la caja.
 *
 * Feature 231: la DECLARACION se muda a `lib/types/wallet.ts` —desde esta feature es tambien
 * el tipo de un campo de `WalletMovimientoDTO` (R31), y `lib/types/` no puede depender de
 * `lib/utils/`—. Se re-exporta aqui para que ningun importador de la 173 cambie: la mudanza es
 * una mudanza, no un cambio de significado. La CLASIFICACION sigue viviendo abajo.
 */
export type { NaturalezaMovimiento };

/**
 * R2/R3 — clasificacion EXHAUSTIVA de las categorias de la caja en las dos naturalezas.
 *
 * La naturaleza es de la CATEGORIA, no de la fila: no se anade ninguna columna al libro
 * (design §10-B descarta esa via —seria una segunda fuente de verdad sobre una tabla
 * append-only con filas ya en produccion—).
 *
 * Es un `Record` sobre el union COMPLETO a proposito: el dia que el enum de Postgres gane un
 * valor, `_EnsureCategoriaExhaustive` (lib/types/wallet.ts) lo obliga a entrar en el union y
 * ESTE objeto deja de compilar hasta que alguien decida —y escriba— de quien es ese dinero
 * (R3). Un `Partial<Record<…>>` o un `switch` con `default` lo dejarian caer en silencio
 * dentro de «propio», que es justo el error que esta feature existe para impedir.
 * `tests/unit/utils/caja-tesoreria.test.ts` recorre ademas el SEED en RUNTIME, para que la
 * garantia no dependa de que alguien ejecute `tsc`.
 */
export const NATURALEZA_POR_CATEGORIA: Record<WalletMovimientoCategoria, NaturalezaMovimiento> = {
  // PROPIO: lo que Ordenex gana y lo que Ordenex gasta.
  ingreso_flete: "propio",
  ingreso_flete_devolucion: "propio",
  ingreso_comision_cod: "propio",
  ingreso_iva_flete: "propio",
  ingreso_iva_flete_devolucion: "propio",
  ingreso_iva_comision_cod: "propio",
  ingreso_ajuste: "propio",
  egreso_pago_mensajero: "propio", // [P2]: sigue siendo devengo (design §3.4), no tesoreria
  egreso_gasto: "propio",
  egreso_sueldo: "propio",
  egreso_ajuste: "propio",
  egreso_gasto_fijo: "propio",
  egreso_gasto_variable: "propio",
  egreso_indemnizacion: "propio",
  // DE TERCEROS: dinero que solo PASA por la caja. `ingreso_ajuste` NO puede hacer este
  // trabajo (design §10-C): es propio, y anular un pago a una tienda subiria la ganancia.
  ingreso_cod_recaudado: "terceros",
  egreso_pago_tienda: "terceros",
  ingreso_reverso_pago_tienda: "terceros",
};

/** Las seis sumas que hacen falta: por tipo y, dentro de cada tipo, por naturaleza. */
type Acumulado = {
  entradas: Prisma.Decimal;
  salidas: Prisma.Decimal;
  ingresosPropios: Prisma.Decimal;
  egresosPropios: Prisma.Decimal;
  ingresosTerceros: Prisma.Decimal;
  egresosTerceros: Prisma.Decimal;
};

function acumular(filas: readonly AgregadoCajaRow[]): Acumulado {
  const acc: Acumulado = {
    entradas: new Prisma.Decimal(0),
    salidas: new Prisma.Decimal(0),
    ingresosPropios: new Prisma.Decimal(0),
    egresosPropios: new Prisma.Decimal(0),
    ingresosTerceros: new Prisma.Decimal(0),
    egresosTerceros: new Prisma.Decimal(0),
  };

  for (const fila of filas) {
    const monto = new Prisma.Decimal(fila.total);
    // El signo lo da el TIPO; la cubeta, la CATEGORIA. Que las dos cosas casen es lo que
    // garantiza el CHECK categoria↔tipo de la base (design §2.2).
    const esIngreso = fila.tipo === "ingreso";
    const esPropio = NATURALEZA_POR_CATEGORIA[fila.categoria] === "propio";

    if (esIngreso) {
      acc.entradas = acc.entradas.add(monto);
      if (esPropio) acc.ingresosPropios = acc.ingresosPropios.add(monto);
      else acc.ingresosTerceros = acc.ingresosTerceros.add(monto);
    } else {
      acc.salidas = acc.salidas.add(monto);
      if (esPropio) acc.egresosPropios = acc.egresosPropios.add(monto);
      else acc.egresosTerceros = acc.egresosTerceros.add(monto);
    }
  }

  return acc;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// Feature 231 (design §3.1) — la caja partida en DOS BOLSILLOS.
//
// Todo lo que sigue son SUMAS POR CUBETA y UNA DIVISION sobre importes que `derivarBalance`
// ya derivo. Ninguna resta con signo nueva: la guardia `caja-derivaciones.guardia.test.ts`
// exige que este modulo siga llamando a `derivarBalance` exactamente tres veces y que no
// declare por su cuenta ni el signo ni la resta.
// ═════════════════════════════════════════════════════════════════════════════════════════

/** Las dos porciones extremas de la barra, como STRING con la misma escala que el resto. */
const TODO_DE_LAS_TIENDAS = "100.00";
const NADA_DE_LAS_TIENDAS = "0.00";

/**
 * R10/R14-R19 — que forma admite la barra y, si admite dos segmentos, con que proporcion.
 *
 * La tabla se evalua EN ESTE ORDEN y es TOTAL: los nueve pares de signos posibles de (G, T)
 * caen en exactamente una rama.
 *
 *  1. `G < 0` y `T > 0`  -> `solo_tiendas`   (100.00): Ordenex pierde y el dinero de las
 *                                            tiendas esta cubriendo ese saldo.
 *  2. `T < 0` y `G > 0`  -> `solo_ordenex`   (  0.00): el espejo (D4).
 *  3. `T <= 0` y `G <= 0`-> `sin_reparto`    (  0.00): no hay nada que repartir.
 *  4. resto              -> `dos_bolsillos`  (T / enCaja x 100).
 *
 * La division ocurre SOLO en la rama 4, donde `enCaja = G + T` es estrictamente positivo
 * (llegar ahi exige `T >= 0`, `G >= 0` y que al menos uno sea > 0): no hay division por cero
 * que atrapar. El signo se compara sobre `Prisma.Decimal` (`.lt(0)` / `.gt(0)`) y NUNCA
 * leyendo el campo `signo` del balance — que es la otra forma de acabar con dos definiciones
 * de «cuando una cifra es negativa».
 */
function derivarReparto(
  enCaja: Prisma.Decimal,
  ganancia: Prisma.Decimal,
  deTerceros: Prisma.Decimal,
): { porcentajeTiendas: string; modoComposicion: ModoComposicionCaja } {
  if (ganancia.lt(0) && deTerceros.gt(0)) {
    return { porcentajeTiendas: TODO_DE_LAS_TIENDAS, modoComposicion: "solo_tiendas" };
  }
  if (deTerceros.lt(0) && ganancia.gt(0)) {
    return { porcentajeTiendas: NADA_DE_LAS_TIENDAS, modoComposicion: "solo_ordenex" };
  }
  if (!deTerceros.gt(0) && !ganancia.gt(0)) {
    return { porcentajeTiendas: NADA_DE_LAS_TIENDAS, modoComposicion: "sin_reparto" };
  }
  return {
    porcentajeTiendas: montoEscala2(
      deTerceros.div(enCaja).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    ),
    modoComposicion: "dos_bolsillos",
  };
}

/**
 * R1/R4/R5/R6/R7 — deriva las DOS cifras del libro de la caja a partir de los totales ya
 * agregados por (categoria, tipo).
 *
 *  - `enCaja`   = entradas − salidas, sin distinguir de quien es el dinero (R4).
 *  - `ganancia` = ingresos propios − egresos propios (R5). Sobre el libro entero es, numero
 *                 por numero, lo que hoy devuelve `derivarBalance`: la cifra que el maestro
 *                 lleva viendo desde la 42 NO cambia de valor, cambia de nombre.
 *  - `deTerceros` = ingresos de terceros − egresos de terceros (la tercera linea, [P6]).
 *
 * Las TRES restas —con su signo— las hace `derivarBalance`, que ya existe y ya esta probada.
 * Aqui NO se reimplementa ninguna: duplicar la resta con signo seria abrir dos definiciones
 * del mismo dinero, que es exactamente lo que el repo prohibe por escrito. Lo unico propio de
 * esta funcion es la PARTICION por naturaleza.
 *
 * `periodoFiltrado` [P7] no se deriva de las filas —no es una propiedad del dinero sino de la
 * CONSULTA—, asi que entra como opcion explicita y vale `false` por defecto. La pantalla la
 * usa para cambiar el ROTULO cuando hay filtros puestos; el numero no cambia nunca.
 *
 * Feature 231 (R9/R10/R14): la salida gana `porcentajeTiendas` y `modoComposicion`. Ni la
 * firma ni el valor de los diez campos anteriores cambian (R38): lo nuevo se DERIVA de los
 * tres balances que esta funcion ya calculaba.
 */
export function derivarCaja(
  filas: readonly AgregadoCajaRow[],
  opciones: { periodoFiltrado?: boolean } = {},
): CajaResumenDTO {
  const acc = acumular(filas);

  const caja = derivarBalance(acc.entradas, acc.salidas);
  const propio = derivarBalance(acc.ingresosPropios, acc.egresosPropios);
  const terceros = derivarBalance(acc.ingresosTerceros, acc.egresosTerceros);

  const reparto = derivarReparto(
    new Prisma.Decimal(caja.balance),
    new Prisma.Decimal(propio.balance),
    new Prisma.Decimal(terceros.balance),
  );

  return {
    entradas: caja.ingresos,
    salidas: caja.egresos,
    enCaja: caja.balance,
    signoEnCaja: caja.signo,
    ingresosPropios: propio.ingresos,
    egresosPropios: propio.egresos,
    ganancia: propio.balance,
    signoGanancia: propio.signo,
    deTerceros: terceros.balance,
    periodoFiltrado: opciones.periodoFiltrado ?? false,
    porcentajeTiendas: reparto.porcentajeTiendas,
    modoComposicion: reparto.modoComposicion,
  };
}

/** Las siete cubetas del desglose de ingresos, todas a cero: un `Record` sin huecos (R23). */
function cubetasDeIngreso(): Record<WalletIngresoPropio, Prisma.Decimal> {
  // El `Object.fromEntries` pierde el tipo de las claves (devuelve `Record<string, …>`), asi
  // que la afirmacion va aqui, en UNA linea y sobre el seed que la produce. No es un `any`:
  // el union de claves sale del propio seed, y una categoria de mas o de menos la caza la
  // guardia de exhaustividad en runtime.
  return Object.fromEntries(
    WALLET_INGRESO_PROPIO_SEED.map((categoria) => [categoria, new Prisma.Decimal(0)]),
  ) as Record<WalletIngresoPropio, Prisma.Decimal>;
}

/** Las cubetas de los egresos con nombre propio, todas a cero: un `Record` sin huecos (R4). */
function cubetasDeEgresoNombrado(): Record<WalletEgresoNombrado, Prisma.Decimal> {
  // Mismo motivo que en `cubetasDeIngreso`: `Object.fromEntries` pierde el tipo de las claves.
  return Object.fromEntries(
    WALLET_EGRESO_NOMBRADO_SEED.map((categoria) => [categoria, new Prisma.Decimal(0)]),
  ) as Record<WalletEgresoNombrado, Prisma.Decimal>;
}

const CATEGORIAS_DE_INGRESO_PROPIO: ReadonlySet<string> = new Set(WALLET_INGRESO_PROPIO_SEED);
const CATEGORIAS_DE_EGRESO_NOMBRADO: ReadonlySet<string> = new Set(WALLET_EGRESO_NOMBRADO_SEED);

/**
 * Ficha 339 — el conjunto de egresos propios CON FILA. Es LA definicion: la usan la derivacion
 * del importe (`derivarComposicionGanancia`) y la del detalle (`categoriasDeFilaComposicion`).
 * Escribirlo dos veces es como el importe de una fila y su lista de movimientos acabarian
 * diciendo cosas distintas sin que nada fallara.
 */
const CATEGORIAS_DE_EGRESO_CON_FILA: ReadonlySet<string> = new Set(WALLET_EGRESO_CON_FILA_SEED);

function esIngresoPropio(categoria: WalletMovimientoCategoria): categoria is WalletIngresoPropio {
  return CATEGORIAS_DE_INGRESO_PROPIO.has(categoria);
}

function esEgresoNombrado(categoria: WalletMovimientoCategoria): categoria is WalletEgresoNombrado {
  return CATEGORIAS_DE_EGRESO_NOMBRADO.has(categoria);
}

/**
 * El tipo de una categoria se lee de su PREFIJO, y no es una heuristica: el CHECK
 * `wallet_movimiento_tipo_categoria_check` (migracion `20260803120000_caja_tesoreria`) enumera
 * las 17 combinaciones legitimas y son exactamente esas — toda `ingreso_*` con tipo `ingreso` y
 * toda `egreso_*` con tipo `egreso`. La base no admite ninguna otra.
 */
function esCategoriaDeEgreso(categoria: WalletMovimientoCategoria): boolean {
  return categoria.startsWith("egreso_");
}

/** El COMPLEMENTO, derivado del catalogo: egresos propios que no tienen fila propia. */
const EGRESOS_PROPIOS_SIN_FILA: readonly WalletMovimientoCategoria[] =
  WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
    (categoria) =>
      NATURALEZA_POR_CATEGORIA[categoria] === "propio" &&
      esCategoriaDeEgreso(categoria) &&
      !CATEGORIAS_DE_EGRESO_CON_FILA.has(categoria),
  );

/**
 * Ficha 339 (T2.1, design §3, R18) — que categorias componen el importe de UNA fila de la
 * tarjeta de la ganancia.
 *
 * Para el token del complemento devuelve todo egreso PROPIO que no tenga fila propia —derivado
 * del catalogo y de `NATURALEZA_POR_CATEGORIA`, nunca una lista escrita a mano—; para cualquier
 * otra fila, esa sola categoria.
 *
 * **Esta funcion es la mitad del diseno de la ficha.** El importe de una fila y la lista de
 * movimientos de esa fila salen de la MISMA definicion (`CATEGORIAS_DE_EGRESO_CON_FILA`). Si la
 * lista se dedujera aparte, podrian divergir sin que nada fallara: la fila diria 227.300,00 y el
 * detalle ensenaria otra cosa. Es el mismo error, un piso mas abajo, que esta ficha arregla.
 *
 * Hoy devuelve `["egreso_gasto"]` para «Otros»: la unica categoria de egreso propio que queda
 * sin fila, y no tiene ni un escritor en el arbol.
 */
export function categoriasDeFilaComposicion(
  fila: ComposicionFilaId,
): readonly WalletMovimientoCategoria[] {
  if (fila === COMPOSICION_FILA_OTROS) return EGRESOS_PROPIOS_SIN_FILA;
  return [fila];
}

/**
 * Feature 231 (R23/R26, design §2.2) — la ganancia de Ordenex, concepto por concepto.
 *
 * Funcion PURA y con la MISMA entrada que `derivarCaja`: el servicio la llama sobre el MISMO
 * array de filas (design §3.2), y eso es lo que garantiza R24 —la tarjeta de la ganancia y la
 * cifra de la caja hablan del mismo instante y del mismo conjunto, y no pueden discrepar
 * aunque alguien registre un movimiento entre dos peticiones—.
 *
 * Dos invariantes, y las dos son ESTRUCTURALES, no aspiracionales:
 *
 *  - `totalIngresos` es la Σ de las siete cubetas, asi que la columna de ingresos de la
 *    tarjeta SIEMPRE suma su propio total. Que ademas coincida con `ingresosPropios` depende
 *    de que el seed cubra todas las categorias propias de ingreso, y eso lo mide en runtime
 *    `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts`.
 *  - `otrosEgresos` es el COMPLEMENTO: todo egreso propio que no tenga FILA PROPIA en la
 *    columna. Por eso «los cuatro conceptos del desglose + los nombrados + otros» suman
 *    `totalEgresos` = `egresosPropios` aunque el catalogo gane manana un egreso propio (R26 de
 *    la 231, R11/R13 de la 343). Escribir aqui la lista de las categorias que hoy faltan
 *    dejaria esa suma a merced de que alguien se acordara de ampliarla.
 *
 * Ficha 339 (T2.2): el conjunto contra el que se complementa pasa de
 * `WALLET_EGRESO_DESGLOSADO_SEED` a `WALLET_EGRESO_CON_FILA_SEED`, y los dos egresos que salen
 * del cubo ganan su propia cubeta en `egresos`. **Ninguna cifra agregada se mueve** (R12/R14):
 * el dinero no sale de la suma, cambia de cubeta.
 *
 * El desglose se teclea POR CATEGORIA (`ingreso_comision_cod`), nunca con las claves camelCase
 * de las formulas de ingreso: `caja-173-alcance.guardia.test.ts` prohibe que este modulo
 * nombre un insumo de formula, y con razon — no es quien las calcula.
 */
export function derivarComposicionGanancia(
  filas: readonly AgregadoCajaRow[],
): ComposicionGananciaDTO {
  const ingresos = cubetasDeIngreso();
  const egresos = cubetasDeEgresoNombrado();
  let totalIngresos = new Prisma.Decimal(0);
  let totalEgresos = new Prisma.Decimal(0);
  let otrosEgresos = new Prisma.Decimal(0);

  for (const fila of filas) {
    if (NATURALEZA_POR_CATEGORIA[fila.categoria] !== "propio") continue;
    const monto = new Prisma.Decimal(fila.total);

    if (fila.tipo === "ingreso") {
      if (!esIngresoPropio(fila.categoria)) continue;
      ingresos[fila.categoria] = ingresos[fila.categoria].add(monto);
      totalIngresos = totalIngresos.add(monto);
      continue;
    }

    totalEgresos = totalEgresos.add(monto);
    // Ficha 339 (T2.2, R13): cada categoria aporta a EXACTAMENTE una cubeta. La que tiene fila
    // con nombre va a la suya; la que tiene fila en `DesgloseEgresosDTO` no se acumula aqui (la
    // sirve la 45/158 por su propio camino); y solo lo que no tiene fila NINGUNA cae en «otros».
    if (esEgresoNombrado(fila.categoria)) {
      egresos[fila.categoria] = egresos[fila.categoria].add(monto);
    } else if (!CATEGORIAS_DE_EGRESO_CON_FILA.has(fila.categoria)) {
      otrosEgresos = otrosEgresos.add(monto);
    }
  }

  return {
    ingresos: Object.fromEntries(
      WALLET_INGRESO_PROPIO_SEED.map((categoria) => [categoria, montoEscala2(ingresos[categoria])]),
    ) as Record<WalletIngresoPropio, string>,
    totalIngresos: montoEscala2(totalIngresos),
    egresos: Object.fromEntries(
      WALLET_EGRESO_NOMBRADO_SEED.map((categoria) => [categoria, montoEscala2(egresos[categoria])]),
    ) as Record<WalletEgresoNombrado, string>,
    otrosEgresos: montoEscala2(otrosEgresos),
    totalEgresos: montoEscala2(totalEgresos),
    // R9: la decision de pintar «Otros» la toma el SERVIDOR. `isZero()` y no `.gt(0)`: un
    // importe negativo es justo lo que mas falta haria ver, y `.gt(0)` lo esconderia.
    hayOtrosEgresos: !otrosEgresos.isZero(),
  };
}
