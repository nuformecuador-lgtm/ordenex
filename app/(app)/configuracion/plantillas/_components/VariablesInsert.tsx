"use client";

import { useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { PLANTILLA_VARIABLES } from "@/lib/types/plantilla-variables";
import { previewPlantilla } from "@/lib/actions/plantillas";
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
 * Botonera de campos variables (feature 107/R17) + panel de vista previa (R18).
 * Lee el catálogo ABIERTO `PLANTILLA_VARIABLES` (agregar una variable es agregar
 * una fila, sin tocar este componente) y, al pulsar, inserta `{{clave}}` en la
 * posición del cursor del textarea. La vista previa llama a `previewPlantilla` y
 * muestra el cuerpo con los valores de ejemplo del catálogo.
 */
export function VariablesInsert({
  textareaRef,
  value,
  onInsert,
  previewAction = previewPlantilla,
}: VariablesInsertProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleInsert(key: string) {
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
        <span className="text-sm font-medium">Insertar variable</span>
        <div className="flex flex-wrap gap-2">
          {PLANTILLA_VARIABLES.map((variable) => (
            <Button
              key={variable.key}
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Insertar {{${variable.key}}}`}
              title={`{{${variable.key}}}`}
              onClick={() => handleInsert(variable.key)}
            >
              {variable.label}
            </Button>
          ))}
        </div>
      </div>

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
