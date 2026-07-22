"use client";

import { useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLANTILLA_VARIABLES } from "@/lib/types/plantilla-variables";
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
 * de vista previa (R18). El catálogo `PLANTILLA_VARIABLES` está VACÍO por defecto: el
 * usuario DEFINE sus propias variables. Escribe la clave en el input, la valida
 * (`[a-z0-9_]+`) y al pulsar "Insertar variable" (o Enter) la coloca como `{{clave}}`
 * en la posición del cursor del textarea, tantas veces como necesite (0 o más). Si el
 * catálogo tuviera sugerencias en el futuro, se muestran como accesos rápidos. Las
 * variables ya presentes en el cuerpo se ofrecen como chips para re-insertarlas. La
 * vista previa llama a `previewPlantilla` (cada clave sin ejemplo se ve en MAYÚSCULAS).
 */
export function VariablesInsert({
  textareaRef,
  value,
  onInsert,
  previewAction = previewPlantilla,
}: VariablesInsertProps) {
  const [clave, setClave] = useState("");
  const [claveError, setClaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Variables ya presentes en el cuerpo, para re-insertarlas como accesos rápidos. */
  const variablesEnCuerpo = extraerVariables(value);

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

  function handleInsertDesdeInput() {
    const key = normalizarClave(clave);
    if (key === null) {
      setClaveError(
        "La clave solo admite minúsculas, números y guion bajo (a-z, 0-9, _).",
      );
      return;
    }
    setClaveError(null);
    insertarClave(key);
    setClave("");
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
          Insertar variable
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
                handleInsertDesdeInput();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleInsertDesdeInput}
          >
            Insertar variable
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

      {PLANTILLA_VARIABLES.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Sugerencias</span>
          <div className="flex flex-wrap gap-2">
            {PLANTILLA_VARIABLES.map((variable) => (
              <Button
                key={variable.key}
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Insertar {{${variable.key}}}`}
                title={`{{${variable.key}}}`}
                onClick={() => insertarClave(variable.key)}
              >
                {variable.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {variablesEnCuerpo.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Variables en el cuerpo</span>
          <div className="flex flex-wrap gap-2">
            {variablesEnCuerpo.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Insertar {{${key}}}`}
                title={`{{${key}}}`}
                onClick={() => insertarClave(key)}
              >
                {`{{${key}}}`}
              </Button>
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
