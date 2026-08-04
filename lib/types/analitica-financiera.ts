// Feature 127 (T A.1) — CONTRATO DE SALIDA de las metricas financieras (ocho al escribirse;
// DIEZ desde la 173, que anadio `dinero_en_caja` y `ganancia_ordenex` — ver `IDS_FINANCIERAS_SERVIDAS`).
//
// Modulo de TIPOS: sin consultas, sin logica, sin Prisma en import de valor, sin HTTP.
// Lo unico de runtime que exporta son tres registros declarativos (los ids servidos, los
// acumulados y los ids de las dos vistas de `cod_recaudado`), que existen para que ningun
// consumidor tenga que reescribir esas listas a mano.
//
// Invariantes que este archivo materializa, con la decision de la puerta T0 que los ordena:
//
//  - S1 / R27 — TODO importe es STRING escala 2. Ningun `number` representa dinero en
//    ninguna frontera. El unico `number` del contrato es `FilaConciliacion.cantidad`, que
//    es un CONTEO de cierres (design.md §5.3 lo dice literalmente: "aqui si es un entero,
//    no dinero").
//  - ⟨D1⟩ / R37 — cada importe llega DOS veces: `bruto` (Σ de las categorias nominales) y
//    `neto` (Σ CON SIGNO). El `neto` NO sale de emparejar un `ajuste_*` con el movimiento
//    que corrige: el libro no tiene ese puntero (design.md §2.1 hecho 3).
//    ACOTADO por ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`, feature 183): R37 sigue
//    valiendo donde el neto NO es redundante por construccion, y deja de aplicar a las tres
//    metricas cuya lista de categorias es homogenea de prefijo `ingreso_*` —`ingreso_flete`,
//    `ingreso_comision_cod`, `ingreso_iva`—. Con el CHECK categoria↔tipo de la 173 esas tres
//    admiten un solo `tipo`, luego `Σ egreso = 0` y `neto = +bruto` SIEMPRE: el campo no
//    informa de nada. Publican `ImporteSoloBruto`. Lo que R37 sigue prohibiendo —derivar el
//    neto emparejando un `ajuste_*` con el movimiento que corrige— no se toca.
//  - ⟨D3⟩ / R43 — `esAcumulado` es `true` EXACTAMENTE en las dos cuentas por pagar, que son
//    un saldo al corte y no un flujo del periodo.
//  - ⟨D6⟩ / R38 — `cod_recaudado` se sirve en DOS vistas con ids distintos que NO suman
//    entre si; `sumableCon` lo declara en el propio DTO, no en la cabeza del que mira.
//  - ⟨D4⟩ / R39 — cada fila de conciliacion declara su coordenada temporal (`fechadoPor`).
//  - ⟨D8⟩ — no existe estado `no_producida`: la 127 produce las ocho.
//  - ⟨D9⟩ / R42 — el `forbidden` que cruza al cliente NO lleva motivo. El dominio cerrado
//    de `MotivoDenegacion` viaja a `describirDenegado` y al `ErrorLogger`, y solo ahi.
//  - R14 — ningun campo de este contrato es, ni contiene, un identificador de mensajero.
//    Ni siquiera `cierresDescuadrados`, que lleva ids de CIERRE.
//
// DESVIACION DECLARADA respecto de design.md §5.2 (unica): alli `ResultadoFinanciero` es una
// sola interfaz con `vistas`, y §5.3 declara `ResultadoConciliacion` suelto, sin decir por
// donde sale. Aqui `ResultadoFinanciero` es una UNION DISCRIMINADA por `tipo`
// ("vistas" | "conciliacion"). El motivo: `conciliacion_cierres` no produce importes por
// cubo sino conteos por estado mas un cuadre, y modelarla como `vistas: []` con un campo
// opcional al lado obliga a todo consumidor a comprobar un `undefined` que el compilador no
// le exige. Con la union, olvidarse de la conciliacion no compila. El resto de los campos
// son los de design.md §5.2/§5.3, uno a uno.

import type { DimensionAnalitica, MetricaUnidad, TablaDinero } from "@/lib/analytics/types";
import type { MetricaId } from "@/lib/analytics/metrics";

