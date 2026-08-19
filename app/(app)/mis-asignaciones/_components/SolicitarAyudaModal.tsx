"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Label } from "@/components/ui/label";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { MOTIVO_AYUDA_MAX } from "@/lib/types/orden-ayuda";

// Pedido humano 2026-08-18 — modal de «Solicitar ayuda» del panel del mensajero.
//
// Copia deliberada de `HabilitarNovedadModal`: motivo OBLIGATORIO, error que no se pinta hasta
// que el campo se toca y botón deshabilitado desde el primer instante (la regla se comunica sin
// regañar). La diferencia con aquél es que aquí SÍ hay borde detrás — `solicitarAyudaOrden`
// revalida con zod y el service de notas vuelve a recortar—, así que esta guarda es lo que es:
// de superficie, no la que protege el dato.
//
// El tope se toma de `MOTIVO_AYUDA_MAX`, que es el de una nota del hilo, porque el motivo ACABA
// siendo una nota del hilo. Escribir aquí un 200 a mano sería el mismo número dos veces.

export interface SolicitarAyudaModalProps {
  /**
   * Orden sobre la que se pide ayuda (snapshot). El padre monta el modal SOLO cuando está
   * abierto y con `key={orden.id}`, así el motivo arranca fresco en cada apertura sin efecto de
   * reinicio — mismo patrón que los modales de `/novedades`.
   */
  orden: MiAsignacionDTO;
  onOpenChange: (open: boolean) => void;
  /** Confirmación con el motivo YA recortado y nunca vacío. */
  onConfirmar: (motivo: string) => void | Promise<void>;
  /** `true` mientras la Server Action está en vuelo: bloquea la confirmación. */
  enviando: boolean;
}

export function SolicitarAyudaModal({
  orden,
  onOpenChange,
  onConfirmar,
  enviando,
}: SolicitarAyudaModalProps) {
  const [motivo, setMotivo] = useState("");
  const [tocado, setTocado] = useState(false);

  const motivoLimpio = motivo.trim();
  const motivoInvalido = motivoLimpio === "";
  const mostrarError = tocado && motivoInvalido;

  const guia =
    orden.numGuia !== null ? `guía ${orden.numGuia}` : "sin guía asignada";

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Solicitar ayuda"
      description={`Contá qué está pasando con la orden de ${orden.destinatario} (${guia}). Tu tienda lo verá en Novedades.`}
      confirmLabel="Solicitar ayuda"
      confirmDisabled={motivoInvalido || enviando}
      onConfirm={() => onConfirmar(motivoLimpio)}
      size="sm"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ayuda-motivo">
          Motivo{" "}
          <span className="font-normal text-muted-foreground">(obligatorio)</span>
        </Label>
        <textarea
          id="ayuda-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onBlur={() => setTocado(true)}
          rows={3}
          required
          maxLength={MOTIVO_AYUDA_MAX}
          aria-invalid={mostrarError || undefined}
          aria-describedby={
            mostrarError ? "ayuda-motivo-error" : "ayuda-motivo-limite"
          }
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input/30"
        />
        {mostrarError ? (
          <p id="ayuda-motivo-error" role="alert" className="text-sm text-destructive">
            El motivo es obligatorio.
          </p>
        ) : (
          <p id="ayuda-motivo-limite" className="text-xs text-muted-foreground">
            {`Hasta ${MOTIVO_AYUDA_MAX} caracteres. Se publica en las notas de la orden.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
