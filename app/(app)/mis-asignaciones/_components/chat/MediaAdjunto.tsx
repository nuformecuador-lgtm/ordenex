"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Download, FileText, Play, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChatMediaVista } from "@/lib/types/chat-whatsapp";

import { urlMediaChat, useMediaChat } from "./hooks/useMediaChat";

// Feature 311 (R24/R27/R28/R29) — el adjunto de una burbuja: imagen, sticker, audio, video o
// documento.
//
// QUE SE BAJA SOLO Y QUE NO (design §7, P3): imagen y sticker se cargan al montar la burbuja
// (es lo que el mensajero espera ver); audio, video y documento esperan a que los pida. El hilo
// se refresca cada 10 s: bajar un video en cada refresco seria gastarle los datos moviles al
// repartidor por nada.
//
// EXPIRACION (R24): el proxy responde `410` cuando Meta no entrega el binario: tanto si ya lo
// borro por antiguedad (30 dias) como si el `media_id` no existe alli (Meta devuelve el mismo
// `code: 100` en ambos casos). Por eso el TEXTO VISIBLE no promete los 30 dias: no siempre es
// cierto. El aviso se pinta DENTRO de la burbuja —no como toast— porque pertenece al mensaje y
// tiene que seguir ahi al volver a mirarlo. Nunca se deja un `<img>` roto.

/** Tipos de mensaje que llevan adjunto. */
export type TipoMediaChat = "imagen" | "sticker" | "audio" | "video" | "documento";

const TEXTO_EXPIRADO = "Este archivo ya no está disponible.";

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

/**
 * Botón de "traer el archivo" para los tipos que no cargan solos, y también el de reintentar
 * (misma pieza, otro icono y otra etiqueta: no se duplican los estilos).
 *
 * `nombreAccesible` existe porque en un mismo hilo puede haber VARIAS burbujas fallidas: un
 * botón que solo dice "Reintentar" se repite y el lector de pantalla no los distingue.
 */
function BotonCargar({
  etiqueta,
  onClick,
  nombreAccesible,
  Icono = Play,
}: Readonly<{
  etiqueta: string;
  onClick: () => void;
  nombreAccesible?: string;
  Icono?: LucideIcon;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={nombreAccesible}
      className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icono className="size-3.5 shrink-0" aria-hidden="true" />
      {etiqueta}
    </button>
  );
}

/** Etiqueta VISIBLE del reintento; el nombre accesible lo distingue por adjunto. */
const TEXTO_REINTENTAR = "Reintentar";

/**
 * Aviso (texto visible, R24/R27) + salida del callejón sin salida: hasta ahora un adjunto que
 * fallaba quedaba muerto hasta desmontar la burbuja.
 */
function AvisoConReintento({
  nombreAccesible,
  onReintentar,
  children,
}: Readonly<{
  nombreAccesible: string;
  onReintentar: () => void;
  children: ReactNode;
}>) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <BotonCargar
        etiqueta={TEXTO_REINTENTAR}
        nombreAccesible={nombreAccesible}
        Icono={RotateCcw}
        onClick={onReintentar}
      />
    </div>
  );
}

function ImagenAdjunta({
  mensajeId,
  tipo,
  caption,
}: Readonly<{ mensajeId: string; tipo: "imagen" | "sticker"; caption: string | null }>) {
  const { estado, url, activar } = useMediaChat(mensajeId, true);
  // R28: el `alt` nunca queda vacio. Con pie de foto se usa el pie (es lo que describe la
  // imagen); sin el, una etiqueta que dice QUE es y de QUIEN vino.
  const alternativo =
    caption !== null && caption.trim() !== ""
      ? caption
      : tipo === "sticker"
        ? "Sticker enviado por el cliente"
        : "Imagen enviada por el cliente";

  const reintentoAccesible =
    tipo === "sticker"
      ? "Reintentar la descarga del sticker"
      : "Reintentar la descarga de la imagen";

  if (estado === "expirado" || estado === "error") {
    return (
      <AvisoConReintento nombreAccesible={reintentoAccesible} onReintentar={activar}>
        {estado === "expirado" ? (
          <AvisoExpirado />
        ) : (
          <AvisoError>No se pudo cargar la imagen.</AvisoError>
        )}
      </AvisoConReintento>
    );
  }
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

  if (estado === "expirado" || estado === "error") {
    return (
      <AvisoConReintento
        nombreAccesible={
          tipo === "audio"
            ? "Reintentar la descarga de la nota de voz"
            : "Reintentar la descarga del video"
        }
        onReintentar={activar}
      >
        {estado === "expirado" ? (
          <AvisoExpirado />
        ) : (
          <AvisoError>No se pudo cargar el archivo. Inténtalo de nuevo.</AvisoError>
        )}
      </AvisoConReintento>
    );
  }
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
