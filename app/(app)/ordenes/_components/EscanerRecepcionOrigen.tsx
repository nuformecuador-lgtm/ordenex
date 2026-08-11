"use client";

import { useCallback, useState } from "react";

import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { recibirEnOrigenPorQr } from "@/lib/actions/recepcion-origen";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { RecibirEnOrigenResult } from "@/lib/types/recepcion-origen";

import { estatusLabel } from "./estatus-label";

// Escáner de la tienda en `/ordenes`: cierra el flujo de devolución. El adminTienda
// escanea el QR de la etiqueta de una orden que viaja de vuelta ("En ruta a origen")
// y la marca como recibida en su tienda (`devolviendo_a_tienda` -> `devuelta_a_tienda`).
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
  const [ultimaRecibida, setUltimaRecibida] = useState<number | null>(null);

  /** Traduce cada resultado de la acción a un toast. */
  const notificar = useCallback(
    (result: RecibirEnOrigenResult, numGuia: number) => {
      switch (result.status) {
        case "ok":
          toast.success(`Guía ${numGuia} recibida en tienda.`);
          setUltimaRecibida(numGuia);
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

  /**
   * Camino MANUAL (pedido humano del 2026-08-10): el admin de tienda teclea el número de
   * guía en vez de escanearlo. `EscanerGuiaCard` ya ofrecía las dos vías —es la tarjeta
   * compartida de todas las superficies de escaneo— pero esta pantalla no las activaba, así
   * que degradaba a solo cámara: sin cámara disponible, o con una etiqueta ilegible, no
   * había forma de recibir.
   *
   * Lo tecleado ES el número, sin pasar por `extractNumGuiaFromScan`: ese helper existe para
   * desenvolver la URL que codifica el QR (`<origin>/paquete/<numGuia>`), y aplicarlo aquí
   * rechazaría el número escrito a secas. Mismo criterio que la recolección en tienda.
   *
   * Devolver `false` conserva lo tecleado en el campo para corregirlo, en vez de vaciarlo y
   * obligar a reescribir la guía entera.
   */
  const onManual = useCallback(
    async (valor: string): Promise<boolean> => {
      if (!/^\d+$/.test(valor)) {
        toast.error("El número de guía solo admite dígitos.");
        return false;
      }
      if (procesando) return false;
      const numGuia = Number(valor);
      setProcesando(true);
      try {
        const result = await recibirEnOrigenPorQr({ numGuia });
        notificar(result, numGuia);
        return result.status === "ok";
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando, toast],
  );

  return (
    <EscanerGuiaCard
      ariaLabel="Recepción en tienda por escaneo"
      titulo="Recibir en tienda"
      descripcion="Escanea el código de la guía devuelta o ingresa su número"
      manual={{ onSubmit: onManual, submitLabel: "Recibir en tienda" }}
      onDecoded={onDecoded}
      procesando={procesando}
      mensajeErrorCamara="No se pudo abrir la cámara."
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
