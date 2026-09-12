"use client";

import { useEffect, useRef } from "react";

import { obtenerClavePublicaPush, registrarSuscripcionPush } from "@/lib/actions/push";
import { suscribirYRegistrarEsteDispositivo } from "@/lib/pwa/alta-push";
import {
  clavesDeSuscripcion,
  contenedorDeServiceWorker,
  etiquetaDeDispositivo,
  haySoportePush,
} from "@/lib/pwa/push-navegador";

/**
 * FICHA 422 (tanda 5, T5.1 — R14, R15, R16, R17, R18, R19, R20, R21, R23) — LA REACTIVACIÓN
 * SILENCIOSA DE LOS AVISOS AL VOLVER A ENTRAR.
 *
 * Lo que resuelve: al cerrar sesión este dispositivo se da de baja (410/R19, correcto y se
 * conserva), y con él se iba la única huella de que la persona había dicho que sí. La decisión
 * ahora vive aparte —es de la PERSONA— y al volver a entrar se usa para volver a suscribir **este**
 * dispositivo sin pedirle nada a nadie.
 *
 * ## Por qué es un componente del layout y NO una línea dentro del hook
 *
 * La primera propuesta era meterlo en `usePushSuscripcion`. No sirve, y la razón es medible:
 * `PushOptIn` —el único consumidor del hook— se monta dentro del panel de la campana, que es un
 * `<Popover.Portal>` **sin `keepMounted`** (y en `@base-ui/react` ese prop es `false` por defecto).
 * El panel NO EXISTE mientras la campana está cerrada, así que la reactivación ocurriría la primera
 * vez que alguien **abre la campana** — justo el gesto que esta ficha existe para no tener que
 * pedir. Aquí, en el layout del portal, ocurre al cargar cualquier página autenticada.
 *
 * El precedente exacto es `<AvisoVersionNueva />`: un componente cliente montado en este mismo
 * layout que no pinta nada hasta que decide por sí mismo.
 *
 * ## ⚠️ LAS TRES COSAS QUE ESTE COMPONENTE TIENE PROHIBIDAS
 *
 * 1. **Pedir el permiso (R16).** `Notification.requestPermission()` sigue apareciendo **una sola
 *    vez en todo el árbol**, dentro de `activar()`, y solo tras el gesto de la persona sobre el
 *    interruptor. Aquí el permiso se **LEE**. Un «no» del navegador es casi irreversible, así que
 *    una petición sin gesto perdería el canal para siempre en ese dispositivo. La guardia
 *    `push-alta-punto-unico.guardia.test.ts` lo vigila sobre la forma del árbol, no sobre lo que
 *    este archivo haga hoy.
 * 2. **Saltarse la comprobación del permiso porque la preferencia esté puesta (R17).** La
 *    preferencia ni siquiera entra en `suscribirYRegistrarEsteDispositivo`: esa función comprueba
 *    el permiso por su cuenta. Con el permiso en «default» o en «denied» aquí no pasa nada, y el
 *    control se ofrece como siempre.
 * 3. **Pintar o anunciar nada (R19).** Devuelve `null` SIEMPRE: sin toast, sin aviso, sin
 *    notificación del sistema. El interruptor ya muestra el estado de este dispositivo (410/R14) y
 *    lo dirá la próxima vez que se monte; anunciarlo además sería contarle a la persona una gestión
 *    interna que ella no pidió.
 *
 * ## Y una cuarta, que es la que evita que el interruptor mienta (R20)
 *
 * Si la resuscripción falla —sin red, service worker no activo, servidor que rechaza el registro—
 * aquí **no se toca ningún estado visible**. El interruptor lee el dispositivo, y el dispositivo
 * sigue sin suscripción: dirá «sin activar», que es la verdad. `alta-push` además deshace la
 * suscripción del navegador cuando el registro en el servidor no sale `ok`, justamente para que no
 * quede un dispositivo que cree que va a recibir avisos y no los va a recibir.
 */

export interface PushReactivacionProps {
  /**
   * R14/R18/R24 — la decisión de LA PERSONA, resuelta **en el servidor** por el layout del portal
   * (`docs/architecture.md`: el dato privado baja por props, no se pide desde el cliente). Sin
   * sesión válida el layout no monta este componente y aquí no llega nada que leer.
   */
  avisosRecordados: boolean;
}

/** R20/410/R23 — lo que se registra es la OPERACIÓN y la CAUSA. Nunca el `endpoint` ni las claves. */
function registrarFallo(operacion: string, causa: unknown): void {
  console.error(`[push] ${operacion} falló`, causa);
}

/** La suscripción viva de este dispositivo, o `null`. No pide nada y no crea nada. */
async function suscripcionDeEsteDispositivo(): Promise<PushSubscription | null> {
  // `getRegistration()` y NO `ready`: `navigator.serviceWorker.ready` no resuelve NUNCA si no hay
  // registro activo —y en desarrollo el service worker se des-registra solo—, así que esperarlo
  // dejaría este camino silencioso colgado para siempre. Es la misma decisión que `alta-push.ts`.
  const registro = await contenedorDeServiceWorker()?.getRegistration();
  return (await registro?.pushManager?.getSubscription()) ?? null;
}

