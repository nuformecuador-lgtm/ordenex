"use client";

import { useCallback } from "react";

import { QrScanner } from "@/components/shared/QrScanner";
import { useToast } from "@/hooks/useToast";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { useRecogerPorGuia } from "./useRecogerPorGuia";

// Recoger por escaneo: espejo de `EscanerRecepcion` (feature 33) para el portal del
// mensajero. Delega la cámara y el ciclo de vida de html5-qrcode en el componente
// compartido `QrScanner`; aquí solo se extrae el num_guia del texto decodificado y se
// delega en `useRecogerPorGuia` (feature 96), la MISMA lógica "resolver numGuia contra
// porRecoger -> recoger -> toast + revalidar" que usa el input de número de guía.
//
// El QR de la etiqueta codifica la URL del paquete (`<origin>/paquete/<numGuia>`), así
// que se extrae el num_guia con `extractNumGuiaFromScan` ANTES de resolverlo; un código
// que no es esa URL se rechaza aquí (el input de texto NO usa este parser: compara el
// número tecleado directo contra `numGuia`).

export interface EscanerRecogerProps {
  /** Órdenes en `por_recoger`: resuelven numGuia -> id. */
  porRecoger: MiAsignacionDTO[];
  /** Se invoca tras una recogida exitosa (el módulo lo conecta a router.refresh()). */
  onRecogida: () => void;
}

export function EscanerRecoger({ porRecoger, onRecogida }: Readonly<EscanerRecogerProps>) {
  const toast = useToast();
  const { recoger, procesando } = useRecogerPorGuia(porRecoger);

  /**
   * Camino cámara: `QrScanner` ya cierra el visor antes de invocarnos. Extraemos el
   * num_guia de la URL del paquete y lo pasamos a la lógica compartida; en éxito
   * disparamos `onRecogida` (router.refresh en el módulo).
   */
  const onDecoded = useCallback(
    (texto: string) => {
      const numGuia = extractNumGuiaFromScan(texto);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      void recoger(numGuia).then((ok) => {
        if (ok) onRecogida();
      });
    },
    [recoger, onRecogida, toast],
  );

  return (
    <section aria-label="Recoger por escaneo" className="flex flex-col gap-3">
      <QrScanner
        onDecoded={onDecoded}
        disabled={procesando}
        mensajeErrorCamara="No se pudo abrir la cámara."
      />
    </section>
  );
}
