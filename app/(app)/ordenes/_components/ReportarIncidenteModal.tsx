"use client";

import { useId, useState, type ChangeEvent } from "react";

import {
  EvidenciasField,
  mensajeEvidenciasRechazadas,
  prepararEvidencias,
} from "@/components/shared/EvidenciasField";
import { Modal } from "@/components/shared/Modal";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { reportarIncidente } from "@/lib/actions/incidentes";
import { reportarIncidenteSchema } from "@/lib/types/incidente";
import { gestionConfig } from "@/lib/config/gestion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
// Feature 158 (T2.7): las etiquetas de la causa se IMPORTAN del catálogo que ya deriva del
// SEED y que usa el panel del mensajero para capturarla (T2.1). No se duplican: las dos
// superficies capturan LA MISMA causa y no pueden llamarla distinto. Precedente exacto en el
// repo: `GestionarOrdenPanel` importa `estatus-label` de esta misma carpeta.
import { CAUSA_INCIDENTE_OPTIONS } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumple por estructura
 * `OrdenListItemDTO` (listado de `/ordenes`); se declara aparte —como hace
 * `DeshacerAsignacionModal` (149)— para no atar el modal al DTO completo del listado.
 */
export interface ReportarIncidenteOrdenUI {
  id: string;
  numRemision: string;
  numGuia?: number | null;
  zonaNombre?: string | null;
}

export interface ReportarIncidenteModalProps {
  open: boolean;
  /** Orden UNA, nunca un lote: un incidente pide causa, motivo y fotos POR orden (Q-H). */
  orden: ReportarIncidenteOrdenUI;
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre cierra y RELEE el listado (la orden pasa a `incidente`). */
  onSuccess: () => void;
}

// --- Textos visibles (separados de la lógica, i18n-ready, como el resto del módulo) ---

export const REPORTAR_INCIDENTE_TITULO = "Reportar incidente con el paquete";
export const REPORTAR_INCIDENTE_CONFIRMAR = "Reportar incidente";
/**
 * Consecuencia dicha ANTES de confirmar, no después: la orden sale del flujo y sólo vuelve si
 * el incidente se rechaza o su autor lo retracta. El actor debe saberlo mientras decide.
 */
export const REPORTAR_INCIDENTE_ADVERTENCIA =
  "La orden quedará marcada como incidente y saldrá del flujo: no se podrá asignar, rutear ni entregar. Otro administrador deberá aprobar la indemnización o rechazar el reporte.";
export const CAUSA_LABEL = "Causa del incidente";
export const MOTIVO_LABEL = "Motivo";
export const MOTIVO_PLACEHOLDER =
  "Qué pasó, dónde y cuándo se detectó (lo leerá quien apruebe o rechace).";
export const MOTIVO_MAX_LEN = 500;
export const EVIDENCIAS_LABEL = "Fotos de evidencia";
/**
 * Q-B (decisión del humano, NO se re-litiga): la foto es obligatoria en las TRES causas,
 * incluidas `perdido` y `robado`, donde NO HAY PAQUETE que fotografiar. En vez de un «campo
 * requerido» seco, se dice qué se espera que fotografíe quien está en la bodega —que es otro
 * sitio y otras pruebas que las del mensajero en la calle (T2.1)—. El coste de la decisión
 * queda escrito en `requirements.md`; aquí se hace accionable.
 */
export const EVIDENCIAS_AYUDA =
  "La foto es obligatoria también si el paquete se perdió o se lo robaron. Si no tenés el paquete, fotografiá lo que sí tenés delante: la ubicación o el estante vacío en bodega, la guía o la etiqueta, el acta de recepción o el manifiesto, o la denuncia.";
/** Bloqueo explicado con TEXTO, no sólo con un botón apagado. */
export const FALTAN_CAMPOS_PREFIJO = "Falta completar:";
export const FALTA_CAUSA = "la causa";
export const FALTA_MOTIVO = "el motivo";
export const FALTA_EVIDENCIA = "al menos una foto";

/** Mismo tope por lista que el panel del mensajero: lo impone `evidenciasSchema` (119/158). */
const MAX_EVIDENCIAS = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

