// FICHA 357 — EL ALCANCE DE LA BODEGA SATELITE: «PASO POR MI BODEGA», NO «ES DE MI ZONA».
//
// Este modulo declara DOS cosas que antes eran una sola, y separarlas es el corazon de la ficha:
//
//   1. `ESTADOS_CUSTODIA_SATELITE` — los dos estados que PRUEBAN que un paquete estuvo en una
//      bodega satelite. Es la EVIDENCIA del alcance, y la lee el `WHERE` del repositorio.
//   2. `ESTADOS_BODEGA_SATELITE`  — los estados que el listado «Órdenes de la bodega» puede
//      llegar a MOSTRAR de una orden que ya cumplio esa evidencia. Es el CONTRATO de la
//      pantalla: el desplegable de estado ofrece EXACTAMENTE estos, ni uno mas.
//
// ─── QUE ESTABA ROTO (medido en produccion, 2026-09-02) ────────────────────────────────────
//
// El listado se acotaba por ZONA ∧ una lista blanca de CINCO estados. Eso fallaba por los DOS
// lados a la vez:
//
//   (A) PERDIA LO SUYO. En cuanto un mensajero gestionaba la orden, esta salia de los cinco
//       estados y DESAPARECIA de la pantalla de la bodega que la despacho. De todas las ordenes
//       que pasaron por un cierre de satelite, 17 eran invisibles para esa satelite: 15
//       `entregada`, 1 `rechazada` (guia 66840050, cierre `6cc872bd`) y 1 `reprogramada`. Una
//       bodega podia tener un cierre pendiente por una orden que no podia consultar.
//   (B) MOSTRABA LO AJENO. Como el recorte era por ZONA, la lista blanca dejaba pasar ordenes
//       que NUNCA pisaron una bodega satelite. En la zona habia 267 `entregada` y solo 15
//       habian pasado por una satelite; 29 `rechazada` y 1; 28 `reprogramada` y 1. Y `devuelta`
//       YA estaba en la lista blanca: de las 16 que habia, CERO habian pasado por una satelite.
//
// De ahi que ensanchar la lista blanca SIN cambiar el criterio hubiera sido el error grave: le
// habria enseñado 252 `entregada` que nunca tocaron su bodega. Las dos caras se cierran a la
// vez, y solo se pueden cerrar a la vez: (A) ampliando los estados, (B) exigiendo la evidencia.
//
// Helper PURO (`lib/utils/`): sin Prisma, sin servicios, sin React.

import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * LA EVIDENCIA. Los dos estados que solo existen porque un paquete fue mandado a —o recibido
 * en— una bodega satelite.
 *
 * **Como se identifica QUE bodega, y por que asi** (medido contra el esquema, no supuesto):
 * en este modelo NO existe una entidad «bodega». La bodega satelite ES la zona: `CierreBodega`
 * se ancla en `zona_id` («zona satelite que cierra»), el alcance del `adminSatelite` es su
 * `usuario.zona_id`, y TODO productor de estas dos transiciones deriva la bodega de destino de
 * `orden.zona_id` — el ruteo (`rutearBodegaSateliteLote`), el deshacer
 * (`DeshacerAsignacionService`, `orden.zonaId === centralZonaId`) y las liberaciones por cron
 * (`reprogramada`/`devuelta`/`sin_gestionar` -> `en_bodega_satelite` si la zona no es central).
 *
 * `orden_historial_estado` NO guarda ninguna columna de bodega ni de zona. Su `actor_usuario_id`
 * daria la zona solo en las entradas que ejecuta un `adminSatelite` (`recepcion_satelite`,
 * `recuperacion_manual`, parte de `deshacer_asignacion`/`incidente`); en las que ejecuta el cron
 * es NULL y en las de la aprobacion del cierre es un admin sin zona. O sea: el actor NO sirve
 * como identificador de bodega para todas las entradas, y `orden.zona_id` SI, porque es la
 * fuente de la que el propio sistema deriva a que bodega manda el paquete.
 *
 * Por eso el alcance se compone de DOS mitades y ninguna sobra:
 *   - `orden.zona_id = <zona del actor>` dice QUE bodega. Es la frontera entre inquilinos y NO
 *     se toca: mantenerla es lo que garantiza que este cambio no pueda ensanchar el alcance de
 *     nadie.
 *   - el historial dice SI ESTUVO en una bodega satelite. Es la mitad que faltaba, y es la que
 *     cierra la cara (B).
 */
