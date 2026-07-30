"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { BulkUpload } from "@/components/shared/BulkUpload";
import {
  clasificarBulkSummary,
  type ClasificacionCarga,
} from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import {
  ORDENES_BULK_ACCEPT,
  ORDENES_BULK_FIELDS,
  ORDENES_BULK_TEMPLATE_NAME,
} from "@/app/(app)/ordenes/_components/carga-masiva-fields";
import {
  parseArchivo,
  ParseArchivoError,
  type FilaParseada,
} from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import {
  combinarResultados,
  dedupPorRemision,
  procesarEnChunks,
  ChunkRequestError,
} from "@/app/(app)/ordenes/_components/carga-masiva-chunks";
import { findMissingHeaders } from "@/lib/types/carga-masiva";
import { FORMATO_DIRECCION_DESTINATARIO } from "@/lib/utils/direccion-destinatario";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

export interface OrdenesCargaUploadResult {
  /** Clasificación agregada del dry-run (nada persistido aún). */
  clasificacion: ClasificacionCarga;
  /** Filas únicas (deduplicadas) para re-enviar al confirmar la carga real. */
  filasUnicas: FilaParseada[];
}

export interface OrdenesCargaUploadProps {
  /** Se invoca tras validar (dry-run) todos los lotes sin persistir. */
  onValidated: (result: OrdenesCargaUploadResult) => void;
}

type Status = "idle" | "validando" | "error";

/** Columna única de la plantilla v2 (feature 142). Su ausencia = plantilla vieja. */
const COLUMNA_DIRECCION = "direccion_destinatario";

/**
 * Mensaje de cabecera incompleta. Si lo que falta es `direccion_destinatario`, el
 * archivo es (casi siempre) de la plantilla ANTERIOR, que traía provincia/cantón/
 * distrito/dirección en columnas separadas: no hay modo de compatibilidad (D1),
 * así que se le dice explícitamente que descargue la plantilla nueva (R8).
 */
function mensajeCabeceraFaltante(faltantes: string[]): string {
  const base = `Faltan columnas obligatorias: ${faltantes.join(", ")}.`;
  return faltantes.includes(COLUMNA_DIRECCION)
    ? `${base} La plantilla cambió: descarga la plantilla nueva y vuelve a cargar tus datos.`
    : base;
}

function mensajeDeError(cause: unknown): string {
  if (cause instanceof ParseArchivoError) return cause.message;
  if (cause instanceof ChunkRequestError) {
    return `No se pudo validar el archivo (estado ${cause.status}).`;
  }
  return cause instanceof Error && cause.message
    ? `No se pudo validar el archivo: ${cause.message}`
    : "No se pudo validar el archivo.";
}

/**
 * Paso de subida de la carga masiva. Al elegir un archivo se VALIDA en el acto
 * (parseo en el navegador, comprobación de cabeceras y del tope de filas,
 * deduplicación por num_remisión y validación por LOTES en dry-run, sin
 * persistir). Muestra un loader mientras verifica y permite QUITAR el archivo
 * para elegir otro (o el mismo). El archivo nunca se sube entero: la selección
 * la aporta `BulkUpload` (shared) y el transporte por chunks vive aquí.
 */
export function OrdenesCargaUpload({ onValidated }: OrdenesCargaUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(
    null,
  );

  const validando = status === "validando";

  function handleQuitar() {
    setStatus("idle");
    setMessage(null);
    setProgreso(null);
  }

  function handleFileSelected(file: File) {
    setMessage(null);
    setProgreso(null);
    // Validación AUTOMÁTICA en cuanto se carga el archivo.
    void validar(file);
  }

  async function validar(file: File) {
    setStatus("validando");
    setMessage(null);
    setProgreso(null);

    try {
      const { headers, filas } = await parseArchivo(file);

      const faltantes = findMissingHeaders(headers);
      if (faltantes.length > 0) {
        setStatus("error");
        setMessage(mensajeCabeceraFaltante(faltantes));
        return;
      }
      if (filas.length === 0) {
        setStatus("error");
        setMessage("El archivo no tiene filas de datos.");
        return;
      }
      if (filas.length > cargaMasivaConfig.MAX_ROWS) {
        setStatus("error");
        setMessage(
          `El archivo tiene ${filas.length.toLocaleString()} filas y el máximo permitido es ${cargaMasivaConfig.MAX_ROWS.toLocaleString()}. Divídelo en archivos más pequeños.`,
        );
        return;
      }

      const { unicas, duplicadas } = dedupPorRemision(filas);
      const chunkResults = await procesarEnChunks(unicas, {
        dryRun: true,
        chunkSize: cargaMasivaConfig.CHUNK_SIZE,
        onProgress: (hechas, total) => setProgreso({ hechas, total }),
      });

      const combinado = combinarResultados(chunkResults, duplicadas);
      const clasificacion = clasificarBulkSummary(combinado);
      setStatus("idle");
      onValidated({ clasificacion, filasUnicas: unicas });
    } catch (cause) {
      setStatus("error");
      setMessage(mensajeDeError(cause));
    }
  }

  return (
    <BulkUpload
      accept={ORDENES_BULK_ACCEPT}
      fields={ORDENES_BULK_FIELDS}
      templateFileName={ORDENES_BULK_TEMPLATE_NAME}
      maxSizeBytes={cargaMasivaConfig.MAX_FILE_BYTES}
      // Este flujo históricamente valida SOLO por extensión: las hojas exportadas
      // por Excel/Sheets reportan MIMEs erráticos y rechazarlas cambiaría el
      // comportamiento actual del paso.
      validateMime={false}
      label="Archivo de órdenes"
      busy={validando}
      error={message}
      onFileSelected={handleFileSelected}
      onClear={handleQuitar}
      hint={
        <>
          La dirección va en una sola columna{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {COLUMNA_DIRECCION}
          </code>
          , con el formato {FORMATO_DIRECCION_DESTINATARIO}. Se valida en tu
          navegador (geografía y números de remisión duplicados) apenas lo
          cargues y se procesa por lotes. Máximo{" "}
          {cargaMasivaConfig.MAX_ROWS.toLocaleString()} filas.
        </>
      }
    >
      {validando ? (
        <span
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="animate-spin" aria-hidden="true" />
          {progreso
            ? `Validando ${progreso.hechas.toLocaleString()} / ${progreso.total.toLocaleString()} filas…`
            : "Validando archivo…"}
        </span>
      ) : null}
    </BulkUpload>
  );
}
