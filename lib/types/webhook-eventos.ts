import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";
import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 99 (design §6, R15/D3) — POLITICA de eventos publicos: los estados del ciclo de
// vida de la orden que el integrador consume. Constante UNICA (fuente de verdad); tanto el
// emisor (filtra las transiciones antes de encolar) como cualquier consumidor la referencian
// desde aqui, sin listas duplicadas.
//
// Se INCLUYEN los estados relevantes al integrador y se EXCLUYEN los internos de
// preparacion/ruteo satelite que no consume (`en_preparacion`, `por_recoger`,
// `en_ruta_bodega_satelite`, `en_bodega_satelite`). Lista FIJADA en el gate F1.4 (D3):
// cambiarla es cambiar el contrato publico de la feature.
//
// FEATURE 155/R43 (decision del humano en la puerta T0.1, 2026-07-29) — AMPLIACION ADITIVA:
// entra `por_recolectar_en_tienda`. Hasta la 155 una orden creada por API key nacia en
// `en_ruta_bodega_central`, que SI esta en esta lista, asi que el integrador recibia un evento
// al crearla. Tras la bifurcacion nace en `por_recolectar_en_tienda`: sin este alta, ese
// integrador dejaria de recibir CUALQUIER cosa hasta que la orden llegue a la bodega central,
// y el silencio se leeria como "no se creo". El cambio es estrictamente aditivo: ningun estado
// que hoy emite evento deja de emitirlo.
//
// FEATURE 239 (P2, FIRMADA por el humano el 2026-08-19) — `devolucion_por_confirmar` NO entra
// aqui, y es una decision, no un olvido. Este `Set` es PARCIAL y no rompe el build: un value
// nuevo se queda fuera en silencio, asi que la ausencia hay que afirmarla en un test
// (`tests/unit/types/webhook-eventos.test.ts`).
//
// El vocabulario publico NO gana un valor nuevo: anadirlo obligaria a cada integrador a manejar
// un estado que no sabe interpretar. Lo que cambia es CUANDO llega `devuelta` (R27): hasta la
// 239 se emitia al gestionar el mensajero; desde la 239 se emite al APROBAR el cierre, que es
// cuando la orden entra de verdad en `devuelta`. Retrasar un evento que el integrador ya maneja
// no rompe su codigo — pero SIGUE SIENDO un cambio de contrato observable, con el retraso medido
// contra produccion (mediana 8,2 h · p90 22,1 h · max 48,2 h): hay que AVISAR A LOS INTEGRADORES
// ANTES DE DESPLEGAR (T0.3 de la ficha; bloquea el despliegue, no el codigo).
// FEATURE 235 (P4, FIRMADA por el humano el 2026-08-19) — `ayuda_tienda` NO entraba aqui, y ademas
// el RESCATE de vuelta a `en_reparto` tampoco emitia (`ORIGENES_SIN_EVENTO_PUBLICO`), con lo que el
// ciclo de ayuda entero era invisible desde fuera.
//
// ⚠️ DECISION HUMANA 2026-08-21 — ESA FIRMA QUEDA REVERTIDA, y las DOS mitades a la vez. El
// vocabulario publico SI gana `ayuda_tienda` (abajo) y la excepcion por familia se vacia (ver
// `ORIGENES_SIN_EVENTO_PUBLICO`). Van juntas a proposito: emitir la IDA sin emitir la VUELTA le
// dejaria al integrador la orden colgada en un estado del que nunca la veria salir hasta el
// desenlace. Es un cambio de contrato OBSERVABLE en la direccion de MAS eventos (dos nuevos por
// orden que pase por ayuda, incluido un `en_reparto` repetido sobre la misma orden — precisamente
// lo que P4 evitaba). AVISAR A LOS INTEGRADORES ANTES DE DESPLEGAR, misma politica que la 239/T0.3.
export const EVENTOS_PUBLICOS: ReadonlySet<OrderStatusValue> = new Set<OrderStatusValue>([
  "por_recolectar_en_tienda", // feature 155/R43: evento de NACIMIENTO de la rama (b)
  "en_ruta_bodega_central",
  "en_bodega_central",
  "en_reparto",
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "devolviendo_a_tienda",
  "devuelta_a_tienda",
  // Decision humana 2026-08-21: la solicitud de ayuda del mensajero SI se le cuenta al integrador.
  // Documentado ademas en el enum publico del OpenAPI (`lib/api/openapi-spec.ts`, 4 sitios + el
  // .yaml espejo), porque desde hoy puede llegarle en un webhook y en las respuestas del canal.
  "ayuda_tienda",
]);

