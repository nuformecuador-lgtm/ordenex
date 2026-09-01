import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import type { WalletIngresoConcepto, WalletMovimientoCategoria } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (design §2) — EL CORAZON DE LA FICHA: de donde sale el importe de una fila del
 * libro y que ordenes lo componen, declarado UNA sola vez.
 *
 * Modulo PURO: no consulta nada, no conoce Next y de Prisma solo usa `Decimal`, que es
 * aritmetica. Money-safe: nada de `Number(`, `parseFloat(` ni `parseInt(`.
 *
 * NO HAY NI UNA FORMULA DE DINERO NUEVA (R46). El aporte de una orden a un concepto se
 * RE-DERIVA con `derivarIngresoOrden` —la misma funcion que produjo el importe del movimiento—
 * sobre las ENTRADAS que `cierre_detail` congelo. Es el camino de auditoria que el propio
 * esquema declara y que `CierresAdminRepository.toIngresoOrdenex` ya recorre.
 *
 * CORRECCION DE PREMISA, escrita para que nadie la busque en vano: `cierre_detail` congela las
 * ENTRADAS de la formula (tarifa, `monto_cobrar`, `cobra_comision`, `es_central`,
 * `es_zona_especial`, `tienda_id`), NO los conceptos derivados. NO EXISTE una columna con el
 * aporte por orden: los conceptos dependen del `resultado` de la GESTION, no de la orden.
 */

/**
 * De donde sale el importe de una categoria del libro. Tres formas y solo tres.
 *
 * `sin_reparto` no es un hueco: es una DECLARACION con motivo, y es lo que permite que esa fila
 * se abra igual y diga de donde sale su importe en vez de callar (R48).
 */
export type FuenteDeAporte =
  | { tipo: "concepto_ordenex"; concepto: WalletIngresoConcepto }
  | { tipo: "cod_recaudado" }
  | { tipo: "sin_reparto"; motivo: MotivoSinReparto };

/**
 * R49 — el catalogo de la CAJA PRINCIPAL. `Record` TOTAL sobre el union de categorias: una
 * categoria nueva en el enum rompe el BUILD en vez de caer en un `default` silencioso. Es el
 * mismo recurso con el que `NATURALEZA_POR_CATEGORIA` clasifica el dueno del dinero.
 *
 * Los seis conceptos del feed del cierre se reparten por orden. Los tres que NO, con su motivo:
 *
 *  - `egreso_pago_mensajero`  -> su importe es el snapshot `cierre_dia.total_pago_mensajero`.
 *  - `ingreso_cod_recaudado`  -> es la suma de los creditos que ese cierre dejo en el libro POR
 *                               TIENDA. Repartirlo exigiria afirmar una invariante entre dos
 *                               snapshots que esta ficha NO ha medido.
 *  - `egreso_indemnizacion`   -> su fuente por orden EXISTE (`gestion_orden.indemnizacion`),
 *                               pero la emite un tercer productor; follow-up declarado.
 *
 * Todo lo demas (`*_ajuste`, `egreso_gasto*`, `egreso_sueldo`, `egreso_pago_tienda`,
 * `ingreso_reverso_pago_tienda`) no nace de un cierre: no hay ordenes que ensenar.
 */
export const FUENTE_CAJA: Record<WalletMovimientoCategoria, FuenteDeAporte> = {
  ingreso_flete: { tipo: "concepto_ordenex", concepto: "ingreso_flete" },
  ingreso_flete_devolucion: { tipo: "concepto_ordenex", concepto: "ingreso_flete_devolucion" },
  ingreso_comision_cod: { tipo: "concepto_ordenex", concepto: "ingreso_comision_cod" },
  ingreso_iva_flete: { tipo: "concepto_ordenex", concepto: "ingreso_iva_flete" },
  ingreso_iva_flete_devolucion: {
    tipo: "concepto_ordenex",
    concepto: "ingreso_iva_flete_devolucion",
  },
  ingreso_iva_comision_cod: { tipo: "concepto_ordenex", concepto: "ingreso_iva_comision_cod" },
  egreso_pago_mensajero: { tipo: "sin_reparto", motivo: "snapshot_del_cierre" },
  ingreso_cod_recaudado: { tipo: "sin_reparto", motivo: "suma_del_libro_por_tienda" },
  egreso_indemnizacion: { tipo: "sin_reparto", motivo: "otro_productor" },
  ingreso_ajuste: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_ajuste: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_gasto: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_gasto_fijo: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_gasto_variable: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_sueldo: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  egreso_pago_tienda: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  ingreso_reverso_pago_tienda: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
};

