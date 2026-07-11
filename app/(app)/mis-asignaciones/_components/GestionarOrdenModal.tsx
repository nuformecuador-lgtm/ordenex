"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { GESTION_ALLOWED_MIME } from "@/lib/config/gestion";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { METODO_PAGO_OPTIONS } from "./metodo-pago-options";

// Feature 36 (T17, R11/R17-R30): modal de gestión de UNA orden en reparto con
// selector de 4 resultados y campos CONDICIONALES por resultado (decisión
// F1.4-i). Valida en cliente con el MISMO schema que revalida el servidor
// (gestionarSchema, R24) y envía FormData a la Server Action `gestionar` (soporta
// el File de evidencia nativamente). El resultado de dominio se refleja como
// errores por campo (validation_error) o Toast (conflict/forbidden).

type Resultado = "entregada" | "reprogramada" | "devuelta" | "rechazada";

const RESULTADO_OPTIONS = [
  { value: "entregada", label: "Entregada" },
  { value: "reprogramada", label: "Reprogramar" },
  { value: "devuelta", label: "Devolución" },
  { value: "rechazada", label: "Rechazo" },
];

const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");

export interface GestionarOrdenModalProps {
  open: boolean;
  /** Orden activa a gestionar (ya escogida en backend); `null` mientras no hay. */
  orden: MiAsignacionDTO | null;
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras un "ok" para que el padre cierre y refresque el listado. */
  onSuccess: () => void;
}

