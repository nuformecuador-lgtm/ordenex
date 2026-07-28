import { MessageCircle, Phone } from "lucide-react";

import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

// POS card · contacto (réplica del `Comms` de la referencia): dos targets grandes
// "Llamar" (brand) y "WhatsApp" (success). Son ENLACES reales (`tel:` / `wa.me`), no
// botones con `window.open`, así que el componente queda server-safe. El teléfono se
// normaliza a E.164 CR con el helper compartido (mismo criterio que `ContactoButtons`).

export interface PosCommsProps {
  telefono: string;
  /** Nombre del destinatario, para los aria-label accesibles. */
  nombre: string;
}

export function PosComms({ telefono, nombre }: PosCommsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={`tel:${telefono}`}
        aria-label={`Llamar a ${nombre}`}
        className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-black uppercase tracking-wide text-white transition-transform active:scale-[0.98]"
      >
        <Phone className="size-4" aria-hidden="true" /> Llamar
      </a>
      <a
        href={`https://wa.me/${normalizarTelefonoCR(telefono)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp a ${nombre}`}
        className="flex items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-black uppercase tracking-wide text-white transition-transform active:scale-[0.98]"
      >
        <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
      </a>
    </div>
  );
}
