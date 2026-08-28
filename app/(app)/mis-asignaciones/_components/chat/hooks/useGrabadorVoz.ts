"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { FORMATOS_NOTA_VOZ } from "@/lib/config/chat-media-envio";

// Feature 316 (design §6.2, R13-R16) — grabar una nota de voz en el navegador del mensajero.
//
// EL PUNTO DE TODO ESTE ARCHIVO (R14): el formato se MIDE, no se supone. Chrome en Android
// graba `audio/webm;codecs=opus` por defecto y Meta lo RECHAZA como `type: audio`: una nota
// grabada "a lo que salga" llegaria como un envio fallido o, peor, como un archivo que el
// cliente no puede escuchar. Se recorre `FORMATOS_NOTA_VOZ` —todos aceptados por Meta, en orden
// de preferencia— con `MediaRecorder.isTypeSupported` y se graba en el PRIMERO disponible.
//
// Y SI NO HAY NINGUNO (R15/D5): no se graba. La via se ofrece deshabilitada con su aviso y el
// mensajero usa otra de las tres. Enviar el `webm` como documento se evaluo y se descarto por
// decision humana (P1): el cliente recibiria algo que quiza no puede reproducir y el mensajero
// creeria haber mandado una nota de voz.
//
// EL MICROFONO SE CIERRA SIEMPRE (R16): `getTracks().forEach(t => t.stop())` al detener, al
// descartar, al fallar y al desmontar. Dejarlo abierto enciende el indicador del sistema
// indefinidamente y el mensajero no tiene forma de apagarlo sin cerrar la pestana.

/** Estado visible del grabador. `no_soportado` es R15; `sin_permiso` es R16. */
export type EstadoGrabadorVoz =
  | "inactivo"
  | "grabando"
  | "no_soportado"
  | "sin_permiso"
  | "fallo";

export interface UseGrabadorVozOptions {
  /**
   * Se invoca con el `File` ya cerrado cuando la grabacion termina. Es un CALLBACK y no un
   * estado que el componente lea con un efecto: el composer valida ese `File` por el mismo
   * camino que cualquier otro adjunto (clasificar -> validar), y hacerlo desde el `onstop`
   * evita un `setState` dentro de un `useEffect`.
   */
  onGrabacion: (archivo: File) => void;
}

export interface UseGrabadorVozResult {
  /** `false` = ningun formato aceptado por Meta esta disponible aqui (R15). */
  soportado: boolean;
  /** MIME con el que se va a grabar, o `null` si no hay ninguno aceptable. */
  formato: string | null;
  estado: EstadoGrabadorVoz;
  /** Texto del fallo para pintarlo; `null` mientras no haya ninguno. */
  aviso: string | null;
  iniciar: () => void;
  detener: () => void;
  /** Cancela una grabacion en curso sin entregar nada y cierra el microfono. */
  cancelar: () => void;
}

const AVISO_NO_SOPORTADO = "La nota de voz no está disponible en este navegador.";
const AVISO_SIN_PERMISO =
  "No se pudo usar el micrófono. Revisa el permiso del navegador e inténtalo de nuevo.";
const AVISO_FALLO = "No se pudo grabar la nota de voz en este dispositivo.";

/** Extension coherente con el MIME real con el que grabo el navegador (solo cosmetica). */
function extensionDe(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/aac") return "aac";
  return "ogg";
}

/**
 * Primer formato de `FORMATOS_NOTA_VOZ` que este dispositivo sabe grabar, o `null` (R14).
 * Exportada para poder medirla sin montar el componente.
 */
export function formatoNotaVozSoportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  return FORMATOS_NOTA_VOZ.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Suscripcion vacia: la capacidad del dispositivo no cambia durante la vida de la pagina. */
function sinCambios(): () => void {
  return () => {};
}

export function useGrabadorVoz({
  onGrabacion,
}: Readonly<UseGrabadorVozOptions>): UseGrabadorVozResult {
  // `useSyncExternalStore` y NO `useState` + `useEffect`: en el servidor no existe
  // `MediaRecorder`, asi que el snapshot de servidor es `null` (via deshabilitada) y el del
  // cliente es lo que el dispositivo diga, sin hidratacion incoherente y sin setState en efecto.
  const formato = useSyncExternalStore(sinCambios, formatoNotaVozSoportado, () => null);

  const [estado, setEstado] = useState<EstadoGrabadorVoz>("inactivo");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const trozosRef = useRef<Blob[]>([]);
  // El callback vive en una ref para que `onstop` —que corre mucho despues del render que lo
  // registro— use siempre el ultimo, sin re-crear el grabador en cada render del composer.
  const entregaRef = useRef(onGrabacion);
  useEffect(() => {
    entregaRef.current = onGrabacion;
  }, [onGrabacion]);

  const cerrarMicrofono = useCallback(() => {
    streamRef.current?.getTracks().forEach((pista) => pista.stop());
    streamRef.current = null;
  }, []);

  const iniciar = useCallback(() => {
    if (formato === null) {
      setEstado("no_soportado");
      return;
    }
    if (recorderRef.current !== null) return;

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // R16: permiso denegado o sin microfono. Se vuelve al composer con un aviso; no queda
        // un "Grabando" del que no se pueda salir.
        cerrarMicrofono();
        setEstado("sin_permiso");
        return;
      }
      streamRef.current = stream;

      try {
        const recorder = new MediaRecorder(stream, { mimeType: formato });
        recorderRef.current = recorder;
        trozosRef.current = [];

        recorder.ondataavailable = (evento: BlobEvent) => {
          if (evento.data && evento.data.size > 0) trozosRef.current.push(evento.data);
        };
        recorder.onstop = () => {
          // El MIME que se sube es el REAL del grabador, no el que se pidio: si el navegador
          // devolviera otro, se detecta en el mismo camino que cualquier archivo elegido a mano
          // (`clasificarAdjunto` en el composer) y no por un supuesto.
          const mime = recorder.mimeType || formato;
          const blob = new Blob(trozosRef.current, { type: mime });
          trozosRef.current = [];
          recorderRef.current = null;
          cerrarMicrofono();
          setEstado("inactivo");
          entregaRef.current(
            new File([blob], `nota-de-voz.${extensionDe(mime)}`, { type: mime }),
          );
        };

        recorder.start();
        setEstado("grabando");
      } catch {
        // El dispositivo acepto el permiso pero no expone el medio (R16): se cierra el
        // microfono para no dejar el indicador encendido y se avisa.
        recorderRef.current = null;
        cerrarMicrofono();
        setEstado("fallo");
      }
    })();
  }, [cerrarMicrofono, formato]);

  const detener = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null) {
      cerrarMicrofono();
      setEstado("inactivo");
      return;
    }
    recorder.stop();
  }, [cerrarMicrofono]);

  const cancelar = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    trozosRef.current = [];
    if (recorder !== null) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    cerrarMicrofono();
    setEstado("inactivo");
  }, [cerrarMicrofono]);

  // Desmontar con el micro abierto lo deja abierto: el `MediaStream` no muere con el componente.
  useEffect(() => cerrarMicrofono, [cerrarMicrofono]);

  const aviso =
    estado === "no_soportado"
      ? AVISO_NO_SOPORTADO
      : estado === "sin_permiso"
        ? AVISO_SIN_PERMISO
        : estado === "fallo"
          ? AVISO_FALLO
          : formato === null
            ? AVISO_NO_SOPORTADO
            : null;

  return {
    soportado: formato !== null,
    formato,
    estado,
    aviso,
    iniciar,
    detener,
    cancelar,
  };
}