export const ESTADOS_CUSTODIA_SATELITE = [
  "en_ruta_bodega_satelite",
  "en_bodega_satelite",
] as const satisfies readonly OrderStatusValue[];

export type EstadoCustodiaSatelite = (typeof ESTADOS_CUSTODIA_SATELITE)[number];

/**
 * Los estados que el listado NO ofrece aunque el grafo diga que una orden puede llegar a ellos.
 * Se declaran APARTE —y con su motivo— porque son la unica parte del contrato que es una
 * DECISION y no una derivacion: `ESTADOS_BODEGA_SATELITE` es el cierre del grafo menos esto.
 *
 * Son de dos clases:
 *
 *  1. **La custodia volvio a la central.** `en_bodega_central` y `en_ruta_bodega_central` (y,
 *     por delante de ellos, los tres estados de la recoleccion en tienda) describen un paquete
 *     que ya NO esta bajo responsabilidad de la satelite. Mostrarlos convertiria el listado en
 *     una ventana a la operacion de la central.
 *  2. **`en_ruta_bodega_satelite` tiene pantalla propia.** Son las «Por recibir»
 *     (`/recepcion-satelite/por-recibir`, se aceptan por escaner o por lote) y nunca han
 *     entrado en este listado. Ofrecerlas aqui duplicaria en dos pantallas las mismas filas.
 *     OJO: sigue siendo EVIDENCIA valida (esta en `ESTADOS_CUSTODIA_SATELITE`); lo que no es,
 *     es un estado que este listado muestre.
 */
export const ESTADOS_FUERA_DEL_LISTADO_SATELITE = [
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
  "en_ruta_bodega_central",
  "en_bodega_central",
  "en_ruta_bodega_satelite",
] as const satisfies readonly OrderStatusValue[];

