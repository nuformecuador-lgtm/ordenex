"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  generarApiKeySchema,
  type GenerarApiKeyResult,
} from "@/lib/types/api-key";
import { registrarWebhookSchema } from "@/lib/types/webhook";
import { generarApiKey } from "@/lib/actions/api-keys";

import { esHttpsValida } from "./webhook-url";

type FieldErrors = Record<string, string[]>;

/**
 * Resultado del submit imperativo (feature 108/T2). Además del `GenerarApiKeyResult`
 * devuelve la URL de webhook introducida (o cadena vacía) para que el anfitrión
 * decida si encadena `registrarWebhook`. `webhookUrl` es vacío tanto si el usuario
 * lo dejó en blanco (R2) como si la validación de la URL falló (en cuyo caso
 * `keyResult` viene como `validation_error` y la key NO se creó, R4).
 */
export interface GenerarApiKeySubmitResult {
  keyResult: GenerarApiKeyResult;
  webhookUrl: string;
}

/** Handle imperativo: el Modal anfitrión dispara el submit async (R20/R31). */
export interface GenerarApiKeyFormHandle {
  submit: () => Promise<GenerarApiKeySubmitResult>;
}

/**
 * Formulario de generación de API key (feature 82/R20, ampliado por feature 108).
 * Molde de `UsuarioForm`: un campo obligatorio `identificador` y —desde la 108— un
 * campo OPCIONAL "URL de webhook (callback)" (R1). Valida en cliente reusando los
 * schemas de `lib/types` (no duplica reglas): `generarApiKeySchema` para el
 * identificador y `registrarWebhookSchema` + el refuerzo `https` compartido
 * (`webhook-url.ts`, R3) para la URL si es no vacía. Si la URL es inválida, marca
 * el campo y NO invoca `generarApiKey` (R4): no se crea la key con una URL rota.
 * Los `fieldErrors` del backend (R21) se pintan bajo el campo; el conflicto por
 * identificador duplicado (R22) se marca en el propio campo.
 */
export const GenerarApiKeyForm = forwardRef<GenerarApiKeyFormHandle>(
  function GenerarApiKeyForm(_props, ref) {
    const [identificador, setIdentificador] = useState("");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [errors, setErrors] = useState<FieldErrors>({});

    async function submit(): Promise<GenerarApiKeySubmitResult> {
      const parsed = generarApiKeySchema.safeParse({ identificador });
      const url = webhookUrl.trim();

      // Validación de identificador (obligatorio).
      const nextErrors: FieldErrors = {};
      if (!parsed.success) {
        Object.assign(
          nextErrors,
          parsed.error.flatten().fieldErrors as FieldErrors,
        );
      }

      // R3/R4: la URL de webhook es opcional; solo se valida si es no vacía. Se
      // reusa `registrarWebhookSchema` (min(1)/forma) + el refuerzo `https`
      // compartido. `ownerUsuarioId` aún no existe (la key no está creada): se
      // pasa un placeholder para satisfacer el schema; solo interesa la rama `url`.
      if (url.length > 0) {
        const urlParsed = registrarWebhookSchema.safeParse({
          ownerUsuarioId: "pendiente",
          url,
        });
        if (!urlParsed.success) {
          const fe = urlParsed.error.flatten().fieldErrors as FieldErrors;
          if (fe.url?.length) nextErrors.webhookUrl = fe.url;
        } else if (!esHttpsValida(url)) {
          nextErrors.webhookUrl = [
            "La URL de callback debe ser una URL https válida",
          ];
        }
      }

      // R4: si el identificador o la URL fallan, NO se invoca la Server Action.
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return {
          keyResult: { status: "validation_error", fieldErrors: nextErrors },
          webhookUrl: "",
        };
      }

      const res = await generarApiKey(
        parsed.success ? parsed.data : { identificador },
      );

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

      // Solo se propaga la URL cuando la key se creó (R5); en cualquier otro
      // caso el anfitrión no debe encadenar `registrarWebhook`.
      return { keyResult: res, webhookUrl: res.status === "ok" ? url : "" };
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

        <FormField
          id="webhook-url-alta"
          label="URL de webhook (callback)"
          error={errors.webhookUrl}
        >
          <Input
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </FormField>
      </div>
    );
  },
);
