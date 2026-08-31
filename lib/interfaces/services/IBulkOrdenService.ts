import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type { BulkSummary, RowResult } from "@/lib/types/carga-masiva";

// R11: resultado discriminado. La autorizacion NO lanza; el borde (Route
// Handler) traduce "forbidden" a un AppErrorShape (feature 10).
export type BulkOrdenResult = { status: "ok"; summary: BulkSummary } | { status: "forbidden" };

// Feature 88/R10 — fila del resultado de la carga por API. Extiende `RowResult` (misma
// clasificacion creada/duplicada/error de la carga masiva) SOLO añadiendo `numGuia` a las
// filas `creada` (las duplicadas/error no consumen guia, R11).
// Feature 155/R21: `null` cuando la orden nace SIN guia (rama defensiva). Nunca un numero
// fabricado ni un 0.
export interface CargaViaApiRow extends RowResult {
  numGuia?: number | null;
}

/**
 * 2026-08-31 — LAS FILAS QUE FALLAN SALEN DE `filas` Y VIAJAN AQUI.
 *
 * Hasta hoy el resumen devolvia UNA lista con las tres clasificaciones mezcladas y una clave
 * `errores` OPCIONAL dentro de la fila. Para el integrador eso significaba recorrer el lote
 * entero y ramificar por `resultado` —o peor, por la presencia de una clave— antes de poder
 * hacer nada: el caso que hay que atender estaba escondido dentro del caso normal. Ahora
 * `filas` trae SOLO lo que entro (`creada`/`duplicada`) y lo que fallo se lee directo en
 * `errores`, que es la lista que un integrador quiere mirar aparte: reintentar, avisar o
 * corregir.
 *
 * LO QUE NO CAMBIA: el CONTENIDO de cada fila con error se conserva palabra por palabra —su
 * `fila` 1-based, su `numRemision`, su `resultado: "error"` y su mapa `errores` por campo—, y
 * los contadores `total`/`creadas`/`duplicadas`/`conError` siguen contando sobre el lote
 * COMPLETO. `conError` sigue siendo exactamente `errores.length`.
 */
export interface CargaViaApiFilaError {
  /** Indice 1-based dentro del array `ordenes` que se envio. */
  fila: number;
  numRemision: string;
  /** Constante, pero se conserva: una fila movida de sitio no cambia de significado. */
  resultado: "error";
  /** Errores por campo, TAL CUAL los emitia la fila dentro de `filas`. */
  errores: Record<string, string[]>;
}

// Feature 88/R10 — bloque plano que el integrador consume directo (sin filtrar `filas`):
// una entrada por orden EFECTIVAMENTE creada, con su `numGuia` e `id`.
export interface CargaViaApiOrden {
  id: string;
  numRemision: string;
  /**
   * Feature 155/R20/R21: el `num_guia` asignado en el acto por la rama (b) —el caso normal del
   * canal de integracion— o `null` si la orden nacio por la rama (a), sin guia. `null` es la
   * unica representacion admitida de "todavia no tiene": jamas se fabrica un numero.
   */
  numGuia: number | null;
  estado: string;
  // Feature 98 (design §2, R5/R7/D2/D3): costo del envio que paga la tienda por esta orden =
  // FLETE + IVA del flete de su tarifa vigente, money-safe STRING escala 2. NUNCA `null`: el
  // gap de tarifa (tienda sin tarifa vigente) se representa con "0.00" (D1). Distinto de
  // `monto_cobrar`/COD (que viaja en el input y no se toca).
  costoEnvio: string;
  // FULFILLMENT (2026-08-25): el monto FIJO de bodega por orden, DESGLOSADO. `costoEnvio` pasa
  // a ser la SUMA (flete + IVA del flete + fulfillment) y este campo dice cuanto de ese total
  // es el servicio de bodega. "0.00" cuando la tienda no hace fulfillment — que es tambien el
  // caso en que `costoEnvio` vale exactamente lo que valia antes de esta fecha.
  //
  // Nunca `null`: mismo criterio que su hermano de arriba, el gap de tarifa se representa con
  // cero y no con ausencia.
  fulfillment: string;
}

export interface CargaViaApiSummary {
  total: number;
  creadas: number;
  duplicadas: number;
  conError: number;
  /**
   * SOLO las filas que entraron al sistema: `creada` y `duplicada`. Desde 2026-08-31 NINGUNA
   * fila de esta lista lleva `resultado: "error"` ni la clave `errores`; las que fallan estan
   * en el campo hermano de abajo.
   */
  filas: CargaViaApiRow[];
  /** Las filas que NO entraron, con su detalle por campo. Lista vacia = ninguna fallo. */
  errores: CargaViaApiFilaError[];
  ordenes: CargaViaApiOrden[];
  /**
   * Feature 141/R39: identificador del LOTE creado por ESTA peticion (una peticion = un
   * lote, R30). `null` si no se creo ninguna orden y por tanto ningun lote (R33).
   */
  cargaId: string | null;
}

