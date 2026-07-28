"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Download, FileSpreadsheet, UploadCloud, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Feature 143: el MIME del XLSX vive junto a los constructores del binario, para
// que plantilla y export de errores compartan una única definición.
import { XLSX_MIME } from "@/lib/utils/xlsx-template";

/** Definición parametrizable de una columna de la plantilla (R1, R5, R6). */
export interface TemplateField {
  /** Clave/encabezado de la columna en la plantilla. Debe ser único. */
  key: string;
  /** Etiqueta de cabecera mostrada en el archivo. Por defecto = `key`. */
  label?: string;
  /** Valor de ejemplo opcional para la fila de muestra (R6). */
  example?: string;
  /**
   * Marca SEMÁNTICA de columna obligatoria. NO altera el texto de la cabecera de
   * la plantilla: el header SIEMPRE es la clave máquina (`label ?? key`) para
   * preservar el round-trip descargar→subir (el parser identifica las columnas
   * por esa clave exacta). La obligatoriedad se comunica en la UI —p. ej. el
   * `Alert` del botón de carga—, no en el header del archivo (feature 58).
   */
  required?: boolean;
}

/** Tipos de archivo admitidos para la SUBIDA (R3). */
export type UploadFileType = "csv" | "xlsx" | "xls";

export interface BulkUploadProps {
  /** Tipos de archivo permitidos (R3). Al menos uno. */
  accept: UploadFileType[];
  /**
   * Definición de columnas de la plantilla, en orden (R1, R5). Si va vacío, la
   * descarga de plantilla se deshabilita (R11).
   */
  fields?: TemplateField[];
  /** Nombre del archivo de plantilla descargado (R4). Por defecto "plantilla.xlsx". */
  templateFileName?: string;
  /**
   * Límite de tamaño en bytes validado en cliente (R23). Si se omite, NO se valida
   * tamaño en cliente; el backend sigue siendo la autoridad final.
   */
  maxSizeBytes?: number;
  /**
   * Valida además el MIME que reporta el navegador (R21/R22). Por defecto `true`.
   * Los consumidores que solo confían en la extensión (p. ej. hojas exportadas
   * con MIME errático) pueden desactivarlo sin perder la validación por extensión.
   */
  validateMime?: boolean;
  /** Etiqueta accesible del input. Por defecto "Archivo a cargar". */
  label?: string;
  /** Texto de ayuda bajo la zona de subida (i18n vía prop, no hardcode interno). */
  hint?: ReactNode;
  /** Deshabilita la interacción mientras el consumidor procesa el archivo. */
  busy?: boolean;
  /**
   * Error del CONSUMIDOR (p. ej. fallo de parseo/validación de dominio). Se
   * muestra solo si no hay un error local de selección, de modo que siempre haya
   * como mucho un `role="alert"`.
   */
  error?: string | null;
  /** Se invoca con el archivo ya validado (tipo y tamaño). El consumidor decide qué hacer con él. */
  onFileSelected: (file: File) => void;
  /** Se invoca al quitar el archivo elegido, para que el consumidor limpie su estado. */
  onClear?: () => void;
  /** Slot para estado del consumidor (progreso, loaders) bajo las acciones. */
  children?: ReactNode;
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

const DEFAULT_TEMPLATE_NAME = "plantilla.xlsx";
const DEFAULT_LABEL = "Archivo a cargar";

/** Extrae la extensión (en minúsculas, con punto) del nombre de archivo. */
function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

/** Formatea bytes a una unidad legible para los mensajes de tamaño. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Valida un archivo contra los tipos permitidos (D2 — R10, R21, R22) y el
 * tamaño máximo (R23). Devuelve un mensaje de error, o `null` si es válido.
 */
function validateFile(
  file: File,
  accept: UploadFileType[],
  maxSizeBytes: number | undefined,
  validateMime: boolean,
): string | null {
  const allowedExts = accept.map((t) => FILE_TYPE_MAP[t].ext);
  const ext = getExtension(file.name);

  // Capa 1: extensión (autoridad primaria, R10).
  if (!allowedExts.includes(ext)) {
    return `Tipo no permitido. Usa: ${allowedExts.join(", ")}.`;
  }

  // Capa 2: MIME (R21/R22). Solo si el consumidor lo pide y el navegador aporta uno no vacío.
  if (validateMime) {
    const mime = file.type?.trim();
    if (mime) {
      const allowedMimes = accept.flatMap((t) => FILE_TYPE_MAP[t].mimes);
      if (!allowedMimes.includes(mime)) {
        return "El contenido del archivo no coincide con el tipo permitido.";
      }
    }
  }

  // Tamaño (R23): solo si el consumidor fija un límite en cliente.
  if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
    return `El archivo excede el tamaño máximo permitido (${formatBytes(maxSizeBytes)}).`;
  }

  return null;
}

