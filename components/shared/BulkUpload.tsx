"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Download, Loader2, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { buildCsvTemplate } from "@/lib/utils/csv-template";

/** Definición parametrizable de una columna de la plantilla (R1, R5, R6). */
export interface TemplateField {
  /** Clave/encabezado de la columna en la plantilla. Debe ser único. */
  key: string;
  /** Etiqueta de cabecera mostrada en el archivo. Por defecto = `key`. */
  label?: string;
  /** Valor de ejemplo opcional para la fila de muestra (R6). */
  example?: string;
}

/** Tipos de archivo admitidos para la SUBIDA (R3). */
export type UploadFileType = "csv" | "xlsx" | "xls";

export interface BulkUploadResult {
  /** Cuerpo ya parseado de la respuesta del endpoint, si lo hubo. */
  data?: unknown;
  /** Código HTTP devuelto por el endpoint. */
  status: number;
}

export interface BulkUploadError {
  /** Mensaje legible del fallo (validación, red o HTTP no exitoso). */
  message: string;
  /** Código HTTP si el fallo provino de una respuesta del servidor. */
  status?: number;
}

export interface BulkUploadProps {
  /** Ruta de la API destino del POST multipart (R2). Sin ella, la subida se deshabilita (R19). */
  endpoint?: string;
  /** Tipos de archivo permitidos para subir (R3). Al menos uno. */
  accept: UploadFileType[];
  /** Definición de columnas de la plantilla, en orden (R1, R5). */
  fields: TemplateField[];
  /** Nombre del archivo de plantilla descargado (R4). Por defecto "plantilla.csv". */
  templateFileName?: string;
  /** Nombre del campo multipart bajo el que viaja el archivo (R12). Por defecto "file". */
  fieldName?: string;
  /**
   * Límite de tamaño en bytes validado en cliente (R23). Si se omite, NO se valida
   * tamaño en cliente; el backend sigue siendo la autoridad final.
   */
  maxSizeBytes?: number;
  /** Callback tras subida exitosa (R14). */
  onSuccess?: (result: BulkUploadResult) => void;
  /** Callback tras fallo de subida (R15). */
  onError?: (error: BulkUploadError) => void;
  /** Texto accesible/título opcional del bloque. */
  label?: string;
}

/**
 * Mapa de tipo de archivo → extensión y MIME(s) aceptados (D2). La extensión es
 * la autoridad primaria; el MIME solo se comprueba cuando el navegador lo aporta.
 */
const FILE_TYPE_MAP: Record<UploadFileType, { ext: string; mimes: string[] }> = {
  csv: {
    ext: ".csv",
    mimes: ["text/csv", "application/vnd.ms-excel", "application/csv"],
  },
  xlsx: {
    ext: ".xlsx",
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  xls: { ext: ".xls", mimes: ["application/vnd.ms-excel"] },
};

const DEFAULT_TEMPLATE_NAME = "plantilla.csv";
const DEFAULT_FIELD_NAME = "file";

type UploadStatus = "idle" | "selected" | "uploading" | "success" | "error";

/** Extrae la extensión (en minúsculas, con punto) del nombre de archivo. */
function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

/**
 * Valida un archivo contra los tipos permitidos (D2 — R10, R21, R22) y el
 * tamaño máximo (R23). Devuelve un mensaje de error, o `null` si es válido.
 */
function validateFile(
  file: File,
  accept: UploadFileType[],
  maxSizeBytes: number | undefined,
): string | null {
  const allowedExts = accept.map((t) => FILE_TYPE_MAP[t].ext);
  const ext = getExtension(file.name);

  // Capa 1: extensión (autoridad primaria, R10).
  if (!allowedExts.includes(ext)) {
    return `Tipo de archivo no permitido. Formatos aceptados: ${allowedExts.join(", ")}.`;
  }

  // Capa 2: MIME (R21/R22). Solo se valida si el navegador aporta uno no vacío.
  const mime = file.type?.trim();
  if (mime) {
    const allowedMimes = accept.flatMap((t) => FILE_TYPE_MAP[t].mimes);
    if (!allowedMimes.includes(mime)) {
      return "El contenido del archivo no coincide con el tipo permitido.";
    }
  }

  // Tamaño (R23): solo si el consumidor fija un límite en cliente.
  if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
    return `El archivo excede el tamaño máximo permitido (${maxSizeBytes} bytes).`;
  }

  return null;
}