/* -------------------------------------------------------------------------- */
/* 1. Importe: STRING escala 2. UNION DISCRIMINADA por `forma` ⟨D1⟩ R37 / ⟨D12⟩ */
/* -------------------------------------------------------------------------- */
//
// EL DISCRIMINANTE SE LLAMA `forma` Y NO `tipo` A PROPOSITO: en este mismo archivo `tipo` ya
// significa otras dos cosas —`ResultadoFinanciero.tipo` ("vistas" | "conciliacion") y, en el
// contrato del repositorio, `AgregadoCategoriaCaja.tipo` ("ingreso" | "egreso")—. Un tercer
// `tipo` con un tercer significado seria una trampa gratuita.
//
// POR QUE UNA UNION Y NO UN CAMPO OPCIONAL `neto?: string` (feature 183, design.md §3.3(a)):
// un campo opcional invita al arreglo de una linea `importe.neto ?? "0.00"`, que INVENTA un
// cero —el pecado que este contrato persigue desde `aNumero`—, y `undefined` no distingue
// «no aplica» de «no se calculo». En la 132 el dato ausente ya significa «no se sabe» (R15) y
// pintarlo donde la verdad es «no aplica» seria una mentira nueva. Aqui no hay carencia: hay
// otra CLASE de importe. El precedente vive en este mismo archivo (`ResultadoFinanciero`).

/**
 * Importe de una metrica cuyo `neto` con signo significa algo real.
 *
 * Los dos campos existen a la vez A PROPOSITO ⟨D1(c)⟩: el `bruto` es lo que las categorias
 * nominales sumaron, el `neto` es esa misma suma con el signo aplicado (credito − debito,
 * ingreso − egreso, devengo − pago). Servir solo el neto esconderia el volumen; servir solo
 * el bruto mentiria en cuanto hubiera una anulacion. La diferencia entre ambos ES el
 * problema abierto de la 172, y se deja a la vista.
 */
export interface ImporteConNeto {
  readonly forma: "bruto_y_neto";
  /** Σ de las categorias nominales, SIN signo. STRING escala 2. */
  readonly bruto: string;
  /** Σ CON SIGNO agregado. STRING escala 2; puede venir negativo ("-123.45"). */
  readonly neto: string;
  /** Codigo ISO 4217 resuelto por `lib/config/moneda.ts` (S2 / R29). Nunca un simbolo. */
  readonly moneda: string;
}

/**
 * Importe de una metrica cuyo `neto` seria redundante POR CONSTRUCCION: su lista de categorias
 * es homogenea de prefijo y el CHECK categoria↔tipo de la 173
 * (`db/migrations/20260803120000_caja_tesoreria/migration.sql`) admite un solo `tipo` por
 * categoria, luego `Σ egreso = 0` y `neto = +bruto` SIEMPRE.
 *
 * NO lleva `neto` ni siquiera en `null`: leer ese campo de un importe que no lo tiene NO
 * COMPILA, y eso es el punto. ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`).
 */
export interface ImporteSoloBruto {
  readonly forma: "solo_bruto";
  /** Σ de las categorias nominales, SIN signo. STRING escala 2. */
  readonly bruto: string;
  /** Codigo ISO 4217 resuelto por `lib/config/moneda.ts` (S2 / R29). Nunca un simbolo. */
  readonly moneda: string;
}

/** Un importe servido por la analitica financiera, en una de sus DOS formas. */
export type ImporteAnalitico = ImporteConNeto | ImporteSoloBruto;

/* -------------------------------------------------------------------------- */
/* 2. Vistas ⟨D6⟩ R38                                                          */
/* -------------------------------------------------------------------------- */

/** Id de la vista de `cod_recaudado` que sale de los `total_*` del cierre ⟨D6(a)⟩. */
export const VISTA_COD_RECAUDADO_POR_METODO = "cod_recaudado__por_metodo";

/** Id de la vista de `cod_recaudado` que sale del credito del ledger de tienda ⟨D6(a)⟩. */
export const VISTA_COD_RECAUDADO_POR_TIENDA = "cod_recaudado__por_tienda";

/** Una celda del cubo: el valor del grano y su importe. */
export interface FilaFinanciera {
  /** Valor del grano: id de tienda, "efectivo", "YYYY-MM-DD"... Nunca un id de persona fisica. */
  readonly cubo: string;
  readonly importe: ImporteAnalitico;
}

/**
 * Una proyeccion legal de una metrica. Una metrica trae UNA vista, salvo `cod_recaudado`,
 * que trae dos que NO suman entre si ⟨D6(a)⟩ R38.
 */
