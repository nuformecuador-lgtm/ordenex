"use client";

import { useCallback, useState } from "react";

import { QrScanner } from "@/components/shared/QrScanner";
import { useToast } from "@/hooks/useToast";
import { recibirEnOrigenPorQr } from "@/lib/actions/recepcion-origen";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { RecibirEnOrigenResult } from "@/lib/types/recepcion-origen";

import { estatusLabel } from "./estatus-label";

// Escáner de la tienda en `/ordenes`: cierra el flujo de devolución. El adminTienda
// escanea el QR de la etiqueta de una orden que viaja de vuelta ("En ruta a origen")
// y la marca como recibida en su tienda (`devuelta_origen` -> `recibido_origen`).
// Mismo patrón que `EscanerRecepcion` de la bodega satélite: resuelve el num_guia del
// texto decodificado, llama a la Server Action y traduce el resultado a un toast.
//
// A diferencia del escáner de `/qr`, este NO navega: la acción es marcar la recepción
// sin salir del listado, para poder escanear varias seguidas.

export interface EscanerRecepcionOrigenProps {
  /** Se invoca tras una recepción efectiva o idempotente (ok/ya_recibida). */
  onRecibida: () => void;
}

export function EscanerRecepcionOrigen({
  onRecibida,
}: Readonly<EscanerRecepcionOrigenProps>) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  /** Traduce cada resultado de la acción a un toast. */
  const notificar = useCallback(
    (result: RecibirEnOrigenResult, numGuia: number) => {
      switch (result.status) {
        case "ok":
          toast.success(`Guía ${numGuia} recibida en tienda.`);
          onRecibida();
          break;
        case "ya_recibida":
          toast.info(`La guía ${numGuia} ya estaba recibida.`);
          onRecibida();
          break;
        case "tienda_ajena":
          toast.error("Esta orden es de otra tienda.");
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
   * El QR de la etiqueta codifica la URL del paquete (`<origin>/paquete/<numGuia>`);
   * se extrae el num_guia del último segmento. Un texto que no resuelve a num_guia
   * (p. ej. el UUID de una etiqueta vieja) se rechaza aquí, sin llamar a la acción.
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
        const result = await recibirEnOrigenPorQr({ numGuia });
        notificar(result, numGuia);
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando, toast],
  );

  const onDecoded = useCallback(
    (texto: string) => {
      void procesar(texto);
    },
    [procesar],
  );

  return (
    <QrScanner
      onDecoded={onDecoded}
      disabled={procesando}
      mensajeErrorCamara="No se pudo abrir la cámara."
    />
  );
}
