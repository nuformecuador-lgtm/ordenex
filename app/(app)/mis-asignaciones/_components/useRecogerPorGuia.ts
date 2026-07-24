"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/hooks/useToast";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 96 (DRY): lógica compartida por el escáner de cámara (`EscanerRecoger`) y el
// input de número de guía (`InputRecoger`). Resuelve un `num_guia` contra las órdenes
// "por recoger" del PROPIO mensajero para obtener el UUID y ACEPTA la orden con la MISMA
// Server Action `recogerAsignaciones` (por_recoger -> en_ruta), traduciendo
// el resultado a toasts. Restricción "asignada a mí": una guía que NO esté entre las
// "por recoger" se rechaza AQUÍ con toast, SIN llamar a la action (el backend la vuelve a
// exigir: R17 en el service + WHERE del repo).
//
// NO parsea URLs de QR: el llamador entrega ya el `num_guia` (el escáner via
// `extractNumGuiaFromScan`; el input, el texto tecleado tal cual). Tampoco decide la
// revalidación: `recoger` devuelve `true` en éxito y el consumidor dispara su refresh.

export interface UseRecogerPorGuia {
  /**
   * Recoge la orden cuyo `numGuia` coincide con `numGuia`. Devuelve `true` SOLO si la
   * recogida fue exitosa (el consumidor revalida la lista y limpia su control). Si la
   * guía no está entre las "por recoger" del mensajero, muestra un toast de rechazo y
   * NO llama a la action.
   */
  recoger: (numGuia: number) => Promise<boolean>;
  /** `true` mientras hay una recogida en curso (para deshabilitar controles). */
  procesando: boolean;
}

export function useRecogerPorGuia(
  porRecoger: MiAsignacionDTO[],
): UseRecogerPorGuia {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  const recoger = useCallback(
    async (numGuia: number): Promise<boolean> => {
      if (procesando) return false;
      const orden = porRecoger.find((o) => o.numGuia === numGuia);
      if (!orden) {
        toast.error(`La guía ${numGuia} no está entre tus órdenes por recoger.`);
        return false;
      }
      setProcesando(true);
      try {
        const result = await recogerAsignaciones({ ordenIds: [orden.id] });
        if (result.status === "ok") {
          toast.success(`Guía ${numGuia} recogida.`);
          return true;
        }
        switch (result.status) {
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
        return false;
      } finally {
        setProcesando(false);
      }
    },
    [porRecoger, procesando, toast],
  );

  return { recoger, procesando };
}