/** Primer mensaje del campo, si el borde marcó ese campo. */
function firstError(
  errors: Record<string, string[]>,
  campo: string,
): string | undefined {
  return errors[campo]?.[0];
}

/**
 * Feature 158 (T2.7, R41/R45/R46/R48 — camino del ADMIN) — modal «Reportar incidente» POR
 * ORDEN del módulo de órdenes (Q-H, cerrada por el humano). Hermano de
 * `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149), que son las otras dos
 * acciones administrativas por orden CON MOTIVO que viven aquí.
 *
 * **No es —ni puede ser— una acción de LOTE**: pide causa, motivo y fotos propias de CADA
 * paquete. Por eso recibe `orden` (singular) y no `ordenes`.
 *
 * Valida en cliente con `reportarIncidenteSchema`, el MISMO schema que el servidor revalida
 * en el borde (`lib/actions/incidentes.ts`): el cliente no tiene reglas propias que puedan
 * divergir. El servidor sigue siendo la guardia real (R41/R42/R47/R48).
 */
export function ReportarIncidenteModal({
  open,
  orden,
  onOpenChange,
  onSuccess,
}: Readonly<ReportarIncidenteModalProps>) {
  const toast = useToast();
  const motivoId = useId();
  const evidenciasId = useId();

  const [causa, setCausa] = useState<CausaIncidente | "">("");
  const [motivo, setMotivo] = useState("");
  const [evidencias, setEvidencias] = useState<File[]>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Cada apertura arranca limpia: el reporte describe ESTA orden, no la anterior. Patrón
  // «ajustar estado durante el render» (el mismo de `DeshacerAsignacionModal`): en un efecto,
  // este `setState` encadenaría un render extra con los datos viejos ya visibles.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setCausa("");
      setMotivo("");
      setEvidencias([]);
      setFieldErrors({});
    }
  }

  /**
   * Añade las fotos seleccionadas, normalizadas en el navegador (una foto de celular sin
   * comprimir revienta el límite de body del Server Action). Concatena sobre lo ya elegido y
   * recorta al tope, marcando el error del campo. Las que no valen por sí mismas —formato o
   * peso— se avisan AL ELEGIRLAS y con su nombre. Calcado de `GestionarOrdenPanel` (119).
   */
  async function handleEvidenciaChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const seleccion = Array.from(input.files ?? []);
    input.value = ""; // permite volver a elegir la MISMA foto tras quitarla
    if (seleccion.length === 0) return;
    setComprimiendo(true);
    try {
      const { aceptadas, rechazadas } = await prepararEvidencias(seleccion);
      setEvidencias((prev) => {
        const combinadas = [...prev, ...aceptadas];
        setFieldErrors((errs) => {
          const rest = { ...errs };
          delete rest.evidencias;
          const avisos = [
            mensajeEvidenciasRechazadas(rechazadas),
            combinadas.length > MAX_EVIDENCIAS
              ? `Solo podés adjuntar hasta ${MAX_EVIDENCIAS} fotos.`
              : null,
          ].filter((m): m is string => m !== null);
          return avisos.length > 0 ? { ...rest, evidencias: avisos } : rest;
        });
        return combinadas.slice(0, MAX_EVIDENCIAS);
      });
    } finally {
      setComprimiendo(false);
    }
  }

  function quitarEvidencia(index: number) {
    setEvidencias((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((errs) => {
      if (!errs.evidencias) return errs;
      const rest = { ...errs };
      delete rest.evidencias;
      return rest;
    });
  }

  /** Lo que falta para poder enviar, en el orden del formulario (R45/R46). */
  const faltantes: string[] = [];
  if (causa === "") faltantes.push(FALTA_CAUSA);
  if (motivo.trim() === "") faltantes.push(FALTA_MOTIVO);
  if (evidencias.length === 0) faltantes.push(FALTA_EVIDENCIA);
  const completo = faltantes.length === 0;

  function buildRaw(): Record<string, unknown> {
    // `|| undefined` (patrón de `causaDevolucion`, 73) para que zod diga «causa requerida»
    // y no «valor inválido» cuando no se eligió ninguna.
    return {
      ordenId: orden.id,
      causa: causa || undefined,
      motivo,
      evidencias,
    };
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("ordenId", orden.id);
    fd.set("causa", causa);
    fd.set("motivo", motivo.trim());
    // Cada foto va como un valor MÁS de la misma clave `evidencia` (`append`, no `set`); el
    // borde las lee con `getAll("evidencia")`. MISMO contrato que el panel del mensajero.
    for (const foto of evidencias) fd.append("evidencia", foto);
    return fd;
  }

  async function handleConfirm() {
    if (comprimiendo) return;
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del botón para
    // no llamar a la acción con el formulario incompleto (patrón `DeshacerAsignacionModal`).
    if (!completo) return;

    // R45/R46: validación de borde en cliente con el MISMO schema del servidor. Aquí es donde
    // se cazan los fallos que el botón no puede ver (MIME o tamaño de una foto concreta).
    const parsed = reportarIncidenteSchema.safeParse(buildRaw());
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});

    const result = await reportarIncidente(buildFormData());
    if (result.status === "ok") {
      toast.success(`Orden ${orden.numRemision}: incidente reportado.`);
      onSuccess();
      return;
    }
    if (result.status === "validation_error") {
      setFieldErrors(result.fieldErrors);
      return;
    }
    // `conflict` trae el motivo REAL del servidor (orden no reportable / ya tiene un
    // incidente vivo): se muestra tal cual, que es más accionable que un genérico.
    toast.error(
      result.status === "conflict"
        ? result.motivo
        : result.status === "forbidden"
          ? "No tenés permiso para reportar un incidente sobre esta orden."
          : "Tu sesión expiró. Iniciá sesión de nuevo.",
    );
  }

  const causaError = firstError(fieldErrors, "causa");
  const motivoError = firstError(fieldErrors, "motivo");
  const evidenciasError = firstError(fieldErrors, "evidencias");
  const ordenIdError = firstError(fieldErrors, "ordenId");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={REPORTAR_INCIDENTE_TITULO}
      description={`${orden.numRemision}${orden.zonaNombre ? ` — ${orden.zonaNombre}` : ""}`}
      confirmLabel={REPORTAR_INCIDENTE_CONFIRMAR}
      confirmVariant="destructive"
      confirmDisabled={!completo || comprimiendo}
      onConfirm={handleConfirm}
      closeOnConfirm={false}
    >
      <div className="flex flex-col gap-4">
        <p
          role="note"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {REPORTAR_INCIDENTE_ADVERTENCIA}
        </p>

        <div className="flex flex-col gap-1.5">
          <Label>{CAUSA_LABEL}</Label>
          <RadioGroup
            value={causa}
            onValueChange={(next) => setCausa(next as CausaIncidente | "")}
            options={CAUSA_INCIDENTE_OPTIONS}
            aria-label={CAUSA_LABEL}
            aria-invalid={causaError ? true : undefined}
          />
          {causaError ? (
            <p role="alert" className="text-sm text-destructive">
              {causaError}
            </p>
          ) : null}
        </div>

        {/* El campo de fotos es el MISMO componente que usan el panel del mensajero y la ventana
            de novedades (`components/shared/EvidenciasField`): ahí viven las dos vías —cámara y
            galería—, el tope y la previsualización. Aquí solo entran los textos de esta pantalla. */}
        <EvidenciasField
          inputId={evidenciasId}
          label={EVIDENCIAS_LABEL}
          ariaLabel={EVIDENCIAS_LABEL}
          ayuda={EVIDENCIAS_AYUDA}
          files={evidencias}
          error={evidenciasError}
          onSelect={handleEvidenciaChange}
          onRemove={quitarEvidencia}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={motivoId}>{MOTIVO_LABEL}</Label>
          <Textarea
            id={motivoId}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            placeholder={MOTIVO_PLACEHOLDER}
            maxLength={MOTIVO_MAX_LEN}
            rows={3}
            required
            aria-invalid={motivoError ? true : undefined}
          />
          {motivoError ? (
            <p role="alert" className="text-sm text-destructive">
              {motivoError}
            </p>
          ) : null}
        </div>

        {ordenIdError ? (
          <p role="alert" className="text-sm text-destructive">
            {ordenIdError}
          </p>
        ) : null}

        {completo ? null : (
          <p role="note" className="text-sm text-muted-foreground">
            {`${FALTAN_CAMPOS_PREFIJO} ${faltantes.join(", ")}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
