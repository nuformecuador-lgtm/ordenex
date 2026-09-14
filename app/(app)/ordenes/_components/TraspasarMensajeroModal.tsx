"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { traspasarMensajero } from "@/lib/actions/traspasar-mensajero";
import { MOTIVO_USUARIO_NO_ASIGNABLE } from "@/lib/constants/estado-usuario-asignable";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { MOTIVO_BLOQUEADO_POR_CIERRE, toMensajeroOptions } from "./mensajero-options";
import {
  MOTIVO_AYUDA,
  MOTIVO_LABEL,
  MOTIVO_MAX_LEN,
  MOTIVO_PLACEHOLDER,
  motivoValido,
  traspasarMensajeroErrorMessage,
} from "./traspaso-error-messages";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumple por estructura `OrdenListItemDTO`
 * (el listado de `/ordenes`), que es hoy su única superficie, sin obligar al modal a depender del
 * DTO entero — el mismo criterio que `DeshacerAsignacionOrdenUI` (149).
 *
 * El MENSAJERO DE ORIGEN sale de aquí y NO de una prop propia: R8 dice que el origen se DERIVA de
 * las órdenes, y una prop suelta sería una segunda fuente que puede discrepar de la selección.
 */
export interface TraspasarMensajeroOrdenUI {
  id: string;
  numRemision: string;
  mensajeroAsignadoId?: string | null;
  relaciones?: { mensajeroAsignado: { nombre: string } | null } | null;
}

export interface TraspasarMensajeroModalProps {
  open: boolean;
  /** Snapshot del LOTE seleccionado al abrir. Vacío ⇒ el confirmar queda deshabilitado. */
  ordenes: readonly TraspasarMensajeroOrdenUI[];
  /** TODOS los mensajeros, sin filtro de zona (la misma lista que los modales de asignación). */
  mensajeros: readonly MensajeroLiteDTO[];
  /** Feature 157: ids con una RECOLECCIÓN en tienda sin confirmar (R13). */
  mensajerosConRecoleccionIds?: readonly string[];
  /** FEATURE 271 (R11): ids que el servidor va a rechazar por sus cierres sin resolver. */
  mensajerosBloqueadosIds?: readonly string[];
  /** Ids que no pueden recibir trabajo por su ESTADO de usuario (R10). */
  mensajerosNoAsignablesIds?: readonly string[];
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre RELEE el estado del servidor (R36). */
  onSuccess: () => void;
  /** Título del modal; prop para i18n futura. */
  title?: string;
}

/**
 * FICHA 427 — el texto de la acción, declarado JUNTO al modal que abre y exportado desde aquí.
 * Molde de `CAMBIAR_DIA_ACCION` (262): el botón de la barra y el título del modal no pueden
 * divergir si salen del mismo sitio.
 */
export const TRASPASAR_MENSAJERO_ACCION = "Traspasar a otro mensajero";

const CONFIRMAR = "Traspasar";

/** Lo que se lee cuando la selección no permite derivar un origen único (R6/R8). */
const AVISO_SIN_ORDENES = "Selecciona al menos una orden.";
const AVISO_VARIOS_ORIGENES =
  "La selección mezcla órdenes de varios mensajeros. Filtra por un solo mensajero y vuelve a seleccionarlas.";
const AVISO_SIN_MENSAJERO =
  "Alguna orden de la selección no tiene mensajero asignado: eso no es un traspaso, hay que asignarla.";

const SELECT_PLACEHOLDER = "Selecciona el mensajero que las recibe";
const SELECT_ARIA = "Mensajero que recibe el lote";
const SIN_MENSAJEROS_DISPONIBLES =
  "No hay otro mensajero al que traspasar estas órdenes.";

/** R35 — «cuántas, desde quién y hacia quién», ANTES de ejecutar nada. */
function textoConfirmacion(
  cuantas: number,
  origenNombre: string,
  destinoNombre: string | null,
): string {
  const lote = `${cuantas} orden(es)`;
  return destinoNombre === null
    ? `Vas a pasar ${lote} de ${origenNombre}. Elige a quién se las traspasas.`
    : `Vas a pasar ${lote} de ${origenNombre} a ${destinoNombre}.`;
}

/** R36 — lo que de verdad se movió, con las cifras que devuelve el SERVIDOR (no la selección). */
function textoMovidas(movidas: number, conversaciones: number): string {
  return `Se movieron ${movidas} orden(es) y ${conversaciones} conversación(es) de chat.`;
}

