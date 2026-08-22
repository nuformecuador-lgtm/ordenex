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
//
// ⏳ 2026-08-22 (FEATURE 268, decision firmada en la puerta) — AQUI DECIA, y ya no es cierto:
// «FEATURE 235 (P4, FIRMADA por el humano el 2026-08-19) — `ayuda_tienda` NO entra aqui, y ademas
// el RESCATE de vuelta a `en_reparto` tampoco emite: ver `ORIGENES_SIN_EVENTO_PUBLICO` mas abajo.
// El vocabulario publico NO gana ningun valor por causa de esta feature (R39): un integrador no
// sabria interpretar «el mensajero pidio ayuda a la tienda», que es un tramite interno nuestro».
//
// 235/P4 SE REVIERTE A PROPOSITO (268/R1/R2/R8/R9), y LAS DOS MITADES DEL CICLO DE AYUDA VAN
// JUNTAS O NO VAN: entra `ayuda_tienda` (la IDA) y ademas se vacia la exencion del rescate (la
// VUELTA, `en_reparto` — ver `ORIGENES_SIN_EVENTO_PUBLICO` mas abajo). Emitir solo la ida es la
// MEDIA feature y es PEOR que el silencio de hoy: el integrador veria ENTRAR la orden en ayuda y
// no la veria salir nunca hasta el desenlace —que puede tardar horas o llegar por el corte de la
// noche como `sin_gestionar`—, y un estado de ayuda sin cierre visible se lee como «orden
// atascada»: genera exactamente la llamada de soporte que esta feature quiere evitar.
//
// Entra tambien `incidente` (R2), por la misma razon y con la misma direccion aditiva: ningun
// estado que hoy emite deja de emitir. `devolucion_por_confirmar` SIGUE FUERA (R4) y eso continua
// siendo una decision firmada (239/P2), no un olvido ni una asimetria que «corregir por simetria».
//
// COSTE ACEPTADO POR ESCRITO (R10): toda orden que pase por el ciclo de ayuda genera DOS EVENTOS
// MAS que hoy —la ida (`ayuda_tienda`) y la vuelta, que es un `en_reparto` REPETIDO sobre la misma
// orden—. Ese repetido es justo lo que 235/P4 evitaba. Es admisible porque la clave de idempotencia
// del emisor lleva el INSTANTE (features 47 y 99,
// `webhook_estado:<ordenId>:<estatusDestinoId>:<ISO>`): los dos eventos tienen `eventoId` DISTINTO,
// ninguno se descarta en silencio por el `ON CONFLICT DO NOTHING`, y el consumidor deduplica por
// ese id. Es la premisa que hace aceptable la reversion, y por eso se verifica con un test.
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
  "ayuda_tienda", // feature 268/R1: la IDA del ciclo de ayuda (revierte 235/P4)
  "incidente", // feature 268/R2: el desenlace que hoy el integrador no ve
]);

/** `true` si el valor de estado destino es un evento publico emitible (R15). */
export function esEventoPublico(estado: string): boolean {
  return EVENTOS_PUBLICOS.has(estado as OrderStatusValue);
}

// ⏳ 2026-08-22 (FEATURE 268/R5, decision firmada en la puerta) — AQUI DECIA, y ya no es cierto:
// «FEATURE 235 (P4, FIRMADA EN CONTRA DE LA RECOMENDACION DEL SPEC el 2026-08-19) — la UNICA
// excepcion a la politica de arriba (...). El humano NO acepta que un integrador reciba
// `en_reparto` DOS VECES sobre la misma orden. `ayuda_tienda` no entra en `EVENTOS_PUBLICOS` (la
// IDA no se emite), pero la VUELTA —el rescate `ayuda_tienda -> en_reparto`— si emitiria (...).
// Con esta lista, el ciclo de ayuda entero queda INVISIBLE desde fuera: ni la ida ni la vuelta».
//
// LA LISTA QUEDA VACIA A PROPOSITO: 235/P4 se revierte (ver el bloque de `EVENTOS_PUBLICOS`), el
// rescate VUELVE A EMITIR (R9) y ninguna familia queda exceptuada. El `en_reparto` repetido sobre
// la misma orden es el coste que se acepta por escrito arriba, y es soportable porque la clave de
// idempotencia lleva el INSTANTE: dos eventos, dos `eventoId`, y el consumidor deduplica.
//
// ⚠️ POR QUE EL MECANISMO SIGUE EXISTIENDO CON LA LISTA VACIA (R6, alternativa A2 descartada). Este
// es el UNICO sitio del sistema donde una exencion futura puede escribirse POR FAMILIA. Borrarlo
// ahorra seis lineas y compra la regresion de abajo: si manana hace falta silenciar un reingreso
// concreto y este mecanismo no esta, la implementacion natural sera por ESTADO destino. Por eso la
// constante, su restriccion de tipo, el `Set` derivado, `esFamiliaSinEventoPublico` y
// `esTransicionEmitible` se conservan con la MISMA firma y el mismo comportamiento observable.
//
// ⚠️ POR QUE POR FAMILIA Y NO POR ESTADO. Es el punto delicado entero, escrito aqui para que nadie
// lo "simplifique": si la excepcion se implementara por ESTADO DESTINO (`en_reparto` deja de
// emitir), se silenciarian los REINGRESOS LEGITIMOS —una `reprogramada` liberada por el cron
// (`liberacion_reprogramada`), un `deshacer_gestion`, una recogida (`recoleccion`)— y ESO SI seria
// una regresion, no un ajuste de contrato. La clave de idempotencia del emisor lleva el INSTANTE
// precisamente para admitir el reingreso a un mismo estado (patron de la feature 47), asi que esos
// reingresos funcionan y deben seguir funcionando.
//
// ⚠️ Y POR QUE UNA LISTA DE EXCLUSION AQUI ES SEGURA, al reves que en `ORIGEN_TIPOS_VISITA_REAL`:
// alli una lista negra hace que una familia FUTURA empiece a CONTAR sola (dinero cobrado de mas);
// aqui una familia futura empieza a EMITIR sola, que es el comportamiento por defecto de siempre y
// la direccion segura del error (un evento de mas es ruido; un evento de menos es un integrador
// que no se entera). Ampliar esta lista es reducir el contrato publico y tiene que costar una
// decision explicita: por eso el test la fija por IGUALDAD y se pone rojo si alguien la ensancha.
// Feature 268/R5: VACIA. No se borra el mecanismo (R6): lo que se borra es su unico habitante,
// `rescate_ayuda_tienda` (235/P4), que a partir de aqui vuelve a emitir.
export const ORIGENES_SIN_EVENTO_PUBLICO =
  [] as const satisfies readonly OrdenHistorialOrigenTipo[];

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
 * exceptuada (mecanismo de 235/P4, con la lista VACIA desde la 268/R5).
 *
 * ⏳ 2026-08-22 (feature 268/R7): mientras `ORIGENES_SIN_EVENTO_PUBLICO` este vacia, esta funcion
 * es EQUIVALENTE a `esEventoPublico(estadoDestino)` para toda familia declarada. Eso NO la
 * convierte en redundante: sigue siendo el punto UNICO de decision al que pregunta el emisor
 * (R14), y el sitio donde una exencion futura por familia se escribe sin tocar a los que preguntan.
 */
export function esTransicionEmitible(estadoDestino: string, origenTipo: string): boolean {
  return esEventoPublico(estadoDestino) && !esFamiliaSinEventoPublico(origenTipo);
}
