// Feature 92 (design §7, R1-R8) — contrato del gate de asignabilidad por coordenadas.
// Servicio PROPIO, consumido por los TRES writers de `mensajero_asignado_id`
// (`GuiaAsignacionService.generarGuia` rama GAM con mensajero, `.asignarDesdeBodega` y
// `AsignacionSateliteService.asignar`), para que la regla no se escriba tres veces.

/**
 * R1 — los SIETE estados posibles (SEIS hasta la ficha 400). La union es cerrada a
 * proposito: la UI mapea cada valor BLOQUEANTE a un mensaje distinto (R9, feature 93), asi
 * que anadir uno nuevo debe romper el exhaustive check, no colarse como texto libre.
 *
 * FEATURE 400 (2026-09-09): ese exhaustive check pasa a ser REAL. Hasta esta ficha era una
 * promesa de este mismo comentario y nada lo comprobaba —el mapa de mensajes clasificaba
 * los motivos con dos arrays de literales y un valor nuevo caia al `null` defensivo—. Con
 * `EstadoBloqueante` (abajo) el mapa se tipa por la lista, y olvidarse de un estado es un
 * error de compilacion.
 */
export type EstadoAsignabilidad =
  /** R2: tiene latitud y longitud. Se puede asignar. */
  | "asignable"
  /**
   * FEATURE 400 (R1): no tiene coordenadas, pero el ultimo intento de geocodificacion
   * murio por un fallo de configuracion NUESTRO (el proveedor rechazo la peticion, o falta
   * la credencial) — la direccion NUNCA llego a consultarse. Se puede asignar: la orden
   * queda SIN ubicacion y entra en el modo degradado que ya existe (feature 92 R37/R28/R30:
   * se excluye del calculo de ruta sin abortarlo, se muestra al final de la lista del
   * mensajero y el modulo avisa). Puede recibir coordenadas mas tarde, ya asignada.
   */
  | "asignable_sin_ubicacion"
  /** R3: la geocodificacion ya concluyo que la direccion NO existe. Terminal. */
  | "direccion_no_geocodificable"
  /** R5: el job de la direccion vigente agoto sus intentos (`estado = 'failed'`). */
  | "geocodificacion_agotada"
  /** R6: hay un job `pending` o `processing` para la direccion vigente. */
  | "geocodificacion_en_curso"
  /** R7: no habia job; se acaba de encolar uno puntual. */
  | "geocodificacion_encolada"
  /** R7: no habia job y el encolado puntual LANZO. */
  | "geocodificacion_no_encolable"
  /**
   * FICHA 407 (2026-09-10, R1): la orden no tiene coordenadas y su direccion es IRRESOLUBLE
   * (el desenlace DETERMINISTA de R3), pero la peticion de asignacion trae la autorizacion
   * EXPLICITA de una persona para asignarla igual. Se puede asignar: entra en el mismo modo
   * degradado que ya existe (feature 92 R37/R28/R30) y que la 400 estreno en produccion.
   *
   * NO SE PERSISTE (R9). Vale para ESTA peticion y para ninguna mas: si la orden se libera y
   * se vuelve a asignar, hay que volver a autorizarla. Decision del humano del 2026-09-10 —
   * no se guarda quien autorizo (design 407 §8-A1).
   *
   * Es un estado DISTINTO de `asignable_sin_ubicacion` a proposito (design 407 §8-A3):
   * aquella puerta la abre EL SISTEMA por un fallo propio, y su texto dice «no de la
   * direccion»; esta la abre UNA PERSONA a sabiendas, y aqui la direccion SI es el problema.
   * Dos causas, dos cifras, dos textos.
   */
  | "asignable_sin_ubicacion_autorizada";

/**
 * FEATURE 400 (2026-09-09, design §5) — los estados que DEJAN PASAR la asignacion. UNICO
 * sitio donde se decide eso: `esAsignable` se implementa contra esta lista y los tres
 * writers preguntan por `esAsignable`, nunca por un literal suelto.
 */
export type EstadoAsignable =
  | "asignable"
  | "asignable_sin_ubicacion"
  /**
   * FICHA 407 (R1) — el tercero. Tiene que estar AQUI y no solo en `EstadoAsignabilidad`: si
   * se olvidara, `Exclude` lo absorberia en `EstadoBloqueante` y el
   * `Record<EstadoBloqueante, string>` del mapa de mensajes dejaria de compilar (TS2741). Ese
   * tripwire de la 400 es el que protege a esta ficha, y se comprobo a mano al implementarla.
   *
   * Lo que el tripwire NO cubre es la lista interna de `esAsignable`
   * (`AsignabilidadCoordenadasService`): esta anotada `readonly EstadoAsignable[]` y un array
   * mas CORTO sigue compilando. Olvidarla ahi es un fallo mudo — el gate devolveria el estado
   * y los writers lo tratarian como bloqueante—, asi que hay un caso explicito para ella en
   * `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts`.
   */
  | "asignable_sin_ubicacion_autorizada";