// Feature 88 — resultado discriminado de la carga por API (espejo de `BulkOrdenResult`):
// la autorizacion (rol `apiKey`) NO lanza; el borde traduce `forbidden` a 403.
//
// Feature 155/R24 + FULFILLMENT (2026-08-25): `manifiestoOrdenIds` son las ordenes de ESTE
// lote que van al manifiesto — las de la rama (b), las que esperan en la tienda—. Sustituye al
// `destino: DestinoCreacion` que viajaba aqui: desde que la bifurcacion se decide POR ORDEN (su
// tarifa dice si esa tienda hace fulfillment) un lote puede ser mixto, y entonces "este lote
// emite manifiesto" ya no es una pregunta con respuesta.
//
// Va en el resultado del SERVICE y NO en el `summary` (que es literalmente el cuerpo JSON de la
// respuesta publica): el borde lo necesita para pedir el manifiesto, y esa es una decision
// interna. Lo que el integrador ve es el bloque `manifiesto`, cuando lo hay. Lista VACIA = este
// lote no emite manifiesto (ninguna orden creada, o todas nacidas en bodega).
export type CargaViaApiResult =
  | { status: "ok"; summary: CargaViaApiSummary; manifiestoOrdenIds: string[] }
  | { status: "forbidden" };

export interface IBulkOrdenService {
  /**
   * Procesa las filas ya parseadas de un archivo de carga masiva: autoriza
   * (SOLO adminTienda, R11), resuelve/valida cada fila (R18-R23), deduplica
   * (R25/R26), persiste en lotes (R27) con exito parcial (R29) y arma el
   * resumen (R30). Nunca lanza por autorizacion; SI puede lanzar por fallos
   * inesperados de infraestructura (el borde los normaliza a INTERNAL).
   *
   * `options.dryRun` (validación previa): ejecuta TODA la resolución/validación
   * y clasificación de filas (geografía, duplicados, mensajero) SIN persistir
   * ninguna orden. Devuelve el mismo `BulkSummary` que la carga real, para que
   * la UI muestre los hallazgos (errores de geografía, num_remision duplicados)
   * ANTES de escribir en la DB. La carga real re-valida (es la autoridad final).
   *
   * Feature 141 (R15-R17/R20/R29): `options.cargaId` es el TOKEN OPACO del lote que el
   * SERVIDOR emitio al persistir el primer chunk y que el cliente reenvia en los siguientes;
   * el cliente NUNCA elige el id. Ausente = esta peticion crea el lote (id generado dentro de
   * la transaccion). `options.totalFiles` es el total de filas de la SESION declarado por el
   * cliente (nunca el del chunk) y `options.name` el nombre opcional del lote; ambos solo se
   * escriben al CREAR la fila. Puede lanzar `CargaLoteAjenoError` (lote desconocido o ajeno →
   * 403, R19) o `CargaNombreDuplicadoError` (nombre repetido del actor → 409, R24); ninguno se
   * captura aqui: son condiciones del borde, no clasificacion de filas.
   */
  cargarMasiva(
    rows: RawRow[],
    actor: Actor,
    options?: { dryRun?: boolean; cargaId?: string; name?: string; totalFiles?: number },
  ): Promise<BulkOrdenResult>;

  /**
   * Feature 88 — carga por API (canal integrador). Reusa los helpers de resolucion/dedup/
   * validacion de `cargarMasiva` (R7), pero: autoriza SOLO al rol `apiKey` (R15); el dueño
   * (`tienda_id`) es el usuario dedicado de la key (`actor.usuarioId`, D4). Nunca lanza por
   * autorizacion (devuelve `forbidden`). Devuelve el summary extendido con `numGuia` por
   * creada + el bloque plano `ordenes` (R10). No hay `dryRun`: el integrador carga en firme.
   *
   * Feature 155/R19/R20/R22 + FULFILLMENT (2026-08-25): el estado inicial DEJA de ser fijo, y
   * desde hoy se decide POR ORDEN. Se sigue resolviendo con el MISMO punto de decision que la
   * via sesion (`resolverDestinoCreacion`), pero el predicado de ESTA via no es el flag
   * `Usuario.fulfillment` —que para un usuario de rol `apiKey` vale siempre `false`, y por eso
   * la rama (a) llevaba desde la 155 declarada como inalcanzable— sino el MONTO de fulfillment
   * de la tarifa que le resuelve a cada orden: `> 0` -> `en_preparacion` SIN guia; si no, la
   * rama (b) de siempre, `por_recolectar_en_tienda` con `num_guia` en el acto.
   *
   * Feature 141 (R20/R21/R30-R33): `options.name` es el nombre OPCIONAL del lote; el id del
   * lote lo genera SIEMPRE el servidor (una peticion = un lote). Puede lanzar
   * `CargaNombreDuplicadoError` (→ 409, R24), que el borde traduce.
   */
  cargarViaApi(
    rows: RawRow[],
    actor: Actor,
    options?: { name?: string },
  ): Promise<CargaViaApiResult>;
}
