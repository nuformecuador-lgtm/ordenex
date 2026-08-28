"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Texto que acompaña al interruptor. Es la ÚNICA explicación de qué cambia al encenderlo, y
 * por eso dice las tres consecuencias juntas —no va a Meta, queda activa ya, no se envía a
 * aprobación—: el maestro decide esto ANTES de escribir el cuerpo, y descubrir después que su
 * plantilla no necesitaba aprobación (o que sí) es descubrirlo tarde.
 */
export const AYUDA_PLANTILLA_TIENDA =
  "El texto no se envía a WhatsApp para su aprobación: queda activa de inmediato y se usa desde el chat del mensajero.";

export interface PlantillaTiendaFieldProps {
  /** Id del interruptor; enlaza el `Label htmlFor` y la ayuda. */
  id: string;
  /** Estado del interruptor (controlado por el formulario anfitrión). */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
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
}: PlantillaTiendaFieldProps) {
  const ayudaId = `${id}-ayuda`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>Plantilla de tienda</Label>
        <Switch
          id={id}
          aria-label="Plantilla de tienda"
          aria-describedby={ayudaId}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id={ayudaId} className="text-sm text-muted-foreground">
        {AYUDA_PLANTILLA_TIENDA}
      </p>
    </div>
  );
}
