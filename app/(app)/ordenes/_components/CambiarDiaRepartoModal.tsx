"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import {
  DIA_REPARTO_SIN_ELEGIR,
  SelectorDiaReparto,
} from "@/components/shared/SelectorDiaReparto";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { corregirDiaReparto } from "@/lib/actions/corregir-dia-reparto";
import type { DiaReparto } from "@/lib/types/dia-reparto";
import {
  avisoDiaActualDeLaOrden,
  confirmacionDiaReparto,
  SELECTOR_DIA_AYUDA_CORRECCION,
  SELECTOR_DIA_TITULO_CORRECCION,
  type FechasDiaReparto,
} from "@/lib/utils/dia-reparto-textos";

import {
  MOTIVO_AYUDA,
  MOTIVO_LABEL,
  MOTIVO_MAX_LEN,
  MOTIVO_PLACEHOLDER,
  corregirDiaRepartoConflictoMensaje,
  corregirDiaRepartoErrorMessage,
  detalleDeConflicto,
  motivoValido,
} from "./corregir-dia-reparto-error-messages";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumplen por estructura tanto
 * `OrdenListItemDTO` (listado de `/ordenes`) como `RecepcionSateliteDTO` (bodega satélite), de
 * modo que las DOS superficies comparten un único cuerpo en vez de duplicarlo — mismo reparto
 * que `DeshacerAsignacionOrdenUI` (149, design §6.2).
 */
export interface CambiarDiaRepartoOrdenUI {
  id: string;
  numRemision: string;
  /**
   * R16 — el día para el que la orden está marcada HOY, `YYYY-MM-DD` YA RESUELTO EN EL SERVIDOR
   * (`fechaRepartoISO` de los dos DTO de listado, feature 262/B8).
   *
   * Opcional y nullable porque el DTO lo es: una orden sin día existe, la corrección la RECHAZA
   * (R5) y la pantalla tiene que poder nombrarla igual en vez de dejar el hueco en blanco.
   */
  fechaRepartoISO?: string | null;
}

export interface CambiarDiaRepartoModalProps {
  open: boolean;
  /** Snapshot del LOTE seleccionado al abrir. Vacío ⇒ el confirmar queda deshabilitado. */
  ordenes: readonly CambiarDiaRepartoOrdenUI[];
  /**
   * R17 — fechas calendario de «hoy» y «mañana» resueltas EN EL SERVIDOR y bajadas por props
   * desde la página. Obligatorias: montar el modal sin decidir de dónde salen las etiquetas del
   * día tiene que ser imposible, porque la alternativa fácil —calcularlas con `new Date()` aquí—
   * es justo lo que R17 prohíbe.
   */
  fechasDiaReparto: FechasDiaReparto;
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre cierra y RELEE el estado del servidor. */
  onSuccess: () => void;
  /** Título del modal; la satélite lo reusa tal cual. Prop para i18n futura. */
  title?: string;
}

/**
 * ⚠️ ES EL MISMO TEXTO QUE LA ACCIÓN DEL LISTADO, y por eso se exporta: el botón de `/ordenes` y
 * el de `/recepcion-satelite` lo importan de aquí. Dos literales iguales en tres archivos
 * divergen a la primera corrección de estilo, y entonces el usuario pulsa «Cambiar día» y le
 * abre un modal que se llama otra cosa.
 */
export const CAMBIAR_DIA_ACCION = "Cambiar día de reparto";
const CONFIRMAR = "Cambiar día";

/**
 * Feature 262 (F1, R10/R16/R17/R18/R19/R21, design §7.2) — modal por LOTE de «Cambiar día de
 * reparto» sobre órdenes YA ASIGNADAS.
 *
 * El molde son los dos precedentes exactos: `AsignarBodegaModal` (el selector del día y su
 * confirmación en palabras) y `DeshacerAsignacionModal` (lote + motivo obligatorio + una sola
 * llamada a la Server Action). Tres partes, en este orden de lectura:
 *
 *   1. LA LISTA DEL LOTE, CON EL DÍA DE CADA ORDEN (R16). No es adorno: es lo único que impide
 *      corregir a ciegas un lote mixto. Quien marca veinte órdenes y no ve el día de cada una no
 *      sabe cuáles está moviendo ni desde dónde.
 *   2. EL SELECTOR DE DÍA, **sin preselección**. Al asignar «Hoy» viene marcado (246/R27); aquí
 *      NO, porque la mitad de las correcciones son «hoy → mañana» y la otra mitad «mañana →
 *      hoy»: una preselección convertiría un despiste en una corrección equivocada. El confirmar
 *      está deshabilitado hasta que se elige.
 *   3. EL MOTIVO, obligatorio (R21), con las mismas cotas que el borde.
 *
 * ⚠️ VIAJA UN TOKEN, NUNCA UNA FECHA (R2/R3). El servidor traduce «hoy»/«mañana» con el día de
 * Costa Rica y un reloj inyectable. Con dos opciones que significan «el día en curso» y «el
 * siguiente», MOVER AL PASADO NO ES EXPRESABLE: no hay ningún `if` que alguien pueda relajar más
 * adelante. Si esto se convirtiera en un `input type="date"` validado por una comprobación, la
 * propiedad se perdería — y es la razón de la decisión (design §4.3).
 *
 * ⚠️ AQUÍ NO SE LEE NINGÚN RELOJ (R17). Ni el día en curso, ni las etiquetas de las dos
 * opciones, ni el día que se muestra por orden: los tres llegan ya resueltos por el servidor.
 * Y NINGÚN TEXTO DEL DÍA SE ESCRIBE AQUÍ (R18): todos se importan de
 * `lib/utils/dia-reparto-textos.ts`, que es la fuente única que ya usan la asignación y el
 * portal del mensajero.
 */
