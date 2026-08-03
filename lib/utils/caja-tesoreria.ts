import { Prisma } from "@prisma/client";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import type {
  AgregadoCajaRow,
  CajaResumenDTO,
  WalletMovimientoCategoria,
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

/** De quien es el dinero: de Ordenex, o de un tercero que lo tiene aparcado en la caja. */
export type NaturalezaMovimiento = "propio" | "terceros";

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
 */
export function derivarCaja(
  filas: readonly AgregadoCajaRow[],
  opciones: { periodoFiltrado?: boolean } = {},
): CajaResumenDTO {
  const acc = acumular(filas);

  const caja = derivarBalance(acc.entradas, acc.salidas);
  const propio = derivarBalance(acc.ingresosPropios, acc.egresosPropios);
  const terceros = derivarBalance(acc.ingresosTerceros, acc.egresosTerceros);

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
  };
}
