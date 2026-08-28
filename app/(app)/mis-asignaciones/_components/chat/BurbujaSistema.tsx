import { Info } from "lucide-react";

import type { ChatSistemaVista } from "@/lib/types/chat-whatsapp";

import { horaCorta } from "./chat-format";

// Feature 299 (R32, D3) — el cliente cambio su numero de WhatsApp.
//
// Es una fila de SISTEMA: va centrada y sin `data-direccion`, porque no la escribio ni el
// cliente ni el mensajero. Cita AMBOS numeros (R32/R18): es la evidencia de por que el hilo
// siguio en el mismo sitio con otro numero, y sin ella el mensajero veria un salto inexplicable.
// El telefono de la orden y el del cliente NO cambian (R17).

const NUMERO_DESCONOCIDO = "número desconocido";

export interface TextoCambioNumeroProps {
  sistema: ChatSistemaVista | null;
}

/** Contenido del aviso, reutilizado por `BurbujaContenido` en el switch exhaustivo. */
export function TextoCambioNumero({ sistema }: Readonly<TextoCambioNumeroProps>) {
  const anterior = sistema?.telefonoAnterior ?? null;
  const nuevo = sistema?.telefonoNuevo ?? null;

  return (
    <span className="flex items-center gap-1.5">
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        El cliente cambió su número de WhatsApp: {anterior ?? NUMERO_DESCONOCIDO} →{" "}
        {nuevo ?? NUMERO_DESCONOCIDO}
      </span>
    </span>
  );
}

export interface BurbujaSistemaProps {
  sistema: ChatSistemaVista | null;
  ocurridoAt: string;
}

export function BurbujaSistema({ sistema, ocurridoAt }: Readonly<BurbujaSistemaProps>) {
  return (
    // SIN `data-direccion` A PROPOSITO: no es entrante ni saliente (R32).
    <li className="flex justify-center" data-sistema="cambio-numero">
      <div className="max-w-[85%] rounded-full bg-muted-foreground/10 px-3 py-1 text-center text-[11px] text-muted-foreground">
        <TextoCambioNumero sistema={sistema} />
        <span className="ml-1.5 text-[10px]">{horaCorta(ocurridoAt)}</span>
      </div>
    </li>
  );
}
