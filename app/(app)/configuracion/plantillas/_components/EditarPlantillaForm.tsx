"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  actualizarPlantillaSchema,
  type ActualizarPlantillaResult,
  type PlantillaListItemDTO,
} from "@/lib/types/plantilla-mensaje";
import { actualizarPlantilla } from "@/lib/actions/plantillas";

import { VariablesInsert } from "./VariablesInsert";

type FieldErrors = Record<string, string[]>;

/** Clases del textarea del cuerpo, alineadas al `Input` del sistema de diseño. */
const TEXTAREA_CLASS =
  "w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Handle imperativo: el Modal anfitrión dispara el submit async. */
export interface EditarPlantillaFormHandle {
  submit: () => Promise<ActualizarPlantillaResult>;
}

export interface EditarPlantillaFormProps {
  /** Plantilla a editar (precarga los campos). */
  plantilla: PlantillaListItemDTO;
}

/**
 * Formulario de edición de plantilla (feature 107/R20). Mismas validaciones que
 * la creación (R22) reusando `actualizarPlantillaSchema`; delega en la Server
 * Action `actualizarPlantilla`. El error de llave malformada (R16) llega como
 * `fieldErrors.cuerpo`; el conflicto de nombre (R10, excluyendo la propia) se
 * pinta en el campo `nombre`.
 */
export const EditarPlantillaForm = forwardRef<
  EditarPlantillaFormHandle,
  EditarPlantillaFormProps
>(function EditarPlantillaForm({ plantilla }, ref) {
  const [nombre, setNombre] = useState(plantilla.nombre);
  const [cuerpo, setCuerpo] = useState(plantilla.cuerpo);
  const [errors, setErrors] = useState<FieldErrors>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submit(): Promise<ActualizarPlantillaResult> {
    const parsed = actualizarPlantillaSchema.safeParse({ nombre, cuerpo });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
      setErrors(fieldErrors);
      return { status: "validation_error", fieldErrors };
    }

    const res = await actualizarPlantilla(plantilla.id, parsed.data);

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
      <FormField id="plantilla-nombre-edit" label="Nombre" error={errors.nombre}>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </FormField>

      <FormField id="plantilla-cuerpo-edit" label="Cuerpo" error={errors.cuerpo}>
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
      />
    </div>
  );
});
