"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { cn } from "@/lib/utils";
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
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { notificarCargaMasivaTerminada } from "@/lib/actions/notificaciones";
import { nuevoLoteId } from "@/app/(app)/ordenes/_components/lote-id";

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

/** Orden y etiqueta de los pasos, para el indicador de progreso. */
const PASOS: { id: Step; label: string }[] = [
  { id: "upload", label: "Subir archivo" },
  { id: "preview", label: "Revisar hallazgos" },
  { id: "asignacion", label: "Asignar mensajero" },
];

/** Subtítulo del modal según el paso; orienta sin repetir lo que ya dice el paso. */
const PASO_DESCRIPCION: Record<Step, string> = {
  upload: "Sube un archivo CSV o XLSX. Se valida en tu navegador antes de guardar nada.",
  preview: "Revisa los hallazgos de la validación y confirma para cargar.",
  asignacion: "Asigna un mensajero a las órdenes recién creadas.",
};

/** Indicador de progreso de los 3 pasos del modal (presentacional). */
function OrdenesCargaPasos({ step }: { step: Step }) {
  const actual = PASOS.findIndex((p) => p.id === step);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Progreso de la carga masiva">
      {PASOS.map((paso, index) => {
        const completado = index < actual;
        const activo = index === actual;
        return (
          <li key={paso.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                activo && "border-brand bg-brand text-white",
                completado && "border-brand bg-brand-soft text-brand-dark",
                !activo && !completado && "border-border text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {completado ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                activo ? "font-medium text-foreground" : "text-muted-foreground",
              )}
              aria-current={activo ? "step" : undefined}
            >
              {paso.label}
            </span>
            {index < PASOS.length - 1 ? (
              <span
                className={cn(
                  "hidden h-px w-8 sm:block",
                  completado ? "bg-brand" : "bg-border",
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

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
  // R39: identificador del lote, generado al iniciar la carga y ESTABLE entre
  // reintentos de la confirmación; es la clave de idempotencia del aviso.
  const [loteId, setLoteId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmProgreso, setConfirmProgreso] = useState<{
    hechas: number;
    total: number;
  } | null>(null);
  const { mutate } = useSWRConfig();
  const toast = useToast();

  // Fase 1: la validación (dry-run por chunks) terminó. Nada persistido.
  function handleValidated(result: OrdenesCargaUploadResult) {
    setClasificacion(result.clasificacion);
    setFilasUnicas(result.filasUnicas);
    // La carga (aún no persistida) empieza aquí: su lote ya tiene identidad.
    setLoteId(nuevoLoteId());

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

      // R22/R39: la carga por interfaz terminó — el servidor no puede saberlo solo.
      // Best-effort: no se espera ni se propaga el fallo, el resumen no depende de él.
      avisarCargaTerminada(nuevas, filasUnicas.length);

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
        description={PASO_DESCRIPCION[step]}
        hideCancel
        confirmLabel="Cerrar"
        confirmVariant="brand-outline"
        size="xl"
      >
        <div className="flex flex-col gap-5">
          <OrdenesCargaPasos step={step} />

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
            <OrdenesCargaResumen
              numRemisiones={clasificacion.numRemisionesNuevas}
              onDone={() => handleOpenChange(false)}
            />
          )}
        </div>
      </Modal>
    </>
  );
}
