"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/hooks/useToast";

/**
 * Traduce el texto decodificado de un QR de la app a una navegación. Los QR de
 * las etiquetas codifican la URL pública del paquete (`<origin>/paquete/<id>`,
 * ver `EtiquetaGuia`), por lo que un QR válido es una URL del propio origen o
 * una ruta absoluta; cualquier otra cosa es de otro sitio y se rechaza.
 *
 * `procesando` queda en `true` tras un decode válido (la navegación desmonta la
 * superficie): sirve para bloquear el escáner y evitar un segundo decode.
 */
export function useQrNavigate() {
  const router = useRouter();
  const toast = useToast();

  const [procesando, setProcesando] = useState(false);

  const onDecoded = useCallback(
    (decodedText: string) => {
      if (procesando) return;
      setProcesando(true);

      const appOrigin =
        process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

      try {
        const qrUrl = new URL(decodedText);
        if (qrUrl.origin !== appOrigin) {
          toast.error("El código QR pertenece a otro sitio.");
          setProcesando(false);
          return;
        }
        router.push(qrUrl.pathname + qrUrl.search + qrUrl.hash);
      } catch {
        if (!decodedText.startsWith("/")) {
          toast.error("El código QR no contiene una ruta válida de la app.");
          setProcesando(false);
          return;
        }
        router.push(decodedText);
      }
    },
    [procesando, router, toast],
  );

  return { onDecoded, procesando };
}
