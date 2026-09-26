"use client";

import { useId, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { anularMovimientoAction } from "@/lib/actions/wallet-anulacion";
import type { AnularMovimientoResult, DestinoMovimiento } from "@/lib/types/wallet-anulacion";

import { ANULAR_MOVIMIENTO_TEXTO } from "./detalle-movimiento-panel-labels";

// FICHA 458-C (T C.4, design §4.2, R63–R67) — «Anular…» UNIFORME para todo movimiento anulable, por
// la acción ÚNICA `anularMovimientoAction({ destino, motivo })`: el servidor decide el camino (459,
// 461, 457, 172, 293 o los nuevos de la 458-B) y lee el monto del original. Aquí no viaja ningún
// importe (R64/R70 de la 172) ni se decide nada del dinero.
//
// Molde `AnularPagoDialog` (172): motivo obligatorio con DOS barreras (botón deshabilitado y la
// comprobación al confirmar), `closeOnConfirm={false}` para que un rechazo se lea dentro del diálogo,
// `confirmVariant="destructive"`. `ya_anulado` (R66) cierra y relee igual que `ok`, con su propio aviso.
// `no_anulable` (R65) se queda abierto y dice POR QUÉ con el motivo que devolvió el servidor.

export interface AnularMovimientoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El destino que se anula: viaja al servidor y NUNCA se pinta (H6). */
  destino: DestinoMovimiento;
  /** Qué es, en minúscula para el título («el sueldo», «el cobro por rechazo a una tienda»). */
  nombre: string;
  /** La fila en palabras: concepto · fecha · importe ya formateado. */
  resumen: string;
  /** El importe ya formateado (solo se PINTA). */
  montoPintado: string;
  /** Tras `ok` o `ya_anulado`: quien monta relee lo suyo (R60). */
  onAnulado?: (status: "ok" | "ya_anulado") => void;
}

/** El aviso de cada respuesta que NO deja la anulación hecha. Exhaustivo sobre el contrato. */
function avisoDe(r: Exclude<AnularMovimientoResult, { status: "ok" } | { status: "ya_anulado" }>): string {
  switch (r.status) {
    case "no_anulable":
      return ANULAR_MOVIMIENTO_TEXTO.noAnulable(r.motivo);
    case "no_encontrado":
      return ANULAR_MOVIMIENTO_TEXTO.noEncontrado;
    case "forbidden":
      return ANULAR_MOVIMIENTO_TEXTO.forbidden;
    case "unauthenticated":
      return ANULAR_MOVIMIENTO_TEXTO.unauthenticated;
    case "validation_error":
      return ANULAR_MOVIMIENTO_TEXTO.validacion;
  }
}

export function AnularMovimientoDialog({
  open,
  onOpenChange,
  destino,
  nombre,
  resumen,
  montoPintado,
  onAnulado,
}: Readonly<AnularMovimientoDialogProps>) {
  const toast = useToast();
  const idBase = useId();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);
  const motivoLimpio = motivo.trim();

  function cambiarAbierto(siguiente: boolean) {
    if (siguiente) {
      setMotivo("");
      setError(undefined);
      setAviso(null);
    }
    onOpenChange(siguiente);
  }

  async function confirmar() {
    if (motivoLimpio.length === 0) {
      // Segunda barrera: aunque el botón estuviera habilitado, aquí no sale nada (R64).
      setError(ANULAR_MOVIMIENTO_TEXTO.motivoVacio);
      return;
    }
    setError(undefined);
    setAviso(null);

    let r: AnularMovimientoResult;
    try {
      r = await anularMovimientoAction({ destino, motivo: motivoLimpio });
    } catch {
      // Reintentar es seguro: la anulación es única en la base (R66/R67).
      setAviso(ANULAR_MOVIMIENTO_TEXTO.fallo);
      return;
    }

    if (r.status === "ok" || r.status === "ya_anulado") {
      if (r.status === "ok") toast.success(ANULAR_MOVIMIENTO_TEXTO.ok);
      else toast.info(ANULAR_MOVIMIENTO_TEXTO.yaAnulado);
      cambiarAbierto(false);
      onAnulado?.(r.status);
      return;
    }
    if (r.status === "validation_error") {
      const delCampo = r.fieldErrors.motivo?.[0];
      setError(delCampo);
      setAviso(delCampo ? null : ANULAR_MOVIMIENTO_TEXTO.validacion);
      return;
    }
    setAviso(avisoDe(r));
  }

  return (
    <Modal
      open={open}
      onOpenChange={cambiarAbierto}
      title={ANULAR_MOVIMIENTO_TEXTO.titulo(nombre)}
      description={ANULAR_MOVIMIENTO_TEXTO.descripcion(montoPintado)}
      confirmLabel={ANULAR_MOVIMIENTO_TEXTO.confirmar}
      cancelLabel={ANULAR_MOVIMIENTO_TEXTO.cancelar}
      confirmVariant="destructive"
      // Primera barrera del motivo (R64); `confirmar` es la segunda.
      confirmDisabled={motivoLimpio.length === 0}
      onConfirm={confirmar}
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{resumen}</p>
        {aviso ? (
          <p role="alert" className="text-sm text-destructive">
            {aviso}
          </p>
        ) : null}
        <FormField
          id={`${idBase}-motivo`}
          label={ANULAR_MOVIMIENTO_TEXTO.motivo}
          hint={ANULAR_MOVIMIENTO_TEXTO.motivoAyuda}
          required
          error={error}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