/**
 * EL CONTRATO DE LA PANTALLA — los DIECISEIS estados que el listado «Órdenes de la bodega»
 * puede mostrar, EN EL ORDEN EN QUE LOS PRESENTA (el `ORDER BY` del repositorio lee este orden).
 *
 * **No es una lista de deseos: es el cierre del grafo de transiciones** desde
 * `ESTADOS_CUSTODIA_SATELITE`, menos `ESTADOS_FUERA_DEL_LISTADO_SATELITE`. Esa igualdad se
 * comprueba recalculandola sobre `TRANSICIONES` en
 * `tests/unit/utils/estados-bodega-satelite.test.ts`, en las dos direcciones: ni sobra un value
 * al que una orden de la satelite no pueda llegar, ni falta uno al que si.
 *
 * Se escribe como LITERAL —y no como el calculo— a proposito: ES el contrato que el desplegable
 * de la UI ofrece y el `z.enum` del borde admite, tiene que ser una tupla tipada, y su orden es
 * lo que el usuario ve. El calculo vive en el test, que es donde puede contradecirlo.
 *
 * **El orden.** Sigue el recorrido: lo que esta en el estante, lo que sale, lo que esta en la
 * calle, el desenlace, y el retorno hasta la tienda. Los CINCO estados que el listado ya
 * mostraba conservan su orden RELATIVO de siempre (`en_bodega_satelite` < `por_recoger` <
 * `por_devolver` < `devolviendo_a_bodega_central` < `devuelta`): la pantalla gana filas, no
 * reordena las que ya tenia.
 *
 * ─── LAS TRES DECISIONES QUE ESTA LISTA REVIERTE, Y POR QUE ────────────────────────────────
 *
 * Tres estados estaban excluidos por decisiones ESCRITAS de este repo. Las tres se tomaron bajo
 * la premisa vieja —«el listado es lo que tengo FISICAMENTE en el estante»— y la ficha 357
 * cambia esa premisa por «el listado es el RECORRIDO de mis ordenes, de principio a fin». Con la
 * premisa nueva las tres razones dejan de aplicar, y por eso entran:
 *
 *  - **`en_reparto`** (el repo lo decidio dos veces en contra: «el paquete esta EN LA MOTO»).
 *    Entra. Si el listado enseña `entregada` y `rechazada` pero esconde `en_reparto`, la orden
 *    desaparece durante las horas que pasa en la calle y reaparece al gestionarse: es el MISMO
 *    defecto de la cara (A), solo que mas corto. Y quien tiene el cierre pendiente de esa orden
 *    es la satelite.
 *  - **`ayuda_tienda`** (feature 235/R37, misma razon «esta en la moto»). Entra, por lo mismo:
 *    es un tramo del recorrido, no una fila accionable. La ausencia de acciones sobre ella no
 *    depende de esta lista.
 *  - **`devolucion_por_confirmar`** (feature 239/P4, FIRMADA por el humano en contra de la
 *    recomendacion del spec). Entra, y esto es lo mas delicado de la ficha, asi que se escribe
 *    entero: P4 decidio que el `adminSatelite` NO puede RECUPERAR A BODEGA una devolucion aun
 *    no anclada, y esa decision se mantiene INTACTA —no se añade ninguna arista de
 *    `recuperacion_manual` al pre-estado, y el test lo sigue afirmando—. Lo que cambia es que
 *    VER no es OPERAR: bajo la premisa nueva, esconder el tramo en el que el paquete espera la
 *    aprobacion del cierre (retraso medido entonces: p90 22,1 h, max 48,2 h) reabre justo el
 *    agujero que esta ficha cierra. Si el humano prefiere lo contrario, la vuelta atras es
 *    mover el value a `ESTADOS_FUERA_DEL_LISTADO_SATELITE` — un sitio, dos lineas mas arriba.
 *
 * **Como se revierte cualquiera de las tres (o `en_reparto`, que es la que el encargo pide que
 * sea reversible en un sitio):** se saca de esta lista y se mete en
 * `ESTADOS_FUERA_DEL_LISTADO_SATELITE`. El test recalcula el cierre menos esa lista, asi que las
 * dos declaraciones no pueden quedar en desacuerdo sin ponerse rojas.
 */
export const ESTADOS_BODEGA_SATELITE = [
  // --- En la bodega -------------------------------------------------------------------
  "en_bodega_satelite", // Recibidas: en el estante
  "por_recoger", // Asignadas a un mensajero que aun no las recogio (feature 149/R35)
  // --- En la calle --------------------------------------------------------------------
  "en_reparto", // FICHA 357: entra. El tramo entre el despacho y el desenlace
  "ayuda_tienda", // FICHA 357: entra (revierte 235/R37)
  // --- El desenlace -------------------------------------------------------------------
  "entregada", // FICHA 357 (cara A): 15 de las 17 invisibles estaban aqui
  "reprogramada", // FICHA 357 (cara A)
  "rechazada", // FICHA 357 (cara A): la guia 66840050 del reporte
  "sin_gestionar", // FICHA 357: el corte de la noche sobre una orden suya
  "incidente", // FICHA 357: dañada / perdida / robada
  // --- La devolucion ------------------------------------------------------------------
  "devolucion_por_confirmar", // FICHA 357: entra (revierte 239/P4 SOLO en cuanto a VER)
  "por_devolver", // Por devolver — feature 139/R21
  "devolviendo_a_bodega_central", // En transito a central (informativo) — feature 139/R21
  "devuelta", // Devueltas — feature 100/R12
  // --- El retorno a la tienda (el paquete ya salio de la zona, pero el desenlace es suyo) ---
  "por_devolver_a_tienda",
  "devolviendo_a_tienda",
  "devuelta_a_tienda",
] as const satisfies readonly OrderStatusValue[];

/** `value` de estatus que el listado de la bodega satelite admite. */
export type EstadoBodegaSatelite = (typeof ESTADOS_BODEGA_SATELITE)[number];