/** `true` si el valor de estado destino es un evento publico emitible (R15). */
export function esEventoPublico(estado: string): boolean {
  return EVENTOS_PUBLICOS.has(estado as OrderStatusValue);
}

// LA UNICA excepcion a la politica de arriba, y esta escrita POR FAMILIA DE ORIGEN, jamas por
// estado. HOY ESTA VACIA: no hay ninguna familia exenta y `esTransicionEmitible` se reduce, de
// hecho, a `esEventoPublico`. El mecanismo se conserva —no el contenido— porque es el unico sitio
// donde una exencion puede escribirse sin romper los reingresos legitimos (ver el aviso de abajo).
//
// HISTORIA. La feature 235 (P4, firmada EN CONTRA de la recomendacion del spec el 2026-08-19) metio
// aqui `rescate_ayuda_tienda`: como `ayuda_tienda` no era evento publico, la IDA no se emitia, y
// con esta lista tampoco la VUELTA (`ayuda_tienda -> en_reparto`, que si emitiria porque
// `en_reparto` esta en la politica). El motivo declarado: que ningun integrador recibiera
// `en_reparto` dos veces sobre la misma orden.
//
// DECISION HUMANA 2026-08-21 — esa firma queda revertida. `ayuda_tienda` ES evento publico y el
// ciclo se emite ENTERO: ida y vuelta. El `en_reparto` repetido pasa a ser aceptado a proposito —
// es el precio de que el integrador vea salir la orden del estado en que la vio entrar—. Nada de
// esto toca al emisor: su firma y su contrato siguen igual, porque la decision vive en la POLITICA.
//
// ⚠️ SI ALGUN DIA SE VUELVE A EXCEPTUAR ALGO, QUE SEA POR FAMILIA Y NO POR ESTADO. Es el punto
// delicado entero, escrito aqui para que nadie lo "simplifique": si la excepcion se implementara
// por ESTADO DESTINO (`en_reparto` deja de emitir), se silenciarian los REINGRESOS LEGITIMOS —una
// `reprogramada` liberada por el cron (`liberacion_reprogramada`), un `deshacer_gestion`, una
// recogida (`recoleccion`)— y ESO SI seria una regresion, no un ajuste de contrato. La clave de
// idempotencia del emisor lleva el INSTANTE precisamente para admitir el reingreso a un mismo
// estado (patron de la feature 47), asi que esos reingresos funcionan y deben seguir funcionando.
//
// ⚠️ Y POR QUE UNA LISTA DE EXCLUSION AQUI ES SEGURA, al reves que en `ORIGEN_TIPOS_VISITA_REAL`:
// alli una lista negra hace que una familia FUTURA empiece a CONTAR sola (dinero cobrado de mas);
// aqui una familia futura empieza a EMITIR sola, que es el comportamiento por defecto de siempre y
// la direccion segura del error (un evento de mas es ruido; un evento de menos es un integrador
// que no se entera). Llenar esta lista es reducir el contrato publico y tiene que costar una
// decision explicita: por eso el test la fija por IGUALDAD —hoy, contra la lista VACIA— y se pone
// rojo si alguien la ensancha.
export const ORIGENES_SIN_EVENTO_PUBLICO = [] as const satisfies readonly OrdenHistorialOrigenTipo[];

const SET_ORIGENES_SIN_EVENTO: ReadonlySet<string> = new Set<string>(ORIGENES_SIN_EVENTO_PUBLICO);

/** `true` si la FAMILIA de la transicion esta exceptuada de emitir evento publico (235/P4). */
export function esFamiliaSinEventoPublico(origenTipo: string): boolean {
  return SET_ORIGENES_SIN_EVENTO.has(origenTipo);
}

/**
 * LA DECISION DE EMITIR, en un solo punto (R39). El emisor
 * (`lib/services/jobs/webhook-estado-encolado.ts`) pregunta AQUI y no re-deriva nada: su firma, su
 * contrato y el de `emitirBestEffort` quedan intactos — la excepcion vive en la POLITICA, no en el
 * emisor.
 *
 * Se emite si y solo si: el estado destino es publico (R15) **y** la familia de origen no esta
 * exceptuada (235/P4).
 */
export function esTransicionEmitible(estadoDestino: string, origenTipo: string): boolean {
  return esEventoPublico(estadoDestino) && !esFamiliaSinEventoPublico(origenTipo);
}