/** Primer mensaje de error de un campo (o undefined). */
function firstError(
  errors: Record<string, string[]>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

export function GestionarOrdenModal({
  open,
  orden,
  onOpenChange,
  onSuccess,
}: GestionarOrdenModalProps) {
  const toast = useToast();

  const [resultado, setResultado] = useState<Resultado>("entregada");
  const [montoRecibido, setMontoRecibido] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [fechaReprogramacion, setFechaReprogramacion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Reinicia el formulario al (re)abrir para una orden, sin efecto: patrón
  // "ajustar estado durante el render" (como GenerarGuiaModal).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setResultado("entregada");
      setMontoRecibido(orden?.montoCobrar != null ? String(orden.montoCobrar) : "");
      setMetodoPago("");
      setFechaReprogramacion("");
      setMotivo("");
      setEvidencia(null);
      setFieldErrors({});
    }
  }

  /** Construye el objeto crudo para validar en cliente con gestionarSchema. */
  function buildRaw(): Record<string, unknown> {
    if (!orden) return {};
    const base = { ordenId: orden.id, resultado };
    switch (resultado) {
      case "entregada":
        return {
          ...base,
          montoRecibido: montoRecibido === "" ? undefined : Number(montoRecibido),
          metodoPago: metodoPago || undefined,
          evidencia: evidencia ?? undefined,
        };
      case "reprogramada":
        return { ...base, fechaReprogramacion, motivo };
      case "devuelta":
        return { ...base, motivo };
      case "rechazada":
        return { ...base, motivo, evidencia: evidencia ?? undefined };
    }
  }

  /** Empaqueta los campos + File en FormData para la Server Action. */
  function buildFormData(): FormData {
    const fd = new FormData();
    if (!orden) return fd;
    fd.set("ordenId", orden.id);
    fd.set("resultado", resultado);
    if (resultado === "entregada") {
      fd.set("montoRecibido", montoRecibido);
      fd.set("metodoPago", metodoPago);
      if (evidencia) fd.set("evidencia", evidencia);
    } else if (resultado === "reprogramada") {
      fd.set("fechaReprogramacion", fechaReprogramacion);
      fd.set("motivo", motivo);
    } else if (resultado === "devuelta") {
      fd.set("motivo", motivo);
    } else {
      fd.set("motivo", motivo);
      if (evidencia) fd.set("evidencia", evidencia);
    }
    return fd;
  }

  async function handleConfirm() {
    if (!orden) return;
    // R22/R24/R25/R27/R29: validación de borde en cliente (mismo schema que el
    // servidor revalida). Errores → por campo, sin enviar.
    const parsed = gestionarSchema.safeParse(buildRaw());
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});

    const result = await gestionar(buildFormData());
    if (result.status === "ok") {
      toast.success(
        `Orden ${orden.numRemision}: ${estatusLabel(result.estado)}.`,
      );
      onSuccess();
      return;
    }
    if (result.status === "validation_error") {
      // R22/R24 (p. ej. monto != montoCobrar): el servidor devuelve los campos.
      setFieldErrors(result.fieldErrors);
      return;
    }
    // R18/R21 (conflict) / R12 (forbidden) / unauthenticated: Toast de dominio.
    toast.error(
      result.status === "conflict"
        ? "La orden ya no puede gestionarse (estado cambiado o hay otra activa)."
        : "No tienes permiso para gestionar esta orden.",
    );
  }

  const montoError = firstError(fieldErrors, "montoRecibido");
  const metodoError = firstError(fieldErrors, "metodoPago");
  const evidenciaError = firstError(fieldErrors, "evidencia");
  const fechaError = firstError(fieldErrors, "fechaReprogramacion");
  const motivoError = firstError(fieldErrors, "motivo");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Gestionar orden"
      description={orden ? `Orden ${orden.numRemision} · ${orden.destinatario}` : undefined}
      confirmLabel="Guardar gestión"
      onConfirm={handleConfirm}
      closeOnConfirm={false}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gestion-resultado">Resultado</Label>
          <Select
            value={resultado}
            onValueChange={(value) => {
              setResultado(value as Resultado);
              setFieldErrors({});
            }}
            options={RESULTADO_OPTIONS}
            placeholder="Selecciona un resultado"
            aria-label="Resultado de la gestión"
          />
        </div>

        {resultado === "entregada" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gestion-monto">Monto recibido</Label>
              <Input
                id="gestion-monto"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={montoRecibido}
                onChange={(e) => setMontoRecibido(e.target.value)}
                aria-invalid={montoError ? true : undefined}
                aria-label="Monto recibido"
              />
              {montoError ? (
                <p role="alert" className="text-sm text-destructive">
                  {montoError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gestion-metodo">Método de pago</Label>
              <Select
                value={metodoPago}
                onValueChange={setMetodoPago}
                options={METODO_PAGO_OPTIONS}
                placeholder="Selecciona un método"
                aria-label="Método de pago"
              />
              {metodoError ? (
                <p role="alert" className="text-sm text-destructive">
                  {metodoError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gestion-evidencia">Foto de evidencia</Label>
              <input
                id="gestion-evidencia"
                type="file"
                accept={ACCEPT_MIME}
                onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)}
                aria-invalid={evidenciaError ? true : undefined}
                aria-label="Foto de evidencia de entrega"
                className="text-sm"
              />
              {evidenciaError ? (
                <p role="alert" className="text-sm text-destructive">
                  {evidenciaError}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {resultado === "reprogramada" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gestion-fecha">Nueva fecha</Label>
              <Input
                id="gestion-fecha"
                type="date"
                value={fechaReprogramacion}
                onChange={(e) => setFechaReprogramacion(e.target.value)}
                aria-invalid={fechaError ? true : undefined}
                aria-label="Nueva fecha de reprogramación"
              />
              {fechaError ? (
                <p role="alert" className="text-sm text-destructive">
                  {fechaError}
                </p>
              ) : null}
            </div>
            <MotivoField
              value={motivo}
              onChange={setMotivo}
              error={motivoError}
            />
          </>
        ) : null}

        {resultado === "devuelta" ? (
          <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
        ) : null}

        {resultado === "rechazada" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gestion-evidencia-rechazo">Foto de evidencia</Label>
              <input
                id="gestion-evidencia-rechazo"
                type="file"
                accept={ACCEPT_MIME}
                onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)}
                aria-invalid={evidenciaError ? true : undefined}
                aria-label="Foto de evidencia del rechazo"
                className="text-sm"
              />
              {evidenciaError ? (
                <p role="alert" className="text-sm text-destructive">
                  {evidenciaError}
                </p>
              ) : null}
            </div>
            <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function MotivoField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="gestion-motivo">Motivo</Label>
      <textarea
        id="gestion-motivo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-label="Motivo"
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
