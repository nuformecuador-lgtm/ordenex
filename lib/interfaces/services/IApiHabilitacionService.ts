import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 266 (T2.3, design §3.3/§4.4) — contrato del service de HABILITACION POR LOTE del canal
// por API key. Sin HTTP: el borde traduce, el service decide. El owner es SIEMPRE
// `actor.usuarioId` (R3), y ningun identificador de tienda del cuerpo o de la URL lo sustituye.

/**
 * UNA fila del lote, tal como llega del envoltorio ya validado (R6). Los CAMPOS todavia NO estan
 * validados: la validacion por fila (R7) es del service, porque una fila mal formada NO puede
 * tumbar el lote entero.
 *
 * Por eso los tipos son `unknown`: si fueran `number`/`string`, el borde tendria que haber
 * rechazado la fila para construir este tipo, y eso es precisamente lo que R7 prohibe.
 */
export interface FilaHabilitacionInput {
  num_guia: unknown;
  nota: unknown;
}

/**
 * Los TRES desenlaces por fila (R10). Se distinguen en la respuesta para que el integrador sepa,
 * sin adivinar, si la orden se movio:
 *   - `habilitada` — rama A: estaba en `ayuda_tienda` CON mensajero asignado y volvio a
 *     `en_reparto`.
 *   - `habilitada_sin_cambio_de_estado` — rama B: se registro la habilitacion y el estado NO
 *     cambio, porque el paquete ya esta en bodega. Una `devuelta` cae SIEMPRE aqui (R14-b).
 *   - `error` — la fila no se proceso; el porque va en `error.codigo`.
 */
export type ResultadoHabilitacion =
  | "habilitada"
  | "habilitada_sin_cambio_de_estado"
  | "error";

/**
 * **UNION LITERAL CERRADA** de los codigos de error por fila (design §3.3), y cerrada a
 * proposito: un codigo nuevo NO compila hasta que alguien lo declare aqui y lo documente en el
 * OpenAPI (R28). El conjunto es parte del contrato publico.
 *
 *   - `fila_invalida`         — `num_guia` o `nota` no cumplen R7.
 *   - `duplicada_en_lote`     — segunda o posterior aparicion de la misma guia en el lote (R8).
 *   - `no_encontrada`         — no hay orden viva con esa guia PARA ESTE OWNER (R4). Es
 *     deliberadamente OPACO: no distingue «no existe» de «es de otra tienda». Mismo criterio que
 *     `cancelarViaApi` (106/R23-R24).
 *   - `estado_no_habilitable` — el estado actual no esta en `ESTADOS_HABILITABLES_API` (incluye
 *     `reprogramada`, R13-b, y la SEGUNDA habilitacion de una orden ya en `en_reparto`, R31/D3),
 *     o la carrera de R18 hizo que la transicion afectara 0 filas.
 */
export type CodigoErrorHabilitacion =
  | "fila_invalida"
  | "duplicada_en_lote"
  | "no_encontrada"
  | "estado_no_habilitable";

/** El detalle del fallo de UNA fila. `mensaje` es texto para el integrador; NUNCA lleva la key (R5). */
export interface ErrorHabilitacion {
  codigo: CodigoErrorHabilitacion;
  mensaje: string;
}

/**
 * El desenlace de UNA fila. `numGuia` viaja como `unknown` cuando la fila era invalida: no se
 * puede prometer un entero de algo que no lo era, y mentir ahi obligaria al integrador a
 * desconfiar del campo entero.
 *
 * `estado` esta poblado en los dos desenlaces de exito y es `null` en `error` (R10).
 */
export interface ResultadoFilaHabilitacion {
  numGuia: unknown;
  resultado: ResultadoHabilitacion;
  /** `order_status.value` en el que la orden quedo; `null` cuando la fila fallo. */
  estado: string | null;
  error: ErrorHabilitacion | null;
}

/** El recuento del lote. Invariante: `total === habilitadas + habilitadasSinCambioDeEstado + conError`. */
export interface ResumenHabilitacion {
  total: number;
  habilitadas: number;
  habilitadasSinCambioDeEstado: number;
  conError: number;
}

/** La respuesta completa del lote (design §3.3). */
export interface HabilitacionLoteResult {
  resumen: ResumenHabilitacion;
  /** MISMO ORDEN y MISMA CARDINALIDAD que las filas recibidas (R11): se casa por indice. */
  resultados: ResultadoFilaHabilitacion[];
}

export interface IApiHabilitacionService {
  /**
   * Procesa el lote SECUENCIALMENTE, una fila a la vez, y devuelve un resultado POR FILA aunque
   * todas fallen (R9): el fallo de una fila NUNCA se convierte en un error global.
   *
   * La GUARDA DE ESTADO (R13/R14) se aplica AQUI, en el llamador, antes de invocar ninguna
   * escritura, y no se delega en el `WHERE` de `transicionarAyuda` —ese sigue siendo la SEGUNDA
   * red—. El punto unico declara su riesgo al reves («la guarda vive AQUI, en el punto unico, y
   * no en los llamadores»), y este endpoint no pasa por `rescatarOrdenAyuda`: sin guarda propia
   * no tendria ninguna primera red.
   */
  habilitarLote(actor: Actor, filas: readonly FilaHabilitacionInput[]): Promise<HabilitacionLoteResult>;
}
