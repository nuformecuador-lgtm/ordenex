"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import type { TipoEgresoManual } from "@/lib/types/wallet";

import {
  DESCRIPCION_EGRESO_LABEL,
  DESCRIPCION_EGRESO_PLACEHOLDER,
  TIPO_EGRESO_MANUAL_OPTIONS,
  montoValido,
} from "./wallet-labels";

// Feature 45 (T9, R22a/R4/R5/R19) — diálogo de EGRESO administrativo MANUAL (solo maestro;
// la página ya validó el rol). Registra un gasto variable o un sueldo como fila de egreso
// inmutable en la caja principal, vía Server Action (NO fetch a /api). El selector de tipo
// se limita a {gasto variable, sueldo}: el gasto FIJO lo emite el cron mensual, no este form
// (R2/R19/R27). El label de la descripción se adapta al tipo (concepto vs. trabajador+periodo,
// F1.4-c). Money-safe: el monto viaja como STRING y se valida >0 con regex (sin parseFloat/
// Number); el backend re-valida con Decimal.

export interface RegistrarEgresoAdministrativoDialogProps {
  /** Callback opcional para que el módulo recargue su vista (libro + balance + desglose). */
  onRegistrado?: () => void;
}

export function RegistrarEgresoAdministrativoDialog({
  onRegistrado,
}: RegistrarEgresoAdministrativoDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [tipoEgreso, setTipoEgreso] = useState<TipoEgresoManual>("gasto_variable");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [errores, setErrores] = useState<{ monto?: string; descripcion?: string }>({});

  function reset() {
    setTipoEgreso("gasto_variable");
    setMonto("");
    setDescripcion("");
    setErrores({});
  }

  function abrir() {
    reset();
    setOpen(true);
  }

  async function confirmar() {
    // Validación en cliente (el backend re-valida, R4/R5/R19).
    const nuevosErrores: { monto?: string; descripcion?: string } = {};
    if (!montoValido(monto)) {
      nuevosErrores.monto = "El monto debe ser un número mayor que 0.";
    }
    if (descripcion.trim().length === 0) {
      nuevosErrores.descripcion = "La descripción es obligatoria.";
    }
    if (nuevosErrores.monto || nuevosErrores.descripcion) {
      setErrores(nuevosErrores);
      return;
    }

    const result = await registrarEgresoAdministrativoAction({
      tipoEgreso,
      monto: monto.trim(),
      descripcion: descripcion.trim(),
    });

    if (result.status === "ok") {
      toast.success("Egreso registrado correctamente.");
      setOpen(false);
      reset();
      onRegistrado?.();
      router.refresh(); // datos frescos server-side
      return;
    }
    if (result.status === "validation_error") {
      setErrores({
        monto: result.fieldErrors.monto?.[0],
        descripcion: result.fieldErrors.descripcion?.[0],
      });
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para registrar egresos.");
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={abrir}>
        Registrar egreso
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title="Registrar egreso administrativo"
        description="Gasto variable o sueldo. El movimiento es inmutable una vez registrado."
        confirmLabel="Registrar"
        onConfirm={confirmar}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="egreso-tipo">Tipo</Label>
            <Select
              aria-label="Tipo de egreso"
              value={tipoEgreso}
              onValueChange={(v) => setTipoEgreso(v as TipoEgresoManual)}
              options={TIPO_EGRESO_MANUAL_OPTIONS}
            />
          </div>

          <FormField id="egreso-monto" label="Monto" error={errores.monto}>
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

          <FormField
            id="egreso-descripcion"
            label={DESCRIPCION_EGRESO_LABEL[tipoEgreso]}
            error={errores.descripcion}
          >
            {(control) => (
              <textarea
                {...control}
                aria-required="true"
                aria-label={DESCRIPCION_EGRESO_LABEL[tipoEgreso]}
                value={descripcion}
                onChange={(e) => {
                  setDescripcion(e.target.value);
                  if (errores.descripcion)
                    setErrores((p) => ({ ...p, descripcion: undefined }));
                }}
                rows={3}
                placeholder={DESCRIPCION_EGRESO_PLACEHOLDER[tipoEgreso]}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </FormField>
        </div>
      </Modal>
    </>
  );
}
