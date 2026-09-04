"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { corregirFechaReprogramacion } from "@/lib/actions/corregir-fecha-reprogramacion";
import type { DesenlaceLiberacion } from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";

import {
  avisoFechaActual,
  CORREGIR_FECHA_ACCION,
  CORREGIR_FECHA_CONFIRMAR,
  CORREGIR_FECHA_DESCRIPCION,
  CORREGIR_FECHA_SIN_ORDEN,
  CORREGIR_FECHA_UNA_SOLA,
  corregirFechaErrorMensaje,
  FECHA_AYUDA,
  FECHA_INVALIDA,
  FECHA_LABEL,
  MOTIVO_AYUDA,
  MOTIVO_INVALIDO,
  MOTIVO_LABEL,
  MOTIVO_PLACEHOLDER,
  motivoValido,
  textoDesenlace,
  tonoDesenlace,
} from "./corregir-fecha-reprogramacion-textos";

/**
 * Forma MÍNIMA que el modal necesita de una orden; la cumple por estructura `OrdenListItemDTO`.
 * `fechaReprogramacion` llega YA RESUELTA por el servidor (la misma que pinta la columna
 * «Reprogramada para», ficha 367) y es opcional/nullable porque el DTO lo es: una orden sin fecha
 * existe, el servidor la rechaza, y la pantalla tiene que poder nombrarla en vez de dejar el hueco.
 */
export interface CorregirFechaReprogramacionOrdenUI {
  id: string;
  numRemision: string;
  fechaReprogramacion?: string | null;
}

export interface CorregirFechaReprogramacionModalProps {
  open: boolean;
  /** Snapshot de lo seleccionado al abrir. La corrección es de UNA orden por vez. */
  ordenes: readonly CorregirFechaReprogramacionOrdenUI[];
  /**
   * Fecha calendario de HOY en Costa Rica (`YYYY-MM-DD`), resuelta EN EL SERVIDOR y bajada por
   * props desde la página (la misma `fechasDiaReparto.hoy` que usa el selector de la 262). Es el
   * MÍNIMO del campo. Aquí no se lee ningún reloj: un portátil con la hora corrida no puede
   * decidir qué día es «hoy» para esta pantalla.
   *
   * Cadena vacía (no bajó ninguna fecha) ⇒ el campo se queda sin tope inferior y manda el borde,
   * que sigue siendo la guardia real. Degradar a «no se puede corregir» sería peor: bloquearía la
   * única pantalla que arregla el problema por un dato de presentación.
   */
  hoyISO: string;
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre RELEE el estado del servidor. NO cierra: el desenlace se queda a la vista. */
  onSuccess: () => void;
  /** Título del modal. Prop para i18n futura. */
  title?: string;
}

/** Lo que se pinta tras un éxito: el desenlace y las dos fechas que lo componen. */
interface DesenlaceUI {
  liberacion: DesenlaceLiberacion;
  fechaAnterior: string;
  fechaNueva: string;
}

/** Clases del aviso del desenlace por tono. `espera_cierre` no se pinta como un éxito redondo. */
const TONO_CLASES: Record<ReturnType<typeof tonoDesenlace>, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10",
  aviso: "border-amber-500/40 bg-amber-500/10",
  espera: "border-border bg-muted",
};

/**
 * FICHA 371 — modal de «corregir la fecha de una reprogramación ya registrada».
 *
 * El molde es `CambiarDiaRepartoModal` (262): misma operación —corregir una fecha ya escrita que
 * decide cuándo la orden vuelve a circular—, sobre otra columna. De ahí salen la forma (modal,
 * motivo obligatorio, relectura del listado al terminar) y la disciplina de textos.
 *
 * LAS TRES COSAS QUE DECIDE ESTA PANTALLA Y NO EL BACKEND:
 *
 *   1. ENSEÑA LA FECHA ACTUAL ANTES DE CORREGIR (`avisoFechaActual`). Corregir a ciegas es cómo se
 *      llega a la SEGUNDA fecha equivocada; el dato ya viaja en la fila.
 *   2. EL MÍNIMO DEL CAMPO ES HOY, no mañana. Es una divergencia deliberada respecto del registro
 *      original —que exige mañana— y es la razón de ser de la ficha: el caso real es corregir del
 *      4 al 3 estando a día 3. La UI no puede ser más estricta que el borde o volvería a bloquear
 *      justo el caso que venimos a resolver.
 *   3. ⭑ CUENTA EL DESENLACE. Tras el éxito el modal NO se cierra: cambia a una segunda fase que
 *      dice qué pasó con la orden (`liberada` / `espera_cierre` / `espera_fecha`). Va en un panel
 *      que se queda, y no en un aviso que se desvanece, porque `espera_cierre` —7 de las 31 que
 *      esperan hoy— significa que la orden SIGUE RETENIDA: quien no lea ese mensaje mirará el
 *      listado, verá la orden bloqueada y no entenderá nada.
 *
 * ⚠️ NO SE COPIA EL SELECTOR DE DOS FICHAS de la 262 («hoy»/«mañana»): aquí hace falta un campo de
 * fecha REAL, como el de `ReprogramarNovedadModal`, porque la corrección puede ir a cualquier día
 * —la fecha equivocada del caso real estaba a dos días vista—.
 */
