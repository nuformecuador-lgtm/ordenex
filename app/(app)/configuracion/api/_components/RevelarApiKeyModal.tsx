"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/useToast";

export interface RevelarApiKeyModalProps {
  /** Secreto en claro, entregado UNA sola vez por `generarApiKey` (R24). */
  plainKey: string;
  /** Identificador de la key recién generada, para dar contexto. */
  identificador: string;
  /**
   * Cierre confirmado por el usuario (R28): el anfitrión borra el `plainKey` de
   * su estado. No existe ninguna otra vía de cierre ni de re-mostrar el secreto.
   */
  onClose: () => void;
}

/**
 * Modal de revelado del secreto (feature 82/D5 — la UX central, elegida
 * explícitamente por el humano). Muestra el `plainKey` en claro y seleccionable
 * UNA sola vez (R24), con:
 *
 *  - aviso en tono de advertencia `role="alert"` (R24),
 *  - botón Copiar con fallback si `navigator.clipboard` no existe o falla (R25/R26/D6),
 *  - checkbox obligatorio "Ya guardé la clave…" que habilita el ÚNICO botón de
 *    cierre (R27),
 *  - Escape y click-fuera DESHABILITADOS mientras el secreto está visible
 *    (`dismissible={false}`), de modo que un cierre accidental sea imposible: la
 *    única vía de cierre es el botón habilitado por el checkbox (R27/R28).
 *
 * Al cerrar, el anfitrión hace `setRevelado(null)`: el `plainKey` deja de existir
 * en el estado del cliente y no hay acción que lo recupere (R28). El secreto vive
 * solo en `useState` local: sin console, sin URL, sin storage (R30).
 */
export function RevelarApiKeyModal({
  plainKey,
  identificador,
  onClose,
}: RevelarApiKeyModalProps) {
  const toast = useToast();
  const [guardado, setGuardado] = useState(false);

  async function copiar() {
    try {
      // D6: `navigator.clipboard` no existe en contextos no seguros ni en
      // algunos navegadores embebidos. Nunca es un fallo duro: el secreto sigue
      // visible y seleccionable en pantalla.
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(plainKey);
      toast.success("Clave copiada al portapapeles");
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
      title="API key generada"
      description={`Credencial para "${identificador}".`}
      confirmLabel="Cerrar"
      confirmDisabled={!guardado}
      hideCancel
      dismissible={false}
      onConfirm={onClose}
    >
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          Esta es la única vez que verás esta clave. Si la pierdes, tendrás que
          generar otra.
        </p>

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
              onClick={copiar}
              aria-label="Copiar clave de API"
            >
              <Copy aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="api-key-guardado"
            checked={guardado}
            onCheckedChange={(next) => setGuardado(next === true)}
            aria-label="Ya guardé la clave en un lugar seguro"
          />
          <label htmlFor="api-key-guardado" className="cursor-pointer">
            Ya guardé la clave en un lugar seguro
          </label>
        </div>
      </div>
    </Modal>
  );
}
