"use client";

import { useState, type RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { previewPlantilla } from "@/lib/actions/plantillas";
import { extraerVariables } from "@/lib/utils/plantilla-mensaje";
import type { PreviewPlantillaResult } from "@/lib/types/plantilla-mensaje";

/**
 * Inserta `{{key}}` en el rango `[start, end)` del cuerpo (R17). Helper PURO para
 * poder testear la lógica de inserción sin DOM. Devuelve el nuevo cuerpo y la
 * posición del cursor tras el placeholder insertado.
 */
export function insertarPlaceholder(
  cuerpo: string,
  start: number,
  end: number,
  key: string,
): { cuerpo: string; caret: number } {
  const token = `{{${key}}}`;
  const next = cuerpo.slice(0, start) + token + cuerpo.slice(end);
  return { cuerpo: next, caret: start + token.length };
}

/** Formato válido de una clave de variable (R14/R17): `[a-z0-9_]+`. */
const CLAVE_VALIDA_RE = /^[a-z0-9_]+$/;

/**
 * Normaliza la clave escrita por el usuario (trim + minúsculas) y valida su forma.
 * Devuelve la clave normalizada si es válida, o `null` si está vacía o tiene
 * caracteres fuera de `[a-z0-9_]`.
 */
export function normalizarClave(entrada: string): string | null {
  const clave = entrada.trim().toLowerCase();
  if (clave.length === 0 || !CLAVE_VALIDA_RE.test(clave)) return null;
  return clave;
}

export interface VariablesInsertProps {
  /** Ref al `<textarea>` del cuerpo, para leer la posición del cursor (R17). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Cuerpo actual (fuente de verdad en el formulario anfitrión). */
  value: string;
  /** Emite el nuevo cuerpo tras insertar una variable, con la posición del cursor. */
  onInsert: (next: string, caret: number) => void;
  /**
   * Server Action de vista previa. Inyectable para test (R18); por defecto usa la
   * acción real `previewPlantilla`.
   */
  previewAction?: (cuerpo: string) => Promise<PreviewPlantillaResult>;
}

/**
 * Editor de campos variables (feature 107/R17, Corrección humana 2026-07-22) + panel
 * de vista previa (R18). El usuario DEFINE sus propias variables: escribe la clave en
 * un input dedicado, la valida (`[a-z0-9_]+`) y al pulsar "Añadir" (o Enter) la agrega
 * a una LISTA de badges removibles (NO inserta en el cuerpo al añadir). Al hacer clic
 * en el cuerpo de un badge se inserta `{{clave}}` en la posición del cursor del
 * textarea, tantas veces como necesite (0 o más). Cada badge trae una "x" que lo quita
 * de la lista sin tocar el cuerpo. La lista se siembra con las variables ya presentes
 * en el cuerpo al montar, de modo que al EDITAR una plantilla existente aparezcan como
 * badges. La vista previa llama a `previewPlantilla` (cada clave sin ejemplo se ve en
 * MAYÚSCULAS).
 */
export function VariablesInsert({
  textareaRef,
  value,
  onInsert,
  previewAction = previewPlantilla,
}: VariablesInsertProps) {
  const [clave, setClave] = useState("");
  const [claveError, setClaveError] = useState<string | null>(null);
  // Semilla inicial: las variables ya presentes en el cuerpo al montar (R17/edición).
  const [variables, setVariables] = useState<string[]>(() =>
    extraerVariables(value),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function insertarClave(key: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const { cuerpo, caret } = insertarPlaceholder(value, start, end, key);
    onInsert(cuerpo, caret);
    // Restaura foco y cursor tras la inserción para seguir escribiendo.
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    }
  }

  function handleAnadirVariable() {
    const key = normalizarClave(clave);
    if (key === null) {
      setClaveError(
        "La clave solo admite minúsculas, números y guion bajo (a-z, 0-9, _).",
      );
      return;
    }
    setClaveError(null);
    setClave("");
    // No añade duplicados; el resto de la clave ya normalizada se agrega a la lista.
    setVariables((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function quitarVariable(key: string) {
    setVariables((prev) => prev.filter((k) => k !== key));
  }

  async function handlePreview() {
    setLoading(true);
    setPreviewError(null);
    const res = await previewAction(value);
    setLoading(false);
    if (res.status === "ok") {
      setPreview(res.texto);
    } else {
      setPreview(null);
      setPreviewError(
        res.status === "validation_error"
          ? "Corrige el cuerpo antes de ver la vista previa."
          : "No se pudo generar la vista previa.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium" id="variable-clave-label">
          Nueva variable
        </span>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            aria-labelledby="variable-clave-label"
            aria-describedby={claveError ? "variable-clave-error" : undefined}
            aria-invalid={claveError ? true : undefined}
            placeholder="p. ej. nombre_cliente"
            className="max-w-xs"
            value={clave}
            onChange={(e) => {
              setClave(e.target.value);
              if (claveError) setClaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAnadirVariable();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAnadirVariable}
          >
            Añadir
          </Button>
        </div>
        {claveError ? (
          <p
            id="variable-clave-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {claveError}
          </p>
        ) : null}
      </div>

      {variables.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Variables</span>
          <div className="flex flex-wrap gap-2">
            {variables.map((key) => (
              <Badge key={key} variant="secondary" className="gap-0.5 pr-0.5">
                <button
                  type="button"
                  aria-label={`Insertar {{${key}}}`}
                  title={`Insertar {{${key}}}`}
                  className="cursor-pointer rounded-sm px-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => insertarClave(key)}
                >
                  {`{{${key}}}`}
                </button>
                <button
                  type="button"
                  aria-label={`Quitar variable ${key}`}
                  title={`Quitar variable ${key}`}
                  className="grid size-4 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    quitarVariable(key);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          loading={loading}
          onClick={handlePreview}
        >
          Vista previa
        </Button>
        {previewError ? (
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
        ) : null}
        {preview !== null ? (
          <pre
            data-testid="plantilla-preview"
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap"
          >
            {preview}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