export function CambiarDiaRepartoModal({
  open,
  ordenes,
  fechasDiaReparto,
  onOpenChange,
  onSuccess,
  title = CAMBIAR_DIA_ACCION,
}: Readonly<CambiarDiaRepartoModalProps>) {
  const toast = useToast();
  const motivoId = useId();
  const ayudaId = useId();
  const conflictoId = useId();
  const [motivo, setMotivo] = useState("");
  // Sin preselección (design §7.2): el estado arranca «sin elegir» y el confirmar depende de
  // que deje de estarlo.
  const [dia, setDia] = useState<DiaReparto | typeof DIA_REPARTO_SIN_ELEGIR>(
    DIA_REPARTO_SIN_ELEGIR,
  );
  /** R19 — motivos POR ORDEN del último rechazo. `null` = no hay rechazo que mostrar. */
  const [conflictos, setConflictos] = useState<
    { ordenId: string; motivo: string }[] | null
  >(null);

  // Cada apertura arranca limpia: el motivo describe ESTE lote, el día se vuelve a elegir para
  // ESTE lote y el rechazo del anterior no se queda pegado. Patrón «ajustar estado durante el
  // render» (el mismo de `AsignarBodegaModal` y `DeshacerAsignacionModal`): en un efecto, estos
  // `setState` encadenarían un render extra con los valores viejos ya visibles.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setMotivo("");
      setDia(DIA_REPARTO_SIN_ELEGIR);
      setConflictos(null);
    }
  }

  const sinOrdenes = ordenes.length === 0;
  const motivoOk = motivoValido(motivo);
  const diaElegido = dia !== DIA_REPARTO_SIN_ELEGIR;

  /** El nº de remisión de una orden del lote, para nombrar su rechazo (R19). Nunca su UUID. */
  function remisionDe(ordenId: string): string | null {
    return ordenes.find((orden) => orden.id === ordenId)?.numRemision ?? null;
  }

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled` (el Modal ya bloquea el click, pero el handler no
    // debe depender de eso para no llamar a la acción sin día o sin motivo).
    if (sinOrdenes || !diaElegido || !motivoOk) return;

    // Un rechazo anterior deja de describir lo que va a pasar en cuanto se vuelve a confirmar.
    setConflictos(null);

    const result = await corregirDiaReparto({
      ordenIds: ordenes.map((orden) => orden.id),
      // R2/R3: el TOKEN, no una fecha. La fecha la resuelve el servidor.
      dia,
      motivo: motivo.trim(),
    });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal: no cierra y llama a `onError`
    }

    // R10: para qué día quedó el lote, EN PALABRAS y sin siglas. Sale de
    // `confirmacionDiaReparto`, la misma función que usa la asignación (R18), y se compone con
    // el día que se ACABA de cometer.
    toast.success(confirmacionDiaReparto(dia, fechasDiaReparto));
    onSuccess();
  }

  function handleError(error: unknown) {
    // R19: un `conflict` trae el motivo REAL POR ORDEN y se pinta orden a orden dentro del
    // modal, no como un toast genérico. El lote entero se abortó (R8), así que el operador tiene
    // que poder leer cuál falló y por qué antes de volver a intentarlo.
    const detalle = detalleDeConflicto(error);
    if (detalle) {
      setConflictos(detalle);
      return;
    }
    setConflictos(null);
    toast.error(corregirDiaRepartoErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`Cambia el día de reparto de ${ordenes.length} orden(es) ya asignada(s). No cambia el mensajero, ni el estado, ni la guía.`}
      confirmLabel={CONFIRMAR}
      confirmDisabled={sinOrdenes || !diaElegido || !motivoOk}
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
          /* R16 — el día de CADA orden, en palabras. `avisoDiaActualDeLaOrden` sale de la
             fuente única y no construye ningún `Date`: la fecha llega ya resuelta en
             `fechaRepartoISO`. */
          <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
            {ordenes.map((orden) => (
              <li key={orden.id}>
                {orden.numRemision} · {avisoDiaActualDeLaOrden(orden.fechaRepartoISO)}
              </li>
            ))}
          </ul>
        )}

        {/* R17: las dos etiquetas salen de las fechas que resolvió el servidor. R27 de la 246
            NO aplica aquí: sin opción marcada de salida (design §7.2). */}
        <SelectorDiaReparto
          valor={dia}
          onValorChange={setDia}
          fechas={fechasDiaReparto}
          titulo={SELECTOR_DIA_TITULO_CORRECCION}
          ayuda={SELECTOR_DIA_AYUDA_CORRECCION}
        />

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

        {/* R19 — el rechazo, ORDEN A ORDEN y con el motivo real de cada una. `role="alert"`
            para que un lector de pantalla lo anuncie al aparecer; la orden se nombra por su nº
            de remisión, nunca por su identificador interno. */}
        {conflictos ? (
          <div
            role="alert"
            id={conflictoId}
            className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <p className="font-medium">
              No se cambió el día de ninguna orden del lote. Estas son las que lo impidieron:
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {conflictos.map((c) => {
                const remision = remisionDe(c.ordenId);
                return (
                  <li key={c.ordenId}>
                    {remision ? `${remision} — ` : ""}
                    {corregirDiaRepartoConflictoMensaje(c.motivo)}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
