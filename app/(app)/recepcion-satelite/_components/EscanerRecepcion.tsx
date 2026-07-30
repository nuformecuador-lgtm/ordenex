"use client";

import { useCallback, useState } from "react";

import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
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
// Pedido humano (rama ux): la recepción se opera IGUAL que la recogida del mensajero
// (`RecogerPaqueteCard`), con los DOS caminos en la misma tarjeta: cámara y número de
// guía TECLEADO. La diferencia entre ambos es solo de parseo — la cámara entrega la URL
// del paquete (`<origin>/paquete/<numGuia>`) y hay que extraer el número; lo tecleado ES
// el número—, así que los dos terminan en el mismo `recibirPorQr`.

export interface EscanerRecepcionProps {
  /** Se invoca tras una recepción efectiva o idempotente (ok/ya_recibida). */
  onRecibida: () => void;
}

export function EscanerRecepcion({ onRecibida }: EscanerRecepcionProps) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);
  // Confirmacion PERSISTENTE del ultimo acierto: el toast se va solo y en una tanda
  // de escaneos seguidos el mensajero necesita ver que la anterior si entro.
  const [ultimaRecibida, setUltimaRecibida] = useState<number | null>(null);

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
          setUltimaRecibida(numGuia);
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

  /**
   * Camino manual: lo tecleado ES el número de guía (base 10, mismo criterio que la URL
   * del paquete). Un valor que no son dígitos no resuelve a ninguna guía: no se llama a
   * la acción y el texto se queda en el campo para corregirlo. Devuelve `true` solo si la
   * recepción entró (`ok`), que es lo que limpia el campo en `EscanerGuiaCard`.
   */
  const onManual = useCallback(
    async (valor: string): Promise<boolean> => {
      if (procesando) return false;
      if (!/^\d+$/.test(valor)) return false;
      const numGuia = Number(valor);
      setProcesando(true);
      try {
        const result = await recibirPorQr({ numGuia });
        notificar(result, numGuia);
        return result.status === "ok";
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando],
  );

  return (
    <EscanerGuiaCard
      ariaLabel="Recibir por número de guía o escaneo"
      titulo="Recibir paquete"
      descripcion="Escanea o ingresa el número de guía"
      onDecoded={onDecoded}
      procesando={procesando}
      mensajeErrorCamara="No se pudo abrir la cámara."
      manual={{ onSubmit: onManual, submitLabel: "Recibir" }}
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
