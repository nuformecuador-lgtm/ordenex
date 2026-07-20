"use client";

import { useCallback, useState } from "react";

import { QrScanner } from "@/components/shared/QrScanner";
import { useToast } from "@/hooks/useToast";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Recoger por escaneo: espejo de `EscanerRecepcion` (feature 33) para el portal del
// mensajero. Delega la cámara y el ciclo de vida de html5-qrcode en el componente
// compartido `QrScanner`; aquí solo se resuelve el num_guia del texto decodificado y
// se ACEPTA la orden con la MISMA Server Action que el botón "Recoger"
// (`recogerAsignaciones`, en_espera_aceptacion -> en_reparto). El backend no cambia.
//
// El QR de la etiqueta codifica la URL del paquete (`<origin>/paquete/<numGuia>`),
// así que se extrae el num_guia y se resuelve contra la lista de "por recoger" del
// propio mensajero para obtener el UUID que la action espera (misma fuente de verdad
// que el botón). Un código que no resuelve a una de esas órdenes se rechaza aquí sin
// llamar a la action.

export interface EscanerRecogerProps {
  /** Órdenes en `en_espera_aceptacion` (por recoger): resuelven numGuia -> id. */
  porRecoger: MiAsignacionDTO[];
  /** Se invoca tras una recogida exitosa (el módulo lo conecta a router.refresh()). */
  onRecogida: () => void;
}

export function EscanerRecoger({ porRecoger, onRecogida }: Readonly<EscanerRecogerProps>) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  const procesar = useCallback(
    async (escaneado: string) => {
      if (procesando) return;
      const numGuia = extractNumGuiaFromScan(escaneado);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      const orden = porRecoger.find((o) => o.numGuia === numGuia);
      if (!orden) {
        toast.error(`La guía ${numGuia} no está entre tus órdenes por recoger.`);
        return;
      }
      setProcesando(true);
      try {
        const result = await recogerAsignaciones({ ordenIds: [orden.id] });
        switch (result.status) {
          case "ok":
            toast.success(`Guía ${numGuia} recogida.`);
            onRecogida();
            break;
          case "conflict":
            toast.error(
              "La orden ya no está por recoger. Actualiza y vuelve a intentar.",
            );
            break;
          case "forbidden":
            toast.error("No tienes permiso para recoger esta orden.");
            break;
          case "unauthenticated":
            toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
            break;
          case "validation_error":
            toast.error("Código inválido.");
            break;
        }
      } finally {
        setProcesando(false);
      }
    },
    [porRecoger, procesando, toast, onRecogida],
  );

  /**
   * Camino cámara: `QrScanner` ya cierra el visor antes de invocarnos, así que aquí
   * solo procesamos el texto.
   */
  const onDecoded = useCallback(
    (texto: string) => {
      void procesar(texto);
    },
    [procesar],
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
