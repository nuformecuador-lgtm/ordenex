"use client";

import { MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

// Feature 87 (T10, design §3.3) — compuesto reutilizable de botones de CONTACTO al cliente:
// "Llamar" (`tel:`, R16) y "WhatsApp" (`wa.me/<normalizado>`, R12/R15). Extraido de los
// botones inline de `GestionarOrdenPanel` (deduplicacion, R17) y corrige de paso el bug
// heredado del enlace `wa.me` sin prefijo `506` (R15) usando `normalizarTelefonoCR`. Se usa
// en `/novedades` (lista, tamano `sm`) y en el panel del mensajero (tamano `lg` = size-14).

export interface ContactoButtonsProps {
  /** Telefono del destinatario (crudo, tal cual viene de la orden). */
  telefono: string;
  /** Nombre del destinatario, para los aria-label accesibles. */
  nombre: string;
  /** `lg` = botones grandes (size-14, panel del mensajero); `sm`/default = compacto (lista). */
  size?: "sm" | "lg";
}

/** Botones "Llamar" + "WhatsApp" accesibles, con el telefono normalizado en el enlace wa.me. */
export function ContactoButtons({ telefono, nombre, size = "sm" }: ContactoButtonsProps) {
  const iconButtonClass = size === "lg" ? "size-14 shrink-0" : "shrink-0";
  const iconClass = size === "lg" ? "size-5" : "size-4";

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={iconButtonClass}
        onClick={() => window.open(`tel:${telefono}`, "_self")}
        aria-label={`Llamar a ${nombre}`}
      >
        <Phone className={iconClass} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={iconButtonClass}
        onClick={() =>
          window.open(`https://wa.me/${normalizarTelefonoCR(telefono)}`, "_blank")
        }
        aria-label={`WhatsApp a ${nombre}`}
      >
        <MessageCircle className={iconClass} aria-hidden="true" />
      </Button>
    </div>
  );
}
