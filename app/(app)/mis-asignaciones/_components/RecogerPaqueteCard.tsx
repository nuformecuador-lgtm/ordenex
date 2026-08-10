"use client";

import { useCallback, useState } from "react";
import { PackageCheck } from "lucide-react";

import { EscanerModal } from "@/components/shared/EscanerModal";
import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { useRecogerPorGuia } from "./useRecogerPorGuia";

// Feature 96 — la recogida del mensajero, en UN solo control: los DOS caminos que antes
// eran dos secciones sueltas (`EscanerRecoger` + `InputRecoger`) viven ahora en la misma
// tarjeta, cada uno a un lado del separador. La logica no cambia: ambos resuelven el
// num_guia contra `porRecoger` (restriccion "asignada a mi") y aceptan con la MISMA
// action via `useRecogerPorGuia`, directo al confirmar (sin modal).
//
// La diferencia entre los dos caminos es solo de PARSEO: la camara entrega la URL del
// paquete (`<origin>/paquete/<numGuia>`) y hay que extraer el numero; lo tecleado ES el
// numero y se compara tal cual.

export interface RecogerPaqueteCardProps {
  /** Órdenes en `por_recoger`: resuelven numGuia -> id. */
  porRecoger: MiAsignacionDTO[];
  /** Se invoca tras una recogida exitosa (el módulo lo conecta a router.refresh()). */
  onRecogida: () => void;
}

export function RecogerPaqueteCard({
  porRecoger,
  onRecogida,
}: Readonly<RecogerPaqueteCardProps>) {
  const toast = useToast();
  const { recoger, procesando } = useRecogerPorGuia(porRecoger);
  // Confirmación PERSISTENTE de la última recogida: el toast se va solo y en una tanda
  // seguida el mensajero necesita ver que la anterior sí entró.
  const [ultimaRecogida, setUltimaRecogida] = useState<number | null>(null);

  const recogerGuia = useCallback(
    async (numGuia: number): Promise<boolean> => {
      const ok = await recoger(numGuia);
      if (ok) {
        setUltimaRecogida(numGuia);
        onRecogida();
      }
      return ok;
    },
    [recoger, onRecogida],
  );

  /** Camino cámara: `QrScanner` ya cerró el visor; aquí solo se extrae el num_guia. */
  const onDecoded = useCallback(
    (texto: string) => {
      const numGuia = extractNumGuiaFromScan(texto);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      void recogerGuia(numGuia);
    },
    [recogerGuia, toast],
  );

  /**
   * Camino manual: lo tecleado ES el número. Un valor que no son dígitos no resuelve a
   * ninguna guía, así que no se llama a la action y el texto se queda en el campo para
   * corregirlo (mismo criterio de `num_guia` que la URL del paquete: base 10).
   */
  const onManual = useCallback(
    async (valor: string): Promise<boolean> => {
      if (!/^\d+$/.test(valor)) return false;
      return recogerGuia(Number(valor));
    },
    [recogerGuia],
  );

  return (
    /* 2026-07-31 (decisión del humano): la tarjeta vive TRAS su disparador, como en el resto
       de la app — desde el 2026-08-10, en modal. Sin él, `QrScanner` quedaba montado todo el
       tiempo que el mensajero tuviera abierta la pantalla — o sea, la cámara encendida en la
       calle. La confirmación de la última recogida vive FUERA de la tarjeta (en el estado de
       este componente), así que cerrar y reabrir no la pierde.
       El label NO es el de por defecto: aquí se RECOGE, no se recibe. */
    <EscanerModal label="Recoger paquete">
      <EscanerGuiaCard
        ariaLabel="Recoger por número de guía o escaneo"
        titulo="Recoger paquete"
        descripcion="Escanea o ingresa el número de guía"
        icono={PackageCheck}
        onDecoded={onDecoded}
        procesando={procesando}
        mensajeErrorCamara="No se pudo abrir la cámara."
        manual={{ onSubmit: onManual, submitLabel: "Recoger" }}
        exito={
          ultimaRecogida === null ? undefined : (
            <>
              Guía <span className="font-semibold">{ultimaRecogida}</span> recogida
              correctamente.
            </>
          )
        }
      />
    </EscanerModal>
  );
}