/**
 * El calculo del que sale `ESTADOS_BODEGA_SATELITE`: cierre transitivo de `TRANSICIONES` desde
 * `ESTADOS_CUSTODIA_SATELITE`, sin atravesar los estados de
 * `ESTADOS_FUERA_DEL_LISTADO_SATELITE`.
 *
 * **Por que se PODAN como NODOS y no solo como salida.** Que un paquete vuelva a
 * `en_bodega_central` no es «un estado que no enseñamos»: es que la orden dejo de estar bajo la
 * satelite, y lo que le pase DESPUES (que la reasignen a otra ruta, que se cancele por API)
 * tampoco es suyo. Podar el nodo modela eso; filtrar solo la salida final dejaria entrar toda la
 * operacion posterior de la central por la puerta de atras.
 *
 * Vive aqui —y no en el test— para que la regla y su verificacion no puedan divergir: el test
 * llama a ESTA funcion y la compara contra la tupla literal.
 */
export function alcanceDerivadoDelGrafo(): Set<string> {
  const fuera = new Set<string>(ESTADOS_FUERA_DEL_LISTADO_SATELITE);
  const grafo = TRANSICIONES as unknown as Record<string, readonly { readonly to: string }[]>;
  const alcanzados = new Set<string>();
  const pendientes: string[] = [];

  for (const origen of ESTADOS_CUSTODIA_SATELITE) {
    // El propio estado de custodia cuenta como alcanzado (la orden ESTA ahi), salvo que este
    // podado — que es el caso de `en_ruta_bodega_satelite`, con pantalla propia.
    if (!fuera.has(origen)) alcanzados.add(origen);
    // Sus salidas se exploran SIEMPRE, aunque el nodo este podado del listado: una orden que
    // fue ruteada y luego recibida sigue el recorrido desde ahi.
    pendientes.push(origen);
  }

  const visitados = new Set<string>(pendientes);
  while (pendientes.length > 0) {
    const actual = pendientes.pop() as string;
    for (const { to } of grafo[actual] ?? []) {
      if (fuera.has(to)) continue; // nodo podado: ni se muestra ni se atraviesa
      if (!alcanzados.has(to)) alcanzados.add(to);
      if (!visitados.has(to)) {
        visitados.add(to);
        pendientes.push(to);
      }
    }
  }
  return alcanzados;
}

/**
 * R44/R45 — traduce la SELECCION del filtro de estado a la lista de estados que se consulta.
 *
 * Dos reglas, las dos copiadas del filtro de cliente que sustituye:
 *
 *  - **seleccion vacia = «todos»** (el desplegable sin nada marcado no filtra). Es el
 *    `estadosElegidos.length > 0` de `SateliteOrdenesListado`.
 *  - **la seleccion INTERSECA la lista blanca, nunca la amplia**: un `estados:
 *    ["en_bodega_central"]` no devuelve ordenes de la central, devuelve NADA. La diferencia
 *    importa: un `estado` colado por el borde no puede convertir este listado en una ventana a
 *    la operacion de otra bodega. Por eso la interseccion vacia NO cae a «todos» — eso seria
 *    justo lo contrario.
 *
 * OJO (ficha 357): esta funcion acota los ESTADOS, no el ALCANCE. La frontera entre inquilinos
 * —zona del actor ∧ la orden paso por una bodega satelite— la impone el `WHERE` del
 * repositorio y NO depende de lo que llegue por aqui.
 *
 * El resultado sale SIEMPRE en el orden canonico, sea cual sea el orden en que llegue la
 * seleccion: el usuario no puede reordenar la pantalla marcando los filtros al reves.
 */
export function estadosDelListado(
  seleccion?: readonly string[],
): EstadoBodegaSatelite[] {
  if (seleccion === undefined || seleccion.length === 0) {
    return [...ESTADOS_BODEGA_SATELITE];
  }
  return ESTADOS_BODEGA_SATELITE.filter((estado) => seleccion.includes(estado));
}
