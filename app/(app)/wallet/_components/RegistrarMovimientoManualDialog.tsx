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
import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

import { TIPO_LABEL } from "./wallet-labels";

// Feature 42 (T13, R15) — diálogo de movimiento manual de AJUSTE (solo maestro; la
// página ya validó el rol). Mutación interna por Server Action (NO fetch a /api). La
// categoría se DERIVA del tipo (ingreso→ingreso_ajuste, egreso→egreso_ajuste). El
// movimiento es INMUTABLE: no hay editar/borrar. Money-safe: el monto viaja como STRING
// y se valida >0 con regex (sin parseFloat/Number); el backend re-valida con Decimal.

const TIPO_OPTIONS = (["ingreso", "egreso"] as const).map((tipo) => ({
  value: tipo,
  label: TIPO_LABEL[tipo],
}));

/** Deriva la categoría de ajuste a partir del tipo (R15). */
function categoriaDe(tipo: WalletMovimientoTipo): "ingreso_ajuste" | "egreso_ajuste" {
  return tipo === "ingreso" ? "ingreso_ajuste" : "egreso_ajuste";
}

/** Monto STRING con hasta 2 decimales y > 0 (al menos un dígito distinto de cero). */
function montoValido(monto: string): boolean {
  const limpio = monto.trim();
  return /^\d+(\.\d{1,2})?$/.test(limpio) && /[1-9]/.test(limpio);
}

export interface RegistrarMovimientoManualDialogProps {
  /** Callback opcional para que el módulo recargue su vista tras registrar. */
  onRegistrado?: () => void;
}

export function RegistrarMovimientoManualDialog({
  onRegistrado,
}: RegistrarMovimientoManualDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<WalletMovimientoTipo>("ingreso");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [errores, setErrores] = useState<{ monto?: string; descripcion?: string }>({});

  function reset() {
    setTipo("ingreso");
    setMonto("");
    setDescripcion("");
    setErrores({});
  }

  function abrir() {
    reset();
    setOpen(true);
  }

  async function confirmar() {
    // Validación en cliente (el backend re-valida, R15).
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

    const result = await registrarMovimientoManualAction({
      tipo,
      categoria: categoriaDe(tipo),
      monto: monto.trim(),
      descripcion: descripcion.trim(),
    });

    if (result.status === "ok") {
      toast.success("Movimiento registrado correctamente.");
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
      toast.error("No tenés permiso para registrar movimientos.");
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  return (
    <>
      <Button type="button" onClick={abrir}>
        Registrar movimiento
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title="Registrar movimiento manual"
        description="Ajuste de ingreso o egreso. El movimiento es inmutable una vez registrado."
        confirmLabel="Registrar"
        onConfirm={confirmar}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-tipo">Tipo</Label>
            <Select
              aria-label="Tipo de movimiento"
              value={tipo}
              onValueChange={(v) => setTipo(v as WalletMovimientoTipo)}
              options={TIPO_OPTIONS}
            />
          </div>

          <FormField id="manual-monto" label="Monto" error={errores.monto}>
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
            id="manual-descripcion"
            label="Descripción"
            error={errores.descripcion}
          >
            {(control) => (
              <textarea
                {...control}
                aria-required="true"
                value={descripcion}
                onChange={(e) => {
                  setDescripcion(e.target.value);
                  if (errores.descripcion)
                    setErrores((p) => ({ ...p, descripcion: undefined }));
                }}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </FormField>
        </div>
      </Modal>
    </>
  );
}
