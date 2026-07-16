"use client";

import { useState } from "react";
import {
  Loader2,
  MessageCircle,
  PackageCheck,
  Phone,
  RotateCcw,
  Undo2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { GESTION_ALLOWED_MIME } from "@/lib/config/gestion";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { CAUSA_DEVOLUCION_OPTIONS } from "./causa-devolucion-options";
import { METODO_PAGO_OPTIONS } from "./metodo-pago-options";

// Feature 36 / rediseño 63 (pedido humano): detalle GRANDE y centrado de UNA
// orden en reparto con gestión multi-paso, ahora como PANEL INLINE (no modal /
// overlay). Se renderiza en la página, debajo de la grilla de cards. Flujo:
// (1) detalle + botón "Gestionar pedido" (fija el puntero 1-a-1 vía
// `onGestionarPedido`); (2) 4 botones de resultado; (3) campos CONDICIONALES por
// resultado. Valida en cliente con el MISMO schema que revalida el servidor
// (gestionarSchema, R24) y envía FormData a la Server Action `gestionar`. El
// resultado de dominio se refleja como errores por campo (validation_error) o
// Toast (conflict/forbidden). El contrato de backend NO cambia.
//
// Como ya NO hay modal que cerrar, cuando el puntero está fijado (pasos
// resultados/formulario) se ofrece "Cancelar gestión", que libera el puntero
// (vía `onCancelarGestion` del padre) y vuelve al paso "detalle" sin cambiar de
// orden. El reset del estado interno lo garantiza el padre remontando el panel
// con `key={orden.id}` al cambiar de orden.

type Resultado = "entregada" | "reprogramada" | "devuelta" | "rechazada";

/** Pasos del flujo de gestión dentro del panel. */
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
    className: "border-border bg-muted/40 text-foreground hover:bg-muted",
  },
];

export interface GestionarOrdenPanelProps {
  /** Orden a mostrar/gestionar (la del panel de detalle). */
  orden: MiAsignacionDTO;
  /**
   * `true` si el puntero 1-a-1 ya está fijado en esta orden (gestión en curso):
   * el panel arranca directo en los 4 botones, saltando "Gestionar pedido".
   */
  yaActiva: boolean;
  /**
   * Fija el puntero 1-a-1 (escogerParaGestion) al pulsar "Gestionar pedido".
   * Devuelve `true` si quedó fijado (avanza a los 4 botones); `false` si hubo
   * conflicto/forbidden (el padre ya mostró el Toast; el paso no avanza).
   */
  onGestionarPedido: () => Promise<boolean>;
  /**
   * Libera el puntero 1-a-1 (liberarGestion) al pulsar "Cancelar gestión". Se
   * invoca solo cuando el puntero está fijado (pasos resultados/formulario).
   */
  onCancelarGestion: () => void | Promise<void>;
  /** Se invoca tras un "ok" para que el padre refresque el listado. */
  onSuccess: () => void;
}

