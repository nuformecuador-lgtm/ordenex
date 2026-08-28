"use client";

import { AlertTriangle, Download, FileText, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChatMediaVista } from "@/lib/types/chat-whatsapp";

import { urlMediaChat, useMediaChat } from "./hooks/useMediaChat";

// Feature 299 (R24/R27/R28/R29) — el adjunto de una burbuja: imagen, sticker, audio, video o
// documento.
//
// QUE SE BAJA SOLO Y QUE NO (design §7, P3): imagen y sticker se cargan al montar la burbuja
// (es lo que el mensajero espera ver); audio, video y documento esperan a que los pida. El hilo
// se refresca cada 10 s: bajar un video en cada refresco seria gastarle los datos moviles al
// repartidor por nada.
//
// EXPIRACION (R24): el proxy responde `410` cuando Meta ya borro el binario (30 dias). El aviso
// se pinta DENTRO de la burbuja —no como toast— porque pertenece al mensaje y tiene que seguir
// ahi al volver a mirarlo. Nunca se deja un `<img>` roto.

/** Tipos de mensaje que llevan adjunto. */
export type TipoMediaChat = "imagen" | "sticker" | "audio" | "video" | "documento";

const TEXTO_EXPIRADO =
  "Este archivo ya no está disponible (WhatsApp lo elimina a los 30 días).";

const NOMBRE_DOCUMENTO_POR_DEFECTO = "Documento adjunto";

export interface MediaAdjuntoProps {
  /** Id INTERNO del mensaje: es lo que la ruta proxy autoriza. */
  mensajeId: string;
  tipo: TipoMediaChat;
  media: ChatMediaVista | null;
  /** Pie de foto, si vino (R2). Se usa como texto alternativo de la imagen. */
  caption: string | null;
}

/**
 * Tamaño legible; solo se muestra cuando Meta lo mandó (P2: casi nunca).
 *
 * El decimal se redondea a mano y NO con `toFixed`: la guardia 230 prohíbe `.toFixed(` en
 * `app/**` (un importe serializado a mano se salta el formateador de moneda), y aunque aquí
 * sean bytes, la guardia mira la forma, no la intención. Un MB no necesita más precisión.
 */
function tamanoLegible(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Aviso in-burbuja de que el binario ya no existe en Meta (R24). Texto, no solo icono. */
function AvisoExpirado() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{TEXTO_EXPIRADO}</span>
    </p>
  );
}

function AvisoError({ children }: Readonly<{ children: string }>) {
  return (
    <p role="alert" className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Botón de "traer el archivo" para los tipos que no cargan solos. */
function BotonCargar({
  etiqueta,
  onClick,
}: Readonly<{ etiqueta: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Play className="size-3.5 shrink-0" aria-hidden="true" />
      {etiqueta}
    </button>
  );
}

function ImagenAdjunta({
  mensajeId,
  tipo,
  caption,
}: Readonly<{ mensajeId: string; tipo: "imagen" | "sticker"; caption: string | null }>) {
  const { estado, url } = useMediaChat(mensajeId, true);
  // R28: el `alt` nunca queda vacio. Con pie de foto se usa el pie (es lo que describe la
  // imagen); sin el, una etiqueta que dice QUE es y de QUIEN vino.
  const alternativo =
    caption !== null && caption.trim() !== ""
      ? caption
      : tipo === "sticker"
        ? "Sticker enviado por el cliente"
        : "Imagen enviada por el cliente";

  if (estado === "expirado") return <AvisoExpirado />;
  if (estado === "error") return <AvisoError>No se pudo cargar la imagen.</AvisoError>;
  if (estado !== "listo" || url === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {tipo === "sticker" ? "Cargando sticker…" : "Cargando imagen…"}
      </p>
    );
  }

  return (
    // Es un object URL (`blob:`) de un binario que sirve NUESTRO proxy: `next/image` no puede
    // optimizarlo ni conoce sus dimensiones, y con `unoptimized` no aporta nada.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alternativo}
      className={cn(
        "rounded-lg object-contain",
        tipo === "sticker" ? "max-h-32 w-auto" : "max-h-64 w-full",
      )}
    />
  );
}

function ReproductorAdjunto({
  mensajeId,
  tipo,
}: Readonly<{ mensajeId: string; tipo: "audio" | "video" }>) {
  const { estado, url, activar } = useMediaChat(mensajeId, false);
  const nombreAccesible =
    tipo === "audio" ? "Nota de voz del cliente" : "Video enviado por el cliente";

  if (estado === "expirado") return <AvisoExpirado />;
  if (estado === "error")
    return <AvisoError>No se pudo cargar el archivo. Inténtalo de nuevo.</AvisoError>;
  if (estado === "cargando")
    return <p className="text-xs text-muted-foreground">Cargando archivo…</p>;
  if (estado !== "listo" || url === null) {
    return (
      <BotonCargar
        etiqueta={tipo === "audio" ? "Reproducir nota de voz" : "Reproducir video"}
        onClick={activar}
      />
    );
  }

  // R28: controles nativos + nombre accesible. `controls` sin nombre deja al lector de
  // pantalla anunciando "reproductor" a secas.
  return tipo === "audio" ? (
    <audio controls src={url} aria-label={nombreAccesible} className="w-56 max-w-full">
      <track kind="captions" />
    </audio>
  ) : (
    <video
      controls
      src={url}
      aria-label={nombreAccesible}
      className="max-h-64 w-full rounded-lg"
    >
      <track kind="captions" />
    </video>
  );
}

function DocumentoAdjunto({
  mensajeId,
  media,
}: Readonly<{ mensajeId: string; media: ChatMediaVista }>) {
  // R29: el nombre del archivo es TEXTO visible (no solo un icono) y la descarga es un enlace
  // real al proxy con `?descarga=1`, que responde `attachment` con el nombre saneado (R25).
  const nombre =
    media.nombre !== null && media.nombre.trim() !== ""
      ? media.nombre
      : NOMBRE_DOCUMENTO_POR_DEFECTO;
  const tamano = tamanoLegible(media.tamanoBytes);

  return (
    <div className="flex items-center gap-2">
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{nombre}</p>
        {tamano === null ? null : (
          <p className="text-[10px] text-muted-foreground">{tamano}</p>
        )}
      </div>
      <a
        href={urlMediaChat(mensajeId, true)}
        download={nombre}
        className="ml-auto flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Download className="size-3.5 shrink-0" aria-hidden="true" />
        Descargar
      </a>
    </div>
  );
}

export function MediaAdjunto({
  mensajeId,
  tipo,
  media,
  caption,
}: Readonly<MediaAdjuntoProps>) {
  // Sin metadatos de adjunto no hay nada que pedirle al proxy: la burbuja lo DICE en vez de
  // quedarse vacia (R27).
  if (media === null) return <AvisoError>Adjunto no disponible.</AvisoError>;

  if (tipo === "imagen" || tipo === "sticker") {
    return <ImagenAdjunta mensajeId={mensajeId} tipo={tipo} caption={caption} />;
  }
  if (tipo === "audio" || tipo === "video") {
    return <ReproductorAdjunto mensajeId={mensajeId} tipo={tipo} />;
  }
  return <DocumentoAdjunto mensajeId={mensajeId} media={media} />;
}
