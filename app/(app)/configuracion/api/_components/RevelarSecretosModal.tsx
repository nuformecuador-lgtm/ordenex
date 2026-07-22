"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/useToast";

export interface RevelarSecretosModalProps {
  /** Secreto de la API key en claro, entregado UNA sola vez por `generarApiKey` (R7/R8). */
  plainKey: string;
  /** Identificador de la key recién generada, para dar contexto. */
  identificador: string;
  /**
   * Secreto del webhook en claro cuando `registrarWebhook` devolvió `creada` (R8).
   * `null` = no se registró webhook (R7) o el registro falló (R11 → ver `webhookFallo`).
   */
  webhookSecret: string | null;
  /**
   * Aviso de fallo parcial (R11/R12): la API key se creó pero el webhook NO quedó
   * registrado. Mensaje neutro, sin internals. Si es `null` no hubo fallo.
   */
  webhookFallo: string | null;
  /**
   * Cierre confirmado por el usuario (R9): el anfitrión borra ambos secretos de su
   * estado. No existe ninguna otra vía de cierre ni de re-mostrar ningún secreto.
   */
  onClose: () => void;
}

/**
 * Feature 108/T4 — revelado COMBINADO de secretos en un solo modal con dos
 * secciones (gate F1.4, punto b). Muestra:
 *
 *  - Sección "Clave de API": el `plainKey` en claro y seleccionable, UNA vez (R7/R8).
 *  - Sección "Secreto de webhook": el `webhookSecret` en claro, UNA vez, SOLO si el
 *    webhook se registró (`creada`). Si `webhookFallo != null`, en su lugar un aviso
 *    `role="alert"` de fallo parcial: la key se creó pero el webhook no (R11/R12/R13).
 *  - Un ÚNICO checkbox "Ya guardé mis credenciales…" que habilita el ÚNICO botón
 *    "Cerrar" (R9), cubriendo ambos secretos a la vez.
 *  - Escape y click-fuera DESHABILITADOS (`dismissible={false}`): cierre imposible
 *    por accidente; la única vía es el botón habilitado por el checkbox (R9).
 *
 * Al cerrar, el anfitrión descarta ambos secretos: viven solo en su `useState`; sin
 * console, sin URL, sin storage (R10). Este modal es exclusivo del ALTA; el revelado
 * por fila (feature 105) sigue usando `RevelarApiKeyModal`/`RevelarWebhookSecretoModal`.
 */
export function RevelarSecretosModal({
  plainKey,
  identificador,
  webhookSecret,
  webhookFallo,
  onClose,
}: RevelarSecretosModalProps) {
  const toast = useToast();
  const [guardado, setGuardado] = useState(false);

  async function copiar(valor: string, exito: string) {
    try {
      // El `navigator.clipboard` no existe en contextos no seguros ni en algunos
      // navegadores embebidos. Nunca es un fallo duro: el secreto sigue visible y
      // seleccionable en pantalla.
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(valor);
      toast.success(exito);
    } catch {
      toast.error(
        "No se pudo copiar; selecciona el texto y cópialo manualmente",
      );
    }
  }

  const descripcion = webhookSecret
    ? `Credenciales para "${identificador}": clave de API y secreto de webhook.`
    : `Credencial para "${identificador}".`;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="API key generada"
      description={descripcion}
      confirmLabel="Cerrar"
      confirmDisabled={!guardado}
      hideCancel
      dismissible={false}
      onConfirm={onClose}
    >
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          Esta es la única vez que verás estas credenciales. Si las pierdes,
          tendrás que generarlas de nuevo.
        </p>

        {/* Sección 1 — Clave de API (siempre). */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-key-secreto">Clave de API</Label>
          <div className="flex items-center gap-2">
            <Input
              id="api-key-secreto"
              readOnly
              value={plainKey}
              className="font-mono"
              aria-label="Clave de API generada"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copiar(plainKey, "Clave copiada al portapapeles")}
              aria-label="Copiar clave de API"
            >
              <Copy aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>

        {/* Sección 2 — Secreto de webhook (condicional) o aviso de fallo parcial. */}
        {webhookSecret ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="webhook-secreto">Secreto de webhook</Label>
            <div className="flex items-center gap-2">
              <Input
                id="webhook-secreto"
                readOnly
                value={webhookSecret}
                className="font-mono"
                aria-label="Secreto de webhook generado"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  copiar(webhookSecret, "Secreto copiado al portapapeles")
                }
                aria-label="Copiar secreto de webhook"
              >
                <Copy aria-hidden="true" />
                Copiar
              </Button>
            </div>
          </div>
        ) : webhookFallo ? (
          <p role="alert" className="text-sm text-destructive">
            {webhookFallo}
          </p>
        ) : null}

        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="secretos-guardados"
            checked={guardado}
            onCheckedChange={(next) => setGuardado(next === true)}
            aria-label="Ya guardé mis credenciales en un lugar seguro"
          />
          <label htmlFor="secretos-guardados" className="cursor-pointer">
            Ya guardé mis credenciales en un lugar seguro
          </label>
        </div>
      </div>
    </Modal>
  );
}