/** Primer mensaje de error de un campo (o undefined). */
function firstError(
  errors: Record<string, string[]>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function GestionarOrdenPanel({
  orden,
  yaActiva,
  onGestionarPedido,
  onCancelarGestion,
  onSuccess,
}: GestionarOrdenPanelProps) {
  const toast = useToast();

  // El padre remonta este panel (`key={orden.id}`) al cambiar de orden, por lo
  // que el estado interno arranca limpio: si la orden ya está activa, directo en
  // los 4 botones; si no, en el detalle.
  const [paso, setPaso] = useState<Paso>(yaActiva ? "resultados" : "detalle");
  const [resultado, setResultado] = useState<Resultado>("entregada");
  const [metodoPago, setMetodoPago] = useState("");
  const [fechaReprogramacion, setFechaReprogramacion] = useState(tomorrowISO());
  const [motivo, setMotivo] = useState("");
  // Feature 73 (R4): causa TIPIFICADA de la rama `devuelta`. `""` = sin elegir; el mensajero
  // DEBE escoger una (R6). Es un campo APARTE del `motivo`, que sigue obligatorio (R7).
  const [causaDevolucion, setCausaDevolucion] = useState<CausaDevolucion | "">("");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  /** Construye el objeto crudo para validar en cliente con gestionarSchema. */
  function buildRaw(): Record<string, unknown> {
    const base = { ordenId: orden.id, resultado };
    switch (resultado) {
      case "entregada":
        return {
          ...base,
          montoRecibido: orden.montoCobrar ?? 0,
          metodoPago: metodoPago || undefined,
          evidencia: evidencia ?? undefined,
        };
      case "reprogramada":
        return { ...base, fechaReprogramacion, motivo };
      case "devuelta":
        // Feature 73/R6: `|| undefined` reproduce el patrón de `metodoPago` (:159) para que zod
        // diga "requerido" y no "valor inválido" cuando no se eligió ninguna causa.
        return { ...base, causaDevolucion: causaDevolucion || undefined, motivo };
      case "rechazada":
        return { ...base, motivo, evidencia: evidencia ?? undefined };
    }
  }

  /** Empaqueta los campos + File en FormData para la Server Action. */
  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("ordenId", orden.id);
    fd.set("resultado", resultado);
    if (resultado === "entregada") {
      fd.set("montoRecibido", String(orden.montoCobrar ?? 0));
      fd.set("metodoPago", metodoPago);
      if (evidencia) fd.set("evidencia", evidencia);
    } else if (resultado === "reprogramada") {
      fd.set("fechaReprogramacion", fechaReprogramacion);
      fd.set("motivo", motivo);
    } else if (resultado === "devuelta") {
      fd.set("causaDevolucion", causaDevolucion); // feature 73 (R9)
      fd.set("motivo", motivo);
    } else {
      fd.set("motivo", motivo);
      if (evidencia) fd.set("evidencia", evidencia);
    }
    return fd;
  }

  /** Paso 1: fija el puntero 1-a-1 y, si ok, revela los 4 botones. */
  async function handleGestionarPedido() {
    const ok = await onGestionarPedido();
    if (ok) setPaso("resultados");
  }

  /** Cancela la gestión en curso: libera el puntero y vuelve al detalle. */
  async function handleCancelarGestion() {
    if (cancelando) return;
    setCancelando(true);
    setPaso("detalle");
    setFieldErrors({});
    try {
      await onCancelarGestion();
    } finally {
      setCancelando(false);
    }
  }

  /** Paso 2: elige un resultado y muestra sus campos condicionales. */
  function elegirResultado(next: Resultado) {
    setResultado(next);
    setFieldErrors({});
    setMetodoPago("");
    setFechaReprogramacion(tomorrowISO());
    setMotivo("");
    setCausaDevolucion(""); // feature 73/R4: cambiar de resultado no arrastra la causa anterior
    setEvidencia(null);
    setPaso("formulario");
  }

  async function handleConfirm() {
    if (enviando) return;
    // R22/R24/R25/R27/R29: validación de borde en cliente (mismo schema que el
    // servidor revalida). Errores → por campo, sin enviar.
    const parsed = gestionarSchema.safeParse(buildRaw());
    if (!parsed.success) {
      setFieldErrors(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
      return;
    }
    setFieldErrors({});

    setEnviando(true);
    try {
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
    } finally {
      setEnviando(false);
    }
  }

  const metodoError = firstError(fieldErrors, "metodoPago");
  const evidenciaError = firstError(fieldErrors, "evidencia");
  const fechaError = firstError(fieldErrors, "fechaReprogramacion");
  const motivoError = firstError(fieldErrors, "motivo");
  const causaError = firstError(fieldErrors, "causaDevolucion");

  const resultadoLabel =
    RESULTADO_BOTONES.find((b) => b.value === resultado)?.label ?? "";

  return (
    <section
      aria-label="Detalle de la orden"
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-x-hidden rounded-xl border border-border bg-card p-6 shadow-xs"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">Detalle de la orden</h2>
        <p className="text-sm text-muted-foreground">
          Orden {orden.numRemision} · {orden.destinatario}
        </p>
      </div>

      {/* Detalle completo: nombre, teléfono, dirección, notas, producto (+ más). */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <AsignacionDetalle orden={orden} />
      </div>

      {/* Paso 1: llamar, whatsapp y gestionar. */}
      {paso === "detalle" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-14 shrink-0"
            onClick={() => window.open(`tel:${orden.telefonoDest}`, "_self")}
            aria-label={`Llamar a ${orden.destinatario}`}
          >
            <Phone className="size-5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-14 shrink-0"
            onClick={() =>
              window.open(
                `https://wa.me/${orden.telefonoDest.replace(/[^\d]/g, "")}`,
                "_blank",
              )
            }
            aria-label={`WhatsApp a ${orden.destinatario}`}
          >
            <MessageCircle className="size-5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={handleGestionarPedido}
            className="h-14 flex-1 text-base font-semibold"
          >
            Gestionar esta orden
          </Button>
        </div>
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
          <Button
            type="button"
            variant="outline"
            onClick={handleCancelarGestion}
            disabled={cancelando}
            className="w-full"
          >
            Cancelar gestión
          </Button>
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
            <>
              <CausaField
                value={causaDevolucion}
                onChange={setCausaDevolucion}
                error={causaError}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
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

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelarGestion}
              disabled={cancelando || enviando}
            >
              Cancelar gestión
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={enviando}
              aria-busy={enviando || undefined}
            >
              {enviando ? (
                <span role="status" className="flex items-center gap-2">
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  <span className="sr-only">Procesando…</span>
                </span>
              ) : null}
              Guardar gestión
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Feature 73 (R3/R4): selector de la causa TIPIFICADA, sólo en la rama `devuelta`. Radios
 * (decisión F1.4-f): las 3 opciones visibles de una, móvil-first, sin dropdown que abrir en la
 * calle. Las etiquetas salen SIEMPRE de `CAUSA_DEVOLUCION_OPTIONS` (derivadas del SEED) → aquí
 * no se duplica ninguna cadena ni se pinta el slug crudo del enum. Vive en este archivo, como
 * `MotivoField`: un solo consumidor (docs/architecture.md "sin sobre-ingeniería").
 */
function CausaField({
  value,
  onChange,
  error,
}: {
  value: CausaDevolucion | "";
  onChange: (value: CausaDevolucion | "") => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Título visible del grupo; el nombre accesible del `radiogroup` lo da su `aria-label`
          (mismo contrato que el `Select` de "Método de pago", :372-379). */}
      <Label>Causa de la devolución</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as CausaDevolucion | "")}
        options={CAUSA_DEVOLUCION_OPTIONS}
        aria-label="Causa de la devolución"
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
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
