import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (design §1/§3) — FUENTE UNICA DE VERDAD de las transiciones legales de
// `order_status` (R1). Dominio PURO: sin Prisma, sin efectos secundarios, sin lecturas de
// entorno. Se indexa por `value` del catalogo (R4), NUNCA por los ids internos: quien valida
// (el choke point `appendCambioEstado`) resuelve `id -> value` antes de preguntar aqui.
//
// El mapa es el INVENTARIO CERRADO del apendice A del design, leido del codigo de `dev`:
// 45 aristas de flujo (numeracion #1-#42 con el #27 RETIRADO, + #7b/#7c + #43/#44 de la 154)
// + 4 de creacion. Las 45 colapsan a 41 pares `(origen, destino)` unicos, porque cuatro pares
// estan declarados dos veces con familias distintas: #19/#23, #20/#24 (SLA vs. recuperacion
// manual) y #3/#7b, #6/#7c (`generacion_guia` no-GAM vs. `ruteo_satelite`; el apendice A
// contaba 41 porque omitia estas dos ultimas — `ORIGEN_RUTEO_SATELITE` de
// `GuiaAsignacionService.ts:35` admite `en_fulfillment`/`en_preparacion` ademas de
// `en_bodega_central`).
//
// FEATURE 154 — SOLO ADITIVA (decision Q2 del gate, 2026-07-29). Suma #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, y NO retira NINGUNA arista. El spec original proponia
// retirar #1/#3/#4/#6/#7b/#7c (saltarse la bodega central al generar guia); esa retirada se
// MUDA a la feature que recablea el service que las ejecuta: #4/#6/#7c -> feature 156,
// #1/#3/#7b -> feature 155. Motivo: `GuiaAsignacionService` las ejecuta HOY; retirarlas aqui
// dejaria `en_fulfillment` sin salidas (rompe el invariante de conectividad) y atraparia las
// ordenes vivas en ese estado hasta la 155. Que la arista muera en el mismo commit que su
// ultimo productor es la unica secuencia segura.
//
// ACTIVACION ESTRICTA (Q7, decision del gate): no hay modo shadow, ni modo solo-log, ni
// feature flag, ni variable de entorno que desactive la guardia. Tampoco existe override
// `ANY -> ANY` para maestro/admin (Q3): el ajuste administrativo generico
// (`OrdenService.actualizar`, `origen_tipo = ajuste_estado`) pasa por el MISMO mapa y sus
// aristas legitimas (#28, #40, #42) estan declaradas explicitamente abajo.

/** Familia de la transicion: reutiliza el enum de origen del historial (22 valores). */
export type FamiliaTransicion = OrdenHistorialOrigenTipo;

/**
 * Una arista del grafo. `via`/`rol` son METADATOS de trazabilidad (R2): documentan quien la
 * dispara y desde que familia, pero NO participan de la decision de legalidad — esta depende
 * SOLO del par `(origen, destino)`.
 */
export interface DestinoTransicion {
  readonly to: OrderStatusValue;
  readonly via: FamiliaTransicion;
  readonly rol: string;
}

/**
 * Mapa `origen -> destinos` (R1). El `satisfies Record<OrderStatusValue, ...>` es el chequeo
 * de EXHAUSTIVIDAD ESTATICA (R5): si el catalogo (`ORDER_STATUS_SEED`) gana un `value` que
 * aqui no queda clasificado, el build ROMPE. Un estado terminal se declara con lista vacia.
 *
 * El numero `#n` de cada arista es el del inventario (apendice A de design.md), para que el
 * diff sea auditable contra la tabla del spec.
 */
