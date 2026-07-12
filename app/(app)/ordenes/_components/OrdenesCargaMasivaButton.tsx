"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Modal } from "@/components/shared/Modal";
import {
  BulkUpload,
  type BulkUploadError,
  type BulkUploadResult,
  type TemplateField,
} from "@/components/shared/BulkUpload";
import { OrdenesCargaResumenPaso } from "@/app/(app)/ordenes/_components/OrdenesCargaResumenPaso";
import {
  clasificarBulkSummary,
  type ClasificacionCarga,
} from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { useToast } from "@/hooks/useToast";

export const ORDENES_BULK_FIELDS: TemplateField[] = [
  { key: "num_remision", example: "REM-0001" },
  { key: "destinatario", example: "Juan Pérez" },
  { key: "telefono", example: "0999999999" },
  { key: "provincia", example: "Pichincha" },
  { key: "canton", example: "Quito" },
  { key: "distrito", example: "Iñaquito" },
  { key: "direccion", example: "Av. Amazonas N34-451" },
  { key: "producto", example: "Camiseta talla M" },
  { key: "notas", example: "Entregar en la tarde" },
  { key: "monto_cobrar", example: "25.90" },
  { key: "mensajero_sugerido_id", example: "" },
];

interface ResumenCarga {
  creadas: number;
  duplicadas: number;
  conError: number;
}

/**
 * Guard defensivo sobre `result.data` (llega `unknown` desde `BulkUpload`).
 * Devuelve el resumen solo si tiene la forma esperada con conteos numéricos
 * (D5); si no, `null` para caer al mensaje/variante genérica (R15).
 */
function parseResumen(data: unknown): ResumenCarga | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const { creadas, duplicadas, conError } = record;
  if (
    typeof creadas === "number" &&
    typeof duplicadas === "number" &&
    typeof conError === "number"
  ) {
    return { creadas, duplicadas, conError };
  }
  return null;
}

/** Paso mostrado en el cuerpo del modal (R21, [RESUELTO-6]). */
type Step = "upload" | "resumen";

/**
 * Wrapper de cliente que compone el botón "Carga masiva", el `Modal`
 * contenedor y, según el paso, el `BulkUpload` genérico (feature 14) o el
 * resumen de asignación de mensajero (feature 16, R21). Pura composición: no
 * reimplementa accesibilidad ni lógica de subida (R18, R19).
 */
export function OrdenesCargaMasivaButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [clasificacion, setClasificacion] = useState<ClasificacionCarga>({
    numRemisionesNuevas: [],
    existentes: [],
    errores: [],
  });
  const { mutate } = useSWRConfig();
  const toast = useToast();

  function handleSuccess(result: BulkUploadResult) {
    const resumen = parseResumen(result.data);

    // R13: revalida todas las páginas cacheadas de la lista de órdenes sin
    // acoplarse a page/pageSize actuales.
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:list",
      undefined,
      { revalidate: true },
    );

    const message = resumen
      ? `Carga: ${resumen.creadas} creadas, ${resumen.duplicadas} duplicadas, ${resumen.conError} con error`
      : "Carga procesada";

    // R14/R15: warning si hay errores o el resumen no es parseable; success en otro caso.
    if (!resumen || resumen.conError > 0) {
      toast.warning(message);
    } else {
      toast.success(message);
    }

    // R1/R11/R12/R18: clasifica las filas del BulkSummary y avanza al resumen si
    // hay algo que mostrar (nuevas O existentes O errores). Con los tres grupos
    // vacíos (p. ej. `filas: []`) se conserva el comportamiento de feature 14
    // (solo toast, sigue en "upload").
    const clasif = clasificarBulkSummary(result.data);
    setClasificacion(clasif);

    if (
      clasif.numRemisionesNuevas.length > 0 ||
      clasif.existentes.length > 0 ||
      clasif.errores.length > 0
    ) {
      setStep("resumen");
    }

    // R17: no se cierra el modal automáticamente tras el éxito.
  }

  function handleError(error: BulkUploadError) {
    toast.error(`No se pudo cargar el archivo: ${error.message}`);
    // R16: no se refresca la lista ante un fallo.
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // El siguiente uso del modal vuelve a arrancar en el paso de subida.
      setStep("upload");
      setClasificacion({
        numRemisionesNuevas: [],
        existentes: [],
        errores: [],
      });
    }
  }

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
      >
        {step === "upload" ? (
          <div className="flex flex-col gap-4">
            {/*
              Aviso del acoplamiento distrito↔zona (feature 24, R4/R11): se
              comunica ANTES de cargar para que el usuario lo anticipe, en vez de
              enterarse solo por el error fila a fila (feature 51).
            */}
            <Alert>
              <Info aria-hidden="true" />
              <AlertTitle>El distrito es obligatorio</AlertTitle>
              <AlertDescription>
                Cada orden debe indicar un distrito, y ese distrito debe tener
                una zona asignada. Si el distrito falta o no tiene zona, esa fila
                se rechazará al cargar.
              </AlertDescription>
            </Alert>
            <BulkUpload
              endpoint="/api/ordenes/carga-masiva"
              accept={["csv", "xlsx"]}
              fieldName="file"
              templateFileName="plantilla-ordenes-carga-masiva.xlsx"
              fields={ORDENES_BULK_FIELDS}
              onSuccess={handleSuccess}
              onError={handleError}
              label="Archivo de órdenes"
            />
          </div>
        ) : (
          <OrdenesCargaResumenPaso clasificacion={clasificacion} />
        )}
      </Modal>
    </>
  );
}
