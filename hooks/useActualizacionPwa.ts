"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  hayTrabajoEnCurso,
  MENSAJE_PAGINA_LISTA,
  MENSAJE_RELEVO_AHORA,
} from "@/lib/pwa/actualizacion";

/**
 * Feature 284 — "hay una version nueva": detectarla, y NO recargar por su cuenta.
 *
 * ## Las dos garantias, que son el motivo entero de este hook
 *
 * **G1 · No se recarga nada que el usuario no haya pedido.** `controllerchange` se dispara en
 * TODAS las pestañas cuando el service worker nuevo toma el control, tambien en las que no
 * pulsaron nada. Aqui la recarga esta condicionada a `solicitadoRef`: la pestaña que pidio el
 * relevo se recarga, y las demas solo se enteran de que hay version nueva.
 *
 * **G2 · El aviso espera a que no haya una gestion a medias.** No se ofrece el boton mientras
 * `hayTrabajoEnCurso` diga que si; se revisa cada pocos segundos y el aviso aparece cuando el
 * usuario termina. Y se vuelve a comprobar AL PULSAR, por si algo empezo entre el pintado y el
 * clic.
 *
 * ## Lo que este hook NO puede probar, y se dice
 *
 * Que el navegador de verdad deje al SW nuevo en `waiting` es cosa del navegador, y en
 * `localhost` el SW de produccion ni siquiera existe (se autodestruye). Eso se comprueba a
 * mano sobre un despliegue HTTPS; el guion esta en `specs/284-pwa-correcta/design.md` §6.3.
 */

/** Cada cuanto se vuelve a mirar si el usuario ya termino lo que estaba haciendo. */
const INTERVALO_REVISION_MS = 3000;

export interface OpcionesActualizacionPwa {
  /**
   * Como se recarga. Existe para poder AFIRMAR en un test que la recarga ocurre (o que no
   * ocurre): `location.reload()` no es observable ni sustituible en jsdom.
   */
  recargar?: () => void;
  /** Cada cuanto se revisa si sigue habiendo trabajo en curso. */
  intervaloMs?: number;
}

export interface EstadoActualizacionPwa {
  /** Hay una version nueva lista (esperando, o ya activa porque la activo otra pestaña). */
  hayVersionNueva: boolean;
  /** Se le puede enseñar el aviso al usuario: hay version nueva y no esta en medio de nada. */
  seAvisa: boolean;
  /** Lo llama el boton del aviso. Nunca recarga si hay una gestion a medias. */
  actualizar: () => void;
}

