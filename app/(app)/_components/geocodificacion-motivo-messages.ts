// Feature 93 (R9, design §6.1.b) — mapeo COMPARTIDO de los `motivo` del gate de
// asignabilidad por coordenadas (feature 92, R1-R8) a mensajes de usuario.
//
// Por qué vive aquí y no dentro de un mapper concreto: los cuatro modales de
// asignación delegan en DOS mappers distintos
// (`ordenes/_components/guia-decision-error-messages.ts` y
// `recepcion-satelite/_components/asignacion-satelite-error-messages.ts`), y ambos
// ramifican solo por `status`. La regla de R9 se escribe UNA vez aquí y los dos
// mappers la consultan ANTES de su switch por `status`; así no se duplica ni se
// deja un consumidor atrás.
//
// FEATURE 400 (2026-09-09) — DOS CAMBIOS, y la cabecera vieja ya no vale:
//
//  1. Los mensajes pasan de DOS a TRES (R19). Hasta esta ficha,
//     `geocodificacion_agotada` compartía el literal «Dirección no encontrada» con
//     `direccion_no_geocodificable`, y eso MENTÍA: el 2026-09-08 el proveedor rechazó
//     todas las peticiones por un fallo de configuración NUESTRO —la dirección nunca
//     llegó a consultarse— y el operador se pasó la mañana corrigiendo 42 direcciones
//     que estaban perfectamente bien. Ahora cada uno dice lo suyo (§6.2 del design).
//  2. La clasificación deja de hacerse con arrays de literales sueltos y pasa a un
//     `Record<EstadoBloqueante, string>` (R25): añadir un estado a la unión sin
//     decidir su texto es un ERROR DE COMPILACIÓN, no un silencio que cae al `null`
//     defensivo. Antes de la 400 el comentario de `EstadoAsignabilidad` prometía ese
//     «exhaustive check» y nada lo comprobaba.
//
// No filtra PII: los mensajes son literales fijos, nunca la dirección ni el id (R24).

import type { EstadoBloqueante } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

/** R9/R20: desenlace DEFINITIVO — la geocodificación concluyó que la dirección no resuelve. */
export const MSG_DIRECCION_NO_ENCONTRADA = "Dirección no encontrada";

/**
 * FEATURE 400 (R19, design §6.2) — el intento de ubicar la orden murió, pero por algo
 * NUESTRO: el servicio de mapas rechazó la petición o falta su configuración. La dirección
 * nunca llegó a evaluarse, así que este texto (a) no la culpa, (b) no pide corregirla y
 * (c) dice en lenguaje llano de quién es el problema. Literal fijo, sin PII.
 */
export const MSG_UBICACION_NO_VERIFICADA =
  "No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.";

/** R9/R21: desenlace TRANSITORIO — todavía se está resolviendo, no es un fallo final. */
export const MSG_DIRECCION_EN_VALIDACION =
  "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.";

/**
 * FEATURE 400 (R25) — el mapa `motivo -> mensaje`, tipado por `EstadoBloqueante`.
 *
 * `Record<EstadoBloqueante, string>` es lo que convierte «añadir un estado al gate» en un
 * error de compilación: el tipo se deriva por `Exclude` de la unión completa, así que un
 * valor nuevo que no se clasifique como asignable aterriza aquí y este objeto deja de
 * compilar hasta que alguien decida su texto.
 *
 * `asignable_sin_ubicacion` NO aparece —ni puede— por construcción del tipo: no bloquea
 * nada, así que nunca viaja como `motivo` en el `detalle` de un rechazo (R10).
 */
const MOTIVO_A_MENSAJE: Record<EstadoBloqueante, string> = {
  direccion_no_geocodificable: MSG_DIRECCION_NO_ENCONTRADA,
  geocodificacion_agotada: MSG_UBICACION_NO_VERIFICADA,
  geocodificacion_en_curso: MSG_DIRECCION_EN_VALIDACION,
  geocodificacion_encolada: MSG_DIRECCION_EN_VALIDACION,
  geocodificacion_no_encolable: MSG_DIRECCION_EN_VALIDACION,
};

/**
 * FEATURE 400 (R25) — los motivos que bloquean, en UNA sola lista, derivada del mapa.
 * El guard y los tests comparan contra esto, nunca contra una copia escrita en otro sitio.
 */