export interface VistaFinanciera {
  /** Estable: la 132 y la 134 lo usan como clave. Ver las dos constantes de arriba. */
  readonly id: string;
  readonly grano: DimensionAnalitica;
  /** De que tabla salio ESTA cifra. Acotado al universo del dinero por el tipo (R1/R4). */
  readonly fuente: TablaDinero;
  /**
   * Ids de las vistas con las que esta SI suma. `[]` = con ninguna.
   *
   * No es decoracion: las dos vistas de `cod_recaudado` miden cosas distintas (lo que el
   * mensajero entrego vs. lo acreditado a tiendas) y un mismo cierre puede contener ordenes
   * de varias tiendas. La primera pantalla que las ponga juntas las sumaria.
   */
  readonly sumableCon: readonly string[];
  readonly filas: readonly FilaFinanciera[];
  /**
   * R18 (feature 183) — UNA VISTA, UNA FORMA: el `total` y TODAS las `filas` publican la misma
   * `forma`. Una vista que mezclara obligaria a cada consumidor a ramificar fila a fila, y la
   * 180 multiplica por ~62 los sitios donde se emite un importe. Lo vigila
   * `tests/unit/analytics/financiera-forma-importe.guardia.test.ts`.
   */
  readonly total: ImporteAnalitico;
}

/* -------------------------------------------------------------------------- */
/* 3. Conciliacion de cierres ⟨D2/D4/D5⟩ R22/R23/R39                           */
/* -------------------------------------------------------------------------- */

/** Los dos niveles de cierre, POR SEPARADO (R22): fundirlos cuenta el dinero dos veces. */
export type NivelCierre = "cierre_dia" | "cierre_bodega";

/**
 * Los cuatro estados de `CierreEstado` (`db/schema.prisma:833-840`). Se declara aqui como
 * union literal y no se importa el enum de Prisma para que este contrato no arrastre el
 * cliente generado; la equivalencia con el esquema la vigila el test de forma del DTO.
 */
export type EstadoCierreAnalitica = "solicitado" | "aprobado" | "rechazado" | "vencido";

/**
 * ⟨D2/D4⟩ R39 — la coordenada temporal de la fila, EXPLICITA. Un cierre no resuelto no tiene
 * `resuelto_at`: fingir que sus filas se fechan por ahi seria declarar una columna nula.
 */
export type CoordenadaTemporalCierre = "resuelto_at" | "solicitado_at";

/** Las cuatro claves de total snapshot que la conciliacion reporta. */
export type ClaveTotalCierre = "efectivo" | "simpe" | "transferencia" | "general";

export interface FilaConciliacion {
  readonly nivel: NivelCierre;
  readonly estado: EstadoCierreAnalitica;
  /** CONTEO de cierres. Unico `number` del contrato: no es dinero (design.md §5.3). */
  readonly cantidad: number;
  /** Totales snapshot del grupo. STRING escala 2, como todo importe. */
  readonly totales: Readonly<Record<ClaveTotalCierre, string>>;
  readonly fechadoPor: CoordenadaTemporalCierre;
}

/**
 * ⟨D5⟩ R23/R24 — el cuadre se REPORTA, nunca revienta. Si `|diferencia|` supera el umbral de
 * `lib/config/analitica-financiera.ts` se emite ademas por el `ErrorLogger`, pero el DTO se
 * devuelve igual: un tablero que se cae por un descuadre historico es un tablero que alguien
 * apaga, y con el se pierde la comprobacion que se queria ganar.
 */
export interface CuadreConciliacion {
  readonly cuadra: boolean;
  /** Σ `total_general` de los cierres APROBADOS del rango (por `resuelto_at`). */
  readonly totalSnapshot: string;
  /** Σ de los movimientos de ledger cuyo origen son ESOS cierres, no todos los del rango. */
  readonly totalLedger: string;
  /** `totalSnapshot − totalLedger`, con signo. STRING escala 2. */
  readonly diferencia: string;
  /** Ids de CIERRE. Nunca ids de mensajero ni de tienda (R14). */
  readonly cierresDescuadrados: readonly string[];
}

export interface ResultadoConciliacion {
  readonly porEstado: readonly FilaConciliacion[];
  readonly cuadre: CuadreConciliacion;
}

/* -------------------------------------------------------------------------- */
/* 4. Resultado de una metrica                                                 */
/* -------------------------------------------------------------------------- */

/** Fechas calendario CR del rango resuelto, tal cual las produce `resolverRango` (R26). */
export interface RangoFinanciero {
  readonly desdeFecha: string;
  readonly hastaFecha: string;
}

