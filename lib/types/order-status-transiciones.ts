import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (design §1/§3) — FUENTE UNICA DE VERDAD de las transiciones legales de
// `order_status` (R1). Dominio PURO: sin Prisma, sin efectos secundarios, sin lecturas de
// entorno. Se indexa por `value` del catalogo (R4), NUNCA por los ids internos: quien valida
// (el choke point `appendCambioEstado`) resuelve `id -> value` antes de preguntar aqui.
//
// El mapa es el INVENTARIO CERRADO del apendice A del design, leido del codigo de `dev`:
// 38 aristas de flujo (numeracion #1-#44 con el #27 RETIRADO por la 139, #4/#6/#7c por la 156 y
// #1/#2/#3/#7b por la 155) + 2 de creacion. Las 38 colapsan a 36 pares `(origen, destino)`
// unicos, porque dos pares estan declarados dos veces con familias distintas: #19/#23 y #20/#24
// (SLA vs. recuperacion manual). El tercer duplicado historico (#3/#7b) se fue con
// `en_fulfillment`.
//
// FEATURE 154 — SOLO ADITIVA (decision Q2 del gate, 2026-07-29). Sumo #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, sin retirar NINGUNA arista: `GuiaAsignacionService` las
// ejecutaba todavia, y una arista solo puede morir en el mismo commit que su ultimo productor.
//
// FEATURE 156 — RETIRA #4, #6 y #7c, que es justo lo que su recableado deja sin productor:
// "Generar guia" pasa a numerar y mover a la bodega central, y nada mas (ya no asigna
// mensajero -> se va #4; ya no rutea a satelite -> se va #6), y "rutear a bodega satelite"
// pasa a admitir SOLO el origen `en_bodega_central` -> se va #7c. La superviviente es #5
// (`en_preparacion -> en_bodega_central`), destino UNICO de generar guia.
//
// FEATURE 155 — RETIRA la clave `en_fulfillment` con sus cuatro aristas (#1/#2/#3/#7b) y las dos
// entradas de creacion que sobraban (`en_fulfillment` y `en_ruta_bodega_central`). Es la mitad
// de codigo del retiro del estado; la otra mitad es la migracion que reasigna a `en_preparacion`
// las ordenes vivas. Ese backfill es la condicion que hace que retirar las aristas no atrape a
// nadie: la 156 no podia retirarlas justamente porque todavia habia ordenes ahi.
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
  // Feature 156: SALIDA UNICA. `generarGuia` numera y mueve a la bodega central, y nada mas.
  // Se retiraron #4 (`-> por_recoger`: generar guia ya no asigna mensajero), #6 (`->
  // en_ruta_bodega_satelite` via `generacion_guia`: ya no rutea) y #7c (el mismo par via
  // `ruteo_satelite`: `rutearABodegaSatelite` solo admite `en_bodega_central`). Reintroducir
  // cualquiera de las tres reabre el atajo que el flujo v2 cierra: el paquete se asigna y se
  // rutea desde la bodega donde esta fisicamente, no al numerarlo.
  en_preparacion: [
    { to: "en_bodega_central", via: "generacion_guia", rol: "maestro/admin" }, // #5
  ],
  // FEATURE 155: la clave `en_fulfillment` y sus cuatro aristas (#1/#2/#3/#7b) quedaron
  // RETIRADAS junto con el value del catalogo. Las cuatro estaban SIN PRODUCTOR desde la 156, y
  // la 155 cierra el circulo: (i) ninguna orden nace ya ahi —la bifurcacion de creacion manda a
  // `en_preparacion` o a `por_recolectar_en_tienda`— y (ii) la migracion
  // `20260729140000_order_status_retiro_en_fulfillment` reasigna a `en_preparacion` TODAS las
  // ordenes vivas que quedaran en ese estado. Ese backfill es la razon por la que retirarlas
  // AHORA no atrapa a nadie: cuando el codigo nuevo corre, el conjunto de ordenes en
  // `en_fulfillment` es vacio. Si el orden se invirtiera (retirar aristas sin backfill), esas
  // ordenes se quedarian sin ninguna salida legal.
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
 * RESUELTA: la creacion SI se valida. Nacer en cualquier otro estado del catalogo es ILEGAL
 * (endurecimiento deliberado de `OrdenService.crear`, que aceptaba un `estatusId` explicito
 * arbitrario; A.3-#8).
 *
 * FEATURE 155 (R22/R31): pasa de 4 a EXACTAMENTE DOS. Ya no hay tres constantes de
 * configuracion que decidan donde nace una orden: hay UNA funcion,
 * `resolverDestinoCreacion(fulfillmentDeLaTienda)` (`lib/services/destino-creacion.ts`), y estos
 * dos values son SUS DOS UNICAS SALIDAS —
 *   - `fulfillment = true`  -> `en_preparacion`            (el paquete ya esta en bodega)
 *   - `fulfillment = false` -> `por_recolectar_en_tienda`  (el paquete sigue en la tienda)
 * Se retiran `en_fulfillment` (el estado desaparece del catalogo) y `en_ruta_bodega_central`
 * (el estado fijo del canal de API key, `ESTATUS_INICIAL_API`: dejaba la orden viajando sin
 * haber sido recolectada). Ninguna orden puede volver a nacer en ninguno de los dos.
 *
 * `tests/unit/services/destino-creacion.test.ts` verifica la IGUALDAD entre esta lista y el
 * conjunto de estados que la funcion produce: si divergen, cae el test antes que produccion.
 */
export const ESTADOS_CREACION = [
  "en_preparacion",
  "por_recolectar_en_tienda", // feature 154 (declarado) / 155 (producido)
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
