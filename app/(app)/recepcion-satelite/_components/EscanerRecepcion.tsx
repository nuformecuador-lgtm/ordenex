"use client";

import { useCallback, useState } from "react";

import { QrScanner } from "@/components/shared/QrScanner";
import { useToast } from "@/hooks/useToast";
import { recibirPorQr } from "@/lib/actions/recepcion-satelite";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { RecibirResult } from "@/lib/types/recepcion-satelite";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";

// Feature 33 (T13, R12–R16, decisión F1.4 (a)): recepción por escaneo con la
// cámara del dispositivo, delegada al componente compartido `QrScanner`, que
// encapsula el botón, el visor y el ciclo de vida de html5-qrcode. Aquí solo
// resolvemos el numGuia del texto decodificado y llamamos a `recibirPorQr`.
// Feedback por ítem con useToast (un toast por resultado). Tras ok/ya_recibida se
// dispara `onRecibida` (el módulo lo conecta a router.refresh()).
//
// El camino del lector físico keyboard-wedge (<input> autofocus + Enter, R10) se
// retiró por pedido humano: la cámara es la única entrada.

export interface EscanerRecepcionProps {
  /** Se invoca tras una recepción efectiva o idempotente (ok/ya_recibida). */
  onRecibida: () => void;
}

export function EscanerRecepcion({ onRecibida }: EscanerRecepcionProps) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  /**
   * Traduce cada resultado de la acción a un toast por ítem (R12–R16). El
   * `num_guia` es el del escaneo (el mismo con el que la acción resolvió la
   * orden): es lo que el humano ve impreso en la etiqueta, a diferencia del
   * `result.ordenId`, que es el UUID interno y no le dice nada.
   */
  const notificar = useCallback(
    (result: RecibirResult, numGuia: number) => {
      switch (result.status) {
        case "ok":
          toast.success(`Guía ${numGuia} recibida.`);
          onRecibida();
          break;
        case "ya_recibida":
          toast.info(`La guía ${numGuia} ya estaba recibida.`);
          onRecibida();
          break;
        case "zona_ajena":
          toast.error("Esta orden pertenece a otra zona.");
          break;
        case "estado_invalido":
          toast.error(
            `No se puede recibir: la orden está en "${estatusLabel(result.estado)}".`,
          );
          break;
        case "no_encontrada":
          toast.error("Orden no encontrada.");
          break;
        case "validation_error":
          toast.error("Código inválido.");
          break;
        case "sin_zona":
          toast.error("No tienes una zona asignada.");
          break;
        case "forbidden":
          toast.error("No tienes permiso para recibir órdenes.");
          break;
        case "unauthenticated":
          toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
          break;
        case "conflict":
          toast.error("La orden cambió de estado. Vuelve a escanear.");
          break;
      }
    },
    [toast, onRecibida],
  );

  /**
   * Dado el texto escaneado, recibe la orden. El QR de la etiqueta codifica la
   * URL del paquete (`<origin>/paquete/<numGuia>`), así que se extrae el num_guia
   * del último segmento. CORTE LIMPIO: un texto que no resuelve a num_guia (p. ej.
   * el UUID de una etiqueta vieja) se rechaza aquí con el mismo mensaje que el
   * `validation_error` del borde, sin llamar a la acción.
   */
  const procesar = useCallback(
    async (escaneado: string) => {
      if (procesando) return;
      const numGuia = extractNumGuiaFromScan(escaneado);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      setProcesando(true);
      try {
        const result = await recibirPorQr({ numGuia });
        notificar(result, numGuia);
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando, toast],
  );

  /**
   * Camino cámara: `QrScanner` ya cierra el visor antes de invocarnos, así que
   * aquí solo procesamos el texto.
   */
  const onDecoded = useCallback(
    (texto: string) => {
      void procesar(texto);
    },
    [procesar],
  );

  return (
    <section aria-label="Recepción por escaneo" className="flex flex-col gap-3">
      <QrScanner
        onDecoded={onDecoded}
        disabled={procesando}
        mensajeErrorCamara="No se pudo abrir la cámara."
      />
    </section>
  );
}
