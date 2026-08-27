"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  crearPlantillaSchema,
  type CrearPlantillaResult,
} from "@/lib/types/plantilla-mensaje";
import { crearPlantilla } from "@/lib/actions/plantillas";

import { VariablesInsert } from "./VariablesInsert";

type FieldErrors = Record<string, string[]>;

/** Referencia estable: una plantilla nueva no tiene snapshot persistido (feature 282). */
const SIN_VARIABLES_NOMBRES: Record<string, string> = {};

/** Clases del textarea del cuerpo, alineadas al `Input` del sistema de diseño. */
const TEXTAREA_CLASS =
  "w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Handle imperativo: el Modal anfitrión dispara el submit async. */
export interface CrearPlantillaFormHandle {
  submit: () => Promise<CrearPlantillaResult>;
}

/**
 * Formulario de creación de plantilla (feature 107/R8). Molde de
 * `GenerarApiKeyForm`: valida en cliente reusando `crearPlantillaSchema` (nombre y
 * cuerpo no vacíos, R11) y delega en la Server Action `crearPlantilla`. Los
 * `fieldErrors` del backend se pintan por campo; el error de llave malformada
 * (R16) llega como `fieldErrors.cuerpo`. La botonera `VariablesInsert` inserta
 * `{{clave}}` en el cursor (R17) y ofrece vista previa (R18).
 */
export const CrearPlantillaForm = forwardRef<CrearPlantillaFormHandle>(
  function CrearPlantillaForm(_props, ref) {
    const [nombre, setNombre] = useState("");
    const [cuerpo, setCuerpo] = useState("");
    const [errors, setErrors] = useState<FieldErrors>({});
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    async function submit(): Promise<CrearPlantillaResult> {
      const parsed = crearPlantillaSchema.safeParse({ nombre, cuerpo });
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
        setErrors(fieldErrors);
        return { status: "validation_error", fieldErrors };
      }

      const res = await crearPlantilla(parsed.data);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors); // R16: fieldErrors.cuerpo (llave malformada)
      } else if (res.status === "conflict") {
        setErrors({ nombre: ["Ya existe una plantilla con ese nombre"] });
      } else {
        setErrors({});
      }
      return res;
    }

    useImperativeHandle(ref, () => ({ submit }));

    return (
      <div className="flex flex-col gap-4">
        <FormField id="plantilla-nombre" label="Nombre" error={errors.nombre}>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </FormField>

        <FormField id="plantilla-cuerpo" label="Cuerpo" error={errors.cuerpo}>
          <textarea
            ref={textareaRef}
            value={cuerpo}
            onChange={(e) => setCuerpo(e.target.value)}
            rows={5}
            className={TEXTAREA_CLASS}
          />
        </FormField>

        <VariablesInsert
          textareaRef={textareaRef}
          value={cuerpo}
          onInsert={(next) => setCuerpo(next)}
          variablesNombres={SIN_VARIABLES_NOMBRES}
        />
      </div>
    );
  },
);
