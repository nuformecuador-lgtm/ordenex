import { Info } from "lucide-react";

import type { ChatSistemaVista } from "@/lib/types/chat-whatsapp";

import { horaCorta } from "./chat-format";

// Feature 308 (R32, D3) — el cliente cambio su numero de WhatsApp.
//
// Es una fila de SISTEMA: va centrada y sin `data-direccion`, porque no la escribio ni el
// cliente ni el mensajero. Cita AMBOS numeros (R32/R18): es la evidencia de por que el hilo
// siguio en el mismo sitio con otro numero, y sin ella el mensajero veria un salto inexplicable.
// El telefono de la orden y el del cliente NO cambian (R17).
//
// SEGUNDA LINEA (R16, «LIMITACION CONOCIDA» de requirements.md, decidida por el humano el
// 2026-08-27): el cambio de numero se queda SOLO COMO EVIDENCIA. Un entrante se resuelve a su
// orden por `orden.telefono_dest`, no por el telefono del hilo, asi que un mensaje enviado desde
// el numero NUEVO no cae aqui: se cuenta como `sinResolver` y el webhook responde 200. Citar los
// dos numeros a secas sugiere una continuidad que NO existe y deja al mensajero esperando
// respuestas que nunca van a llegar. Se enuncia SOLO el hecho: no se instruye a «actualizar el
// telefono de la orden» porque no esta verificado que este rol pueda hacerlo.
//
// Es informacion, no una alarma: mismo tono `muted` que el resto de la fila, sin color de error,
// sin icono nuevo y sin animacion (nada aqui depende de `prefers-reduced-motion`).

const NUMERO_DESCONOCIDO = "número desconocido";

/** El hecho operativo de R16. Se muestra SIEMPRE, tambien si falta alguno de los dos numeros. */
const AVISO_SIN_CONTINUIDAD = "Sus mensajes desde el número nuevo no llegarán a esta orden.";

export interface TextoCambioNumeroProps {
  sistema: ChatSistemaVista | null;
}

/** Contenido del aviso, reutilizado por `BurbujaContenido` en el switch exhaustivo. */
export function TextoCambioNumero({ sistema }: Readonly<TextoCambioNumeroProps>) {
  const anterior = sistema?.telefonoAnterior ?? null;
  const nuevo = sistema?.telefonoNuevo ?? null;

  // Solo `span`: este bloque tambien se pinta dentro de un `<p>` en `BurbujaContenido`.
  return (
    <span className="flex items-start gap-1.5">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="text-balance">
        <span className="block">
          El cliente cambió su número de WhatsApp: {anterior ?? NUMERO_DESCONOCIDO} →{" "}
          {nuevo ?? NUMERO_DESCONOCIDO}
        </span>
        <span className="block">{AVISO_SIN_CONTINUIDAD}</span>
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
      <div className="max-w-[85%] rounded-2xl bg-muted-foreground/10 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
        <TextoCambioNumero sistema={sistema} />
        <span className="ml-1.5 text-[10px]">{horaCorta(ocurridoAt)}</span>
      </div>
    </li>
  );
}
