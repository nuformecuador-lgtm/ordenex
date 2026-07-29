"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";

const MENSAJE_ERROR_CAMARA_DEFAULT =
  "No se pudo acceder a la cámara. Debes habilitar los permisos de cámara en la configuración del navegador para usar esta función.";

export interface QrScannerProps {
  /** Se invoca con el texto decodificado, tras cerrar la cámara. */
  onDecoded: (texto: string) => void;
  /** Bloquea el botón (p. ej. mientras el consumidor procesa el texto). */
  disabled?: boolean;
  /** Mensaje del toast cuando la cámara no se puede abrir (permisos). */
  mensajeErrorCamara?: string;
}

/**
 * Escáner de QR reutilizable: encapsula el botón de abrir/cerrar cámara, el ciclo
 * de vida de `html5-qrcode` (import dinámico: la lib toca window/navigator, nunca
 * en SSR), el visor y el error de permisos. NO sabe qué significa el texto
 * decodificado: eso lo decide el consumidor via `onDecoded`.
 */
export function QrScanner({
  onDecoded,
  disabled = false,
  mensajeErrorCamara = MENSAJE_ERROR_CAMARA_DEFAULT,
}: Readonly<QrScannerProps>) {
  const toast = useToast();
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  // Entre abrir el visor y el primer frame hay un hueco (permisos + arranque de la
  // lib): sin esto el usuario mira un rectangulo negro sin saber si algo pasa. Se
  // enciende en el propio clic (no en un efecto) y se apaga cuando la camara arranca.
  const [iniciando, setIniciando] = useState(false);

  const regionId = useId().replace(/:/g, "_") + "-camara";

  // El efecto NO puede depender de estas tres: `onDecoded` y `toast` cambian de
  // identidad en cada render de los consumidores (p. ej. `useQrNavigate` la
  // recrea al mover su flag `procesando`), y tenerlas en las deps limpiaba el
  // efecto y RE-ARRANCABA la cámara, que volvía a decodificar el mismo QR en
  // bucle. Las leemos por ref: siempre la versión fresca, cero churn de deps.
  const onDecodedRef = useRef(onDecoded);
  const toastRef = useRef(toast);
  const mensajeErrorCamaraRef = useRef(mensajeErrorCamara);
  useEffect(() => {
    onDecodedRef.current = onDecoded;
    toastRef.current = toast;
    mensajeErrorCamaraRef.current = mensajeErrorCamara;
  });

  useEffect(() => {
    if (!camaraAbierta) return;
    let cancelado = false;
    let iniciado = false;
    // html5-qrcode sigue entregando frames (~fps) hasta que `stop()` resuelve,
    // que es asíncrono: sin este pestillo el primer QR dispara `onDecoded` una
    // vez por frame. Un `useState` no serviría — el callback vive en la clausura
    // que `start()` capturó y nunca vería el valor nuevo.
    let entregado = false;
    let instancia: {
      stop: () => Promise<void>;
      clear: () => void;
    } | null = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelado) return;
        const scanner = new Html5Qrcode(regionId);
        instancia = scanner as unknown as typeof instancia;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            if (entregado || cancelado) return;
            entregado = true;
            setCamaraAbierta(false);
            onDecodedRef.current(decodedText);
          },
          undefined,
        );
        iniciado = true;
        if (!cancelado) setIniciando(false);
      } catch {
        if (!cancelado) {
          toastRef.current.error(mensajeErrorCamaraRef.current);
          setIniciando(false);
          setCamaraAbierta(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      const s = instancia;
      if (!s) return;
      if (iniciado) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      } else {
        try {
          s.clear();
        } catch {
          // ignora si clear falla
        }
      }
    };
  }, [camaraAbierta, regionId]);

  if (!camaraAbierta || disabled) {
    return (
      <button
        type="button"
        // El nombre accesible se fija a mano: el boton lleva dos lineas de texto y
        // sin esto se leeria "Escanear con camara Apunta al codigo de la guia".
        aria-label="Escanear con cámara"
        aria-pressed={camaraAbierta}
        disabled={disabled}
        onClick={() => {
          setIniciando(true);
          setCamaraAbierta(true);
        }}
        className="group flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          <Camera className="size-6" aria-hidden="true" />
        </span>
        <span className="space-y-0.5">
          <span className="block text-sm font-medium text-card-foreground">
            Escanear con cámara
          </span>
          <span className="block text-xs text-muted-foreground">
            Apunta al código de la guía
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <div className="relative aspect-[4/3] w-full">
        {/* html5-qrcode inyecta SU <video> dentro de esta region; los selectores de
            hijo lo hacen llenar el marco en vez de quedar centrado a su tamaño. */}
        <div
          id={regionId}
          role="region"
          aria-label="Visor de cámara QR"
          className="size-full [&_canvas]:hidden [&_video]:size-full [&_video]:object-cover"
        />

        {iniciando ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
            <Loader2
              className="size-6 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="text-sm">Iniciando cámara…</span>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Recuadro de enfoque: la mascara oscura de alrededor la pinta la sombra
                gigante del propio recuadro, asi no hacen falta cuatro divs de borde. */}
            <div className="relative aspect-square w-[62%] rounded-lg">
              <div className="absolute inset-0 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              <span className="absolute -top-0.5 -left-0.5 size-7 rounded-tl-lg border-t-4 border-l-4 border-primary" />
              <span className="absolute -top-0.5 -right-0.5 size-7 rounded-tr-lg border-t-4 border-r-4 border-primary" />
              <span className="absolute -bottom-0.5 -left-0.5 size-7 rounded-bl-lg border-b-4 border-l-4 border-primary" />
              <span className="absolute -right-0.5 -bottom-0.5 size-7 rounded-br-lg border-r-4 border-b-4 border-primary" />
              <div className="animate-scanline absolute inset-x-3 h-0.5 rounded-full bg-primary shadow-primary/70 shadow-[0_0_12px_2px]" />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-white/70">
          <ScanLine className="size-4 text-primary" aria-hidden="true" />
          Buscando código…
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={camaraAbierta}
          onClick={() => {
            setIniciando(false);
            setCamaraAbierta(false);
          }}
        >
          Cerrar cámara
        </Button>
      </div>
    </div>
  );
}