/**
 * R33 — LA RUTA DEL QUE RECIBE QUEDA OBSOLETA, Y LA PANTALLA TIENE QUE DECIRLO.
 *
 * No es un adorno: es la lección que dejó el arreglo manual del 2026-09-14. El recálculo se encola
 * dentro de la transacción (R32) pero corre DESPUÉS, y hasta que corra las paradas nuevas se pintan
 * al final del recorrido —comportamiento declarado de `ruta_optimizada_parada`—. Si la pantalla no
 * lo dice, el mensajero que recibe sigue un orden de paradas calculado para el recorrido de otra
 * persona.
 *
 * Lenguaje claro y sin siglas: «se va a recalcular», no «reoptimización encolada».
 */
function textoRutaPendiente(destinoNombre: string): string {
  return `La ruta de ${destinoNombre} se va a recalcular; hasta entonces las paradas nuevas aparecen al final de su recorrido.`;
}

/**
 * FICHA 427 (T22, R33-R37) — Modal por LOTE de «Traspasar a otro mensajero».
 *
 * Cuerpo de `DeshacerAsignacionModal` (motivo obligatorio, confirmar deshabilitado hasta que
 * valide, UNA sola llamada con el lote completo) más el selector de mensajero de
 * `AsignarBodegaModal` con sus marcadores de no-elegible.
 *
 * - UNA sola llamada con el lote COMPLETO: el backend es todo-o-nada por lote (R23), así que
 *   partirlo en N llamadas produciría exactamente el estado parcial que el diseño evita.
 * - EL ORIGEN SE MUESTRA, NO SE ELIGE (R8/R35): sale de la selección. Si la selección mezcla
 *   mensajeros, el modal lo dice y no deja confirmar — el servidor lo rechazaría igual (R6), y una
 *   pantalla no debe ofrecer lo que el servidor va a negar.
 * - EL SELECTOR EXCLUYE AL ORIGEN (R7), por la misma razón y con el precedente del incidente del
 *   18/08.
 * - Tras el éxito el modal NO se cierra solo: pasa a una fase de RESULTADO donde se leen las dos
 *   cifras (R36) y el aviso de la ruta pendiente (R33). `onSuccess()` relee el listado detrás; el
 *   modal lo cierra la persona cuando ha leído el desenlace. Molde de
 *   `CorregirFechaReprogramacionModal` (371), y por el mismo motivo: cerrar de golpe se lleva el
 *   mensaje que explica qué pasó.
 */
