"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  generarApiKeySchema,
  type GenerarApiKeyResult,
} from "@/lib/types/api-key";
import { generarApiKey } from "@/lib/actions/api-keys";

type FieldErrors = Record<string, string[]>;

/** Handle imperativo: el Modal anfitrión dispara el submit async (R20/R31). */
export interface GenerarApiKeyFormHandle {
  submit: () => Promise<GenerarApiKeyResult>;
}

/**
 * Formulario de generación de API key (feature 82/R20). Molde de `UsuarioForm`:
 * un único campo obligatorio `identificador`, validado en cliente reusando el
 * schema de `lib/types/api-key` (no duplica reglas). Los `fieldErrors` del
 * backend (R21) se pintan bajo el campo. El conflicto por identificador
 * duplicado (R22) lo traduce el módulo anfitrión: aquí solo se marca el campo.
 */
export const GenerarApiKeyForm = forwardRef<GenerarApiKeyFormHandle>(
  function GenerarApiKeyForm(_props, ref) {
    const [identificador, setIdentificador] = useState("");
    const [errors, setErrors] = useState<FieldErrors>({});

    async function submit(): Promise<GenerarApiKeyResult> {
      const parsed = generarApiKeySchema.safeParse({ identificador });
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
        setErrors(fieldErrors);
        return { status: "validation_error", fieldErrors };
      }

      const res = await generarApiKey(parsed.data);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      } else if (res.status === "conflict") {
        // R22: el backend deriva un usuario a partir del identificador; un
        // duplicado se marca en el propio campo para no cerrar el modal.
        setErrors({
          identificador: ["Ya existe una API key para ese identificador"],
        });
      } else {
        setErrors({});
      }
      return res;
    }

    useImperativeHandle(ref, () => ({ submit }));

    return (
      <div className="flex flex-col gap-3">
        <FormField
          id="identificador"
          label="Identificador"
          error={errors.identificador}
        >
          <Input
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
          />
        </FormField>
      </div>
    );
  },
);