export function useActualizacionPwa(
  opciones: OpcionesActualizacionPwa = {},
): EstadoActualizacionPwa {
  const { intervaloMs = INTERVALO_REVISION_MS } = opciones;

  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  const [trabajoEnCurso, setTrabajoEnCurso] = useState(false);

  /** El SW instalado y en espera, si lo hay. Es a quien se le pide el relevo. */
  const esperandoRef = useRef<ServiceWorker | null>(null);
  /** Esta pestaña pidio el relevo. Sin esto, NO se recarga (G1). */
  const solicitadoRef = useRef(false);
  /** El relevo ya ocurrio (aqui o en otra pestaña): recargar es lo unico que falta. */
  const relevadoRef = useRef(false);
  /** Una sola recarga, pase lo que pase. */
  const recargadoRef = useRef(false);

  // La forma de recargar se guarda en un ref DESDE UN EFECTO (nunca durante el render) para
  // que los manejadores de eventos, que viven fuera del ciclo de React, siempre usen la
  // ultima. Se recarga como muy pronto en el primer evento del SW, o sea despues de montar.
  const recargarRef = useRef<() => void>(() => {
    window.location.reload();
  });
  const recargarOpcion = opciones.recargar;
  useEffect(() => {
    recargarRef.current =
      recargarOpcion ??
      (() => {
        window.location.reload();
      });
  }, [recargarOpcion]);

  useEffect(() => {
    // Se mira el VALOR y no `"serviceWorker" in navigator`: la propiedad puede existir
    // declarada y valer `undefined` (navegadores viejos, contextos no seguros), y ahi el `in`
    // dice que si y la linea siguiente revienta.
    const quizaContenedor =
      typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!quizaContenedor) return;
    // El alias con tipo explicito no es adorno: TypeScript pierde el estrechamiento de arriba
    // dentro de las funciones anidadas de este efecto.
    const contenedor: ServiceWorkerContainer = quizaContenedor;
    let vivo = true;

    /** Anota que hay version nueva y mira YA si se puede avisar. */
    function anunciar(worker: ServiceWorker | null) {
      if (!vivo) return;
      esperandoRef.current = worker;
      setHayVersionNueva(true);
      setTrabajoEnCurso(hayTrabajoEnCurso(document));
    }

    function alCambiarDeControlador() {
      if (!vivo) return;
      relevadoRef.current = true;
      // G1: solo se recarga la pestaña que lo pidio. En las demas el service worker nuevo ya
      // manda, pero su pagina sigue siendo la de antes y se queda como esta: se le enseña el
      // aviso y recarga cuando el usuario quiera.
      if (!solicitadoRef.current) {
        anunciar(null);
        return;
      }
      if (recargadoRef.current) return;
      recargadoRef.current = true;
      recargarRef.current();
    }

    contenedor.addEventListener("controllerchange", alCambiarDeControlador);

    const registro = contenedor.getRegistration?.();
    const limpiezas: Array<() => void> = [];

    void Promise.resolve(registro)
      .then((encontrado) => {
        if (!vivo || !encontrado) return;
        const reg: ServiceWorkerRegistration = encontrado;

        // Ya instalado y esperando desde antes de montar esta pagina.
        if (reg.waiting && contenedor.controller) anunciar(reg.waiting);

        function alEncontrarActualizacion() {
          const entrante = reg.installing;
          if (!entrante) return;
          function alCambiarDeEstado() {
            // `installed` + hay controlador = version NUEVA sobre una pagina viva. Sin
            // controlador seria la primera instalacion, que no es una actualizacion.
            if (entrante && entrante.state === "installed" && contenedor.controller) {
              anunciar(entrante);
            }
          }
          entrante.addEventListener("statechange", alCambiarDeEstado);
          limpiezas.push(() =>
            entrante.removeEventListener("statechange", alCambiarDeEstado),
          );
        }

        reg.addEventListener("updatefound", alEncontrarActualizacion);
        limpiezas.push(() => reg.removeEventListener("updatefound", alEncontrarActualizacion));
      })
      .catch(() => {
        // Sin registro no hay nada que avisar. No es un error que el usuario deba ver.
      });

    // La pagina avisa de que ya cargo: es la señal con la que el SW reintenta la purga de las
    // caches viejas (la ultima pagina de la build anterior puede acabar de desaparecer).
    contenedor.controller?.postMessage({ tipo: MENSAJE_PAGINA_LISTA });

    return () => {
      vivo = false;
      contenedor.removeEventListener("controllerchange", alCambiarDeControlador);
      for (const limpiar of limpiezas) limpiar();
    };
  }, []);

  useEffect(() => {
    if (!hayVersionNueva) return;
    const id = window.setInterval(() => {
      setTrabajoEnCurso(hayTrabajoEnCurso(document));
    }, intervaloMs);
    return () => window.clearInterval(id);
  }, [hayVersionNueva, intervaloMs]);

  const actualizar = useCallback(() => {
    // G2, segunda vuelta: entre que se pinto el aviso y el clic pudo abrirse un dialogo o
    // empezar un formulario. Si es asi el aviso se retira y vuelve cuando el usuario termine.
    if (hayTrabajoEnCurso(document)) {
      setTrabajoEnCurso(true);
      return;
    }
    const esperando = esperandoRef.current;
    if (esperando) {
      solicitadoRef.current = true;
      esperando.postMessage({ tipo: MENSAJE_RELEVO_AHORA });
      return;
    }
    // El relevo ya ocurrio (lo pidio otra pestaña): aqui solo queda recargar, y lo acaba de
    // pedir el usuario con el boton.
    if (relevadoRef.current && !recargadoRef.current) {
      recargadoRef.current = true;
      recargarRef.current();
    }
  }, []);

  return {
    hayVersionNueva,
    seAvisa: hayVersionNueva && !trabajoEnCurso,
    actualizar,
  };
}
