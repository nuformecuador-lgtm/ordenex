"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/hooks/useToast";
import { recolectarEnTiendaPorQr } from "@/lib/actions/recoleccion-tienda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 157 (R21/R23) — espejo de `useRecogerPorGuia` para la RECOLECCIÓN EN TIENDA.
// Lógica compartida por las dos vías de entrada del panel (escáner de cámara e input de
// número de guía): resuelve un `num_guia` contra las órdenes "por recolectar" del PROPIO
// mensajero y confirma la recolección con la MISMA Server Action
// (`por_recolectar_en_tienda` -> `en_ruta_bodega_central`), traduciendo el resultado a toasts.
//
// Restricción "asignada a mí": una guía que NO esté entre las suyas se rechaza AQUÍ, con
// toast y SIN llamar a la action (el backend la vuelve a exigir: guardia de propiedad del
// service + `mensajero_asignado_id` dentro del WHERE del repo). Es lo que hace que escanear
// una etiqueta ajena en el mostrador de la tienda no gaste un viaje al servidor.
//
// NO parsea URLs de QR: el llamador entrega ya el `num_guia`. Tampoco decide la
// revalidación: `recolectar` devuelve `true` en éxito y el consumidor dispara su refresh.

export interface UseRecolectarPorGuia {
  /**
   * Confirma la recolección de la orden cuyo `numGuia` coincide. Devuelve `true` SOLO si
   * la orden quedó en ruta a la bodega central (el consumidor revalida y limpia su control).
   */
  recolectar: (numGuia: number) => Promise<boolean>;
  /** `true` mientras hay una recolección en curso (para deshabilitar controles). */
  procesando: boolean;
}

export function useRecolectarPorGuia(
  porRecolectar: MiAsignacionDTO[],
): UseRecolectarPorGuia {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  const recolectar = useCallback(
    async (numGuia: number): Promise<boolean> => {
      if (procesando) return false;
      const orden = porRecolectar.find((o) => o.numGuia === numGuia);
      if (!orden) {
        toast.error(
          `La guía ${numGuia} no está entre tus órdenes por recolectar en tienda.`,
        );
        return false;
      }
      setProcesando(true);
      try {
        const result = await recolectarEnTiendaPorQr({ numGuia });
        // Un toast DISTINTO por resultado (R23): en una recolección de decenas de paquetes,
        // "ya la habías escaneado" y "esa no es tuya" piden reacciones opuestas del mensajero.
        switch (result.status) {
          case "ok":
            toast.success(`Guía ${numGuia} recolectada. Va a la bodega central.`);
            return true;
          case "ya_recolectada":
            // Idempotente: escanear dos veces la misma etiqueta es normal, no un error.
            toast.info(`La guía ${numGuia} ya estaba recolectada.`);
            return true;
          case "estado_invalido":
            toast.error(
              `La guía ${numGuia} ya no está por recolectar (está en "${result.estado}").`,
            );
            break;
          case "no_encontrada":
            toast.error(`La guía ${numGuia} no está entre tus órdenes por recolectar.`);
            break;
          case "conflict":
            toast.error(result.motivo);
            break;
          case "forbidden":
            toast.error("No tienes permiso para recolectar órdenes.");
            break;
          case "unauthenticated":
            toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
            break;
          case "validation_error":
            toast.error("Código inválido.");
            break;
        }
        return false;
      } finally {
        setProcesando(false);
      }
    },
    [porRecolectar, procesando, toast],
  );

  return { recolectar, procesando };
}
