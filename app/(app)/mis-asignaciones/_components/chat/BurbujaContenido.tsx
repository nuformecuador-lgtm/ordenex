"use client";

import { MapPin } from "lucide-react";

import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";

import type { UbicacionPunto } from "../ubicacion-mapa-tipos";
import { MediaAdjunto } from "./MediaAdjunto";
import { TarjetaContacto } from "./TarjetaContacto";
import { TextoConEnlaces } from "./TextoConEnlaces";
import { TextoCambioNumero } from "./BurbujaSistema";

// Feature 299 (R14/R27) — QUE se pinta dentro de una burbuja, por tipo de mensaje.
//
// El `switch` es EXHAUSTIVO con `never` en el `default` a proposito: asi, el dia que se añada un
// tipo nuevo al enum y nadie lo pinte, el fallo es un ERROR DE COMPILACION y no otra burbuja
// vacia como la que esta feature vino a arreglar. Ese era exactamente el sintoma: todo entrante
// que no fuera `text` ni `location` caia en `otro` con `cuerpo = null` y se renderizaba como
// `<p>{cuerpo ?? ""}</p>`.

/** R14: los entrantes ya guardados como `otro` NO se pueden reconstruir (el payload crudo no se
 * persistio). Se dicen, en vez de quedarse en blanco. */
const AVISO_NO_COMPATIBLE = "Mensaje no compatible";

export interface BurbujaContenidoProps {
  mensaje: ChatMensajeVista;
  onAbrirUbicacion: (punto: UbicacionPunto) => void;
}

/** Pie de foto del adjunto, si vino (R2). */
function Caption({ cuerpo }: Readonly<{ cuerpo: string | null }>) {
  if (cuerpo === null || cuerpo.trim() === "") return null;
  return <TextoConEnlaces texto={cuerpo} className="mt-1 text-xs" />;
}

export function BurbujaContenido({
  mensaje,
  onAbrirUbicacion,
}: Readonly<BurbujaContenidoProps>) {
  switch (mensaje.tipo) {
    case "texto":
    case "plantilla":
      return <TextoConEnlaces texto={mensaje.cuerpo ?? ""} />;

    case "ubicacion":
      // Feature 121 (R9/R15): las coordenadas NO se vuelcan al DOM visible; alimentan el
      // minimapa del modal.
      if (mensaje.latitud === null || mensaje.longitud === null) {
        return <p className="text-xs text-muted-foreground">Ubicación compartida</p>;
      }
      return (
        <button
          type="button"
          onClick={() =>
            onAbrirUbicacion({
              lat: mensaje.latitud as number,
              lng: mensaje.longitud as number,
            })
          }
          aria-label="Ver ubicación compartida"
          className="flex items-center gap-1.5 rounded-sm text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          Ubicación compartida
        </button>
      );

    case "imagen":
    case "sticker":
    case "audio":
    case "video":
    case "documento":
      return (
        <>
          <MediaAdjunto
            mensajeId={mensaje.id}
            tipo={mensaje.tipo}
            media={mensaje.media}
            caption={mensaje.cuerpo}
          />
          {mensaje.tipo === "imagen" || mensaje.tipo === "sticker" ? null : (
            <Caption cuerpo={mensaje.cuerpo} />
          )}
        </>
      );

    case "contactos":
      if (mensaje.contactos === null || mensaje.contactos.length === 0) {
        return <p className="text-xs text-muted-foreground">Contacto compartido</p>;
      }
      return <TarjetaContacto contactos={mensaje.contactos} />;

    case "sistema":
      // Normalmente esta fila la pinta `BurbujaSistema` (fila centrada, R32). Este ramal
      // existe para que el switch sea exhaustivo y para que el contenido nunca quede vacio.
      return (
        <p className="text-xs text-muted-foreground">
          <TextoCambioNumero sistema={mensaje.sistema} />
        </p>
      );

    case "reaccion":
      // R19/D4: las reacciones llegan ANCLADAS a su mensaje y no deberian aparecer como
      // burbuja. Si una se colara (hilo antiguo, objetivo purgado), se dice; no se deja vacia.
      return <p className="text-xs text-muted-foreground">Reacción a un mensaje</p>;

    case "otro":
      return <p className="text-xs italic text-muted-foreground">{AVISO_NO_COMPATIBLE}</p>;

    default: {
      const exhaustivo: never = mensaje.tipo;
      return <p className="text-xs italic text-muted-foreground">{String(exhaustivo)}</p>;
    }
  }
}