export const TRANSICIONES = {
  // --- Estados de entrada (creacion) --------------------------------------------------
  en_preparacion: [
    { to: "por_recoger", via: "generacion_guia", rol: "maestro/admin" }, // #4
    { to: "en_bodega_central", via: "generacion_guia", rol: "maestro/admin" }, // #5
    { to: "en_ruta_bodega_satelite", via: "generacion_guia", rol: "maestro/admin" }, // #6
    // #7c: `rutearABogegaSatelite` admite este origen (`ORIGEN_RUTEO_SATELITE`,
    // GuiaAsignacionService.ts:35) y emite `ruteo_satelite`. Mismo PAR que #6, otra familia.
    { to: "en_ruta_bodega_satelite", via: "ruteo_satelite", rol: "maestro/admin" }, // #7c
  ],
  en_fulfillment: [
    { to: "por_recoger", via: "generacion_guia", rol: "maestro/admin" }, // #1
    { to: "en_bodega_central", via: "generacion_guia", rol: "maestro/admin" }, // #2
    { to: "en_ruta_bodega_satelite", via: "generacion_guia", rol: "maestro/admin" }, // #3
    // #7b: idem #7c desde `en_fulfillment` (mismo PAR que #3, familia `ruteo_satelite`).
    { to: "en_ruta_bodega_satelite", via: "ruteo_satelite", rol: "maestro/admin" }, // #7b
  ],
  en_ruta_bodega_central: [
    { to: "devolviendo_a_tienda", via: "cancelacion_api", rol: "apiKey (tienda)" }, // #30
    { to: "en_bodega_central", via: "recepcion_bodega_central", rol: "maestro/admin" }, // #37 (138)
  ],
  // Feature 154: estado de ESPERA en la tienda. Nace por creacion (esta en ESTADOS_CREACION) y
  // sale hacia la central cuando el mensajero la recolecta. La arista queda DECLARADA y SIN USO
  // hasta la feature 157 (escaner de recoleccion en tienda).
  por_recolectar_en_tienda: [
    { to: "en_ruta_bodega_central", via: "recoleccion_tienda", rol: "mensajero" }, // #43 (154)
  ],

  // --- Bodegas y reparto ---------------------------------------------------------------
  en_bodega_central: [
    { to: "en_ruta_bodega_satelite", via: "ruteo_satelite", rol: "maestro/admin" }, // #7
    { to: "por_recoger", via: "asignacion_bodega", rol: "maestro/admin" }, // #8
    { to: "devolviendo_a_tienda", via: "cancelacion_api", rol: "apiKey (tienda)" }, // #29
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #34
  ],
  en_ruta_bodega_satelite: [
    { to: "en_bodega_satelite", via: "recepcion_satelite", rol: "adminSatelite" }, // #10
  ],
  en_bodega_satelite: [
    { to: "por_recoger", via: "asignacion_satelite", rol: "adminSatelite" }, // #9
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #35
  ],
  por_recoger: [
    { to: "en_reparto", via: "recoleccion", rol: "mensajero" }, // #11
  ],
  en_reparto: [
    { to: "entregada", via: "gestion", rol: "mensajero" }, // #12
    { to: "reprogramada", via: "gestion", rol: "mensajero" }, // #13
    { to: "devuelta", via: "gestion", rol: "mensajero" }, // #14
    { to: "rechazada", via: "gestion", rol: "mensajero" }, // #15
    { to: "sin_gestionar", via: "corte_sin_gestionar", rol: "sistema/cron" }, // #16
    // #44 (154): resultado `incidente` de la gestion. Va via `gestion` —y no via la familia
    // `incidente`— porque quien la marca es el mensajero DESDE su gestion (decision Q4). La
    // familia `incidente` del enum de historial queda declarada sin productor hasta la 158.
    { to: "incidente", via: "gestion", rol: "mensajero" }, // #44 (154)
  ],

  // --- Resultados de gestion -----------------------------------------------------------
  entregada: [
    // TERMINAL (Q1). Conserva UNA salida legitima: deshacer la gestion del dia (#31).
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #31
  ],
  reprogramada: [
    { to: "en_bodega_central", via: "liberacion_reprogramada", rol: "sistema/cron" }, // #25
    { to: "en_bodega_satelite", via: "liberacion_reprogramada", rol: "sistema/cron" }, // #26
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #32
  ],
  devuelta: [
    { to: "en_bodega_central", via: "liberacion_devuelta_sla", rol: "sistema/cron" }, // #19
    { to: "en_bodega_satelite", via: "liberacion_devuelta_sla", rol: "sistema/cron" }, // #20
    { to: "rechazada", via: "escalado_devuelta_sla", rol: "sistema/cron" }, // #21
    { to: "reprogramada", via: "reprogramacion_tienda", rol: "adminTienda" }, // #22
    // #23/#24 comparten par con #19/#20 y difieren SOLO en familia (accion manual del admin).
    { to: "en_bodega_central", via: "recuperacion_manual", rol: "maestro/admin/adminSatelite" }, // #23
    { to: "en_bodega_satelite", via: "recuperacion_manual", rol: "adminSatelite" }, // #24
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #36 (defensa filas legadas)
  ],
  rechazada: [
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #33
    { to: "por_devolver", via: "devolucion_rechazada", rol: "admin (aprobar cierre; zona satelite)" }, // #38 (139)
    {
      to: "por_devolver_a_tienda",
      via: "devolucion_rechazada",
      rol: "admin (aprobar cierre; zona central)",
    }, // #39 (139)
    // OJO: `rechazada -> devolviendo_a_tienda` (el viejo #27) NO se declara. La feature 139
    // la RETIRO a proposito (su R9): la unica salida de `rechazada` hacia la devolucion es
    // ahora la aprobacion del cierre (#38/#39). Reintroducirla reabre un camino cerrado.
  ],
  sin_gestionar: [
    { to: "en_bodega_central", via: "liberacion_sin_gestionar", rol: "admin (aprobar cierre)" }, // #17
    { to: "en_bodega_satelite", via: "liberacion_sin_gestionar", rol: "admin (aprobar cierre)" }, // #18
  ],

  // --- Flujo de devolucion (137 + 139) -------------------------------------------------
  por_devolver: [
    {
      to: "devolviendo_a_bodega_central",
      via: "ajuste_estado",
      rol: "adminSatelite (de la zona)",
    }, // #40 (139)
  ],
  devolviendo_a_bodega_central: [
    { to: "por_devolver_a_tienda", via: "recepcion_bodega_central", rol: "maestro/admin" }, // #41 (139)
  ],
  por_devolver_a_tienda: [
    { to: "devolviendo_a_tienda", via: "ajuste_estado", rol: "maestro/admin (central)" }, // #42 (139)
  ],
  devolviendo_a_tienda: [
    { to: "devuelta_a_tienda", via: "ajuste_estado", rol: "adminTienda" }, // #28
  ],
  // TERMINAL (Q1): la tienda de origen la recibio; sin salida esperada.
  devuelta_a_tienda: [],
  // TERMINAL (feature 154, decision del humano del 2026-07-29): `incidente` cierra el ciclo de
  // la orden y NO tiene ninguna arista de salida. En el gate se planteo un estado `indemnizada`
  // que lo desterminara: se DESCARTO. No se declara, ni se deja preparado. Tiene entrada (#44),
  // asi que cumple el invariante de conectividad de los terminales.
  incidente: [],
} as const satisfies Record<OrderStatusValue, readonly DestinoTransicion[]>;

