"use client";

import { useState } from "react";
import { PackageCheck, RotateCcw, Undo2, XCircle } from "lucide-react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { GESTION_ALLOWED_MIME } from "@/lib/config/gestion";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { METODO_PAGO_OPTIONS } from "./metodo-pago-options";

// Feature 36 / rediseño 63: detalle GRANDE y centrado de UNA orden en reparto con
// gestión multi-paso (decisión F1.4-i). Flujo: (1) detalle + botón "Gestionar
// pedido" (fija el puntero 1-a-1 vía `onGestionarPedido`); (2) 4 botones de
// resultado; (3) campos CONDICIONALES por resultado. Valida en cliente con el
// MISMO schema que revalida el servidor (gestionarSchema, R24) y envía FormData a
// la Server Action `gestionar`. El resultado de dominio se refleja como errores
// por campo (validation_error) o Toast (conflict/forbidden). El contrato de
// backend NO cambia.

type Resultado = "entregada" | "reprogramada" | "devuelta" | "rechazada";

/** Pasos del flujo de gestión dentro del modal. */
type Paso = "detalle" | "resultados" | "formulario";

const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");

/** Configuración visual de los 4 botones de resultado (jerarquía + color). */
const RESULTADO_BOTONES: {
  value: Resultado;
  label: string;
  Icon: typeof PackageCheck;
  className: string;
}[] = [
  {
    value: "entregada",
    label: "Entregar",
    Icon: PackageCheck,
    className:
      "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  },
  {
    value: "rechazada",
    label: "Rechazar",
    Icon: XCircle,
    className:
      "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
  },
  {
    value: "reprogramada",
    label: "Reprogramar",
    Icon: RotateCcw,
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
  },
  {
    value: "devuelta",
    label: "Devolver",
    Icon: Undo2,
    className:
      "border-border bg-muted/40 text-foreground hover:bg-muted",
  },
];

export interface GestionarOrdenModalProps {
  open: boolean;
  /** Orden a mostrar/gestionar; `null` mientras no hay ninguna seleccionada. */
  orden: MiAsignacionDTO | null;
  /**
   * `true` si el puntero 1-a-1 ya está fijado en esta orden (se reabre una gestión
   * activa): el modal arranca directo en los 4 botones, saltando "Gestionar pedido".
   */
  yaActiva: boolean;
  /**
   * Fija el puntero 1-a-1 (escogerParaGestion) al pulsar "Gestionar pedido".
   * Devuelve `true` si quedó fijado (avanza a los 4 botones); `false` si hubo
   * conflicto/forbidden (el padre ya mostró el Toast; el paso no avanza).
   */
  onGestionarPedido: () => Promise<boolean>;
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
  yaActiva,
  onGestionarPedido,
  onOpenChange,
  onSuccess,
}: GestionarOrdenModalProps) {
  const toast = useToast();

  const [paso, setPaso] = useState<Paso>("detalle");
  const [resultado, setResultado] = useState<Resultado>("entregada");
  const [montoRecibido, setMontoRecibido] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [fechaReprogramacion, setFechaReprogramacion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Reinicia el flujo al (re)abrir para una orden, sin efecto: patrón "ajustar
  // estado durante el render" (como GenerarGuiaModal). Si la orden ya está activa
  // (puntero fijado), arranca directo en los 4 botones.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPaso(yaActiva ? "resultados" : "detalle");
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

  /** Paso 2: fija el puntero 1-a-1 y, si ok, revela los 4 botones. */
  async function handleGestionarPedido() {
    const ok = await onGestionarPedido();
    if (ok) setPaso("resultados");
  }

  /** Paso 3: elige un resultado y muestra sus campos condicionales. */
  function elegirResultado(next: Resultado) {
    setResultado(next);
    setFieldErrors({});
    setMontoRecibido(orden?.montoCobrar != null ? String(orden.montoCobrar) : "");
    setMetodoPago("");
    setFechaReprogramacion("");
    setMotivo("");
    setEvidencia(null);
    setPaso("formulario");
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

  const resultadoLabel =
    RESULTADO_BOTONES.find((b) => b.value === resultado)?.label ?? "";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Detalle de la orden"
      description={orden ? `Orden ${orden.numRemision} · ${orden.destinatario}` : undefined}
      confirmLabel="Guardar gestión"
      onConfirm={paso === "formulario" ? handleConfirm : undefined}
      hideConfirm={paso !== "formulario"}
      closeOnConfirm={false}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        {/* Detalle completo de la orden (siempre visible arriba). */}
        {orden ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <AsignacionDetalle orden={orden} />
          </div>
        ) : null}

        {/* Paso 1: botón GRANDE para iniciar la gestión (fija el puntero 1-a-1). */}
        {paso === "detalle" ? (
          <Button
            type="button"
            size="lg"
            onClick={handleGestionarPedido}
            className="h-14 w-full text-base font-semibold"
          >
            Gestionar pedido
          </Button>
        ) : null}

        {/* Paso 2: 4 botones GRANDES de resultado (entrada suave). */}
        {paso === "resultados" ? (
          <div className="flex flex-col gap-3 duration-300 animate-in fade-in slide-in-from-bottom-2">
            <p className="text-sm font-medium text-muted-foreground">
              ¿Cómo terminó la gestión?
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {RESULTADO_BOTONES.map(({ value, label, Icon, className }) => (
                <Button
                  key={value}
                  type="button"
                  onClick={() => elegirResultado(value)}
                  className={`h-16 w-full flex-col gap-1 text-base font-semibold ${className}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Paso 3: campos condicionales del resultado elegido. */}
        {paso === "formulario" ? (
          <div className="flex flex-col gap-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{resultadoLabel}</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFieldErrors({});
                  setPaso("resultados");
                }}
              >
                Atrás
              </Button>
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
                <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
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