export function TraspasarMensajeroModal({
  open,
  ordenes,
  mensajeros,
  mensajerosConRecoleccionIds = [],
  mensajerosBloqueadosIds = [],
  mensajerosNoAsignablesIds = [],
  onOpenChange,
  onSuccess,
  title = TRASPASAR_MENSAJERO_ACCION,
}: Readonly<TraspasarMensajeroModalProps>) {
  const toast = useToast();
  const motivoId = useId();
  const ayudaId = useId();
  const destinoId = useId();
  const [mensajeroDestinoId, setMensajeroDestinoId] = useState("");
  const [motivo, setMotivo] = useState("");
  /** Fase «resultado»: lo que el servidor confirmó, congelado con el lote ya cometido. */
  const [resultado, setResultado] = useState<{
    movidas: number;
    conversaciones: number;
    destinoNombre: string;
  } | null>(null);

  // Cada apertura arranca limpia: el motivo y el destino describen ESTE lote, no el anterior.
  // Patrón «ajustar estado durante el render» (el mismo de `AsignarBodegaModal`): en un efecto,
  // estos `setState` encadenarían un render extra con los valores viejos ya visibles.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setMotivo("");
      setMensajeroDestinoId("");
      setResultado(null);
    }
  }

  // R8 — EL ORIGEN SE DERIVA DE LAS ÓRDENES. `null` en el conjunto = alguna orden sin mensajero.
  const origenes = new Set(ordenes.map((o) => o.mensajeroAsignadoId ?? null));
  const sinOrdenes = ordenes.length === 0;
  const hayOrdenSinMensajero = origenes.has(null);
  const variosOrigenes = origenes.size > 1;
  const origenId = !sinOrdenes && origenes.size === 1 && !hayOrdenSinMensajero
    ? ([...origenes][0] as string)
    : null;

  // El nombre del origen sale de la fila del listado (la columna «Mensajero» ya lo pinta) y, si no
  // viniera, del directorio de mensajeros. Nunca se inventa: sin nombre no se afirma nada.
  const origenNombre =
    ordenes.find((o) => o.mensajeroAsignadoId === origenId)?.relaciones?.mensajeroAsignado
      ?.nombre ??
    mensajeros.find((m) => m.id === origenId)?.nombre ??
    null;

  // R7: el origen NO se ofrece como destino. El servidor lo rechaza igual y el CHECK de la base lo
  // hace inescribible, pero ofrecerlo sería pintar un control condenado.
  const candidatos = mensajeros.filter((m) => m.id !== origenId);
  const opcionesDestino = toMensajeroOptions(
    [...candidatos],
    new Map([
      ...mensajerosConRecoleccionIds.map(
        (id) => [id, "tiene recolección pendiente"] as const,
      ),
      ...mensajerosBloqueadosIds.map((id) => [id, MOTIVO_BLOQUEADO_POR_CIERRE] as const),
      ...mensajerosNoAsignablesIds.map((id) => [id, MOTIVO_USUARIO_NO_ASIGNABLE] as const),
    ]),
  );

  const destinoNombre =
    mensajeros.find((m) => m.id === mensajeroDestinoId)?.nombre ?? null;
  const motivoOk = motivoValido(motivo);
  const loteUtilizable = !sinOrdenes && origenId !== null && origenNombre !== null;
  const puedeConfirmar = loteUtilizable && mensajeroDestinoId !== "" && motivoOk;

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled` (el Modal ya bloquea el click, pero el handler no
    // debe depender de eso para no llamar a la acción sin motivo ni sin destino).
    if (!puedeConfirmar) return;

    const result = await traspasarMensajero({
      // R8: NO viaja ningún campo de origen. El servicio lo deriva de las órdenes.
      ordenIds: ordenes.map((orden) => orden.id),
      mensajeroDestinoId,
      motivo: motivo.trim(),
    });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal (patrón DeshacerAsignacionModal)
    }

    // R36: las CIFRAS son las del servidor, no las de la selección. Con 31 órdenes y 31
    // conversaciones, eso es exactamente lo que se lee.
    const movidas = textoMovidas(result.movidas, result.conversaciones);
    toast.success(movidas);
    setResultado({
      movidas: result.movidas,
      conversaciones: result.conversaciones,
      // El nombre sale de la RESPUESTA del servidor, que es quien sabe a quién se las dio.
      destinoNombre: result.destino.nombre,
    });
    onSuccess(); // relee el listado detrás; el modal se queda con el desenlace a la vista
  }

  function handleError(error: unknown) {
    toast.error(traspasarMensajeroErrorMessage(error));
  }

  const avisoLote = sinOrdenes
    ? AVISO_SIN_ORDENES
    : hayOrdenSinMensajero
      ? AVISO_SIN_MENSAJERO
      : variosOrigenes || origenNombre === null
        ? AVISO_VARIOS_ORIGENES
        : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        resultado
          ? "Traspaso hecho. Lee el resumen antes de cerrar."
          : avisoLote !== null
            ? title
            : textoConfirmacion(ordenes.length, origenNombre ?? "", destinoNombre)
      }
      confirmLabel={CONFIRMAR}
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      confirmDisabled={!puedeConfirmar}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <div className="flex flex-col gap-3">
          <p
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            {textoMovidas(resultado.movidas, resultado.conversaciones)}
          </p>
          {/* R33: el aviso de la ruta va SIEMPRE, no sólo cuando algo falla. Es lo que el arreglo
              manual enseñó: sin él, quien recibe sigue un orden de paradas que no es el suyo. */}
          <p role="status" className="text-sm">
            {textoRutaPendiente(resultado.destinoNombre)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {avisoLote !== null ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {avisoLote}
            </p>
          ) : (
            <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
              {ordenes.map((orden) => (
                <li key={orden.id}>{orden.numRemision}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={destinoId} className="text-sm font-medium">
              {SELECT_ARIA}
            </label>
            {opcionesDestino.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {SIN_MENSAJEROS_DISPONIBLES}
              </p>
            ) : (
              <Select
                id={destinoId}
                value={mensajeroDestinoId}
                onValueChange={setMensajeroDestinoId}
                options={opcionesDestino}
                placeholder={SELECT_PLACEHOLDER}
                aria-label={SELECT_ARIA}
              />
            )}
          </div>

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

          {/* R33, ANTES de confirmar: la consecuencia se dice cuando todavía se puede decidir, no
              sólo cuando ya está hecho. */}
          {destinoNombre !== null ? (
            <p role="status" className="text-sm text-muted-foreground">
              {textoRutaPendiente(destinoNombre)}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