/**
 * Estados en los que una orden puede NACER (destinos validos de `null -> X`, R3/R10). Q5
 * RESUELTA: la creacion SI se valida. Verificado contra codigo:
 *   - `ordenesConfig.DEFAULT_ESTATUS_VALUE` = `en_preparacion` (default global, A.1)
 *   - `ordenesConfig.FULFILLMENT_ESTATUS_VALUE` = `en_fulfillment` (tienda con fulfillment)
 *   - `BulkOrdenService.ESTATUS_INICIAL_API` = `en_ruta_bodega_central` (carga por API key)
 * Nacer en cualquier otro estado del catalogo pasa a ser ILEGAL (endurecimiento deliberado
 * de `OrdenService.crear`, que aceptaba un `estatusId` explicito arbitrario; A.3-#8).
 *
 * Feature 154 (R13): pasa de 3 a 4 con `por_recolectar_en_tienda`. Es LEGAL que una orden NAZCA
 * ahi (la bifurcacion de creacion por bodega llega con la 155); hoy ningun call-site lo produce.
 */
export const ESTADOS_CREACION = [
  "en_preparacion",
  "en_fulfillment",
  "en_ruta_bodega_central",
  "por_recolectar_en_tienda", // feature 154
] as const satisfies readonly OrderStatusValue[];

/**
 * Estados TERMINALES (Q1): sin salida esperada en el flujo normal. Exentos de necesitar
 * salida en el invariante de conectividad (R14), pero NO de tener entrada: un terminal
 * inalcanzable tambien es un bug. `entregada` conserva la salida #31 (deshacer gestion), y
 * eso es legal: el test exime, no prohibe.
 *
 * Feature 154 (R16): pasa de 2 a 3 con `incidente`, que a diferencia de `entregada` NO conserva
 * ninguna salida (decision del humano del 2026-07-29; la idea de un estado `indemnizada` que lo
 * desterminara se descarto).
 */
export const ESTADOS_TERMINALES = [
  "entregada",
  "devuelta_a_tienda",
  "incidente", // feature 154
] as const satisfies readonly OrderStatusValue[];

/**
 * Estados VESTIGIALES declarados (design §8): mecanismo conservado para un estado futuro que
 * naciera sin flujo. Hoy el conjunto esta VACIO (Q2 RESUELTA) y ningun `value` del catalogo
 * queda exento de la cobertura (R16) ni del invariante entrada/salida (R14).
 */
export const ESTADOS_VESTIGIALES = [] as const satisfies readonly OrderStatusValue[];

