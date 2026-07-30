"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { deshacerAsignacion } from "@/lib/actions/deshacer-asignacion";

import {
  MOTIVO_AYUDA,
  MOTIVO_LABEL,
  MOTIVO_MAX_LEN,
  MOTIVO_PLACEHOLDER,
  deshacerAsignacionErrorMessage,
  motivoValido,
} from "./deshacer-asignacion-error-messages";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumplen por estructura tanto
 * `OrdenListItemDTO` (listado del maestro) como `RecepcionSateliteDTO` (bodega satélite), de
 * modo que las DOS superficies comparten un único cuerpo en vez de duplicarlo (design §6.2:
 * "mismo cuerpo que el del maestro, con RecepcionSateliteDTO en vez de OrdenListItemDTO").
 */
export interface DeshacerAsignacionOrdenUI {
  id: string;
  numRemision: string;
  zonaNombre?: string | null;
}

export interface DeshacerAsignacionModalProps {
  open: boolean;
  /** Snapshot del LOTE seleccionado al abrir. Vacío ⇒ el confirmar queda deshabilitado. */
  ordenes: readonly DeshacerAsignacionOrdenUI[];
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre cierra y RELEE el estado del servidor (R38). */
  onSuccess: () => void;
  /** Título del modal; la satélite lo reusa tal cual. Prop para i18n futura. */
  title?: string;
}

const TITULO = "Deshacer asignación";
const CONFIRMAR = "Deshacer asignación";

/**
 * Feature 149 (T6.1, R34/R37/R38/R39) — Modal por LOTE de "Deshacer asignación".
 *
 * - UNA sola llamada a la Server Action con el lote COMPLETO (no un loop `await` por orden como
 *   `RecuperarABodegaModal`): el backend es todo-o-nada por lote (R20), así que partirlo en N
 *   llamadas produciría exactamente el estado parcial que el diseño evita.
 * - Motivo OBLIGATORIO (D4/R22): el confirmar está deshabilitado mientras el texto no valide
 *   (R37) y el handler lo revalida antes de llamar. El servidor sigue siendo la guardia real.
 * - Los fallos van al canal de error del `Modal` y se traducen a un mensaje accionable por causa
 *   (R39), sin exponer identificadores internos (R40).
 */
export function DeshacerAsignacionModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
  title = TITULO,
}: DeshacerAsignacionModalProps) {
  const toast = useToast();
  const motivoId = useId();
  const ayudaId = useId();
  const [motivo, setMotivo] = useState("");

  // Cada apertura arranca con el campo limpio: el motivo describe ESTE lote, no el anterior.
  // Patrón "ajustar estado durante el render" (el mismo de `OrdenesModule` al cambiar de
  // filtro): en un efecto, este `setState` encadenaría un render extra con el motivo viejo
  // ya visible.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) setMotivo("");
  }

  const sinOrdenes = ordenes.length === 0;
  const motivoOk = motivoValido(motivo);

  async function handleConfirm() {
    // R37: guarda redundante con `confirmDisabled` (el Modal ya bloquea el click, pero el
    // handler no debe depender de eso para no llamar a la acción sin motivo).
    if (sinOrdenes || !motivoOk) return;

    const result = await deshacerAsignacion({
      ordenIds: ordenes.map((orden) => orden.id),
      motivo: motivo.trim(),
    });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal (patrón RecuperarABodegaModal)
    }

    // R38: se informa CUÁNTAS órdenes se revirtieron (dato del servidor, no de la selección).
    toast.success(
      `${result.resultados.length} orden(es) devuelta(s) a bodega.`,
    );
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(deshacerAsignacionErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`Se devolverán ${ordenes.length} orden(es) a la bodega desde la que se asignaron y quedarán sin mensajero.`}
      confirmLabel={CONFIRMAR}
      confirmDisabled={sinOrdenes || !motivoOk}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      <div className="flex flex-col gap-4">
        {sinOrdenes ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            Selecciona al menos una orden.
          </p>
        ) : (
          <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
            {ordenes.map((orden) => (
              <li key={orden.id}>
                {orden.numRemision}
                {orden.zonaNombre ? ` — ${orden.zonaNombre}` : ""}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={motivoId} className="text-sm font-medium">
            {MOTIVO_LABEL}
          </label>
          <Textarea
            id={motivoId}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            placeholder={MOTIVO_PLACEHOLDER}
            maxLength={MOTIVO_MAX_LEN}
            rows={3}
            required
            aria-describedby={ayudaId}
            aria-invalid={motivoOk ? undefined : true}
          />
          <p id={ayudaId} className="text-xs text-muted-foreground">
            {MOTIVO_AYUDA}
          </p>
        </div>
      </div>
    </Modal>
  );
}
