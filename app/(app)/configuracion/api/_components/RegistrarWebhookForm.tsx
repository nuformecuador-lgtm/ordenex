"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import { registrarWebhookSchema } from "@/lib/types/webhook";
import type { RegistrarWebhookActionResult } from "@/lib/types/webhook";
import { registrarWebhook } from "@/lib/actions/webhooks";

type FieldErrors = { url?: string[]; ownerUsuarioId?: string[] };

/** Handle imperativo: el Modal anfitrión dispara el submit async (R16). */
export interface RegistrarWebhookFormHandle {
  submit: () => Promise<RegistrarWebhookActionResult>;
}

export interface RegistrarWebhookFormProps {
  /** Owner (usuario de rol `apiKey`) dueño de la suscripción. */
  ownerUsuarioId: string;
  /** URL ya registrada, para el modo edición; vacío para el ALTA. */
  initialUrl?: string;
}

/**
 * R6: la URL de callback debe ser `https` válida. El schema base
 * `registrarWebhookSchema` (reusado, sin duplicar reglas de forma) solo garantiza
 * `min(1)`; R6 exige además `https`, así que la UI lo refuerza en cliente antes de
 * invocar la Server Action. El borde server revalida igualmente.
 */
function esHttpsValida(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Formulario de registro/edición de la URL de webhook (feature 105/T3, molde de
 * `GenerarApiKeyForm`). Un único campo `url`, validado en cliente reusando
 * `registrarWebhookSchema` + refuerzo `https` (R6). Los `fieldErrors` del backend
 * (R9) se pintan bajo el campo; `owner_invalido` (R10) y `config_error` (R11) se
 * traducen a avisos NO-campo dentro del formulario, sin exponer internals.
 */
export const RegistrarWebhookForm = forwardRef<
  RegistrarWebhookFormHandle,
  RegistrarWebhookFormProps
>(function RegistrarWebhookForm({ ownerUsuarioId, initialUrl = "" }, ref) {
  const [url, setUrl] = useState(initialUrl);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [avisoNoCampo, setAvisoNoCampo] = useState<string | null>(null);

  async function submit(): Promise<RegistrarWebhookActionResult> {
    setAvisoNoCampo(null);

    const parsed = registrarWebhookSchema.safeParse({ ownerUsuarioId, url });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
      setErrors(fieldErrors);
      return { status: "validation_error", fieldErrors };
    }

    // R6: bloqueo de cliente para URL no-https; NO se invoca la Server Action.
    if (!esHttpsValida(parsed.data.url)) {
      const fieldErrors: FieldErrors = {
        url: ["La URL de callback debe ser una URL https válida"],
      };
      setErrors(fieldErrors);
      return { status: "validation_error", fieldErrors };
    }

    const res = await registrarWebhook(parsed.data);

    if (res.status === "validation_error") {
      setErrors(res.fieldErrors); // R9
    } else if (res.status === "owner_invalido") {
      // R10: aviso no-campo; el owner no es una cuenta de API válida.
      setErrors({});
      setAvisoNoCampo(
        "El destinatario no es una cuenta de API válida. Verifica la API key seleccionada.",
      );
    } else if (res.status === "config_error") {
      // R11 (D3): mensaje neutro de servidor, sin nombrar variables ni trazas.
      setErrors({});
      setAvisoNoCampo(
        "La configuración de webhooks del servidor está pendiente. Contacta al administrador del sistema; no es posible registrar el webhook en este momento.",
      );
    } else {
      setErrors({});
    }
    return res;
  }

  useImperativeHandle(ref, () => ({ submit }));

  return (
    <div className="flex flex-col gap-3">
      <FormField id="webhook-url" label="URL de callback" error={errors.url}>
        <Input
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>
      {errors.ownerUsuarioId?.length ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.ownerUsuarioId[0]}
        </p>
      ) : null}
      {avisoNoCampo ? (
        <p role="alert" className="text-sm text-destructive">
          {avisoNoCampo}
        </p>
      ) : null}
    </div>
  );
});