// Exhaustividad EXPLICITA en la otra direccion (patron `_EnsureExhaustive` de
// `orden-historial.ts`): si el catalogo gana un `value` que el mapa no clasifica,
// `Exclude<...>` deja de ser `never` y el build rompe (R5).
type _EnsureExhaustive = Exclude<OrderStatusValue, keyof typeof TRANSICIONES> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

/** Error de dominio de transicion ilegal (R12): distinguible por `instanceof`. */
export class TransicionIlegalError extends Error {
  constructor(
    readonly origen: OrderStatusValue | null,
    readonly destino: OrderStatusValue,
  ) {
    // R12: el mensaje SOLO menciona los dos `value` del catalogo. Nunca ids, ordenes,
    // actores, guias ni ningun dato del cliente: no filtra PII ni secretos.
    super(
      origen === null
        ? `transicion ilegal: creacion -> ${destino}`
        : `transicion ilegal: ${origen} -> ${destino}`,
    );
    this.name = "TransicionIlegalError";
  }
}

/**
 * Motivo por el que la guardia NO PUDO decidir la legalidad de una transicion.
 *   - `catalogo_no_disponible`: no se pudo leer `order_status` en la transaccion en curso.
 *   - `estatus_desconocido`: un `id` de la entrada no corresponde a ningun `value` del
 *     catalogo CONOCIDO por este build (drift DB->codigo: la tabla tiene un value que
 *     `ORDER_STATUS_SEED` todavia no lista).
 */
export type MotivoNoValidable = "catalogo_no_disponible" | "estatus_desconocido";

/**
 * Feature 140 (Q7, activacion estricta) — FALLO CERRADO. Si la guardia no puede DEMOSTRAR que
 * una transicion es legal, la RECHAZA: no existe ninguna ruta por la que una entrada llegue al
 * `createMany` sin haber pasado por `assertTransicionValida`.
 *
 * Es un error distinto de `TransicionIlegalError` a proposito: "no pude validar" no es lo
 * mismo que "es ilegal", y separarlos deja el diagnostico claro en la bitacora del incidente
 * (drift catalogo/codigo vs. flujo que intenta una arista inexistente). Mensaje SIN PII: ni
 * ids, ni ordenes, ni actores (R12).
 */
export class TransicionNoValidableError extends Error {
  constructor(
    readonly motivo: MotivoNoValidable,
    /** Lado de la transicion que no resolvio (solo para `estatus_desconocido`). */
    readonly lado: "origen" | "destino" | null = null,
  ) {
    super(
      motivo === "catalogo_no_disponible"
        ? "transicion no validable: el catalogo de estados no esta disponible"
        : `transicion no validable: el catalogo no reconoce el estatus de ${lado ?? "la transicion"}`,
    );
    this.name = "TransicionNoValidableError";
  }
}

// Indices O(1) del camino caliente (R13), construidos UNA vez al cargar el modulo: no hay
// recorridos de arrays ni round-trips por transicion validada.
const DESTINOS_POR_ORIGEN: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(TRANSICIONES).map(([origen, destinos]) => [
    origen,
    new Set<string>(destinos.map((d) => d.to)),
  ]),
);
const SET_CREACION: ReadonlySet<string> = new Set<string>(ESTADOS_CREACION);
const SET_CATALOGO: ReadonlySet<string> = new Set<string>(ORDER_STATUS_SEED);

/** `true` si `value` pertenece al catalogo (`ORDER_STATUS_SEED`), estrechando el tipo. */
export function esOrderStatusValue(value: string): value is OrderStatusValue {
  return SET_CATALOGO.has(value);
}

/**
 * R6/R10/R12/R13 — GUARDIA de legalidad. Funcion PURA: no lee DB, no escribe, no registra.
 * Lanza `TransicionIlegalError` si la arista no existe en el mapa.
 *   - `origen === null` (creacion): valida contra `ESTADOS_CREACION` (R10).
 *   - `origen !== null`: valida que exista un destino con ese `to` en `TRANSICIONES[origen]`.
 * `via`/`rol` NO participan de la decision (R2). Comprobacion O(1) por transicion (R13).
 */
export function assertTransicionValida(
  origen: OrderStatusValue | null,
  destino: OrderStatusValue,
): void {
  if (origen === null) {
    if (!SET_CREACION.has(destino)) throw new TransicionIlegalError(null, destino);
    return;
  }
  const destinos = DESTINOS_POR_ORIGEN.get(origen);
  if (destinos === undefined || !destinos.has(destino)) {
    throw new TransicionIlegalError(origen, destino);
  }
}
