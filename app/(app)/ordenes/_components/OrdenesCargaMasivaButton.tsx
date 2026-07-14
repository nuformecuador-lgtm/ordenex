"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/shared/Modal";
import { OrdenesCargaResumen } from "@/app/(app)/ordenes/_components/OrdenesCargaResumen";
import { OrdenesCargaPreview } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import {
  OrdenesCargaUpload,
  type OrdenesCargaUploadResult,
} from "@/app/(app)/ordenes/_components/OrdenesCargaUpload";
import {
  clasificarBulkSummary,
  type ClasificacionCarga,
} from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import {
  procesarEnChunks,
  combinarResultados,
  ChunkRequestError,
} from "@/app/(app)/ordenes/_components/carga-masiva-chunks";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import { useToast } from "@/hooks/useToast";
import { listarMensajeros } from "@/lib/actions/mensajeros";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import type { MensajeroDTO } from "@/lib/types/asignacion-mensajero";

// Re-export por compatibilidad con consumidores previos de la constante.
export { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/carga-masiva-fields";

const CLASIFICACION_VACIA: ClasificacionCarga = {
  numRemisionesNuevas: [],
  existentes: [],
  errores: [],
};

/**
 * Pasos del modal: `upload` (elegir archivo → parseo/validación por chunks en el
 * navegador, dry-run, sin persistir), `preview` (hallazgos: duplicados + errores,
 * con chips) y `asignacion` (tras la carga real: asignar mensajero a las nuevas).
 */
type Step = "upload" | "preview" | "asignacion";

/**
 * Botón "Carga masiva". El archivo se parsea y deduplica EN EL NAVEGADOR y sus
 * filas viajan en LOTES (chunks) al backend — evita el límite de body de Vercel
 * y soporta archivos grandes. Flujo en dos fases: valida (dry-run) → confirma la
 * carga real. Ambas reutilizan `procesarEnChunks` sobre el mismo endpoint.
 */
export function OrdenesCargaMasivaButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [clasificacion, setClasificacion] =
    useState<ClasificacionCarga>(CLASIFICACION_VACIA);
  // Filas únicas validadas, para re-enviarlas en la carga real al confirmar.
  const [filasUnicas, setFilasUnicas] = useState<FilaParseada[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmProgreso, setConfirmProgreso] = useState<{
    hechas: number;
    total: number;
  } | null>(null);
  const [mensajeros, setMensajeros] = useState<MensajeroDTO[]>([]);
  const [mensajeroSugeridoId, setMensajeroSugeridoId] = useState("");
  const { mutate } = useSWRConfig();
  const toast = useToast();

  // Carga la lista de mensajeros al abrir el modal (una sola vez por apertura).
  useEffect(() => {
    if (!open || mensajeros.length > 0) return;
    let cancelled = false;
    listarMensajeros()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") setMensajeros(result.mensajeros);
      })
      .catch(() => {
        // Silencioso: el mensajero sugerido es opcional.
      });
    return () => {
      cancelled = true;
    };
  }, [open, mensajeros.length]);

  const mensajeroOptions = [
    { value: "", label: "Sin sugerir" },
    ...mensajeros.map((m) => ({ value: m.id, label: m.nombre })),
  ];

  // Fase 1: la validación (dry-run por chunks) terminó. Nada persistido.
  function handleValidated(result: OrdenesCargaUploadResult) {
    setClasificacion(result.clasificacion);
    setFilasUnicas(result.filasUnicas);

    const nuevas = result.clasificacion.numRemisionesNuevas.length;
    const dup = result.clasificacion.existentes.length;
    const err = result.clasificacion.errores.length;
    toast.info(`Validación: ${nuevas} nuevas, ${dup} duplicadas, ${err} con error`);

    setStep("preview");
  }

  // Fase 2: carga real. Re-envía las filas únicas en chunks SIN dryRun para
  // persistir solo las nuevas válidas (duplicadas/errores se omiten).
  async function handleConfirmar() {
    if (filasUnicas.length === 0 || confirmando) return;
    setConfirmando(true);
    setConfirmProgreso(null);

    try {
      const realResults = await procesarEnChunks(filasUnicas, {
        dryRun: false,
        mensajeroSugeridoId,
        chunkSize: cargaMasivaConfig.CHUNK_SIZE,
        onProgress: (hechas, total) => setConfirmProgreso({ hechas, total }),
      });

      const clasif = clasificarBulkSummary(combinarResultados(realResults, []));
      const nuevas = clasif.numRemisionesNuevas.length;
      const dup = clasif.existentes.length;
      const err = clasif.errores.length;
      const message = `Carga: ${nuevas} creadas, ${dup} duplicadas, ${err} con error`;
      if (err > 0) toast.warning(message);
      else toast.success(message);

      void mutate(
        (key) => Array.isArray(key) && key[0] === "ordenes:list",
        undefined,
        { revalidate: true },
      );

      setClasificacion(clasif);
      if (nuevas > 0) setStep("asignacion");
      else handleOpenChange(false);
    } catch (cause) {
      toast.error(
        cause instanceof ChunkRequestError
          ? `La carga falló (estado ${cause.status}).`
          : "No se pudo completar la carga.",
      );
    } finally {
      setConfirmando(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("upload");
      setClasificacion(CLASIFICACION_VACIA);
      setFilasUnicas([]);
      setConfirmando(false);
      setConfirmProgreso(null);
      setMensajeroSugeridoId("");
    }
  }

  const progresoTexto = confirmProgreso
    ? `${confirmProgreso.hechas.toLocaleString()} / ${confirmProgreso.total.toLocaleString()}`
    : null;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Carga masiva
      </Button>
      <Modal
        open={open}
        onOpenChange={handleOpenChange}
        title="Carga masiva de órdenes"
        hideCancel
        confirmLabel="Cerrar"
        className="w-[75vw] max-w-none min-w-[320px]"
      >
        <div className="flex flex-col gap-4">
          {/* El mensajero sugerido persiste en subida y preview: se aplica en la
              carga real (al confirmar). No se muestra en la asignación, que tiene
              su propio asignador por orden. */}
          {step !== "asignacion" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="carga-mensajero-sugerido">
                Mensajero sugerido (opcional)
              </Label>
              <Select
                value={mensajeroSugeridoId}
                onValueChange={setMensajeroSugeridoId}
                options={mensajeroOptions}
                placeholder="Sin sugerir"
                disabled={mensajeros.length === 0 || confirmando}
                aria-label="Mensajero sugerido para el lote"
              />
              <p className="text-sm text-muted-foreground">
                Puedes sugerir un mensajero para todos los pedidos de esta carga.
                Es opcional; si no eliges ninguno, quedarán sin mensajero sugerido.
              </p>
            </div>
          ) : null}

          {step === "upload" ? (
            <OrdenesCargaUpload onValidated={handleValidated} />
          ) : step === "preview" ? (
            <OrdenesCargaPreview
              clasificacion={clasificacion}
              confirmando={confirmando}
              progresoTexto={progresoTexto}
              onConfirmar={handleConfirmar}
            />
          ) : (
            <OrdenesCargaResumen numRemisiones={clasificacion.numRemisionesNuevas} />
          )}
        </div>
      </Modal>
    </>
  );
}
