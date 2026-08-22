"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/hooks/useToast";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
// Feature 261 (F1, R13/R15): el motivo del rechazo por reserva sale de la fuente ÚNICA, la misma
// frase que pinta la card y la misma que devuelve el servidor. Aquí no se redacta nada.
import { avisoReservaParaOtroDia } from "@/lib/utils/dia-reparto-textos";

// Feature 96 (DRY): lógica compartida por el escáner de cámara (`EscanerRecoger`) y el
// input de número de guía (`InputRecoger`). Resuelve un `num_guia` contra las órdenes
// "por recoger" del PROPIO mensajero para obtener el UUID y ACEPTA la orden con la MISMA
// Server Action `recogerAsignaciones` (por_recoger -> en_reparto), traduciendo
// el resultado a toasts. Restricción "asignada a mí": una guía que NO esté entre las
// "por recoger" se rechaza AQUÍ con toast, SIN llamar a la action (el backend la vuelve a
// exigir: R17 en el service + WHERE del repo).
//
// Feature 261 (F1, R13): el MISMO molde cubre un segundo rechazo — la orden RESERVADA para un
// día posterior. Son dos rechazos suaves con la misma forma y la misma defensa real detrás (el
// servidor), y el texto del segundo sale de la fuente única, no se redacta aquí.
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
      // Feature 261 (F1, R13) — LA ORDEN ESTÁ RESERVADA PARA UN DÍA POSTERIOR: se rechaza AQUÍ,
      // con el MISMO molde que el rechazo de arriba y SIN llamar a la action. El mensaje nombra
      // el motivo real y el día desde el que podrá; no se presenta como un error de la orden ni
      // como un código inválido, que es exactamente lo que R13 prohíbe.
      //
      // Defensa SUAVE, como la del mensajero bloqueado por cierre: la defensa real es del
      // servidor (R1/R4/R5) y vive además en el `WHERE` de la escritura. `esParaManana` lo
      // decidió el SERVIDOR (R14): el navegador no compara ninguna fecha.
      if (orden.esParaManana) {
        toast.error(avisoReservaParaOtroDia(orden.fechaRepartoISO));
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
            // Feature 261 (F1, R13): la CARRERA PERDIDA. Si el cliente dejó pasar la acción —la
            // lista venía de antes de que alguien reservara la orden— el servidor la rechaza y
            // dice por qué con un CÓDIGO DE MÁQUINA, no con prosa que haya que comparar. Se pinta
            // la misma frase de arriba, con el día que la orden trae consigo: una regla, dos
            // sitios, un texto. Sin esto, el mensajero leería «la orden ya no está por recoger»,
            // que es falso y le mandaría a actualizar para siempre.
            toast.error(
              result.detalle.some((d) => d.codigo === "reservada_para_otro_dia")
                ? avisoReservaParaOtroDia(orden.fechaRepartoISO)
                : "La orden ya no está por recoger. Actualiza y vuelve a intentar.",
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
