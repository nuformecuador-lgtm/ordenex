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
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { primerDiaMovimientoAdmisible, problemaDeFechaMovimiento } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import {
  CONCEPTO_MANUAL_OPTIONS,
  CONCEPTOS_MANUALES,
  conceptoPorId,
  nombreEnElLibro,
  type ConceptoManual,
} from "./wallet-conceptos-manuales";
import { montoValido } from "./wallet-labels";

// Ficha 334 (T D3, design §10) — el ÚNICO control para mover dinero a mano en la caja
// principal. Sustituye a los dos diálogos que había (`RegistrarMovimientoManualDialog` y
// `RegistrarEgresoAdministrativoDialog`), que pedían lo mismo con dos vocabularios distintos y
// obligaban a adivinar cuál abrir.
//
// Se unifica la INTERFAZ, no el backend (design §6): el concepto elegido decide a qué Server
// Action va el registro, porque los cuatro escriben `origen_tipo` distinto (`gasto` vs
// `manual`) y de ese campo cuelga qué movimiento se puede reversar. Una action única volvería
// reversables los ajustes —un cambio en dinero que nadie pidió— colado en un cambio de forma.
//
// Money-safe (R15): el monto viaja como STRING de punta a punta y NUNCA se convierte a punto
// flotante en este archivo; el borde lo re-valida con aritmetica decimal.
// Mutación interna por Server Action (NO fetch a /api). El movimiento es INMUTABLE (R17): no
// hay editar ni borrar.

/** El concepto que el diálogo trae elegido al abrirse: el primero del catálogo. */
const CONCEPTO_INICIAL: ConceptoManual = CONCEPTOS_MANUALES[0];

interface ErroresCampo {
  monto?: string;
  fecha?: string;
  descripcion?: string;
}

export interface RegistrarMovimientoCajaDialogProps {
  /** Callback opcional para que el módulo recargue su vista (libro + cifras + desglose, R18). */
  onRegistrado?: () => void;
}

