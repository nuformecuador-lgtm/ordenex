"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import {
  BulkUpload,
  type BulkUploadError,
  type BulkUploadResult,
  type TemplateField,
} from "@/components/shared/BulkUpload";
import { useToast } from "@/hooks/useToast";

/**
 * Columnas del contrato de entrada del endpoint de carga masiva de órdenes
 * (feature 15), en orden (R11, design.md D3).
 */
const ORDENES_BULK_FIELDS: TemplateField[] = [
  { key: "num_remision", label: "Nº Remisión", example: "REM-0001" },
  { key: "destinatario", label: "Destinatario", example: "Juan Pérez" },
  { key: "telefono", label: "Teléfono", example: "0999999999" },
  { key: "provincia", label: "Provincia", example: "Pichincha" },
  { key: "canton", label: "Cantón", example: "Quito" },
  { key: "distrito", label: "Distrito", example: "Iñaquito" },
  { key: "direccion", label: "Dirección", example: "Av. Amazonas N34-451" },
  { key: "producto", label: "Producto", example: "Camiseta talla M" },
  { key: "notas", label: "Notas", example: "Entregar en la tarde" },
  { key: "monto_cobrar", label: "Monto a cobrar", example: "25.90" },
  {
    key: "mensajero_sugerido_id",
    label: "Mensajero sugerido",
    example: "",
  },
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

/**
 * Wrapper de cliente que compone el botón "Carga masiva", el `Modal`
 * contenedor y el `BulkUpload` genérico apuntando al endpoint de órdenes
 * (feature 14). Pura composición: no reimplementa accesibilidad ni lógica de
 * subida (R18, R19).
 */
export function OrdenesCargaMasivaButton() {
  const [open, setOpen] = useState(false);
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

    // R17: no se cierra el modal automáticamente tras el éxito.
  }

  function handleError(error: BulkUploadError) {
    toast.error(`No se pudo cargar el archivo: ${error.message}`);
    // R16: no se refresca la lista ante un fallo.
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Carga masiva
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Carga masiva de órdenes"
        hideCancel
        confirmLabel="Cerrar"
      >
        <BulkUpload
          endpoint="/api/ordenes/carga-masiva"
          accept={["csv", "xlsx"]}
          fieldName="file"
          templateFileName="plantilla-ordenes-carga-masiva.csv"
          fields={ORDENES_BULK_FIELDS}
          onSuccess={handleSuccess}
          onError={handleError}
          label="Archivo de órdenes"
        />
      </Modal>
    </>
  );
}