/**
 * Componente genérico y reutilizable de carga masiva (UI pura). Ofrece dos
 * acciones: descargar una plantilla CSV parametrizada por `fields` y subir un
 * archivo por `POST` multipart al `endpoint`. No conoce el dominio ni el destino.
 */
export function BulkUpload({
  endpoint,
  accept,
  fields,
  templateFileName,
  fieldName = DEFAULT_FIELD_NAME,
  maxSizeBytes,
  onSuccess,
  onError,
  label,
}: BulkUploadProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptAttr = useMemo(
    () => accept.map((t) => FILE_TYPE_MAP[t].ext).join(","),
    [accept],
  );

  const isUploading = status === "uploading";
  const canDownloadTemplate = fields.length > 0 && !isUploading;
  const hasValidFile = file !== null && (status === "selected" || status === "error" || status === "success");
  const canUpload = hasValidFile && Boolean(endpoint) && !isUploading;

  function handleDownloadTemplate() {
    if (fields.length === 0) return;
    const csv = buildCsvTemplate(fields);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = templateFileName ?? DEFAULT_TEMPLATE_NAME;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      setStatus("idle");
      setMessage(null);
      return;
    }

    const error = validateFile(selected, accept, maxSizeBytes);
    if (error) {
      // Archivo inválido: no se guarda, se muestra error y no se habilita envío
      // (R10, R21, R23). El estado vuelve a idle para mantener la subida bloqueada.
      setFile(null);
      setStatus("idle");
      setMessage(error);
      return;
    }

    // Archivo válido: se muestra el nombre y se limpia cualquier mensaje previo
    // para permitir reintento tras un fallo anterior (R9, R16, R22).
    setFile(selected);
    setStatus("selected");
    setMessage(null);
  }

  async function handleUpload() {
    if (!endpoint || !file) return;

    setStatus("uploading");
    setMessage(null);

    const formData = new FormData();
    formData.append(fieldName, file);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error: BulkUploadError = {
          message: `La carga falló con estado ${response.status}.`,
          status: response.status,
        };
        setStatus("error");
        setMessage(error.message);
        onError?.(error);
        return;
      }

      const data = await response.json().catch(() => undefined);
      setStatus("success");
      setMessage("Archivo cargado correctamente.");
      onSuccess?.({ status: response.status, data });
    } catch (cause) {
      // Fallo de red: se envuelve con contexto y se notifica, sin propagar (R15).
      const error: BulkUploadError = {
        message:
          cause instanceof Error
            ? `No se pudo enviar el archivo: ${cause.message}`
            : "No se pudo enviar el archivo por un error de red.",
      };
      setStatus("error");
      setMessage(error.message);
      onError?.(error);
    }
  }

  const inputId = "bulk-upload-input";

  return (
    <div
      className="flex flex-col gap-3"
      aria-label={label}
      role={label ? "group" : undefined}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{label ?? "Archivo a cargar"}</Label>
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={acceptAttr}
          onChange={handleSelect}
          disabled={isUploading}
        />
        {file ? (
          <p className="text-sm text-muted-foreground">{file.name}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadTemplate}
          disabled={!canDownloadTemplate}
        >
          <Download aria-hidden="true" />
          Descargar plantilla
        </Button>
        <Button
          type="button"
          onClick={handleUpload}
          disabled={!canUpload}
        >
          <Upload aria-hidden="true" />
          Cargar archivo
        </Button>
      </div>

      {isUploading ? (
        <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" aria-hidden="true" />
          Cargando…
        </span>
      ) : null}

      {status === "success" && message ? (
        <Alert role="status" className={cn("border-transparent")}>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {status !== "success" && status !== "uploading" && message ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