export function RegistrarMovimientoCajaDialog({
  onRegistrado,
}: RegistrarMovimientoCajaDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [concepto, setConcepto] = useState<ConceptoManual>(CONCEPTO_INICIAL);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [errores, setErrores] = useState<ErroresCampo>({});
  // La ventana admisible se congela AL ABRIR y no se recalcula en cada render: leer el reloj
  // durante el render haría que el `min`/`max` del campo cambiaran solos a medianoche, debajo
  // de una persona que está escribiendo.
  const [ventana, setVentana] = useState({ min: "", max: "" });

  function reset() {
    const hoy = fechaCalendarioCR();
    setConcepto(CONCEPTO_INICIAL);
    setMonto("");
    // R19: el campo arranca en el día calendario EN CURSO de Costa Rica.
    setFecha(hoy);
    setVentana({ min: primerDiaMovimientoAdmisible(), max: hoy });
    setDescripcion("");
    setErrores({});
  }

  function abrir() {
    reset();
    setOpen(true);
  }

  function elegirConcepto(id: string) {
    const siguiente = conceptoPorId(id);
    if (!siguiente) return; // el `Select` solo emite ids del catálogo; esto es la red.
    setConcepto(siguiente);
    // La descripción ya escrita se conserva: cambiar de concepto no borra lo tecleado, solo
    // cambia con qué nombre se pide. El error de descripción sí se limpia (era de otro rótulo).
    setErrores((previos) => ({ ...previos, descripcion: undefined }));
  }

  /** Lo que está mal ANTES de llamar al borde (que re-valida todo, R14/R20/R21). */
  function validar(): ErroresCampo {
    const nuevos: ErroresCampo = {};
    if (!montoValido(monto)) {
      nuevos.monto = "El monto debe ser un número mayor que 0.";
    }
    // Los textos de rechazo son los MISMOS que emite el borde (`problemaDeFechaMovimiento`):
    // el cliente no inventa una segunda redacción de la misma regla.
    const problemaFecha = problemaDeFechaMovimiento(fecha);
    if (problemaFecha !== null) nuevos.fecha = problemaFecha;
    if (descripcion.trim().length === 0) {
      nuevos.descripcion = "La descripción es obligatoria.";
    }
    return nuevos;
  }

  /**
   * R23 — la fecha SOLO viaja si el usuario eligió un día distinto del de hoy. Sin la clave, el
   * movimiento se fecha con el instante del registro, byte a byte como hasta hoy: ese es todo
   * el coste de la ampliación, y por eso el registro del día en curso sigue encabezando el libro.
   */
  function fechaAEnviar(): string | undefined {
    return fecha === fechaCalendarioCR() ? undefined : fecha;
  }

  async function registrar() {
    const elegida = fechaAEnviar();
    const comun = {
      monto: monto.trim(),
      descripcion: descripcion.trim(),
      ...(elegida === undefined ? {} : { fecha: elegida }),
    };

    if (concepto.destino.clase === "egreso_administrativo") {
      return registrarEgresoAdministrativoAction({
        tipoEgreso: concepto.destino.tipoEgreso,
        ...comun,
      });
    }
    return registrarMovimientoManualAction({
      tipo: concepto.destino.tipo,
      categoria: concepto.categoria,
      ...comun,
    });
  }

  async function confirmar() {
    const problemas = validar();
    if (problemas.monto || problemas.fecha || problemas.descripcion) {
      setErrores(problemas);
      return;
    }

    const result = await registrar();

    if (result.status === "ok") {
      toast.success("Movimiento registrado correctamente.");
      setOpen(false);
      reset();
      onRegistrado?.(); // R18: el módulo relee libro, cifras y desglose
      router.refresh(); // datos frescos server-side
      return;
    }
    if (result.status === "validation_error") {
      setErrores({
        monto: result.fieldErrors.monto?.[0],
        fecha: result.fieldErrors.fecha?.[0],
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
        title="Registrar movimiento en la caja"
        description="Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado."
        confirmLabel="Registrar"
        onConfirm={confirmar}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="movimiento-concepto">Concepto</Label>
            <Select
              id="movimiento-concepto"
              aria-label="Concepto del movimiento"
              aria-describedby="movimiento-concepto-libro"
              value={concepto.id}
              onValueChange={elegirConcepto}
              options={CONCEPTO_MANUAL_OPTIONS}
            />
            {/* R4: con qué nombre aparecerá el movimiento en el libro, para que nadie tenga que
                registrarlo primero y buscarlo después para averiguarlo. */}
            <p id="movimiento-concepto-libro" className="text-sm text-muted-foreground">
              Se registra en el libro como «{nombreEnElLibro(concepto)}».
            </p>
          </div>

          <FormField id="movimiento-monto" label="Monto" error={errores.monto}>
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
            id="movimiento-fecha"
            label="Fecha"
            error={errores.fecha}
            hint="Poné el día en que ocurrió. Podés elegir un día anterior si lo estás registrando después."
          >
            {(control) => (
              <Input
                {...control}
                aria-required="true"
                type="date"
                value={fecha}
                min={ventana.min}
                max={ventana.max}
                onChange={(e) => {
                  setFecha(e.target.value);
                  if (errores.fecha) setErrores((p) => ({ ...p, fecha: undefined }));
                }}
              />
            )}
          </FormField>

          <FormField
            id="movimiento-descripcion"
            label={concepto.descripcionLabel}
            error={errores.descripcion}
          >
            {(control) => (
              <textarea
                {...control}
                aria-required="true"
                aria-label={concepto.descripcionLabel}
                value={descripcion}
                onChange={(e) => {
                  setDescripcion(e.target.value);
                  if (errores.descripcion)
                    setErrores((p) => ({ ...p, descripcion: undefined }));
                }}
                rows={3}
                placeholder={concepto.descripcionPlaceholder}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </FormField>
        </div>
      </Modal>
    </>
  );
}