interface CabeceraFinanciera {
  readonly metricaId: string;
  /** Del catalogo (`metrica.etiqueta`). No se escribe aqui ni en el servicio. */
  readonly etiqueta: string;
  /** Del catalogo (`metrica.unidad`). */
  readonly unidad: MetricaUnidad;
  readonly rango: RangoFinanciero;
  /** ⟨D3⟩ R43 — `true` EXACTAMENTE en las dos cuentas por pagar: son saldo al corte. */
  readonly esAcumulado: boolean;
}

/** Las metricas que producen importes por cubo: todas menos `conciliacion_cierres`. */
export interface ResultadoFinancieroVistas extends CabeceraFinanciera {
  readonly tipo: "vistas";
  /** Una vista, salvo `cod_recaudado`, que trae dos no sumables entre si ⟨D6⟩. */
  readonly vistas: readonly VistaFinanciera[];
}

/** `conciliacion_cierres`: conteos por estado + cuadre, no importes por cubo. */
export interface ResultadoFinancieroConciliacion extends CabeceraFinanciera {
  readonly tipo: "conciliacion";
  readonly conciliacion: ResultadoConciliacion;
}

export type ResultadoFinanciero = ResultadoFinancieroVistas | ResultadoFinancieroConciliacion;

/* -------------------------------------------------------------------------- */
/* 5. Respuesta del borde ⟨D8/D9⟩                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lo que devuelve el Server Action.
 *
 * SIN estado `no_producida` ⟨D8(b)⟩: la 127 produce las ocho financieras, asi que un estado
 * para "declarada sin productor" seria codigo muerto que invita a rellenarlo.
 *
 * El `forbidden` NO lleva motivo ⟨D9(c)⟩ R42: con `metrica_desconocida` vs `metrica_prohibida`
 * un cliente podria enumerar el catalogo y los permisos de cada rol preguntando.
 */
export type RespuestaFinanciera =
  | { readonly status: "ok"; readonly datos: ResultadoFinanciero }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden"; readonly code: "FORBIDDEN" }
  | { readonly status: "error"; readonly mensaje: string };

/* -------------------------------------------------------------------------- */
/* 6. Registros declarativos (para no reescribir listas a mano)                */
/* -------------------------------------------------------------------------- */

/**
 * Las DIEZ metricas de dominio `financiera` que esta feature sirve (R6).
 *
 * Se declara como lista PROPIA y no derivada del catalogo a proposito: asi el guardia de
 * coherencia compara DOS fuentes independientes (esta lista contra
 * `listarMetricas({ dominio: "financiera" })`) en vez de comparar el catalogo consigo mismo.
 * Añadir una metrica financiera al catalogo sin productor, o servir aqui un id que el
 * catalogo no tiene, se pone rojo.
 *
 * Eran OCHO hasta la feature 173, que anadio las dos de la caja en modo tesoreria
 * (`progress/decision_F2_173.md`, ⟨P4⟩ humano del 2026-08-03). Las dos las produce el mismo
 * repositorio de la caja principal y el mismo manejador del servicio, con `derivarCaja`.
 */
export const IDS_FINANCIERAS_SERVIDAS = [
  "cod_recaudado",
  "ingreso_flete",
  "ingreso_comision_cod",
  "ingreso_iva",
  "egresos",
  "dinero_en_caja",
  "ganancia_ordenex",
  "cuenta_por_pagar_tienda",
  "cuenta_por_pagar_mensajero",
  "conciliacion_cierres",
] as const satisfies readonly MetricaId[];

export type MetricaFinancieraId = (typeof IDS_FINANCIERAS_SERVIDAS)[number];

/**
 * ⟨D3⟩ R43 — las DOS metricas que son un SALDO AL CORTE y no un flujo del periodo: se agregan
 * con `fecha_movimiento < hasta` ignorando `desde`, y por eso no se pueden sumar entre fechas
 * ni graficar como serie acumulativa.
 */
export const IDS_FINANCIERAS_ACUMULADAS = [
  "cuenta_por_pagar_tienda",
  "cuenta_por_pagar_mensajero",
] as const satisfies readonly MetricaFinancieraId[];

/** Total, sin rama por defecto: un id que no sea de las dos cuentas por pagar es `false`. */
export function esMetricaAcumulada(metricaId: string): boolean {
  return (IDS_FINANCIERAS_ACUMULADAS as readonly string[]).includes(metricaId);
}