export const MOTIVOS_BLOQUEANTES = Object.keys(
  MOTIVO_A_MENSAJE,
) as readonly EstadoBloqueante[];

/** `true` si el string es uno de los motivos bloqueantes que el gate emite. */
function esMotivoBloqueante(motivo: string): motivo is EstadoBloqueante {
  return (MOTIVOS_BLOQUEANTES as readonly string[]).includes(motivo);
}

/**
 * FEATURE 400 (R22, design §6.3) — precedencia del mensaje AGREGADO de un lote, en una
 * tabla ordenada y no en una escalera de `if`: añadir una cuarta clase mañana es añadir
 * una fila, no releer la escalera.
 *
 * Criterio: gana el que EXIGE UNA ACCIÓN DEL OPERADOR SOBRE EL DATO. Si en el lote hay una
 * dirección genuinamente mala, esa es la que hay que arreglar; si no la hay, el operador
 * merece saber que el problema es nuestro y no suyo.
 */
const MENSAJES_POR_PRECEDENCIA: readonly string[] = [
  MSG_DIRECCION_NO_ENCONTRADA,
  MSG_UBICACION_NO_VERIFICADA,
  MSG_DIRECCION_EN_VALIDACION,
];

/** Lee `detalle[].motivo` de un resultado no-"ok" sin asumir su forma. */
function motivosDe(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const detalle = (error as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return [];
  return detalle
    .map((d) =>
      d && typeof d === "object" ? (d as { motivo?: unknown }).motivo : undefined,
    )
    .filter((m): m is string => typeof m === "string");
}

/**
 * Feature 368 (R11, design §6.1): el mensaje de UN motivo de coordenadas, sin agregar —
 * a diferencia de `geocodificacionMotivoMessage`, que agrega todos los motivos de un lote
 * en un único mensaje "ganador". Aquí hace falta un mensaje por orden bloqueada, para el
 * caso de éxito parcial: cada orden lleva el mensaje de SU propio motivo (R11).
 * `null` si `motivo` no es uno de los motivos bloqueantes que emite el gate (defensivo; no
 * debería ocurrir con `EstadoAsignabilidad`). Reusa el mismo `MOTIVO_A_MENSAJE` de arriba:
 * un solo vocabulario, nunca dos mapas que puedan divergir.
 */
export function mensajeDireccionPorMotivo(motivo: string): string | null {
  return esMotivoBloqueante(motivo) ? MOTIVO_A_MENSAJE[motivo] : null;
}

/**
 * R9: mensaje de usuario si el error trae al menos un `motivo` del gate de
 * coordenadas; `null` si no aplica (el mapper llamador sigue con su switch por
 * `status`). Si conviven motivos de varias clases gana el de MÁS precedencia
 * (400/R22): irresoluble > fallo del servicio de mapas > en validación.
 */
export function geocodificacionMotivoMessage(error: unknown): string | null {
  const presentes = new Set(
    motivosDe(error)
      .map((m) => mensajeDireccionPorMotivo(m))
      .filter((m): m is string => m !== null),
  );
  if (presentes.size === 0) return null;
  return MENSAJES_POR_PRECEDENCIA.find((m) => presentes.has(m)) ?? null;
}

/**
 * FEATURE 400 (R31/R36, design §6.5-b) — el aviso de «cuántas se asignaron sin ubicación»,
 * para el bloque de confirmación que el operador ya ve tras asignar.
 *
 * Es una CIFRA AGREGADA y nada más (R32): el texto nunca nombra ni puede nombrar cuál orden
 * quedó sin ubicación —ni por id, ni por guía, ni por dirección—, porque solo recibe un
 * número. Vocabulario llano (R36): sin siglas ni jerga interna, diciendo que el problema es
 * del sistema y NO de la dirección. Y en pasado, porque a diferencia de
 * `MSG_UBICACION_NO_VERIFICADA` aquí la orden SÍ se asignó: no se le pide nada al operador.
 *
 * `n <= 0` devuelve cadena vacía: sin órdenes en esa condición no hay aviso (R33).
 */
export function mensajeAsignadasSinUbicacion(n: number): string {
  if (n <= 0) return "";
  return n === 1
    ? "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde."
    : `${n} órdenes se asignaron sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.`;
}

/**
 * FICHA 407 (R17, design §4.1) — el predicado «¿este motivo se puede autorizar?», reexportado
 * desde el ÚNICO módulo de vocabulario que los dos modales ya importan.
 *
 * La lista vive en el contrato del gate (`MOTIVOS_AUTORIZABLES_SIN_UBICACION`), que es donde la
 * consulta el servidor; aquí solo se le abre la puerta al cliente, para que un modal jamás tenga
 * que escribir `"direccion_no_geocodificable"` a mano. Esa es la divergencia concreta que R17
 * prohíbe y que el guardia `geocodificacion-motivo-por-orden-mismo-modulo` convierte en rojo: si
 * el modal decidiera con un literal propio, ofrecería autorizar lo que el servidor va a negar el
 * día que la lista cambie (la lección de la 271).
 *
 * Reexport y no copia: no hay dos listas que puedan separarse.
 */
export { esMotivoAutorizableSinUbicacion } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

/**
 * FICHA 407 (R14, design §5.1) — LA CONSECUENCIA DECLARADA, ANTES DE CONFIRMAR.
 *
 * Es el texto que el operador tiene delante en el momento de desactivar una guarda a sabiendas,
 * así que dice las tres cosas que van a pasar y la condición bajo la que autorizar es correcto.
 * Aprobado por el humano el 2026-09-10 y copiado carácter a carácter de design.md §5.1: no se
 * retoca.
 *
 * Cada afirmación es verificable en el código, no es una promesa suelta: «no se tendrá en cuenta
 * al calcular el orden del recorrido» = `OptimizacionRutaService` excluye del cálculo a las
 * órdenes sin coordenadas sin abortarlo (92/R37); «aparecerá al final de su lista de entregas» =
 * quedan como paradas sin posición (92/R28).
 *
 * Sin siglas ni jerga interna (R13): no nombra la geocodificación, ni el proveedor, ni el estado
 * del gate. Y sin NI UN dato de la orden (R15): es un literal fijo, así que por este canal no
 * puede viajar la dirección, el destinatario, el teléfono, la guía ni el id interno.
 */
export const MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION =
  "El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección.";

/**
 * FICHA 407 (design §5.2) — ETIQUETA DEL CONTROL que dispara la segunda petición.
 *
 * Dice las DOS cosas que hace, porque desde la decisión del humano del 2026-09-10 autorizar y
 * asignar son un solo acto y una sola pulsación. Vive aquí, con el resto del vocabulario, para
 * que los dos modales y sus tests la nombren desde un solo sitio.
 */
export const LABEL_AUTORIZAR_SIN_UBICACION = "Autorizar y asignar sin ubicación";

/**
 * FICHA 407 (R10/R12/R13, design §5.2) — el aviso agregado de «cuántas se asignaron sin ubicación
 * PORQUE ALGUIEN LO AUTORIZÓ».
 *
 * ⚠️ NO ES `mensajeAsignadasSinUbicacion` NI PUEDE SERLO (R12). Aquél dice «por un problema del
 * sistema, no de la dirección» y describe el caso de la feature 400, donde el fallo es NUESTRO y
 * la dirección está bien. Aquí la dirección SÍ es el problema: el mapa no la reconoce y una
 * persona decidió asignar igual. Reutilizar aquel texto le mentiría al operador, y por eso hay un
 * guardia que lee el árbol (`tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts`) y
 * se pone rojo si esa frase reaparece aquí o si esta función se vuelve un alias de la otra.
 *
 * Espejo ESTRUCTURAL de `mensajeAsignadasSinUbicacion`, nunca textual: cifra agregada y nada más.
 * Recibe un `number`, así que por este canal no puede viajar una guía, un id ni una dirección
 * (R15). `n <= 0` devuelve cadena vacía: sin órdenes en esa condición no hay aviso.
 */
export function mensajeAsignadasSinUbicacionAutorizada(n: number): string {
  if (n <= 0) return "";
  return n === 1
    ? "1 orden se asignó sin ubicación en el mapa porque se autorizó hacerlo. Aparecerá al final de la lista de entregas del mensajero."
    : `${n} órdenes se asignaron sin ubicación en el mapa porque se autorizó hacerlo. Aparecerán al final de la lista de entregas del mensajero.`;
}
