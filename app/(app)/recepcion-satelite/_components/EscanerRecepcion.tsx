"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { recibirPorQr } from "@/lib/actions/recepcion-satelite";
import { extractOrdenIdFromScan } from "@/lib/utils/paquete-url";
import type { RecibirResult } from "@/lib/types/recepcion-satelite";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";

// Feature 33 (T13, R10/R12–R16, decisión F1.4 (a)): recepción por escaneo con
// DOS caminos que resuelven a la MISMA lógica (dado un orden.id → recibirPorQr):
//   1. Lector físico keyboard-wedge: un <input> autofocus donde el lector "teclea"
//      el contenido del QR y termina con Enter (submit del form). R10.
//   2. Cámara del dispositivo: html5-qrcode cargado por import dinámico dentro del
//      Client Component (la lib toca window/navigator → nunca en SSR). Al decodificar
//      un QR resuelve el orden.id y llama la misma acción.
// Feedback por ítem con useToast (un toast por resultado). Tras ok/ya_recibida se
// dispara `onRecibida` (el módulo lo conecta a router.refresh()).

export interface EscanerRecepcionProps {
  /** Se invoca tras una recepción efectiva o idempotente (ok/ya_recibida). */
  onRecibida: () => void;
}

export function EscanerRecepcion({ onRecibida }: EscanerRecepcionProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [valor, setValor] = useState("");
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const regionId = useId().replace(/:/g, "_") + "-camara";
  // Instancia de Html5Qrcode viva mientras la cámara está abierta.
  const scannerRef = useRef<unknown>(null);

  /** Traduce cada resultado de la acción a un toast por ítem (R12–R16). */
  const notificar = useCallback(
    (result: RecibirResult) => {
      switch (result.status) {
        case "ok":
          toast.success(`Orden ${result.ordenId} recibida.`);
          onRecibida();
          break;
        case "ya_recibida":
          toast.info("Esta orden ya estaba recibida.");
          onRecibida();
          break;
        case "zona_ajena":
          toast.error("Esta orden pertenece a otra zona.");
          break;
        case "estado_invalido":
          toast.error(
            `No se puede recibir: la orden está en "${estatusLabel(result.estado)}".`,
          );
          break;
        case "no_encontrada":
          toast.error("Orden no encontrada.");
          break;
        case "validation_error":
          toast.error("Código inválido.");
          break;
        case "sin_zona":
          toast.error("No tienes una zona asignada.");
          break;
        case "forbidden":
          toast.error("No tienes permiso para recibir órdenes.");
          break;
        case "unauthenticated":
          toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
          break;
        case "conflict":
          toast.error("La orden cambió de estado. Vuelve a escanear.");
          break;
      }
    },
    [toast, onRecibida],
  );

  /**
   * Camino común: dado el texto escaneado, recibe la orden. El QR de la etiqueta
   * ahora codifica la URL del paquete (`<origin>/paquete/<ordenId>`), así que se
   * extrae el ordenId del último segmento; sigue aceptando el UUID pelado de
   * etiquetas ya impresas (`extractOrdenIdFromScan`).
   */
  const procesar = useCallback(
    async (escaneado: string) => {
      const limpio = extractOrdenIdFromScan(escaneado);
      if (!limpio || procesando) return;
      setProcesando(true);
      try {
        const result = await recibirPorQr({ ordenId: limpio });
        notificar(result);
      } finally {
        setProcesando(false);
      }
    },
    [notificar, procesando],
  );

  /** Enter (o terminador del lector) → toma el valor, recibe, limpia y re-enfoca. */
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const actual = valor;
    setValor("");
    await procesar(actual);
    inputRef.current?.focus();
  }

  // ---------------- Cámara (import dinámico, sin SSR) ----------------
  useEffect(() => {
    if (!camaraAbierta) return;
    let cancelado = false;
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
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            // Cierra la cámara y procesa el orden.id decodificado.
            setCamaraAbierta(false);
            void procesar(decodedText);
          },
          undefined,
        );
      } catch {
        if (!cancelado) {
          toast.error("No se pudo abrir la cámara.");
          setCamaraAbierta(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      const s = instancia;
      scannerRef.current = null;
      // Defensivo: `start` puede haber fallado dejando un scanner sin ciclo de
      // vida completo (o un doble en tests); solo detenemos si expone `stop`.
      if (s && typeof s.stop === "function") {
        Promise.resolve(s.stop())
          .then(() => {
            if (typeof s.clear === "function") s.clear();
          })
          .catch(() => {
            /* la cámara ya estaba detenida */
          });
      }
    };
  }, [camaraAbierta, regionId, procesar, toast]);

  return (
    <section aria-label="Recepción por escaneo" className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="escaner-input" className="text-sm font-medium">
            Escanear orden (lector o código)
          </label>
          <Input
            id="escaner-input"
            ref={inputRef}
            name="ordenId"
            autoFocus
            autoComplete="off"
            aria-label="Código de la orden"
            placeholder="Escanea el QR o escribe el código y pulsa Enter"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={procesando}
          />
        </div>
        <Button type="submit" disabled={procesando || valor.trim() === ""}>
          Recibir
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-pressed={camaraAbierta}
          onClick={() => setCamaraAbierta((abierta) => !abierta)}
        >
          {camaraAbierta ? "Cerrar cámara" : "Escanear con cámara"}
        </Button>
      </form>

      {camaraAbierta ? (
        <div
          id={regionId}
          role="region"
          aria-label="Lector de cámara"
          className="w-full max-w-sm overflow-hidden rounded-lg border"
        />
      ) : null}
    </section>
  );
}