export function CorregirFechaReprogramacionModal({
  open,
  ordenes,
  hoyISO,
  onOpenChange,
  onSuccess,
  title = CORREGIR_FECHA_ACCION,
}: Readonly<CorregirFechaReprogramacionModalProps>) {
  const fechaId = useId();
  const fechaAyudaId = useId();
  const fechaErrorId = useId();
  const motivoId = useId();
  const motivoAyudaId = useId();
  const motivoErrorId = useId();

  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");
  /** Se enciende al primer intento de confirmar: no se regaña a nadie por un campo aún sin tocar. */
  const [intentado, setIntentado] = useState(false);
  const [rechazo, setRechazo] = useState<string | null>(null);
  const [desenlace, setDesenlace] = useState<DesenlaceUI | null>(null);

  // Cada apertura arranca limpia. Patrón «ajustar estado durante el render» (el mismo de
  // `CambiarDiaRepartoModal`): en un efecto, estos `setState` encadenarían un render extra con
  // los valores viejos —incluido el desenlace de la corrección ANTERIOR— ya visibles.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setFecha("");
      setMotivo("");
      setIntentado(false);
      setRechazo(null);
      setDesenlace(null);
    }
  }

  const orden = ordenes.length === 1 ? ordenes[0] : null;
  // Sin fecha elegida no hay nada que enviar; con una anterior a hoy, el borde la rechazaría.
  const fechaOk = fecha !== "" && (hoyISO === "" || fecha >= hoyISO);
  const motivoOk = motivoValido(motivo);
  const listo = orden !== null && fechaOk && motivoOk;

  async function handleConfirm() {
    // ⚠️ EL BOTÓN NO SE DESHABILITA POR CAMPO VACÍO, y es deliberado (aquí se separa de la 262).
    // Un confirmar apagado no dice QUÉ falta: quien no escribe el motivo se queda mirando un botón
    // muerto. Se deja pulsable, y al pulsarlo el error aparece JUNTO AL CAMPO que lo causa. La
    // acción NO se llama: la guarda de abajo corta antes, y el borde revalida igual.
    setIntentado(true);
    if (!listo || orden === null) return;

    // Un rechazo anterior deja de describir lo que va a pasar en cuanto se vuelve a confirmar.
    setRechazo(null);

    const result = await corregirFechaReprogramacion({
      ordenId: orden.id,
      fecha,
      motivo: motivo.trim(),
    });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal: no cierra y llama a `onError`
    }

    // ⭑ El desenlace, a la vista y sin cerrar el modal.
    setDesenlace({
      liberacion: result.liberacion,
      fechaAnterior: result.fechaAnterior,
      fechaNueva: result.fechaNueva,
    });
    onSuccess(); // el listado vuelve a leer del servidor detrás del modal
  }

  function handleError(error: unknown) {
    setRechazo(corregirFechaErrorMensaje(error));
  }

  // Segunda fase: ya se corrigió. No hay nada más que confirmar, así que el botón que escribe
  // desaparece y el que queda sólo cierra.
  const corregido = desenlace !== null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={corregido ? undefined : CORREGIR_FECHA_DESCRIPCION}
      confirmLabel={CORREGIR_FECHA_CONFIRMAR}
      // Sólo se apaga cuando no hay UNA orden que corregir: eso no lo arregla ningún campo de
      // este formulario, sino la selección del listado. Lo demás se explica al pulsar.
      confirmDisabled={orden === null}
      hideConfirm={corregido}
      cancelLabel={corregido ? "Cerrar" : "Cancelar"}
      // El desenlace se queda a la vista: es la mitad del valor de esta pantalla.
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {desenlace ? (
          <p
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm text-foreground ${TONO_CLASES[tonoDesenlace(desenlace.liberacion)]}`}
          >
            {textoDesenlace(
              desenlace.liberacion,
              desenlace.fechaAnterior,
              desenlace.fechaNueva,
            )}
          </p>
        ) : (
          <>
            {orden === null ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {ordenes.length === 0 ? CORREGIR_FECHA_SIN_ORDEN : CORREGIR_FECHA_UNA_SOLA}
              </p>
            ) : (
              /* La fecha para la que la orden está reprogramada HOY: lo único que impide
                 corregir a ciegas. La orden se nombra por su nº de remisión, nunca por su
                 identificador interno. */
              <p className="text-sm text-muted-foreground">
                {orden.numRemision} · {avisoFechaActual(orden.fechaReprogramacion)}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fechaId}>{FECHA_LABEL}</Label>
              <Input
                id={fechaId}
                type="date"
                value={fecha}
                // El mínimo es HOY (ver la cabecera): el día en curso es una corrección válida.
                min={hoyISO === "" ? undefined : hoyISO}
                onChange={(event) => setFecha(event.target.value)}
                required
                aria-describedby={
                  intentado && !fechaOk ? `${fechaErrorId} ${fechaAyudaId}` : fechaAyudaId
                }
                aria-invalid={intentado && !fechaOk ? true : undefined}
              />
              <p id={fechaAyudaId} className="text-xs text-muted-foreground">
                {FECHA_AYUDA}
              </p>
              {intentado && !fechaOk ? (
                <p id={fechaErrorId} role="alert" className="text-sm text-destructive">
                  {FECHA_INVALIDA}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={motivoId}>{MOTIVO_LABEL}</Label>
              <Textarea
                id={motivoId}
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder={MOTIVO_PLACEHOLDER}
                rows={3}
                required
                aria-describedby={
                  intentado && !motivoOk ? `${motivoErrorId} ${motivoAyudaId}` : motivoAyudaId
                }
                aria-invalid={intentado && !motivoOk ? true : undefined}
              />
              <p id={motivoAyudaId} className="text-xs text-muted-foreground">
                {MOTIVO_AYUDA}
              </p>
              {intentado && !motivoOk ? (
                <p id={motivoErrorId} role="alert" className="text-sm text-destructive">
                  {MOTIVO_INVALIDO}
                </p>
              ) : null}
            </div>

            {/* El rechazo del servidor, DENTRO del modal y con su causa real: la orden sigue
                seleccionada y el operador tiene que poder leer por qué falló antes de reintentar. */}
            {rechazo ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {rechazo}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
