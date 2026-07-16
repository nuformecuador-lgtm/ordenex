"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";

const MENSAJE_ERROR_CAMARA_DEFAULT =
  "No se pudo acceder a la cámara. Debes habilitar los permisos de cámara en la configuración del navegador para usar esta función.";

export interface QrScannerProps {
  /** Se invoca con el texto decodificado, tras cerrar la cámara. */
  onDecoded: (texto: string) => void;
  /** Bloquea el botón (p. ej. mientras el consumidor procesa el texto). */
  disabled?: boolean;
  /** Mensaje del toast cuando la cámara no se puede abrir (permisos). */
  mensajeErrorCamara?: string;
}

/**
 * Escáner de QR reutilizable: encapsula el botón de abrir/cerrar cámara, el ciclo
 * de vida de `html5-qrcode` (import dinámico: la lib toca window/navigator, nunca
 * en SSR), el visor y el error de permisos. NO sabe qué significa el texto
 * decodificado: eso lo decide el consumidor via `onDecoded`.
 */
export function QrScanner({
  onDecoded,
  disabled = false,
  mensajeErrorCamara = MENSAJE_ERROR_CAMARA_DEFAULT,
}: Readonly<QrScannerProps>) {
  const toast = useToast();
  const [camaraAbierta, setCamaraAbierta] = useState(false);

  const regionId = useId().replace(/:/g, "_") + "-camara";

  // El efecto NO puede depender de estas tres: `onDecoded` y `toast` cambian de
  // identidad en cada render de los consumidores (p. ej. `useQrNavigate` la
  // recrea al mover su flag `procesando`), y tenerlas en las deps limpiaba el
  // efecto y RE-ARRANCABA la cámara, que volvía a decodificar el mismo QR en
  // bucle. Las leemos por ref: siempre la versión fresca, cero churn de deps.
  const onDecodedRef = useRef(onDecoded);
  const toastRef = useRef(toast);
  const mensajeErrorCamaraRef = useRef(mensajeErrorCamara);
  useEffect(() => {
    onDecodedRef.current = onDecoded;
    toastRef.current = toast;
    mensajeErrorCamaraRef.current = mensajeErrorCamara;
  });

  useEffect(() => {
    if (!camaraAbierta) return;
    let cancelado = false;
    let iniciado = false;
    // html5-qrcode sigue entregando frames (~fps) hasta que `stop()` resuelve,
    // que es asíncrono: sin este pestillo el primer QR dispara `onDecoded` una
    // vez por frame. Un `useState` no serviría — el callback vive en la clausura
    // que `start()` capturó y nunca vería el valor nuevo.
    let entregado = false;
    let instancia: {
      stop: () => Promise<void>;
      clear: () => void;
    } | null = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelado) return;
        const scanner = new Html5Qrcode(regionId);
        instancia = scanner as unknown as typeof instancia;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            if (entregado || cancelado) return;
            entregado = true;
            setCamaraAbierta(false);
            onDecodedRef.current(decodedText);
          },
          undefined,
        );
        iniciado = true;
      } catch {
        if (!cancelado) {
          toastRef.current.error(mensajeErrorCamaraRef.current);
          setCamaraAbierta(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      const s = instancia;
      if (!s) return;
      if (iniciado) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      } else {
        try {
          s.clear();
        } catch {
          // ignora si clear falla
        }
      }
    };
  }, [camaraAbierta, regionId]);

  return (
    <>
      <Button
        type="button"
        variant={camaraAbierta ? "outline" : "default"}
        aria-pressed={camaraAbierta}
        disabled={disabled}
        onClick={() => setCamaraAbierta((a) => !a)}
      >
        {camaraAbierta ? "Cerrar cámara" : "Escanear con cámara"}
      </Button>

      {camaraAbierta && !disabled ? (
        <div
          id={regionId}
          role="region"
          aria-label="Visor de cámara QR"
          className="w-full max-w-sm overflow-hidden rounded-lg border"
        />
      ) : null}
    </>
  );
}
