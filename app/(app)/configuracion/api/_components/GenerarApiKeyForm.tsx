"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import useSWR from "swr";

import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import {
  generarApiKeySchema,
  type GenerarApiKeyResult,
} from "@/lib/types/api-key";
import { registrarWebhookSchema } from "@/lib/types/webhook";
import { generarApiKey } from "@/lib/actions/api-keys";
import { listarAdminTiendas } from "@/lib/actions/usuarios-por-rol";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

import { esHttpsValida } from "./webhook-url";

type FieldErrors = Record<string, string[]>;

/**
 * Textos del campo "Tienda destino" (feature 307), agrupados para que una futura pasada
 * de i18n tenga UN solo sitio que tocar.
 *
 * El `hint` es el motivo de existir de la feature 302 dicho en una línea: sin él, elegir
 * una tienda en un desplegable no dice qué cambia. Lo que cambia es DE QUIÉN son las
 * órdenes que cargue la clave, y esa es la decisión que se toma aquí.
 */
const TEXTO_TIENDA_DESTINO = {
  label: "Tienda destino",
  hint: "Opcional. Si eliges una tienda, las órdenes que cargue esta clave serán de esa tienda ya registrada. Si la dejas sin elegir, la clave usa su propia cuenta nueva y las órdenes serán suyas.",
  ninguna: "Ninguna: la clave usa su propia cuenta",
  sinTiendas: "No hay tiendas registradas",
} as const;

/** Clave SWR del catálogo de tiendas destino. */
const SWR_KEY_TIENDAS = "api-keys:tiendas-destino";

/**
 * Catálogo de tiendas elegibles como destino. Reusa `listarAdminTiendas` (que ya
 * autoriza a `maestro` y proyecta solo id/nombre); aquí no se decide nada de permisos.
 *
 * Se degrada en silencio, como `cargarMensajeros` en `FiltrosOperativos`: si el catálogo
 * no llega, el desplegable queda vacío y deshabilitado, pero el alta sigue funcionando
 * exactamente igual que antes de la 302 —la tienda destino es OPCIONAL, así que no poder
 * elegirla no puede impedir generar la clave—.
 */
async function cargarTiendasDestino(): Promise<UsuarioPorRolDTO[]> {
  try {
    const res = await listarAdminTiendas();
    return res.status === "ok" ? res.usuarios : [];
  } catch {
    return [];
  }
}

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
 * Formulario de generación de API key (feature 82/R20, ampliado por features 108 y 307).
 * Molde de `UsuarioForm`: un campo obligatorio `identificador` y dos campos OPCIONALES —
 * la "URL de webhook (callback)" de la 108 (R1) y la "Tienda destino" de la 302, que la
 * 307 pone por fin en pantalla—. Valida en cliente reusando los schemas de `lib/types`
 * (no duplica reglas): `generarApiKeySchema` para el identificador Y la tienda destino, y
 * `registrarWebhookSchema` + el refuerzo `https` compartido (`webhook-url.ts`, R3) para la
 * URL si es no vacía. Si la URL es inválida, marca el campo y NO invoca `generarApiKey`
 * (R4): no se crea la key con una URL rota. Los `fieldErrors` del backend (R21) se pintan
 * bajo el campo —incluidos los de `tiendaDestinoId`, que el service produce si la tienda
 * no existe, no es `adminTienda` o está inactiva—; el conflicto por identificador
 * duplicado (R22) se marca en el propio campo.
 *
 * "Sin tienda elegida" NO es un error de validación: es el comportamiento histórico
 * (la cuenta dedicada es dueña de sus órdenes) y el schema ya normaliza la cadena vacía
 * del `<select>` a "ninguna" antes de mirar el uuid.
 */
export const GenerarApiKeyForm = forwardRef<GenerarApiKeyFormHandle>(
  function GenerarApiKeyForm(_props, ref) {
    const [identificador, setIdentificador] = useState("");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [tiendaDestinoId, setTiendaDestinoId] = useState("");
    const [errors, setErrors] = useState<FieldErrors>({});

    const { data: tiendas } = useSWR(SWR_KEY_TIENDAS, cargarTiendasDestino);

    const opcionesTienda: SelectOption[] = useMemo(() => {
      const disponibles = tiendas ?? [];
      if (disponibles.length === 0) return [];
      // La primera opción permite DESHACER la elección: sin ella, elegir una tienda
      // por error sería irreversible sin cerrar el modal.
      return [
        { value: "", label: TEXTO_TIENDA_DESTINO.ninguna },
        ...disponibles.map((t) => ({ value: t.id, label: t.nombre })),
      ];
    }, [tiendas]);

    async function submit(): Promise<GenerarApiKeySubmitResult> {
      // Feature 307: la tienda destino entra al MISMO parseo que el identificador. La
      // cadena vacía la normaliza el schema a `undefined` ("ninguna"), no a un error.
      const parsed = generarApiKeySchema.safeParse({
        identificador,
        tiendaDestinoId,
      });
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
          id="tienda-destino"
          label={TEXTO_TIENDA_DESTINO.label}
          hint={TEXTO_TIENDA_DESTINO.hint}
          error={errors.tiendaDestinoId}
        >
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              value={tiendaDestinoId}
              onValueChange={setTiendaDestinoId}
              options={opcionesTienda}
              placeholder={
                opcionesTienda.length === 0
                  ? TEXTO_TIENDA_DESTINO.sinTiendas
                  : TEXTO_TIENDA_DESTINO.ninguna
              }
              // Sin catálogo no hay nada que elegir. No bloquea el alta: la
              // tienda destino es opcional y "ninguna" es un destino válido.
              disabled={opcionesTienda.length === 0}
              aria-label={TEXTO_TIENDA_DESTINO.label}
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
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
