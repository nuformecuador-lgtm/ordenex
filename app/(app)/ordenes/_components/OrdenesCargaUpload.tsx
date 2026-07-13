"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Download, Loader2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  extensionDe,
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
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
 * para elegir otro (o el mismo). El archivo nunca se sube entero.
 */
export function OrdenesCargaUpload({ onValidated }: OrdenesCargaUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [generando, setGenerando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validando = status === "validando";
  const acceptAttr = ORDENES_BULK_ACCEPT.map((t) => `.${t}`).join(",");

  async function handleDescargarPlantilla() {
    if (generando) return;
    setGenerando(true);
    try {
      const { buildXlsxTemplate } = await import("@/lib/utils/xlsx-template");
      const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
      const blob = new Blob([buffer], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ORDENES_BULK_TEMPLATE_NAME;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setGenerando(false);
    }
  }

  function limpiarInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleQuitar() {
    if (validando) return;
    setFileName(null);
    setStatus("idle");
    setMessage(null);
    setProgreso(null);
    limpiarInput();
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    // Se libera el value del input para poder re-seleccionar el MISMO archivo.
    limpiarInput();
    setProgreso(null);

    if (!selected) return;

    const ext = extensionDe(selected.name);
    if (!ORDENES_BULK_ACCEPT.includes(ext as (typeof ORDENES_BULK_ACCEPT)[number])) {
      setFileName(null);
      setStatus("error");
      setMessage(`Tipo no permitido. Usa: ${acceptAttr}.`);
      return;
    }
    if (selected.size > cargaMasivaConfig.MAX_FILE_BYTES) {
      setFileName(null);
      setStatus("error");
      setMessage("El archivo excede el tamaño máximo permitido.");
      return;
    }

    setFileName(selected.name);
    setMessage(null);
    // Validación AUTOMÁTICA en cuanto se carga el archivo.
    void validar(selected);
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
        setMessage(`Faltan columnas obligatorias: ${faltantes.join(", ")}.`);
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
        mensajeroSugeridoId: "", // el mensajero se aplica en la carga real
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="carga-archivo">Archivo de órdenes</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            id="carga-archivo"
            type="file"
            accept={acceptAttr}
            onChange={handleSelect}
            disabled={validando}
            className="flex-1"
          />
          {fileName ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleQuitar}
              disabled={validando}
              aria-label="Quitar archivo"
              title="Quitar archivo"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {fileName ? (
          <p className="text-sm text-muted-foreground">{fileName}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Se valida en tu navegador (geografía y números de remisión duplicados)
          apenas lo cargues y se procesa por lotes. Máximo{" "}
          {cargaMasivaConfig.MAX_ROWS.toLocaleString()} filas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleDescargarPlantilla}
          disabled={generando || validando}
        >
          <Download aria-hidden="true" />
          Descargar plantilla
        </Button>
        {validando ? (
          <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" aria-hidden="true" />
            {progreso
              ? `Validando ${progreso.hechas.toLocaleString()} / ${progreso.total.toLocaleString()} filas…`
              : "Validando archivo…"}
          </span>
        ) : null}
      </div>

      {message ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