/**
 * Selector de archivo reutilizable para flujos de carga masiva (UI pura). Ofrece
 * una zona de subida (click, teclado o arrastrar/soltar), validación de tipo y
 * tamaño en cliente, y la descarga de una plantilla XLSX parametrizada por
 * `fields`.
 *
 * NO decide qué se hace con el archivo: lo entrega por `onFileSelected` y el
 * consumidor elige (parsear en el navegador, enviar por chunks, subirlo entero…).
 * Esto es deliberado — los flujos de carga difieren demasiado entre sí como para
 * fijar el transporte aquí.
 */
export function BulkUpload({
  accept,
  fields = [],
  templateFileName,
  maxSizeBytes,
  validateMime = true,
  label,
  hint,
  busy = false,
  error,
  onFileSelected,
  onClear,
  children,
}: BulkUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reactId = useId();
  const inputId = `${reactId}-input`;
  const hintId = `${reactId}-hint`;

  const acceptAttr = useMemo(
    () => accept.map((t) => FILE_TYPE_MAP[t].ext).join(","),
    [accept],
  );

  const fieldLabel = label ?? DEFAULT_LABEL;
  const canDownloadTemplate = fields.length > 0 && !busy && !isGeneratingTemplate;
  // Un único alert: el error local de selección tiene prioridad sobre el del consumidor.
  const shownError = localError ?? error ?? null;

  async function handleDownloadTemplate() {
    // R10/R11: no re-dispara si no hay campos o ya hay una generación en curso.
    if (fields.length === 0 || isGeneratingTemplate) return;
    setIsGeneratingTemplate(true);
    try {
      // Import dinámico (R6b): exceljs queda fuera del bundle inicial del componente.
      const { buildXlsxTemplate } = await import("@/lib/utils/xlsx-template");
      const buffer = await buildXlsxTemplate(fields);
      const blob = new Blob([buffer], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = templateFileName ?? DEFAULT_TEMPLATE_NAME;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      // Se restablece pase lo que pase; un fallo de build burbujea a la consola.
      setIsGeneratingTemplate(false);
    }
  }

  /** Libera el value del input para poder re-seleccionar el MISMO archivo. */
  function limpiarInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFile(selected: File) {
    const invalid = validateFile(selected, accept, maxSizeBytes, validateMime);
    if (invalid) {
      // Archivo inválido: no se guarda ni se emite; se muestra el error (R10, R21, R23).
      setFileName(null);
      setLocalError(invalid);
      return;
    }
    setFileName(selected.name);
    setLocalError(null);
    onFileSelected(selected);
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    limpiarInput();
    if (!selected) return;
    handleFile(selected);
  }

  function handleClear() {
    if (busy) return;
    setFileName(null);
    setLocalError(null);
    limpiarInput();
    onClear?.();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) handleFile(dropped);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!busy) setIsDragging(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* El click en la zona es un atajo de ratón; la operación por teclado y por
          lector de pantalla la sigue proveyendo el <input type="file"> real, que
          permanece en el árbol (sr-only, enfocable) y NO se sustituye. */}
      <div
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          "has-[input:focus-visible]:border-brand has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-brand/30",
          isDragging
            ? "border-brand bg-brand-soft"
            : "border-border bg-muted/30 hover:border-brand/60 hover:bg-brand-soft/40",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {/* Label sr-only: da al input un nombre accesible ESTABLE en ambos estados
            (vacío y con archivo), del que dependen consumidores y tests. */}
        <label htmlFor={inputId} className="sr-only">
          {fieldLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={acceptAttr}
          onChange={handleSelect}
          disabled={busy}
          // El texto de ayuda solo existe en el estado vacío: no se referencia
          // un id inexistente cuando ya hay archivo elegido.
          aria-describedby={fileName ? undefined : hintId}
          className="sr-only"
        />

        {fileName ? (
          <>
            <FileSpreadsheet className="size-8 text-brand" aria-hidden="true" />
            <p className="text-sm font-medium break-all text-foreground">
              {fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              Haz clic o arrastra otro archivo para reemplazarlo
            </p>
          </>
        ) : (
          <>
            <UploadCloud className="size-8 text-brand" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{fieldLabel}</p>
            <p id={hintId} className="text-xs text-muted-foreground">
              Arrastra el archivo aquí o haz clic para elegirlo ({acceptAttr})
              {maxSizeBytes !== undefined
                ? ` · hasta ${formatBytes(maxSizeBytes)}`
                : null}
            </p>
          </>
        )}
      </div>

      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="brand-outline"
          onClick={handleDownloadTemplate}
          disabled={!canDownloadTemplate}
          loading={isGeneratingTemplate}
        >
          {isGeneratingTemplate ? null : <Download aria-hidden="true" />}
          Descargar plantilla
        </Button>
        {fileName ? (
          <Button
            type="button"
            variant="brand-outline"
            onClick={handleClear}
            disabled={busy}
            aria-label="Quitar archivo"
            title="Quitar archivo"
          >
            <X aria-hidden="true" />
            Quitar archivo
          </Button>
        ) : null}
        {children}
      </div>

      {shownError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
