"use client";

import { useCallback, useEffect, useState } from "react";

// Feature 308 (design §7, R24/R28) — descarga del adjunto de una burbuja por el proxy propio.
//
// Se usa `fetch` y NO un `<img src>` directo A PROPOSITO: el `onError` de un `<img>` no
// distingue "el archivo ya no existe" de "no hay red", y R24 exige decirlo explicitamente. El
// proxy responde `410` con `{ error: "expirado" }` cuando Meta ya borro el binario (30 dias).
//
// La cookie de sesion viaja sola (misma origin); el token de WhatsApp jamas llega al navegador.

/** URL del binario de un mensaje. `mensajeId` es el id INTERNO, nunca el media id de Meta. */
export function urlMediaChat(mensajeId: string, descarga = false): string {
  return `/api/chat/media/${encodeURIComponent(mensajeId)}${descarga ? "?descarga=1" : ""}`;
}

export type EstadoMediaChat =
  /** Aun no se ha pedido (audio/video/documento esperan accion explicita del mensajero, P3). */
  | "inactivo"
  | "cargando"
  | "listo"
  /** El proxy respondio 410: Meta ya no tiene el binario (R24). */
  | "expirado"
  | "error";

export interface UseMediaChatResult {
  estado: EstadoMediaChat;
  /** Object URL local del binario; `null` mientras no este `listo`. */
  url: string | null;
  /** Dispara la descarga (o la reintenta tras un error). */
  activar: () => void;
}

/**
 * @param mensajeId id interno del `ChatMensaje`.
 * @param autoCargar `true` para imagen y sticker (se ven al abrir el hilo); `false` para audio,
 * video y documento, que esperan a que el mensajero lo pida (P3: el polling refresca cada 10 s
 * y no se le van a gastar los datos moviles al repartidor en videos que no pidio).
 */
export function useMediaChat(mensajeId: string, autoCargar: boolean): UseMediaChatResult {
  const [pedido, setPedido] = useState(autoCargar);
  const [estado, setEstado] = useState<EstadoMediaChat>(
    autoCargar ? "cargando" : "inactivo",
  );
  const [url, setUrl] = useState<string | null>(null);

  const activar = useCallback(() => {
    setPedido(true);
    setEstado((actual) => (actual === "listo" ? actual : "cargando"));
  }, []);

  useEffect(() => {
    if (!pedido) return;

    const abort = new AbortController();
    let objectUrl: string | null = null;

    const descargar = async (): Promise<void> => {
      try {
        const res = await fetch(urlMediaChat(mensajeId), { signal: abort.signal });
        if (res.status === 410) {
          setEstado("expirado");
          return;
        }
        if (!res.ok) {
          setEstado("error");
          return;
        }
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setEstado("listo");
      } catch {
        // `AbortError` al desmontar no es un fallo que el mensajero deba ver.
        if (!abort.signal.aborted) setEstado("error");
      }
    };

    void descargar();

    return () => {
      abort.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [mensajeId, pedido]);

  return { estado, url, activar };
}
