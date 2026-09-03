"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { SelectorDiaReparto } from "@/components/shared/SelectorDiaReparto";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import type { DiaReparto } from "@/lib/types/dia-reparto";
import {
  confirmacionDiaReparto,
  type FechasDiaReparto,
} from "@/lib/utils/dia-reparto-textos";
import type { AsignarBodegaResult } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { MOTIVO_BLOQUEADO_POR_CIERRE, toMensajeroOptions } from "./mensajero-options";
import { MOTIVO_USUARIO_NO_ASIGNABLE } from "@/lib/constants/estado-usuario-asignable";
import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";
import { mensajeDireccionPorMotivo } from "@/app/(app)/_components/geocodificacion-motivo-messages";

export interface AsignarBodegaModalProps {
  open: boolean;
  /**
   * Órdenes de `en_bodega_central` seleccionadas al abrir (snapshot, R17/R26). El padre
   * ya filtró a `zonaEsGam === true`: `asignarDesdeBodega` exige zona GAM y mensajero de
   * la zona central (R27/R12), así que una orden satélite aquí saldría `conflict`
   * (defensa en profundidad), pero no se ofrece en la UI. Si el filtro deja el lote
   * vacío, el modal avisa y deshabilita el confirmar.
   */
  ordenes: OrdenListItemDTO[];
  /** TODOS los mensajeros, sin filtro de zona (R28). */
  mensajeros: MensajeroLiteDTO[];
  /**
   * Feature 157 (regla de dedicación): ids con una RECOLECCIÓN en tienda sin confirmar.
   * Tienen un viaje comprometido, así que no reciben reparto hasta cerrarlo.
   */
  mensajerosConRecoleccionIds?: string[];
  /**
   * FEATURE 271 (T9.4, R32): ids que el servidor va a RECHAZAR por su cierre —acumula dos sin
   * aprobar, o arrastra uno que espera a que él lo reenvíe—. Se deshabilitan con el motivo a la
   * vista, y el conjunto es EXACTAMENTE el que rechaza `asignarDesdeBodega`: no se re-deriva aquí.
   *
   * ⚠️ Esto se había RETIRADO el 2026-08-18, cuando recibir trabajo dejó de bloquearse. La 271
   * revierte esa mitad de la regla (decisión del humano del 2026-08-23) y con ella vuelve el
   * marcado: sin él, la pantalla ofrece un mensajero que la acción va a negar.
   */
  mensajerosBloqueadosIds?: string[];
  /**
   * Pedido humano (2026-08-26): ids de mensajeros que NO pueden recibir trabajo por su ESTADO de
   * usuario (`inactivo` / `bloqueado`). Llega de la MISMA acción que la lista, resuelto con el
   * MISMO predicado que aplica la escritura: aquí no se re-deriva nada.
   */
  mensajerosNoAsignablesIds?: string[];
  /**
   * Feature 246 (T4.2, R29): fechas calendario de «hoy» y «mañana» resueltas EN EL SERVIDOR y
   * bajadas por props desde la página. Obligatorias: montar el modal sin decidir de dónde salen
   * las etiquetas del día tiene que ser imposible, porque la alternativa fácil —calcularlas con
   * `new Date()` aquí— es justo lo que R29 prohíbe.
   */
  fechasDiaReparto: FechasDiaReparto;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Modal async "Asignar mensajero" desde `en_bodega_central` (feature 17, T19, R26): un
 * único mensajero para todo el lote seleccionado (design.md §3.2,
 * `asignarDesdeBodega({ ordenIds, mensajeroId })`); NO reasigna `num_guia`
 * (R5/R26, ya asignado en "Generar guía").
 */
export function AsignarBodegaModal({
  open,
  ordenes,
  mensajeros,
  mensajerosConRecoleccionIds = [],
  mensajerosBloqueadosIds = [],
  mensajerosNoAsignablesIds = [],
  fechasDiaReparto,
  onOpenChange,
  onSuccess,
}: AsignarBodegaModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Feature 246 (T4.2, R27): «Hoy» PRESELECCIONADO. El estado arranca en `"hoy"` y el envío
  // manda siempre un valor explícito, así que no hay ningún camino por el que un lote acabe
  // «para mañana» sin que alguien lo eligiera — que sería peor que el defecto que esta ficha
  // arregla. El borde también tiene `.default("hoy")` (R4), pero eso es la red de abajo: aquí
  // la elección es explícita para que el servidor no tenga que adivinar nada.
  const [dia, setDia] = useState<DiaReparto>("hoy");
  // Feature 148 (T11, §9.7): fase "resultado" con el lote ya cometido.
  const [resultado, setResultado] = useState<{
    ordenIds: string[];
    mensaje: string;
    /** R28: para qué día quedó el lote, en palabras. Se congela con el lote cometido. */
    confirmacionDia: string;
    /**
     * Feature 368 (R10-R12): éxito parcial — órdenes que el gate de coordenadas bloqueó,
     * identificadas por su `numRemision` (nunca por id interno ni dirección, R10/R14) con el
     * mensaje de SU propio motivo (R11). Vacío en éxito total.
     */
    bloqueadas: { numRemision: string; mensaje: string }[];
  } | null>(null);
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado
  // durante el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMensajeroId("");
      // El día vuelve a «hoy» en CADA apertura, no sólo en la primera: el modal no se
      // desmonta al cerrarse, así que sin esto un «mañana» elegido para un lote se quedaría
      // pegado y el siguiente lote saldría reservado sin que nadie lo pidiera.
      setDia("hoy");
      setResultado(null);
    }
  }

  // Los TRES motivos por los que hoy NO se puede elegir a un mensajero, en un solo mapa. El del
  // CIERRE va DESPUÉS del de recolección a propósito: si concurren, gana el que el mensajero tiene
  // que resolver él (mandarlo a cerrar es accionable; decirle que espere a que termine su
  // recolección, no). El del ESTADO va EL ÚLTIMO y gana a los dos (2026-08-26): un mensajero dado
  // de baja no se desbloquea cerrando nada ni esperando, y quien asigna necesita saber que el
  // arreglo está en otra pantalla.
  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Map([
      ...mensajerosConRecoleccionIds.map(
        (id) => [id, "tiene recolección pendiente"] as const,
      ),
      ...mensajerosBloqueadosIds.map((id) => [id, MOTIVO_BLOQUEADO_POR_CIERRE] as const),
      ...mensajerosNoAsignablesIds.map((id) => [id, MOTIVO_USUARIO_NO_ASIGNABLE] as const),
    ]),
  );

  // El filtro por zona del padre puede dejar el lote vacío (selección solo de zonas
  // satélite). Sin órdenes no hay nada que asignar, y `asignarDesdeBodega` devolvería
  // un "ok" de 0 órdenes: se avisa y se deshabilita el confirmar, igual que
  // `RecuperarABodegaModal` con su propio filtro.
  const sinOrdenes = ordenes.length === 0;

  async function handleConfirm() {
    if (!mensajeroId) {
      // Validación en el borde de UI: sin mensajero no hay nada que asignar.
      // Reusa el canal de error del Modal con la misma forma de resultado.
      const validationError: AsignarBodegaResult = {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
      };
      throw validationError;
    }

    const result = await asignarDesdeBodega({
      ordenIds: ordenes.map((orden) => orden.id),
      mensajeroId,
      // Feature 246 (R1/R3): UN token para TODO el lote — una asignación, un día de reparto.
      // Se manda SIEMPRE, elija lo que elija el usuario: el borde tiene `.default("hoy")`, así
      // que un modal que se olvidara de este campo no rompería nada y nadie se enteraría. Por eso
      // hay un caso de componente que afirma que el valor elegido VIAJA.
      //
      // Va el TOKEN, nunca una fecha (R6): la fecha la resuelve el servidor con el día de Costa
      // Rica, y el reloj del navegador no puede decidir el día de reparto de ninguna orden.
      dia,
    });
    // Feature 368 (R1/R15): "partial" se suma a "ok" — es un resultado que SÍ tuvo efecto
    // (las órdenes asignables se asignaron), así que no va al canal de error del `Modal`.
    // Solo el resto de resultados no-"ok" (conflict/forbidden/validation_error) siguen
    // lanzándose ahí, sin ningún cambio de comportamiento (R16).
    if (result.status !== "ok" && result.status !== "partial") {
      throw result;
    }

    // R10: el identificador visible sale del MISMO snapshot `ordenes` que generó los
    // `ordenIds` enviados al servidor — nunca de un campo nuevo en la respuesta del backend
    // (design.md §2.2/§6.2).
    const numRemisionPorId = new Map(ordenes.map((orden) => [orden.id, orden.numRemision]));
    const bloqueadas =
      result.status === "partial"
        ? result.bloqueadas.map((b) => ({
            numRemision: numRemisionPorId.get(b.ordenId) ?? b.ordenId, // fallback defensivo
            // R11: mensaje de SU PROPIO motivo, no el agregado del lote.
            mensaje: mensajeDireccionPorMotivo(b.motivo) ?? "No se pudo asignar.",
          }))
        : [];

    // R12: informa cuántas se asignaron y cuántas quedaron bloqueadas, en el mismo lugar
    // donde hoy se confirma un lote de éxito total. Literales de design.md §6.3 (Q1
    // aprobado por el humano el 2026-09-03), a mano — no se derivan de otra fuente.
    const mensaje =
      result.status === "partial"
        ? `Mensajero asignado a ${result.resultados.length} de ${
            result.resultados.length + bloqueadas.length
          } orden(es). ${bloqueadas.length} bloqueada(s).`
        : `Mensajero asignado a ${result.resultados.length} orden(es).`;
    toast.success(mensaje);
    // Feature 148 (§9.7): asignación ya cometida → fase "resultado"; `onSuccess()`
    // se difiere al cierre. La llamada de negocio, su input y su toast no cambian (R27).
    setResultado({
      // R13: el manifiesto sigue recibiendo SOLO las órdenes efectivamente asignadas —
      // `result.resultados` ya es ese subconjunto, tanto en "ok" como en "partial".
      ordenIds: result.resultados.map((r) => r.ordenId),
      mensaje,
      // R28: la frase se calcula con el día que se ACABA de cometer y se guarda con el
      // resultado. Derivarla del estado vivo dejaría que un cambio posterior del selector
      // reescribiera la confirmación de un lote que ya está asignado.
      confirmacionDia: confirmacionDiaReparto(dia, fechasDiaReparto),
      bloqueadas,
    });
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  /** Cierre de la fase "resultado" por cualquier vía: recién ahí refresca el padre. */
  function handleOpenChange(next: boolean) {
    if (!next && resultado) {
      setResultado(null);
      onOpenChange(false);
      onSuccess();
      return;
    }
    onOpenChange(next);
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Asignar mensajero"
      description={
        resultado
          ? "Mensajero asignado. Descarga el manifiesto del lote antes de cerrar."
          : `Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de bodega.`
      }
      confirmLabel="Asignar"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      confirmDisabled={sinOrdenes}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <div className="flex flex-col gap-3">
          {/* Feature 246 (T4.4, R28): la confirmación de PARA QUÉ DÍA quedó el lote, con
              palabras y sin siglas. Va como `role="status"` para que un lector de pantalla la
              anuncie al entrar la fase de resultado, igual que el resto de avisos derivados de
              la app. */}
          <p
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            {resultado.confirmacionDia}
          </p>
          <ManifiestoResultado
            mensaje={resultado.mensaje}
            flujo="generacion_guia"
            seleccion={{ ordenIds: resultado.ordenIds }}
          />
          {/* Feature 368 (R10-R12/R14): éxito parcial — una entrada por orden bloqueada, con
              su identificador visible y el mensaje de SU propio motivo. Mismo estilo que el
              bloque de "sinOrdenes" de más abajo. */}
          {resultado.bloqueadas.length > 0 ? (
            <ul
              role="alert"
              className="flex list-disc flex-col gap-1 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 pl-8 text-sm text-destructive"
            >
              {resultado.bloqueadas.map((b) => (
                <li key={b.numRemision}>
                  {b.numRemision} — {b.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : sinOrdenes ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Selecciona órdenes de la zona central.
        </p>
      ) : (
      <div className="flex flex-col gap-2">
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {/* Feature 160 (R18/R19/R23): dato etiquetado junto a cada orden listada, en
              la misma línea y con el mismo markup que el resto del `<li>`. Siempre
              visible, `0` incluido; sin umbral (R20). */}
          {ordenes.map((orden) => (
            <li key={orden.id}>
              {orden.numRemision} · <IntentosDato intentos={valorIntentos(orden)} />
            </li>
          ))}
        </ul>
        <Select
          value={mensajeroId}
          onValueChange={setMensajeroId}
          options={mensajeroOptions}
          placeholder="Selecciona un mensajero"
          aria-label="Mensajero para el lote"
        />
        {/* Feature 246 (T4.2, R1/R27): la elección del día del lote, con «Hoy» preseleccionado.
            Debajo del mensajero porque el orden de lectura es «a quién» y luego «para cuándo». */}
        <SelectorDiaReparto
          valor={dia}
          onValorChange={setDia}
          fechas={fechasDiaReparto}
        />
      </div>
      )}
    </Modal>
  );
}
