"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { previewPlantilla } from "@/lib/actions/plantillas";
import {
  clavesSinCampo,
  etiquetaDeVariable,
  extraerVariables,
} from "@/lib/utils/plantilla-mensaje";
import type { PreviewPlantillaResult } from "@/lib/types/plantilla-mensaje";

import { CampoVariablePicker } from "./CampoVariablePicker";

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

/** Objeto vacío estable a nivel de módulo: evita crear una referencia nueva por render
 * cuando el llamador no pasa `variablesNombres`, lo que invalidaría dependencias de
 * `useEffect`/`useMemo` corriente abajo. */
const SIN_NOMBRES: Record<string, string> = {};

/** Ventana de debounce del panel «Así lo verá el cliente» (design §5.2). Exportada para
 * que los tests avancen el temporizador con el mismo valor, sin duplicar el número. */
export const PREVIEW_DEBOUNCE_MS = 300;

export interface VariablesInsertProps {
  /** Ref al `<textarea>` del cuerpo, para leer la posición del cursor (R7/R17). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Cuerpo actual (fuente de verdad en el formulario anfitrión). */
  value: string;
  /** Emite el nuevo cuerpo tras insertar una variable, con la posición del cursor. */
  onInsert: (next: string, caret: number) => void;
  /**
   * Server Action de vista previa. Inyectable para test; por defecto usa la acción
   * real `previewPlantilla`. CONSERVAR este valor por defecto: es el uso por
   * referencia que `tests/unit/guards/superficie-de-uso.guardia.test.ts` tiene
   * calibrado como control positivo (design §5.2).
   */
  previewAction?: (cuerpo: string) => Promise<PreviewPlantillaResult>;
  /**
   * Snapshot persistido `clave -> nombre` tomado del catálogo en el último guardado
   * (`variables_nombres` de la plantilla). `{}` para una plantilla nueva o para las
   * filas anteriores a la feature 282 (design §2/§4.2). Alimenta `etiquetaDeVariable`
   * y `clavesSinCampo` para distinguir «retirada del catálogo» de «nunca fue válida».
   */
  variablesNombres?: Record<string, string>;
}

/**
 * Selector de campos del catálogo (feature 282) + panel de vista previa con datos de
 * ejemplo. El maestro ya NO define claves libres: elige un campo del catálogo con
 * `CampoVariablePicker`, que inserta `{{clave}}` en la posición del cursor del
 * textarea (R7). Debajo, el panel «Así lo verá el cliente» (§5.2) llama a
 * `previewAction` con debounce de 300 ms y descarta respuestas fuera de orden; la
 * línea de campos usados (§5.3) resume `extraerVariables(value)` con su etiqueta y
 * sigue siendo clicable para reinsertar; y los avisos de `clavesSinCampo` (§5.4)
 * señalan —sin bloquear— las claves que no se van a reemplazar y llegarían vacías al
 * cliente. El `<textarea>` del cuerpo sigue siendo la única fuente de verdad (R18).
 */
export function VariablesInsert({
  textareaRef,
  value,
  onInsert,
  previewAction = previewPlantilla,
  variablesNombres = SIN_NOMBRES,
}: VariablesInsertProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Cuerpo de la última petición LANZADA: si la respuesta llega y el cuerpo actual ya
  // cambió, se descarta (§5.2, respuestas fuera de orden).
  const cuerpoSolicitadoRef = useRef<string | null>(null);

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

  useEffect(() => {
    const cuerpoAlProgramar = value;
    const timer = setTimeout(() => {
      cuerpoSolicitadoRef.current = cuerpoAlProgramar;
      void previewAction(cuerpoAlProgramar).then((res) => {
        // Respuesta fuera de orden: ya se pidió (o se está por pedir) otro cuerpo.
        if (cuerpoSolicitadoRef.current !== cuerpoAlProgramar) return;
        if (res.status === "ok") {
          setPreview(res.texto);
          setPreviewError(null);
        } else {
          setPreview(null);
          setPreviewError(
            res.status === "validation_error"
              ? "Corrige el cuerpo antes de ver la vista previa."
              : "No se pudo generar la vista previa.",
          );
        }
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, previewAction]);

  const camposUsados = extraerVariables(value).map((clave) => ({
    clave,
    etiqueta: etiquetaDeVariable(clave, variablesNombres).texto,
  }));
  const avisos = clavesSinCampo(value, variablesNombres);

  return (
    <div className="flex flex-col gap-3">
      <CampoVariablePicker onSeleccionar={insertarClave} />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Así lo verá el cliente</span>
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

      {camposUsados.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {camposUsados.map(({ clave, etiqueta }, indice) => (
            <span key={clave}>
              {indice > 0 ? " · " : null}
              <button
                type="button"
                className="cursor-pointer rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => insertarClave(clave)}
                title={`Insertar {{${clave}}}`}
              >
                {etiqueta}
              </button>
            </span>
          ))}
        </p>
      ) : null}

      {avisos.length > 0 ? (
        <div className="flex flex-col gap-1">
          {avisos.map(({ clave, etiqueta, retirada }) => (
            <p key={clave} role="alert" className="text-sm text-destructive">
              {retirada
                ? `{{${clave}}} («${etiqueta}») ya no existe en el catálogo y llegará vacío al cliente`
                : `{{${clave}}} no es un campo válido y llegará vacío al cliente`}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
