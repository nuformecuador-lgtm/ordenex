"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/hooks/useToast";
import { recolectarEnTiendaPorQr } from "@/lib/actions/recoleccion-tienda";

// Feature 157 (R21/R23) — espejo de `useRecogerPorGuia` para la RECOLECCIÓN EN TIENDA.
// Lógica compartida por las dos vías de entrada del apartado (escáner de cámara e input de
// número de guía): confirma la recolección con la MISMA Server Action por las dos vías
// (`recolectando` -> `en_ruta_bodega_central`) y traduce el resultado a toasts (R10/R13).
//
// Feature 167 (R12) — SIN pre-chequeo local de "esa guía no es tuya". El hook vivía dentro
// de Entregas y rechazaba en cliente toda guía que no estuviera en la lista cargada. Con el
// escáner SIEMPRE montado (R7) eso se vuelve una trampa: con lista vacía ningún escaneo
// podría tener éxito jamás, y con la página abierta desde hace rato rechazaría guías que el
// maestro ACABA de asignarle. El servidor es la autoridad y ya tiene las guardias reales
// —rol, propiedad, estado, bloqueo y carrera (`RecoleccionTiendaService`)—, y la opacidad
// de la 157/R30 hace que una guía ajena responda `no_encontrada` sin filtrar su existencia.
// Coste aceptado: un viaje de servidor por escaneo equivocado.
//
// Lo que SÍ sigue cortándose en el cliente es el código MAL FORMADO (R11): eso no consulta
// datos, solo evita mandar basura. Lo hace el llamador (`extractNumGuiaFromScan` para la
// cámara, `/^\d+$/` para el teclado) antes de entrar aquí.
//
// NO parsea URLs de QR: el llamador entrega ya el `num_guia`. Tampoco decide la
// revalidación: `recolectar` devuelve `true` en éxito y el consumidor dispara su refresh.

export interface UseRecolectarPorGuia {
  /**
   * Confirma la recolección de la orden de ese `numGuia`. Devuelve `true` SOLO si la orden
   * quedó en ruta a la bodega central —o ya lo estaba, que para el mensajero es el mismo
   * hecho consumado— para que el consumidor revalide y limpie su control.
   */
  recolectar: (numGuia: number) => Promise<boolean>;
  /** `true` mientras hay una recolección en curso (para deshabilitar controles). */
  procesando: boolean;
}

export function useRecolectarPorGuia(): UseRecolectarPorGuia {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  const recolectar = useCallback(
    async (numGuia: number): Promise<boolean> => {
      if (procesando) return false;
      setProcesando(true);
      try {
        const result = await recolectarEnTiendaPorQr({ numGuia });
        // Un toast DISTINTO por resultado (R13): en una recolección de decenas de paquetes,
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
            // R12: este es el mensaje que ANTES daba el corte local. Ahora lo decide el
            // servidor, que es quien sabe de quién es la orden; el mensajero lee lo mismo.
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
    [procesando, toast],
  );

  return { recolectar, procesando };
}
