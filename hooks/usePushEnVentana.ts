"use client";

import { useCallback, useEffect, useRef } from "react";

import { MENSAJE_PUSH_RECIBIDO } from "@/lib/pwa/actualizacion";

/**
 * FICHA 410 (tanda 5, T5.4 — R43) — UN HECHO, UN SONIDO.
 *
 * Con la app abierta y enfocada el navegador **obliga** a mostrar la notificación del sistema: un
 * push no se puede recibir en silencio. Así que si además suena el tono propio de la campana, la
 * persona oye **dos** avisos de la misma cosa y aprende que la app es ruidosa.
 *
 * El service worker ya avisa: cuando muestra un push busca las ventanas VISIBLES y les manda
 * `MENSAJE_PUSH_RECIBIDO`. Este hook escucha ese mensaje, dispara la revalidación de la campana
 * —para que el aviso aparezca ya, sin esperar los 60 s del sondeo— y deja una marca de tiempo que
 * el tono consulta para saltarse **ese** incremento.
 *
 * ## Por qué una marca de tiempo y no una bandera
 *
 * Una bandera «sáltate el próximo» se queda encendida para siempre si el push no produce ningún
 * incremento —llega un aviso que no es accionable, y `porHacer` no se mueve—, y entonces se come
 * el **siguiente** tono, que sí era de otra cosa. Un fallo mudo, y de los caros: el tono deja de
 * sonar y nadie sabe por qué.
 *
 * La marca caduca sola. Se consume **una sola vez** (el primer incremento tras el push) y expira a
 * los `VENTANA_SUPRESION_TONO_MS`, así que el peor caso es «un tono de más» en vez de «todos los
 * tonos de menos».
 */

/**
 * Cuánto vale la pena callar el tono tras un push. La revalidación de la campana tarda lo que tarde
 * la Server Action; diez segundos la cubren de sobra y siguen siendo poco para tragarse por error
 * un incremento ajeno.
 */
export const VENTANA_SUPRESION_TONO_MS = 10_000;

export interface UsePushEnVentanaResult {
  /**
   * ¿Hay que callar el tono de ESTE incremento porque lo acaba de anunciar el sistema?
   *
   * Consume la marca: la segunda llamada seguida devuelve `false`. Se la pasa la campana a
   * `useTonoAlIncrementar`, que la invoca **solo cuando de verdad hay un incremento**.
   *
   * La marca se guarda aquí dentro y no se devuelve: quien la mutara desde fuera sería un segundo
   * dueño de la misma decisión, y además el compilador de React lo prohíbe.
   */
  suprimirTonoDeEsteIncremento: () => boolean;
}

export function usePushEnVentana(alRecibirPush: () => void): UsePushEnVentanaResult {
  const ultimoPushAt = useRef(0);
  const alRecibirRef = useRef(alRecibirPush);

  // La última versión del callback, sin volver a suscribir el listener en cada render.
  useEffect(() => {
    alRecibirRef.current = alRecibirPush;
  }, [alRecibirPush]);

  useEffect(() => {
    const contenedor =
      typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!contenedor) return;

    function alMensaje(evento: MessageEvent) {
      const datos: unknown = evento.data;
      if (
        typeof datos !== "object" ||
        datos === null ||
        (datos as { tipo?: unknown }).tipo !== MENSAJE_PUSH_RECIBIDO
      ) {
        return;
      }
      ultimoPushAt.current = Date.now();
      alRecibirRef.current();
    }

    contenedor.addEventListener("message", alMensaje);
    return () => contenedor.removeEventListener("message", alMensaje);
  }, []);

  const suprimirTonoDeEsteIncremento = useCallback(() => {
    const marca = ultimoPushAt.current;
    if (marca === 0) return false;
    // Se consume SIEMPRE que se mira, haya callado el tono o no.
    ultimoPushAt.current = 0;
    return Date.now() - marca < VENTANA_SUPRESION_TONO_MS;
  }, []);

  return { suprimirTonoDeEsteIncremento };
}
