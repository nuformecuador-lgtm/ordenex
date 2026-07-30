"use client";

import { useCallback, useState } from "react";

import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { recibirEnBodegaCentralPorQr } from "@/lib/actions/recepcion-bodega-central";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { RecibirEnBodegaCentralResult } from "@/lib/types/recepcion-bodega-central";

import { estatusLabel } from "./estatus-label";

// Feature 138 — Receptor en `/ordenes` (encabezado, solo maestro/admin): cierra el
// callejón de `en_ruta_bodega_central`. Espejo de `EscanerRecepcionOrigen`, con DOS
// entradas equivalentes (R12): (a) escaneo de QR por cámara y (b) entrada manual del
// número de guía. Ambas funelan a la MISMA Server Action `recibirEnBodegaCentralPorQr`
// y traducen el resultado a un toast por estado (R15). Guard `procesando` anti-doble
// envío. Tras `ok`/`ya_recibida` invoca `onRecibida` para refrescar el listado (R14).
//
// El rol (maestro/admin) NO se decide aquí: el padre (OrdenesListado) solo monta este
// control cuando `puedeRecibirBodegaCentral`, y el service revalida server-side (R16).

export interface EscanerRecepcionBodegaCentralProps {
  /** Se invoca tras una recepción efectiva o idempotente (ok/ya_recibida). */
  onRecibida: () => void;
}

export function EscanerRecepcionBodegaCentral({
  onRecibida,
}: Readonly<EscanerRecepcionBodegaCentralProps>) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);
  // Confirmacion PERSISTENTE del ultimo acierto: el toast se va solo y quien recibe
  // una tanda seguida necesita ver que la anterior si entro.
  const [ultimaRecibida, setUltimaRecibida] = useState<number | null>(null);

  /** Traduce cada resultado de la acción a un toast (R15, los 8 estados). */
  const notificar = useCallback(
    (result: RecibirEnBodegaCentralResult, numGuia: number) => {
      switch (result.status) {
        case "ok":
          // Feature 139/T3.5: la recepción central es STATE-AWARE. Si la orden venía
          // en `devolviendo_a_bodega_central`, la acción la deja en `por_devolver_a_tienda`
          // (no en bodega central): el toast nombra ese destino real. El caso 138
          // (`en_bodega_central`) conserva su mensaje.
          toast.success(
            result.estado === "por_devolver_a_tienda"
              ? `Guía ${numGuia} recibida; queda por devolver a la tienda.`
              : `Guía ${numGuia} recibida en bodega central.`,
          );
          setUltimaRecibida(numGuia);
          onRecibida();
          break;
        case "ya_recibida":
          toast.info(`La guía ${numGuia} ya estaba recibida.`);
          onRecibida();
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
          toast.error("La orden cambió de estado. Vuelve a intentar.");
          break;
      }
    },
    [toast, onRecibida],
  );

  /** Dispara la recepción de un `num_guia` ya resuelto a entero positivo. */
  const recibir = useCallback(
    async (numGuia: number) => {
      if (procesando) return;
      setProcesando(true);
      try {
        const result = await recibirEnBodegaCentralPorQr({ numGuia });
        notificar(result, numGuia);
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando],
  );

  /**
   * El QR de la etiqueta codifica la URL del paquete (`<origin>/paquete/<numGuia>`);
   * se extrae el num_guia del último segmento. Un texto que no resuelve a num_guia
   * (p. ej. el UUID de una etiqueta vieja) se rechaza aquí, sin llamar a la acción (R10).
   */
  const procesarEscaneo = useCallback(
    (escaneado: string) => {
      const numGuia = extractNumGuiaFromScan(escaneado);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      void recibir(numGuia);
    },
    [recibir, toast],
  );

  /**
   * Entrada manual (R12b): parsea lo tecleado a entero positivo y dispara la misma
   * acción. Un valor no numérico/no positivo se corta en cliente con el mismo
   * mensaje "Código inválido", sin llamar a la acción (coherente con el borde, R10);
   * devolver `false` deja el valor en el campo para corregirlo.
   */
  const enviarManual = useCallback(
    (valor: string) => {
      const numGuia = Number(valor);
      if (!Number.isSafeInteger(numGuia) || numGuia <= 0) {
        toast.error("Código inválido.");
        return false;
      }
      void recibir(numGuia);
      return true;
    },
    [recibir, toast],
  );

  return (
    <EscanerGuiaCard
      ariaLabel="Recepción en bodega central"
      titulo="Recibir paquete"
      descripcion="Escanea o ingresa el número de guía"
      onDecoded={procesarEscaneo}
      procesando={procesando}
      mensajeErrorCamara="No se pudo abrir la cámara."
      manual={{ onSubmit: enviarManual, submitLabel: "Recibir" }}
      exito={
        ultimaRecibida === null ? undefined : (
          <>
            Guía <span className="font-semibold">{ultimaRecibida}</span> recibida
            correctamente.
          </>
        )
      }
    />
  );
}
