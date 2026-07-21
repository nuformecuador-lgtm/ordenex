"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  actualizarPlantillaAction,
  crearPlantillaAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

import { montoValido } from "./wallet-labels";

// Feature 45 (T24, R22b/R24/R25) — diálogo de CREAR/EDITAR una plantilla de gasto fijo
// (solo maestro; la página ya validó el rol). Reutilizado por el panel para ambos modos.
// La plantilla es CONFIGURACIÓN (mutable, editable): el cron mensual la lee y emite los
// egresos; este diálogo NUNCA crea un egreso a mano. Money-safe: el monto viaja como STRING
// y se valida >0 con regex (sin parseFloat/Number); el backend re-valida con Decimal. Sin
// borrado (R25): la desactivación (en el panel) es el mecanismo para dejar de generar.

export interface GastoFijoPlantillaDialogProps {
  /** Visibilidad controlada por el panel. */
  open: boolean;
  /** Emite el cierre; el panel actualiza su estado. */
  onOpenChange: (open: boolean) => void;
  /** Plantilla a editar; `null`/ausente = crear una nueva. */
  plantilla?: GastoFijoPlantillaDTO | null;
  /** Callback tras un guardado exitoso (para que el panel recargue la lista). */
  onGuardado?: () => void;
}

export function GastoFijoPlantillaDialog({
  open,
  onOpenChange,
  plantilla = null,
  onGuardado,
}: GastoFijoPlantillaDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const modo = plantilla ? "editar" : "crear";
  const [concepto, setConcepto] = useState(plantilla?.concepto ?? "");
  const [monto, setMonto] = useState(plantilla?.monto ?? "");
  const [errores, setErrores] = useState<{ concepto?: string; monto?: string }>({});
  // Detecta el cambio de plantilla/modo para re-sembrar los campos cuando el panel reabre
  // el diálogo con otra fila (o pasa de editar a crear) sin desmontarlo.
  const [ultimaId, setUltimaId] = useState<string | null>(plantilla?.id ?? null);
  if ((plantilla?.id ?? null) !== ultimaId) {
    setUltimaId(plantilla?.id ?? null);
    setConcepto(plantilla?.concepto ?? "");
    setMonto(plantilla?.monto ?? "");
    setErrores({});
  }

  async function confirmar() {
    // Validación en cliente (el backend re-valida, R24).
    const nuevosErrores: { concepto?: string; monto?: string } = {};
    if (concepto.trim().length === 0) {
      nuevosErrores.concepto = "El concepto es obligatorio.";
    }
    if (!montoValido(monto)) {
      nuevosErrores.monto = "El monto debe ser un número mayor que 0.";
    }
    if (nuevosErrores.concepto || nuevosErrores.monto) {
      setErrores(nuevosErrores);
      return;
    }

    const result =
      modo === "editar" && plantilla
        ? await actualizarPlantillaAction({
            id: plantilla.id,
            concepto: concepto.trim(),
            monto: monto.trim(),
          })
        : await crearPlantillaAction({
            concepto: concepto.trim(),
            monto: monto.trim(),
          });

    if (result.status === "ok") {
      toast.success(
        modo === "editar" ? "Plantilla actualizada." : "Plantilla creada.",
      );
      onOpenChange(false);
      onGuardado?.();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      setErrores({
        concepto: result.fieldErrors.concepto?.[0],
        monto: result.fieldErrors.monto?.[0],
      });
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para administrar plantillas.");
      return;
    }
    if (result.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      onOpenChange(false);
      onGuardado?.();
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        modo === "editar"
          ? "Editar plantilla de gasto fijo"
          : "Nueva plantilla de gasto fijo"
      }
      description="El sistema genera el egreso de este gasto automáticamente cada mes."
      confirmLabel="Guardar"
      onConfirm={confirmar}
      closeOnConfirm={false}
    >
      <div className="flex flex-col gap-4">
        <FormField id="plantilla-concepto" label="Concepto" error={errores.concepto}>
          {(control) => (
            <Input
              {...control}
              aria-required="true"
              value={concepto}
              onChange={(e) => {
                setConcepto(e.target.value);
                if (errores.concepto)
                  setErrores((p) => ({ ...p, concepto: undefined }));
              }}
              placeholder="Ej. Alquiler de bodega"
            />
          )}
        </FormField>

        <FormField id="plantilla-monto" label="Monto mensual" error={errores.monto}>
          {(control) => (
            <Input
              {...control}
              aria-required="true"
              inputMode="decimal"
              value={monto}
              onChange={(e) => {
                setMonto(e.target.value);
                if (errores.monto) setErrores((p) => ({ ...p, monto: undefined }));
              }}
              placeholder="0.00"
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