/**
 * FEATURE 400 (2026-09-09, design §5) — los estados que BLOQUEAN, y por tanto viajan como
 * `motivo` en el `detalle` de un rechazo y necesitan un mensaje de usuario.
 *
 * Se deriva por `Exclude` y no se escribe a mano: asi anadir un valor a
 * `EstadoAsignabilidad` sin clasificarlo como asignable lo mete AUTOMATICAMENTE aqui, y el
 * `Record<EstadoBloqueante, string>` del mapa de mensajes deja de compilar hasta que
 * alguien decida su texto. Un estado nuevo no puede colarse en silencio (R25).
 */
export type EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>;

/**
 * Proyeccion MINIMA que necesita el gate. `direccion` es imprescindible: sin ella no se
 * puede reconstruir la clave exacta del job (design §0.2).
 */
export interface OrdenAsignabilidadRow {
  id: string;
  direccion: string | null;
  /** `null` cuando la orden no esta geocodificada. */
  latitud: number | null;
  longitud: number | null;
  /** Vocabulario opaco del proveedor: OK | ZERO_RESULTS | INVALID_REQUEST | SIN_DIRECCION. */
  geocodeStatus: string | null;
}

export interface IAsignabilidadCoordenadasService {
  /**
   * R1-R7: clasifica el lote completo en UNA pasada, con como mucho UNA consulta a la
   * cola. Devuelve el estado de CADA orden recibida (nunca omite ninguna).
   */
  evaluar(
    ordenes: OrdenAsignabilidadRow[],
    /**
     * FICHA 407 (R1/R3/R9) — los ids que ESTA peticion autoriza a asignar SIN ubicacion.
     * Efimero por decision del humano (2026-09-10): no se persiste, no se lee de la base y no
     * sobrevive a la llamada. Ausente o vacio = comportamiento IDENTICO al previo a la ficha
     * (R5).
     *
     * Va como PARAMETRO y no como campo de `OrdenAsignabilidadRow` (design §3.1.3 / §8-A5):
     * esa fila es una proyeccion de la base (`findParaAsignabilidad`), y «una persona lo
     * autorizo» no es un hecho de la base. Ademas, al ser opcional, los dobles de test que ya
     * implementan esta interfaz con UN solo parametro siguen compilando sin tocarlos.
     *
     * Solo puede afectar a ordenes del lote recibido (R3): el gate recorre `ordenes`, asi que
     * un id que no este ahi no tiene donde aplicarse.
     */
    autorizadasSinUbicacion?: ReadonlySet<string>,
  ): Promise<Map<string, EstadoAsignabilidad>>;
}

/**
 * FICHA 407 (2026-09-10, R2/R17) — LOS MOTIVOS DEL GATE QUE UNA PERSONA PUEDE AUTORIZAR.
 *
 * Vive AQUI, en el contrato, y no en el servicio ni en el modal, porque lo consultan los DOS
 * lados: el gate para decidir, y los modales para no ofrecer lo que el servidor va a negar
 * (la leccion de la 271: una pantalla que deja pedir lo que el servidor rechaza produce un
 * mensaje falso que no se arregla nunca). Este modulo no importa nada en runtime, asi que un
 * componente cliente puede leerlo sin arrastrar Prisma ni `node:crypto`.
 *
 * ESCRITA A MANO Y NO DERIVADA, a proposito: el defecto seguro es «no autorizable». Un estado
 * nuevo que nadie clasifique se queda fuera, que es el lado correcto en el que equivocarse.
 *
 * Solo el desenlace DETERMINISTA entra (R2). `geocodificacion_en_curso`, `_encolada` y
 * `_no_encolable` todavia pueden resolverse solos, y `geocodificacion_agotada` ya la cubre la
 * feature 400 cuando el fallo es NUESTRO: ninguno es un veredicto definitivo sobre la
 * direccion.
 *
 * Que esta lista no pueda divergir del servidor lo comprueba un caso de
 * `asignabilidad-coordenadas-autorizada.test.ts`: para CADA valor de `EstadoBloqueante`,
 * `esMotivoAutorizableSinUbicacion(m)` es `true` si y solo si alimentar al gate una fila en
 * ese estado CON la marca la vuelve asignable.
 */
export const MOTIVOS_AUTORIZABLES_SIN_UBICACION: readonly EstadoBloqueante[] = [
  "direccion_no_geocodificable",
];

/**
 * FICHA 407 (R17) — el predicado que usan los modales. Recibe `string` (el `motivo` que viaja
 * en `DetalleConflicto` es un `string`, no la union) y responde si esa orden se puede ofrecer
 * para autorizar.
 */
export function esMotivoAutorizableSinUbicacion(motivo: string): boolean {
  return (MOTIVOS_AUTORIZABLES_SIN_UBICACION as readonly string[]).includes(motivo);
}
