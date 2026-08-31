"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Texto que acompaña al interruptor. Es la ÚNICA explicación de qué cambia al encenderlo, así
 * que dice las dos cosas que no se pueden deducir del nombre: que no espera aprobación, y —lo
 * que más se presta a error— DÓNDE se usa. Corregido el 2026-08-27: decía «desde el chat del
 * mensajero», que es justo la superficie en la que NO aparece.
 */
export const AYUDA_PLANTILLA_TIENDA =
  "No pasa por la aprobación de WhatsApp: queda activa de inmediato y solo se envía desde Novedades.";

/**
 * Ayuda que sustituye a la anterior cuando el interruptor está bloqueado. Una plantilla ya
 * guardada como plantilla de tienda no puede dejar de serlo: nunca se registró en Meta, así
 * que apagar el interruptor la dejaría prometiendo un envío por WhatsApp que no existe.
 */
export const AYUDA_PLANTILLA_TIENDA_FIJA =
  "Ya se guardó como plantilla de tienda y no puede dejar de serlo. Crea una plantilla nueva si necesitas enviarla por WhatsApp.";

export interface PlantillaTiendaFieldProps {
  /** Id del interruptor; enlaza el `Label htmlFor` y la ayuda. */
  id: string;
  /** Estado del interruptor (controlado por el formulario anfitrión). */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /**
   * Bloquea el interruptor. Lo usa la edición cuando la plantilla YA venía guardada como
   * plantilla de tienda: la decisión es de ida y no admite vuelta.
   */
  disabled?: boolean;
}

/**
 * Interruptor "Plantilla de tienda", compartido por los formularios de creación y de edición
 * para que ambos digan LO MISMO. Vive aquí y no en `components/shared/` porque sus dos
 * consumidores están en este módulo (misma regla que `FormSheet`).
 *
 * No se usa `FormField`: no es un campo con error de validación —un booleano no puede ser
 * inválido— sino una decisión con consecuencia, así que el patrón es el del `Switch` de
 * `UsuarioForm` (label a la izquierda, control a la derecha) más el texto de ayuda debajo,
 * enlazado por `aria-describedby` para que un lector de pantalla lo anuncie con el control.
 */
export function PlantillaTiendaField({
  id,
  checked,
  onCheckedChange,
  disabled = false,
}: PlantillaTiendaFieldProps) {
  const ayudaId = `${id}-ayuda`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>Plantilla para envío de la tienda</Label>
        <Switch
          id={id}
          aria-label="Plantilla para envío de la tienda"
          aria-describedby={ayudaId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </div>
      <p id={ayudaId} className="text-sm text-muted-foreground">
        {disabled ? AYUDA_PLANTILLA_TIENDA_FIJA : AYUDA_PLANTILLA_TIENDA}
      </p>
    </div>
  );
}