/**
 * R21 — ya hay suscripción viva en este dispositivo: se REAFIRMA su registro en el servidor.
 *
 * No es un adorno: es el arreglo del cierre de sesión a medias. El servidor borró la fila y el
 * `unsubscribe()` del navegador falló, así que el interruptor diría «Activado» y no llegaría nada.
 * El upsert por `endpoint` (410/R17) lo cura **sin crear una segunda suscripción** para el mismo
 * dispositivo, que es lo que R21 exige.
 */
async function reafirmarRegistro(suscripcion: PushSubscription): Promise<void> {
  const claves = clavesDeSuscripcion(suscripcion);
  if (!claves) {
    // Una suscripción a medias no se puede reafirmar: no hay credencial que registrar. No se
    // deshace aquí —esto no la creó— y el interruptor seguirá diciendo lo que el navegador diga.
    registrarFallo("reafirmar el registro de este dispositivo", "suscripción incompleta");
    return;
  }
  const resultado = await registrarSuscripcionPush({
    ...claves,
    etiqueta: etiquetaDeDispositivo(navigator.userAgent),
  });
  if (resultado.status !== "ok") {
    registrarFallo("reafirmar el registro de este dispositivo", resultado.status);
  }
}

/**
 * El camino completo, en el orden de `design.md §5`: **de lo más barato y restrictivo a lo más
 * caro**. Importa, porque para la inmensa mayoría de las cargas el coste de red de todo esto es
 * CERO: se corta en una comprobación local mucho antes de hablar con el servidor.
 */
async function reactivarEsteDispositivo(): Promise<void> {
  try {
    // (2) ¿Puede este navegador? Local. El caso real del `false` es el iPhone sin instalar.
    if (!haySoportePush()) return;

    // (3) ⚠️ EL PERMISO SE **LEE** (R16/R17). `Notification.permission` es una lectura;
    // `requestPermission()` es una petición, y esa no está en este archivo ni puede estarlo.
    // Sin permiso concedido no se suscribe ni se registra NADA, esté puesta o no la preferencia.
    if (Notification.permission !== "granted") return;

    // (4) ¿Este dispositivo ya tiene suscripción viva? Local.
    let suscripcionViva: PushSubscription | null;
    try {
      suscripcionViva = await suscripcionDeEsteDispositivo();
    } catch (error) {
      // No se sabe en qué estado está el navegador, así que no se actúa sobre él. El intento es
      // por carga (R23), no por sesión: la siguiente carga del portal vuelve a mirarlo.
      registrarFallo("mirar si este dispositivo ya tiene avisos activos", error);
      return;
    }

    if (suscripcionViva) {
      await reafirmarRegistro(suscripcionViva);
      return;
    }

    // (5) LA PRIMERA IDA AL SERVIDOR DE TODO EL CAMINO. Sin canal configurado (`null`) se termina
    // sin ruido: no es un error, es un despliegue sin claves (410/R13).
    const clave = await obtenerClavePublicaPush();
    const clavePublica = clave.status === "ok" ? clave.clavePublica : null;
    if (!clavePublica) return;

    // (6) R15 — suscribir y registrar a nombre de la sesión abierta. Esta función **comprueba el
    // permiso otra vez y no lo pide**, y registra su propio fallo con la operación y la causa: por
    // eso aquí no se vuelve a registrar nada ni se mira el resultado. Lo que decide el estado que
    // se muestra es el dispositivo, no esta variable.
    await suscribirYRegistrarEsteDispositivo(clavePublica);
  } catch (error) {
    // R20: un fallo no puede escaparse como promesa sin capturar ni cambiar nada de lo que se ve.
    // La preferencia se conserva —aquí no se escribe— y el intento se repetirá en la próxima carga.
    registrarFallo("reactivar los avisos en este dispositivo", error);
  }
}

export function PushReactivacion({ avisosRecordados }: PushReactivacionProps) {
  // R23 — COMO MUCHO UN INTENTO POR CARGA. Un `useRef` y no un `useState`: cambiar el estado
  // provocaría un render, y este componente no pinta nada. Sobrevive al doble montaje del modo
  // estricto de React en desarrollo (React conserva los refs en ese remontaje simulado) y a
  // cualquier re-render del layout, que es el que persiste entre navegaciones del portal.
  const yaSeIntento = useRef(false);

  useEffect(() => {
    // R18 — LA PRIMERA COMPROBACIÓN, Y LA MÁS BARATA: sin preferencia puesta no se suscribe ni se
    // registra nada por su cuenta. Ni siquiera se le pregunta nada al navegador.
    if (!avisosRecordados) return;
    if (yaSeIntento.current) return;
    yaSeIntento.current = true;
    void reactivarEsteDispositivo();
  }, [avisosRecordados]);

  // R19 — SILENCIOSA. Este componente no ocupa un píxel.
  return null;
}