/**
 * R49 — el catalogo del LIBRO POR TIENDA. `Record` TOTAL, mismo motivo que el de arriba.
 *
 * Los seis debitos son el espejo 1:1 de los seis conceptos de la caja (`MAPEO_CONCEPTO_TIENDA`):
 * la MISMA cifra derivada por `derivarIngresoOrden`, con otro nombre. Que este catalogo sea
 * exactamente la INVERSA de aquel mapa no lo puede afirmar un `Record` escrito a mano: lo
 * afirma `tests/unit/utils/aporte-por-orden.test.ts` recorriendo los seis conceptos.
 *
 * `cod_recaudado` es el UNICO credito y tiene fuente propia: `gestion_orden.monto_recibido`, lo
 * que esa gestion recaudo de verdad (el feed lo acumula para TODA gestion del cierre).
 *
 * El interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` NO entra en este catalogo, y hay que decirlo:
 * ese flag decide si el feed EMITE los dos debitos de devolucion, no cuanto valen. Si el
 * movimiento existe, sus aportantes son los mismos con el flag en cualquier posicion. Meterlo
 * aqui seria anadir una condicion que no gobierna dinero.
 */
export const FUENTE_TIENDA: Record<WalletTiendaMovimientoCategoria, FuenteDeAporte> = {
  flete: { tipo: "concepto_ordenex", concepto: "ingreso_flete" },
  flete_devolucion: { tipo: "concepto_ordenex", concepto: "ingreso_flete_devolucion" },
  comision_cod: { tipo: "concepto_ordenex", concepto: "ingreso_comision_cod" },
  iva_flete: { tipo: "concepto_ordenex", concepto: "ingreso_iva_flete" },
  iva_flete_devolucion: { tipo: "concepto_ordenex", concepto: "ingreso_iva_flete_devolucion" },
  iva_comision_cod: { tipo: "concepto_ordenex", concepto: "ingreso_iva_comision_cod" },
  cod_recaudado: { tipo: "cod_recaudado" },
  pago_tienda: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  ajuste_credito: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  ajuste_debito: { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
};

/**
 * Ficha 344 (design §2.2) — EL CRITERIO «esta orden aporta a este concepto», declarado UNA vez
 * sobre CINCO hechos que son COLUMNAS.
 *
 * DE ESTA TABLA SALEN LAS DOS FORMAS DEL CRITERIO, y esa es la unica razon por la que existe:
 * el `WHERE` que pagina y CUENTA (`CierreAporteRepository`) y el predicado en memoria
 * (`satisfaceCriterio`). Que los cinco hechos sean columnas es lo que permite tener las dos sin
 * elegir entre paginar en la base (R21) y contar el total en la base (R28).
 *
 * LO UNICO QUE IMPIDE QUE DIVERJAN es `tests/unit/utils/aporte-por-orden-equivalencia.test.ts`,
 * que compara este criterio contra `derivarIngresoOrden` en TODAS sus combinaciones. Si manana
 * alguien cambia la formula —como hizo la ficha 301 al sacar `devuelta` de los conceptos de
 * devolucion— ese test se pone rojo en el MISMO commit y obliga a mover esta tabla. No se puede
 * cambiar una sin la otra en silencio, que es literalmente lo que pide R18.
 *
 * Si alguna vez hiciera falta una condicion que NO es columna, la salida correcta NO es un `if`
 * en memoria: es la alternativa A1 de `design.md` (derivar el cierre entero y paginar el array),
 * asumiendo su coste en R21/R28.
 */
export interface CriterioDeAporte {
  /** `gestion_orden.resultado`: los resultados cuya gestion puede aportar a este concepto. */
  resultados: readonly GestionResultado[];
  /** `cierre_detail.cobra_comision IS TRUE`. */
  exigeCobraComision: boolean;
  /** `cierre_detail.tarifa_id IS NOT NULL` (sin tarifa congelada no se deriva nada, R23). */
  exigeTarifa: boolean;
  /**
   * `cierre_detail.monto_cobrar > 0`. Es la SUPRESION DE LOS APORTES EN CERO (Q2), no una
   * condicion de la formula: ver el bloque de abajo.
   */
  exigeMontoCobrar: boolean;
  /** `gestion_orden.monto_recibido > 0`. Solo la usa `cod_recaudado`, por el mismo motivo. */
  exigeMontoRecibido: boolean;
}

/**
 * LA SUPRESION DE LOS CEROS, declarada, porque es la unica desviacion de `design.md`.
 *
 * `design.md § Q2` asumia MOSTRAR la orden que aporta «0,00». EL HUMANO DECIDIO LO CONTRARIO
 * (feature_list, ficha 344, Q2: «lo que aporta cero no es parte del numero»), y `design.md` ya
 * escribio la condicion de esa decision: «el filtro tendria que ir tambien en el `count` para
 * que R28 siga siendo cierto». Por eso NO se filtra en memoria: `exigeMontoCobrar` y
 * `exigeMontoRecibido` son COLUMNAS y viajan en el MISMO `where` que pagina y que cuenta.
 *
 * QUE CUBRE, exactamente: el caso real y frecuente —una orden que cobra comision y no tenia COD
 * que recaudar (`monto_cobrar` 0 o NULL) deriva `ingreso_comision_cod = 0.00` y ya no ensucia el
 * detalle— y su gemelo del credito de la tienda (una gestion sin recaudo).
 *
 * QUE NO CUBRE, y se dice en vez de esconderse: un aporte que sale 0,00 porque la TARIFA
 * congelada valia cero (flete 0, IVA 0 %, comision 0 %). Filtrarlo exigiria calcular el importe
 * DENTRO del `WHERE`, o sea escribir la formula de dinero por SEGUNDA vez en SQL, que es
 * exactamente lo que R18/R46 prohiben. En ese caso —que ademas solo puede existir si otra orden
 * del cierre aporta algo, porque un concepto en 0,00 no llega a emitir movimiento— la fila
 * aparece con «0,00»: es la conducta que `design.md` daba por defecto, y NO rompe nada — la
 * suma sigue cuadrando y el `count` sigue casando con las filas.
 */
export const CRITERIO_DE_APORTE: Record<WalletIngresoConcepto, CriterioDeAporte> = {
  // Solo una ENTREGA factura flete, y sin tarifa congelada no hay monto que facturar.
  ingreso_flete: {
    resultados: ["entregada"],
    exigeCobraComision: false,
    exigeTarifa: true,
    exigeMontoCobrar: false,
    exigeMontoRecibido: false,
  },
  ingreso_iva_flete: {
    resultados: ["entregada"],
    exigeCobraComision: false,
    exigeTarifa: true,
    exigeMontoCobrar: false,
    exigeMontoRecibido: false,
  },
  // FICHA 301 (2026-08-28): SOLO `rechazada`. La `devuelta` estuvo aqui y se fue por decision de
  // negocio. Volver a meterla sin tocar `derivarIngresoOrden` pone rojo el test de equivalencia,
  // que es exactamente para lo que existe.
  ingreso_flete_devolucion: {
    resultados: ["rechazada"],
    exigeCobraComision: false,
    exigeTarifa: true,
    exigeMontoCobrar: false,
    exigeMontoRecibido: false,
  },
  ingreso_iva_flete_devolucion: {
    resultados: ["rechazada"],
    exigeCobraComision: false,
    exigeTarifa: true,
    exigeMontoCobrar: false,
    exigeMontoRecibido: false,
  },
  // La comision COD y su IVA solo existen si la orden COBRA comision (R8/R26 de la 42). El
  // `exigeMontoCobrar` es la supresion de ceros, no parte de la formula.
  ingreso_comision_cod: {
    resultados: ["entregada"],
    exigeCobraComision: true,
    exigeTarifa: true,
    exigeMontoCobrar: true,
    exigeMontoRecibido: false,
  },
  ingreso_iva_comision_cod: {
    resultados: ["entregada"],
    exigeCobraComision: true,
    exigeTarifa: true,
    exigeMontoCobrar: true,
    exigeMontoRecibido: false,
  },
};

/**
 * El criterio del CREDITO de la tienda. No sale de `CRITERIO_DE_APORTE` porque no es un concepto
 * de `derivarIngresoOrden`: el feed acumula `monto_recibido` de TODA gestion del cierre, sin
 * mirar el resultado, la tarifa ni la comision. Lo unico que se le anade es la supresion de
 * ceros, que aqui SI es exacta: la suma de montos no negativos es mayor que cero exactamente
 * cuando alguno de ellos lo es.
 */
export const CRITERIO_COD_RECAUDADO: CriterioDeAporte = {
  resultados: ["entregada", "reprogramada", "devuelta", "rechazada", "incidente"],
  exigeCobraComision: false,
  exigeTarifa: false,
  exigeMontoCobrar: false,
  exigeMontoRecibido: true,
};

/** Los cinco hechos ALMACENADOS de un par (orden congelada, gestion del cierre). */
export interface HechosDeAporte {
  resultado: GestionResultado;
  cobraComision: boolean;
  hayTarifa: boolean;
  /** `monto_cobrar > 0` (un NULL cuenta como `false`: no hay COD que comisionar). */
  hayMontoCobrar: boolean;
  /** `monto_recibido > 0` (un NULL cuenta como `false`: esa gestion no recaudo nada). */
  hayMontoRecibido: boolean;
}

/**
 * La forma EN MEMORIA del criterio. Su gemela es el `where` de `CierreAporteRepository`, y las
 * dos se atan con el test de equivalencia: si esta funcion y aquel `where` dejaran de decir lo
 * mismo, el detalle y su total hablarian de conjuntos distintos.
 */
export function satisfaceCriterio(criterio: CriterioDeAporte, hechos: HechosDeAporte): boolean {
  if (!criterio.resultados.includes(hechos.resultado)) return false;
  if (criterio.exigeTarifa && !hechos.hayTarifa) return false;
  if (criterio.exigeCobraComision && !hechos.cobraComision) return false;
  if (criterio.exigeMontoCobrar && !hechos.hayMontoCobrar) return false;
  if (criterio.exigeMontoRecibido && !hechos.hayMontoRecibido) return false;
  return true;
}

/** El criterio que le toca a una fuente. `sin_reparto` no tiene: esa fila no lista ordenes. */
export function criterioDeFuente(fuente: FuenteDeAporte): CriterioDeAporte | null {
  if (fuente.tipo === "concepto_ordenex") return CRITERIO_DE_APORTE[fuente.concepto];
  if (fuente.tipo === "cod_recaudado") return CRITERIO_COD_RECAUDADO;
  return null;
}

/** Las ENTRADAS congeladas de una orden en un cierre (`cierre_detail`), ya money-safe. */
export interface OrdenCongelada {
  esCentral: boolean;
  esZonaEspecial: boolean;
  /** STRING escala 2, o `null` (la columna es nullable en origen). Nunca `number`. */
  montoCobrar: string | null;
  cobraComision: boolean;
  /** Reconstruida con `tarifaDe`; `null` = la tienda no tenia tarifa vigente al solicitar. */
  tarifa: TarifaVigente | null;
}

/** Una gestion de ESA orden en ESE cierre. `montoRecibido` STRING escala 2, o `null`. */
export interface GestionDelCierre {
  resultado: GestionResultado;
  montoRecibido: string | null;
}

/**
 * Cuanto aporta UNA ORDEN al importe de UN movimiento, o `undefined` si no aporta nada.
 *
 * `concepto_ordenex` — se llama a `derivarIngresoOrden` por CADA gestion de esa orden en ese
 * cierre y se acumulan los aportes PRESENTES. Un concepto AUSENTE significa «esta gestion no
 * aporta a ese concepto» (no es un 0,00), asi que si ninguna lo trae, la orden no aporta.
 *
 * `cod_recaudado` — se acumula `monto_recibido ?? 0` de todas sus gestiones, que es exactamente
 * lo que hace el feed del ledger por tienda (llama a su acumulador para TODA gestion, con o sin
 * recaudo).
 *
 * LA ACUMULACION NO ES UNA OPERACION DE DINERO NUEVA. Es la MISMA que
 * `agregarIngresosPorConcepto` ya hace, PARTICIONADA por orden en vez de colapsada, y es exacta:
 * cada aporte que devuelve `derivarIngresoOrden` viene ya a escala 2 (`round2`/
 * `aplicarPorcentaje`), asi que sumar 2 decimales da 2 decimales y el `round2` final del agregado
 * es la identidad. No hay deriva de redondeo, y se PRUEBA (no se supone) en
 * `tests/unit/utils/aporte-por-orden.test.ts`. En el caso normal —una gestion por orden— ni
 * siquiera hay suma: hay una copia.
 */
export function aporteDeOrden(
  fuente: FuenteDeAporte,
  orden: OrdenCongelada,
  gestiones: readonly GestionDelCierre[],
): Prisma.Decimal | undefined {
  if (fuente.tipo === "sin_reparto") return undefined;

  if (fuente.tipo === "cod_recaudado") {
    if (gestiones.length === 0) return undefined;
    let recaudado = new Prisma.Decimal(0);
    for (const g of gestiones) recaudado = recaudado.plus(new Prisma.Decimal(g.montoRecibido ?? "0"));
    return recaudado;
  }

  let total: Prisma.Decimal | undefined;
  for (const g of gestiones) {
    const derivado = derivarIngresoOrden(
      {
        resultado: g.resultado,
        esCentral: orden.esCentral,
        esZonaEspecial: orden.esZonaEspecial,
        montoCobrar: orden.montoCobrar,
        cobraComision: orden.cobraComision,
      },
      orden.tarifa,
    );
    const aporte = derivado[fuente.concepto];
    if (aporte === undefined) continue; // el concepto no aplica a esta gestion
    total = (total ?? new Prisma.Decimal(0)).plus(aporte);
  }
  return total;
}
