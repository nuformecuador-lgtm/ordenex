"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/useToast";

export interface RevelarWebhookSecretoModalProps {
  /** Secreto en claro, entregado UNA sola vez por el ALTA (R7) o la rotación (R21). */
  secret: string;
  /** Identificador del owner de la suscripción, para dar contexto. */
  identificador: string;
  /**
   * Cierre confirmado por el usuario (R8): el anfitrión borra el `secret` de su
   * estado. No existe ninguna otra vía de cierre ni de re-mostrar el secreto (R17).
   */
  onClose: () => void;
}

/**
 * Modal de revelado del secreto del webhook (feature 105/T2, espejo directo de
 * `RevelarApiKeyModal` de la feature 82/D5). Muestra el `secret` en claro y
 * seleccionable UNA sola vez, con:
 *
 *  - aviso en tono de advertencia `role="alert"` de "única vez" (R7/R21),
 *  - botón Copiar con fallback si `navigator.clipboard` no existe o falla,
 *  - checkbox obligatorio "Ya guardé el secreto…" que habilita el ÚNICO botón de
 *    cierre (R8),
 *  - Escape y click-fuera DESHABILITADOS mientras el secreto está visible
 *    (`dismissible={false}`): la única vía de cierre es el botón habilitado por el
 *    checkbox (R8).
 *
 * Al cerrar, el anfitrión hace `setSecreto(null)`: el `secret` deja de existir en
 * el estado del cliente y no hay acción que lo recupere (R8). El secreto vive solo
 * en `useState` local: sin console, sin URL, sin storage (R17). Lo dispara el ALTA
 * (`registrarWebhook` → `creada`, R7) y la ROTACIÓN (`rotarSecretoWebhook` → `ok`,
 * R21); NUNCA la edición de la URL (`actualizada`, R7b).
 */
export function RevelarWebhookSecretoModal({
  secret,
  identificador,
  onClose,
}: RevelarWebhookSecretoModalProps) {
  const toast = useToast();
  const [guardado, setGuardado] = useState(false);

  async function copiar() {
    try {
      // El `navigator.clipboard` no existe en contextos no seguros ni en algunos
      // navegadores embebidos. Nunca es un fallo duro: el secreto sigue visible y
      // seleccionable en pantalla.
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(secret);
      toast.success("Secreto copiado al portapapeles");
    } catch {
      toast.error(
        "No se pudo copiar; selecciona el texto y cópialo manualmente",
      );
    }
  }

  return (
    <Modal
      open
      // La única vía de cierre es el botón "Cerrar" (confirm), habilitado por el
      // checkbox. Escape/overlay quedan bloqueados por `dismissible={false}`.
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Secreto de webhook"
      description={`Firma de las notificaciones para "${identificador}".`}
      confirmLabel="Cerrar"
      confirmDisabled={!guardado}
      hideCancel
      dismissible={false}
      onConfirm={onClose}
    >
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          Esta es la única vez que verás este secreto. Si lo pierdes, tendrás que
          rotarlo para obtener uno nuevo.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-secreto">Secreto de firma</Label>
          <div className="flex items-center gap-2">
            <Input
              id="webhook-secreto"
              readOnly
              value={secret}
              className="font-mono"
              aria-label="Secreto de webhook generado"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copiar}
              aria-label="Copiar secreto de webhook"
            >
              <Copy aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="webhook-guardado"
            checked={guardado}
            onCheckedChange={(next) => setGuardado(next === true)}
            aria-label="Ya guardé el secreto en un lugar seguro"
          />
          <label htmlFor="webhook-guardado" className="cursor-pointer">
            Ya guardé el secreto en un lugar seguro
          </label>
        </div>
      </div>
    </Modal>
  );
}
