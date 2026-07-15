"use client";

import { useEffect, useId, useState } from "react";

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

  useEffect(() => {
    if (!camaraAbierta) return;
    let cancelado = false;
    let iniciado = false;
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
            setCamaraAbierta(false);
            onDecoded(decodedText);
          },
          undefined,
        );
        iniciado = true;
      } catch {
        if (!cancelado) {
          toast.error(mensajeErrorCamara);
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
  }, [camaraAbierta, regionId, onDecoded, toast, mensajeErrorCamara]);

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
