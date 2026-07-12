"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
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
import { listarMensajeros } from "@/lib/actions/mensajeros";
import type { MensajeroDTO } from "@/lib/types/asignacion-mensajero";

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
  // Mensajero sugerido opcional para todo el lote; se envía como
  // `mensajeroSugeridoId` junto al archivo si el usuario elige uno.
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
        // Silencioso: el mensajero sugerido es opcional; sin lista, el select
        // queda vacío y la carga sigue funcionando.
      });
    return () => {
      cancelled = true;
    };
  }, [open, mensajeros.length]);

  const mensajeroOptions: SelectOption[] = mensajeros.map((m) => ({
    value: m.id,
    label: m.nombre,
  }));

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
      setMensajeroSugeridoId("");
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
        // Ancho del 75% de la pantalla con un mínimo de 320px.
        className="w-[75vw] max-w-none min-w-[320px]"
      >
        {step === "upload" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="carga-mensajero-sugerido">
                Mensajero sugerido (opcional)
              </Label>
              <Select
                value={mensajeroSugeridoId}
                onValueChange={setMensajeroSugeridoId}
                options={mensajeroOptions}
                placeholder="Sin sugerir"
                disabled={mensajeroOptions.length === 0}
                aria-label="Mensajero sugerido para el lote"
              />
              <p className="text-sm text-muted-foreground">
                Puedes sugerir un mensajero para que se haga cargo de todos los
                pedidos de esta carga. Es opcional; si no eliges ninguno, las
                órdenes quedarán sin mensajero sugerido.
              </p>
            </div>
            <BulkUpload
              endpoint="/api/ordenes/carga-masiva"
              accept={["csv", "xlsx"]}
              fieldName="file"
              templateFileName="plantilla-ordenes-carga-masiva.xlsx"
              fields={ORDENES_BULK_FIELDS}
              extraFields={{ mensajeroSugeridoId }}
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
