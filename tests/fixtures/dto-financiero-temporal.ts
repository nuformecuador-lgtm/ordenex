import { granularidadDe, trocear } from "@/lib/analytics/cubo-temporal";
import { resolverRango } from "@/lib/analytics/ranges";
import type { DimensionAnalitica, MetricaUnidad, RangoResuelto, TablaDinero } from "@/lib/analytics/types";
import {
  esMetricaAcumulada,
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  type FilaFinanciera,
  type GranularidadVista,
  type ImporteAnalitico,
  type RangoFinanciero,
  type ResultadoFinancieroVistas,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";

// GUARDIA DE ARNES (2026-08-07, sin ficha) — EL DOBLE DE UNA METRICA TEMPORAL DEL TABLERO.
//
// POR QUE ESTE ARCHIVO EXISTE, con nombre y fecha del incidente que lo paga:
//
// El 2026-08-06 el tablero financiero estuvo SIETE HORAS en produccion pintando una tabla de
// treinta fechas donde el maestro esperaba «Dinero en caja». La causa inmediata fue una señal de
// forma que la feature 180 invalido (`filas.length === 0` para decidir «KPI vs tabla»), pero lo
// que dejo pasar el defecto hasta produccion fue OTRA cosa: el doble del tablero
// (`tests/components/TableroFinanciero.test.tsx`) se llamaba `vistaSinFilas`, declaraba
// `filas: []` A MANO y llevaba escrito al lado, sobre `granularidad`, «el tablero NO la lee».
// Las dos afirmaciones eran falsas desde la 180. La propia 180 paso por delante de ese doble,
// LO EDITO para añadirle `granularidad`, y no vio que su cambio invalidaba la premisa que el
// doble fijaba. Una fixture cuyo DTO el servicio ya no produce no protege nada: describe un
// mundo que no existe, y el componente y su prueba se equivocan igual, asi que no se
// contradicen nunca.
//
// LA DECISION DE DISENO, escrita aqui porque es lo unico que impide que vuelva a pasar: la forma
// del DTO temporal deja de ser una DECLARACION LIBRE dentro de un archivo de test y pasa a ser
// (a) DERIVADA de las mismas funciones puras que el servicio usa —`resolverRango`, `trocear`,
// `granularidadDe`, `esMetricaAcumulada`— y (b) ATADA por ejecucion a la salida real del
// servicio en `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts`. Las dos mitades
// hacen falta y ninguna sustituye a la otra:
//
//   - solo (a) seguiria mirandose al espejo: el doble copiaria las DEPENDENCIAS del servicio, y
//     el dia que un manejador dejara de llamar a `granularidadDe` el doble seguiria diciendo
//     «dia» mientras el servicio dice otra cosa;
//   - solo (b) ataria un literal escrito a mano, que es lo que hoy hacen las dos guardias del
//     tablero (`tablero-financiero.guardia.test.ts` y `tablero-lineas-trazabilidad.guardia.test.ts`):
//     son CENSOS DE TEXTO sobre archivos, no ejecutan el servicio y por tanto no pueden ver esta
//     clase de divergencia. No las duplica: mide otra cosa.
//
// POR QUE VIVE EN `tests/fixtures/` Y NO EN EL PROPIO TEST DE COMPONENTE: para que la guardia
// —que corre en `node` y arrastra el servicio entero, y con el Prisma— pueda importar EXACTAMENTE
// el mismo constructor que el test de componente usa en jsdom. Importar un `.test.tsx` desde otro
// test registraria sus casos dos veces. Mismo motivo y mismo sitio que
// `tests/fixtures/importe-analitico.ts`, con la misma restriccion: aqui NO se importa el
// servicio, ni un repositorio, ni Prisma. Solo modulos puros de `lib/analytics` y tipos.
//
// LO QUE ESTE MODULO **NO** FIJA, y no es un olvido (ver la bitacora
// `progress/impl_guardia-servicio-dobles.md`, seccion «Que NO cubre»):
//   - las CIFRAS. El doble las elige ajenas a todos los totales del test de componente a
//     proposito, para que un panel que pintara una fila donde va el titular no pueda acertar por
//     azar. Atarlas al servicio destruiria esa propiedad.
//   - la `moneda` del importe, que `tests/fixtures/importe-analitico.ts` rellena con un marcador
//     visible por la misma razon.
//   - la `etiqueta`, que el servicio saca del catalogo y el doble escribe a mano: el tablero pinta
//     la del DTO, sea cual sea, asi que una divergencia ahi no puede producir el defecto de la
//     forma.

/** Las siete metricas cuya vista es una SERIE TEMPORAL densa desde la feature 180. */
export type MetricaTemporalServida = (typeof IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA)[number];

/**
 * El rango con el que el tablero se prueba: treinta dias, ambos extremos incluidos.
 *
 * Vive AQUI y no en el test de componente para que la guardia pueda consultar al servicio por
 * EXACTAMENTE la misma ventana. Con dos declaraciones, la comparacion mediria dos mundos.
 */
export const RANGO_TABLERO: RangoFinanciero = {
  desdeFecha: "2026-07-05",
  hastaFecha: "2026-08-03",
} as const;

/**
 * El grano que las siete publican. UNO, no un mapa: el catalogo las declara todas por fecha y
 * los tres manejadores del servicio escriben el mismo literal.
 */
export const GRANO_TEMPORAL: DimensionAnalitica = "fecha";

/** La unidad de las diez financieras del catalogo. */
export const UNIDAD_TEMPORAL: MetricaUnidad = "moneda";

/**
 * De que tabla sale cada una, tal como el servicio lo publica.
 *
 * NO son todas la misma, y esa asimetria es justo lo que un doble con un literal unico
 * escondia: las seis de caja salen de `wallet_movimiento` (manejadores `deCaja` y `deTesoreria`)
 * y la de mensajeros de `pago_mensajero_movimiento` (`deCuentaDeMensajeros`). El doble del
 * tablero declaraba `wallet_tienda_movimiento` en las SIETE —una tabla que ninguna de ellas
 * toca—, y nadie se entero porque el tablero no lee este campo. Ese «no lo lee» es palabra por
 * palabra el argumento con el que se dejo mentir a `granularidad`, asi que aqui se ata igual.
 *
 * El registro es EXHAUSTIVO sobre las siete: una metrica que entre o salga de
 * `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` rompe la COMPILACION de este archivo (TS2739) en vez
 * de dejar el doble describiendo el reparto de ayer.
 */
export const FUENTE_TEMPORAL: Readonly<Record<MetricaTemporalServida, TablaDinero>> = {
  ingreso_flete: "wallet_movimiento",
  ingreso_comision_cod: "wallet_movimiento",
  ingreso_iva: "wallet_movimiento",
  egresos: "wallet_movimiento",
  dinero_en_caja: "wallet_movimiento",
  ganancia_ordenex: "wallet_movimiento",
  cuenta_por_pagar_mensajero: "pago_mensajero_movimiento",
};

/**
 * El rango RESUELTO, por el MISMO camino que la consulta real (`resolverRango`).
 *
 * No se construyen los instantes a mano: la frontera del dia de Costa Rica tiene una sola
 * definicion en el repo (`lib/utils/fecha-cr.ts`) y escribir aqui un `T06:00:00Z` abriria la
 * segunda de la que `ranges.ts` avisa por escrito.
 */
export function rangoResuelto(rango: RangoFinanciero = RANGO_TABLERO): RangoResuelto {
  return resolverRango({
    preset: "personalizado",
    desde: rango.desdeFecha,
    hasta: rango.hastaFecha,
  });
}

/**
 * Las claves de cubo de la serie densa: las que `trocear` produce para ESE rango, en su orden.
 *
 * DERIVADAS, no escritas: hasta hoy el test de componente las calculaba con su propia aritmetica
 * de milisegundos sobre UTC. Daba el mismo resultado —medido: identico, 30 claves— pero era una
 * segunda definicion del troceo viviendo al lado de la primera, y dos definiciones del mismo dia
 * es exactamente como nace un off-by-one que nadie ve.
 */
export function cubosDelRango(rango: RangoFinanciero = RANGO_TABLERO): readonly string[] {
  return trocear(rangoResuelto(rango)).map((cubo) => cubo.clave);
}

/**
 * La granularidad que el SERVIDOR decide para ese rango.
 *
 * Tampoco es un literal: `granularidadDe` compara el tamano del rango contra
 * `TOPE_PUNTOS_SERIE`, asi que si alguien mueve las fechas de `RANGO_TABLERO` por encima del
 * tope, el doble pasa a declarar `semana` —como haria el servicio— en vez de seguir afirmando
 * un grano que ya no le corresponde.
 */
export function granularidadDelRango(rango: RangoFinanciero = RANGO_TABLERO): GranularidadVista {
  return granularidadDe(rangoResuelto(rango));
}

/** Como se construye el importe de la fila `indice`, cuya clave de cubo es `cubo`. */
export type ImporteDeFila = (indice: number, cubo: string) => ImporteAnalitico;

/**
 * La serie DENSA del doble: UNA fila por cubo del rango, incluidos los cubos sin movimiento.
 *
 * Es la misma cardinalidad que `serieDensa` produce en el servicio
 * (`lib/services/AnaliticaFinancieraService.ts`), y por el mismo motivo: la densidad la decide el
 * RANGO, no los datos. Esa es exactamente la propiedad que hace atable esta forma —y la que NO
 * tienen los desgloses por tienda o por metodo de pago, cuya cardinalidad depende de lo que haya
 * en la base—.
 */
export function serieDensaDelRango(
  importeDeFila: ImporteDeFila,
  rango: RangoFinanciero = RANGO_TABLERO,
): readonly FilaFinanciera[] {
  return cubosDelRango(rango).map((cubo, indice) => ({ cubo, importe: importeDeFila(indice, cubo) }));
}

/**
 * La VISTA de una metrica temporal, con la forma que el servicio produce hoy.
 *
 * El `id` de la vista es el id de la METRICA, sin sufijo: es lo que los tres manejadores
 * escriben (`id: consulta.metrica.id`). El doble llevaba `${metricaId}__vista`, que no existe en
 * ningun DTO real; no importaba porque el nombre accesible de una metrica de una sola vista sale
 * de la etiqueta, pero es otra afirmacion falsa esperando a que alguien la lea.
 */
export function vistaTemporalServida(
  metricaId: MetricaTemporalServida,
  importeDeFila: ImporteDeFila,
  total: ImporteAnalitico,
  rango: RangoFinanciero = RANGO_TABLERO,
): VistaFinanciera {
  return {
    id: metricaId,
    grano: GRANO_TEMPORAL,
    fuente: FUENTE_TEMPORAL[metricaId],
    sumableCon: [],
    granularidad: granularidadDelRango(rango),
    filas: serieDensaDelRango(importeDeFila, rango),
    total,
  };
}

/**
 * El DTO completo de una metrica temporal: cabecera + su unica vista.
 *
 * `esAcumulado` se DERIVA de `esMetricaAcumulada`, la misma funcion del contrato que el servicio
 * llama en su cabecera, en vez de llegar como un booleano suelto. Era el ultimo campo de la
 * cabecera que el doble podia contradecir sin que nada fallara, y no es inocuo: el tablero
 * decide con el si pinta «saldo al corte» y si sustituye la linea por el motivo escrito.
 *
 * La `etiqueta` SI la pone el llamador: ver la cabecera del archivo.
 */
export function dtoTemporalServido(
  metricaId: MetricaTemporalServida,
  etiqueta: string,
  importeDeFila: ImporteDeFila,
  total: ImporteAnalitico,
  rango: RangoFinanciero = RANGO_TABLERO,
): ResultadoFinancieroVistas {
  return {
    tipo: "vistas",
    metricaId,
    etiqueta,
    unidad: UNIDAD_TEMPORAL,
    rango,
    esAcumulado: esMetricaAcumulada(metricaId),
    vistas: [vistaTemporalServida(metricaId, importeDeFila, total, rango)],
  };
}
