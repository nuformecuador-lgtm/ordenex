"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { SelectorDiaReparto } from "@/components/shared/SelectorDiaReparto";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import type { DiaReparto } from "@/lib/types/dia-reparto";
import {
  confirmacionDiaReparto,
  type FechasDiaReparto,
} from "@/lib/utils/dia-reparto-textos";
import type { AsignarSateliteResult } from "@/lib/types/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

import {
  MOTIVO_BLOQUEADO_POR_CIERRE,
  toMensajeroOptions,
} from "@/app/(app)/ordenes/_components/mensajero-options";
import { MOTIVO_USUARIO_NO_ASIGNABLE } from "@/lib/constants/estado-usuario-asignable";
import { asignacionSateliteErrorMessage } from "./asignacion-satelite-error-messages";
import {
  esMotivoAutorizableSinUbicacion,
  LABEL_AUTORIZAR_SIN_UBICACION,
  mensajeAsignadasSinUbicacion,
  mensajeAsignadasSinUbicacionAutorizada,
  mensajeDireccionPorMotivo,
  MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION,
} from "@/app/(app)/_components/geocodificacion-motivo-messages";

/**
 * FICHA 407 — los dos desenlaces de `asignarDesdeSatelite` que SÍ tuvieron efecto. Espejo exacto
 * del de la bodega central: las dos peticiones (la normal y la autorizada) comparten el mismo
 * procesamiento, para que el manifiesto de la segunda no se coma lo asignado en la primera.
 */
type AsignacionConEfecto = Extract<AsignarSateliteResult, { status: "ok" | "partial" }>;

/** Una orden del lote que el gate bloqueó y una persona PUEDE autorizar (R16/R19). */
interface OrdenAutorizable {
  ordenId: string;
  /** R19: el identificador que se muestra. El id interno nunca se pinta. */
  numRemision: string;
}

export interface AsignarSateliteModalProps {
  open: boolean;
  /** Órdenes `en_bodega_satelite` seleccionadas al abrir (snapshot, R4). */
  ordenes: RecepcionSateliteDTO[];
  /** Mensajeros de la zona del adminSatelite (ya scoped server-side, R5). */
  mensajeros: { id: string; nombre: string }[];
  /**
   * FEATURE 271 (T9.5, R29/R32) — ids que `AsignacionSateliteService.asignar` va a RECHAZAR por
   * su cierre. Se deshabilitan con el motivo a la vista.
   *
   * ⚠️ ESTA ES LA PANTALLA DEL INCIDENTE DEL 18/08: dejaba elegir a un mensajero que el servidor
   * rechazaba, y el mensaje que devolvía no lo explicaba. Este selector NUNCA había tenido el
   * dato —ni antes ni después de la 241—; el de la bodega central al menos lo tuvo. Es la mitad
   * que faltaba, y por eso el conjunto tiene que ser EXACTAMENTE el que el servidor rechaza: ni
   * uno más, ni uno menos.
   */
  mensajerosBloqueadosIds?: string[];
  /**
   * Pedido humano (2026-08-26): ids de mensajeros que NO pueden recibir trabajo por su ESTADO de
   * usuario (`inactivo` / `bloqueado`). Llega de la MISMA acción que la lista, resuelto con el
   * MISMO predicado que aplica la escritura: aquí no se re-deriva nada.
   */
  mensajerosNoAsignablesIds?: string[];
  /**
   * Feature 246 (T4.3, R29): las MISMAS fechas y el MISMO contrato que la bodega central. La
   * simetría no es estética: D4 se firmó para que la elección del día signifique exactamente lo
   * mismo desde las dos bodegas.
   */
  fechasDiaReparto: FechasDiaReparto;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 34 (T9, F1.4-d): modal por lote con UN mensajero para asignar órdenes
 * `en_bodega_satelite` de la zona del adminSatelite (clon de `AsignarBodegaModal`
 * de la 17). Confirmar → `asignarDesdeSatelite({ ordenIds, mensajeroId })`; un
 * resultado no-"ok" se lanza al canal de error del `Modal` y se traduce a un
 * mensaje de usuario (R7/R9/R10). Si la zona no tiene mensajeros (R6), muestra un
 * estado vacío accionable y deshabilita el confirmar, SIN efectos en datos.
 */
export function AsignarSateliteModal({
  open,
  ordenes,
  mensajeros,
  mensajerosBloqueadosIds = [],
  mensajerosNoAsignablesIds = [],
  fechasDiaReparto,
  onOpenChange,
  onSuccess,
}: AsignarSateliteModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Feature 246 (T4.3, R27): «Hoy» PRESELECCIONADO, igual que en bodega central. Ninguna orden
  // acaba reservada para mañana sin que alguien lo elija.
  const [dia, setDia] = useState<DiaReparto>("hoy");
  // Feature 148 (T12, §9.7): fase "resultado" con el lote ya asignado.
  const [resultado, setResultado] = useState<{
    ordenIds: string[];
    mensaje: string;
    /** R28: para qué día quedó el lote, en palabras. Se congela con el lote cometido. */
    confirmacionDia: string;
    /**
     * Feature 368 (R10-R12, espejo de AsignarBodegaModal): éxito parcial — órdenes que el
     * gate de coordenadas bloqueó, con su `numRemision` (nunca id interno ni dirección) y el
     * mensaje de SU propio motivo. Vacío en éxito total.
     */
    bloqueadas: { ordenId: string; numRemision: string; mensaje: string }[];
    /**
     * FICHA 407 (R20): las cifras de los avisos agregados, ACUMULADAS entre las dos peticiones
     * de una misma apertura. Espejo exacto de la bodega central.
     */
    sinUbicacion: number;
    sinUbicacionAutorizada: number;
  } | null>(null);
  /**
   * FICHA 407 (R16): las órdenes del último intento que el gate bloqueó por una dirección que
   * el mapa no reconoce y que, por tanto, una persona puede autorizar. Sale del `motivo` que
   * devuelve el servidor, filtrado con el predicado del módulo compartido — nunca con un
   * literal escrito aquí (R17).
   *
   * Se llena en las DOS rutas de un intento sin éxito total: `partial` y `conflict`. Y esta
   * pantalla importa más que la otra: la guía del caso real (76068276, Quesada / San Carlos)
   * está en bodega SATÉLITE, así que es aquí donde alguien lleva cinco días sin poder asignarla.
   */
  const [autorizables, setAutorizables] = useState<OrdenAutorizable[]>([]);
  /** Bloqueo anti-doble-envío de la segunda petición: vive fuera del `Modal`, que no la ve. */
  const [autorizando, setAutorizando] = useState(false);
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado durante
  // el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMensajeroId("");
      // El día vuelve a «hoy» en CADA apertura: el modal no se desmonta al cerrarse, así que
      // sin esto un «mañana» elegido para un lote se quedaría pegado al siguiente.
      setDia("hoy");
      setResultado(null);
      // FICHA 407 (R9): la autorización NO sobrevive a la apertura. El servidor tampoco la
      // guarda, así que dejarla pegada aquí ofrecería asignar sin ubicación un lote que nadie
      // ha intentado todavía.
      setAutorizables([]);
      setAutorizando(false);
    }
  }

  const sinMensajeros = mensajeros.length === 0; // R6
  // ⚠️ FEATURE 271 (T9.5, R32) — VUELVE EL DESHABILITADO POR CIERRE, Y AQUÍ ES DONDE MÁS IMPORTA.
  // El 2026-08-18 se retiró porque el service había dejado de rechazarlo; desde el 2026-08-23 lo
  // rechaza otra vez, así que no marcarlos devuelve la pantalla al estado exacto del incidente:
  // el adminSatelite elige a alguien y el lote entero se cae sin efectos. Sigue sin haber ninguna
  // otra regla de elegibilidad aquí (la dedicación reparto/recolección es de la central).
  //
  // 2026-08-26: y el segundo motivo, el ESTADO del usuario. Va DESPUÉS en el mapa, así que gana si
  // concurren: un mensajero dado de baja no se desbloquea cerrando cierres.
  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Map([
      ...mensajerosBloqueadosIds.map((id) => [id, MOTIVO_BLOQUEADO_POR_CIERRE] as const),
      ...mensajerosNoAsignablesIds.map((id) => [id, MOTIVO_USUARIO_NO_ASIGNABLE] as const),
    ]),
  );

  // R10 (368): el identificador visible sale del MISMO snapshot `ordenes` que generó los
  // `ordenIds` enviados al servidor — nunca de un campo nuevo en la respuesta del backend.
  // Vive en el cuerpo del componente porque ahora lo usan los dos caminos: la lista de
  // bloqueadas y el panel de autorización de la 407.
  const numRemisionPorId = new Map(ordenes.map((orden) => [orden.id, orden.numRemision]));

  /**
   * FICHA 407 (R16/R17) — recalcula qué órdenes del último intento se pueden autorizar.
   *
   * Mira las bloqueadas del gate en las dos formas en que llegan (`partial.bloqueadas` y
   * `conflict.detalle`) y se queda con las que el módulo compartido declara autorizables. Un
   * desenlace `ok` deja la lista vacía, que es lo que hace desaparecer el panel cuando la
   * segunda petición asigna todo.
   */
  function recogerAutorizables(result: AsignarSateliteResult) {
    const bloqueadasDelGate =
      result.status === "partial"
        ? result.bloqueadas
        : result.status === "conflict"
          ? result.detalle
          : [];
    setAutorizables(
      bloqueadasDelGate
        .filter((b) => esMotivoAutorizableSinUbicacion(b.motivo))
        .map((b) => ({
          ordenId: b.ordenId,
          numRemision: numRemisionPorId.get(b.ordenId) ?? b.ordenId, // fallback defensivo
        })),
    );
  }

  /**
   * Pasa a la fase «resultado» ACUMULANDO sobre lo que ya había (FICHA 407, R20).
   *
   * Por qué acumula y no reemplaza: la segunda petición —la autorizada— solo lleva las órdenes
   * autorizables, así que su respuesta solo trae ESAS. Si el manifiesto se quedara con la
   * última respuesta, el operador se descargaría un manifiesto al que le faltan las órdenes que
   * la primera petición SÍ asignó, y nada se lo diría. En la primera petición no hay nada
   * previo que acumular, así que el resultado es idéntico al de antes de esta ficha (R5).
   */
  function registrarAsignacion(result: AsignacionConEfecto) {
    const asignadasAhora = result.resultados.map((r) => r.ordenId);
    const previo = resultado;
    const yaAsignadas = previo?.ordenIds ?? [];
    const ordenIds = [
      ...yaAsignadas,
      ...asignadasAhora.filter((id) => !yaAsignadas.includes(id)),
    ];

    // Una orden que ACABA de asignarse deja de estar bloqueada: se cae de la lista previa.
    const bloqueadas = [
      ...(previo?.bloqueadas ?? []).filter((b) => !asignadasAhora.includes(b.ordenId)),
      ...(result.status === "partial"
        ? result.bloqueadas.map((b) => ({
            ordenId: b.ordenId,
            numRemision: numRemisionPorId.get(b.ordenId) ?? b.ordenId, // fallback defensivo
            // R11 (368): mensaje de SU PROPIO motivo, no el agregado del lote.
            mensaje: mensajeDireccionPorMotivo(b.motivo) ?? "No se pudo asignar.",
          }))
        : []),
    ];

    const sinUbicacion = (previo?.sinUbicacion ?? 0) + (result.sinUbicacion ?? 0);
    const sinUbicacionAutorizada =
      (previo?.sinUbicacionAutorizada ?? 0) + (result.sinUbicacionAutorizada ?? 0);

    // R12/R5 (368): mismo criterio y mismo texto que en la bodega central (Q1 aprobado,
    // design.md §6.3 de la 368), escrito a mano.
    //
    // La rama se elige por si QUEDA alguna bloqueada, no por el `status` de esta respuesta: tras
    // la segunda petición el desenlace puede ser `ok` y seguir habiendo una orden bloqueada por
    // un motivo que nadie puede autorizar. En la primera petición las dos condiciones coinciden,
    // así que el texto no cambia respecto de antes de esta ficha (R5).
    //
    // FEATURE 400 (R31/R34/R35) y FICHA 407 (R10/R12): espejo EXACTO de la bodega central — los
    // dos avisos agregados se concatenan a la misma frase que ya va al toast y al
    // `<ManifiestoResultado>`, jamás a la lista de bloqueadas (esas no recibieron mensajero;
    // estas sí). Son DOS avisos DISJUNTOS: el de la 400 dice que el problema es del sistema y no
    // de la dirección, y aquí la dirección SÍ es el problema (R12). Cifras agregadas y nada más:
    // las dos funciones reciben un número, así que por aquí no puede viajar ninguna guía ni
    // ningún id (R15).
    const mensaje =
      (bloqueadas.length > 0
        ? `Mensajero asignado a ${ordenIds.length} de ${
            ordenIds.length + bloqueadas.length
          } orden(es). ${bloqueadas.length} bloqueada(s).`
        : `Mensajero asignado a ${ordenIds.length} orden(es).`) +
      (sinUbicacion ? ` ${mensajeAsignadasSinUbicacion(sinUbicacion)}` : "") +
      (sinUbicacionAutorizada
        ? ` ${mensajeAsignadasSinUbicacionAutorizada(sinUbicacionAutorizada)}`
        : "");
    toast.success(mensaje);
    // Feature 148 (§9.7): asignación ya cometida → fase "resultado"; `onSuccess()`
    // se difiere al cierre. Nada del contrato de negocio cambia (R27).
    setResultado({
      // R13 (368): el manifiesto sigue recibiendo SOLO las órdenes efectivamente asignadas —
      // ahora, las de las DOS peticiones de esta apertura (R20).
      ordenIds,
      mensaje,
      // R28: se congela con el lote cometido, no se deriva del estado vivo del selector.
      confirmacionDia: confirmacionDiaReparto(dia, fechasDiaReparto),
      bloqueadas,
      sinUbicacion,
      sinUbicacionAutorizada,
    });
  }

  /**
   * FICHA 407 (R18) — la SEGUNDA petición: una sola, con la marca, y ACOTADA a las autorizables.
   *
   * Acotada y no al lote entero, y esto no es una optimización: en la ruta `partial` una parte
   * del lote YA se asignó, así que reenviarla la encontraría en su estado nuevo y el writer
   * abortaría el lote completo con «estado de origen no permitido». Acotar es lo único correcto
   * en las dos rutas, así que se hace igual en ambas y no hay dos caminos que mantener.
   *
   * Van los `ordenId` reales (uuids), no el número de remisión: el borde valida
   * `z.array(z.string().uuid())` y cualquier otra cosa vuelve como error de validación sin
   * llegar al servicio.
   */
  async function handleAutorizar() {
    const ids = autorizables.map((a) => a.ordenId);
    if (ids.length === 0 || autorizando) return;
    setAutorizando(true);
    try {
      const result = await asignarDesdeSatelite({
        ordenIds: ids,
        mensajeroId,
        dia,
        autorizarSinUbicacionIds: ids,
      });
      if (result.status !== "ok" && result.status !== "partial") {
        // Un rechazo aquí NO vacía el panel: el modal puede estar en la fase «resultado», donde
        // el botón de confirmar está oculto, y dejarlo sin panel dejaría al operador sin ninguna
        // vía para reintentar.
        handleError(result);
        return;
      }
      recogerAutorizables(result);
      registrarAsignacion(result);
    } catch (error) {
      handleError(error);
    } finally {
      setAutorizando(false);
    }
  }

  async function handleConfirm() {
    if (!mensajeroId) {
      // Validación en el borde de UI: sin mensajero no hay nada que asignar.
      // Reusa el canal de error del Modal con la misma forma de resultado.
      const validationError: AsignarSateliteResult = {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
      };
      throw validationError;
    }

    const result = await asignarDesdeSatelite({
      ordenIds: ordenes.map((orden) => orden.id),
      mensajeroId,
      // Feature 246 (R2/R3): el MISMO token, para TODO el lote. Va siempre, aunque el borde
      // tenga `.default("hoy")`: sin este campo el olvido sería silencioso.
      dia,
    });
    // FICHA 407 (R16): antes de decidir si esto es un error, se anota qué órdenes del intento
    // se pueden autorizar. El `setState` va ANTES del `throw` a propósito: en la ruta
    // `conflict` —que es la del caso que originó la ficha, una sola orden bloqueada— el toast
    // de error sigue saliendo exactamente igual y el modal, que no se cierra al confirmar,
    // queda abierto con el panel pintado debajo.
    recogerAutorizables(result);
    // Feature 368 (R2/R15, espejo de AsignarBodegaModal): "partial" se suma a "ok" — es un
    // resultado que SÍ tuvo efecto, así que no va al canal de error del `Modal`. El resto de
    // resultados no-"ok" siguen lanzándose ahí, sin cambio de comportamiento (R16 de la 368).
    if (result.status !== "ok" && result.status !== "partial") {
      throw result;
    }

    registrarAsignacion(result);
  }

  function handleError(error: unknown) {
    toast.error(asignacionSateliteErrorMessage(error));
  }

  /** Cierre de la fase "resultado" por cualquier vía: recién ahí refresca el padre. */
  function handleOpenChange(next: boolean) {
    if (!next && resultado) {
      setResultado(null);
      // FICHA 407 (R9): la autorización se va con el modal. No queda nada guardado en ningún
      // sitio, ni aquí ni en el servidor.
      setAutorizables([]);
      onOpenChange(false);
      onSuccess();
      return;
    }
    onOpenChange(next);
  }

  /**
   * FICHA 407 (R14/R16/R18/R19) — EL PANEL DE AUTORIZACIÓN. Espejo exacto del de la bodega
   * central: mismo literal, misma etiqueta, misma forma.
   *
   * Se pinta igual en las dos fases del modal —tras un `conflict`, junto al formulario; tras un
   * `partial`, junto al manifiesto y a la lista de bloqueadas— porque R16 exige las dos rutas y
   * el caso real (una sola orden bloqueada, nada asignado) es precisamente el `conflict`.
   *
   * Qué NO lleva: ni la dirección, ni el destinatario, ni el teléfono, ni la guía, ni el id
   * interno (R15/R19). Solo el número de remisión de cada orden y un literal fijo.
   *
   * `role="status"` en la consecuencia y no `role="alert"`: esto no es un error, es una decisión
   * que se ofrece, y el canal asertivo del modal ya lo ocupa la lista de órdenes bloqueadas —que
   * sí es el fallo. Un segundo `alert` competiría con ella por la misma atención.
   */
  const panelAutorizacion =
    autorizables.length > 0 ? (
      <section
        aria-label="Autorizar asignación sin ubicación en el mapa"
        className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        <ul className="flex list-disc flex-col gap-1 overflow-auto pl-5">
          {autorizables.map((a) => (
            <li key={a.ordenId}>{a.numRemision}</li>
          ))}
        </ul>
        {/* R14: la consecuencia, ANTES de que nadie pulse nada. */}
        <p role="status">{MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION}</p>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleAutorizar}
            disabled={autorizando}
          >
            {LABEL_AUTORIZAR_SIN_UBICACION}
          </Button>
        </div>
      </section>
    ) : null;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Asignar mensajero"
      description={
        resultado
          ? "Mensajero asignado. Descarga el manifiesto del lote antes de cerrar."
          : `Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de tu zona.`
      }
      confirmLabel="Asignar"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      confirmDisabled={sinMensajeros}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <div className="flex flex-col gap-3">
          {/* Feature 246 (T4.4, R28): para qué día quedó el lote, con palabras. Espejo exacto
              del de bodega central. */}
          <p
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            {resultado.confirmacionDia}
          </p>
          <ManifiestoResultado
            mensaje={resultado.mensaje}
            flujo="asignacion_satelite"
            seleccion={{ ordenIds: resultado.ordenIds }}
          />
          {/* Feature 368 (R10-R12/R14, espejo de AsignarBodegaModal): una entrada por orden
              bloqueada, con su identificador visible y el mensaje de SU propio motivo. */}
          {resultado.bloqueadas.length > 0 ? (
            <ul
              role="alert"
              className="flex list-disc flex-col gap-1 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 pl-8 text-sm text-destructive"
            >
              {resultado.bloqueadas.map((b) => (
                <li key={b.ordenId}>
                  {b.numRemision} — {b.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
          {/* FICHA 407 (R16-b): tras un `partial`, el panel va DESPUÉS de la lista de
              bloqueadas — primero qué pasó, después qué se puede hacer al respecto. */}
          {panelAutorizacion}
        </div>
      ) : (
      <div className="flex flex-col gap-2">
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {ordenes.map((orden) => (
            <li key={orden.id}>{orden.numRemision}</li>
          ))}
        </ul>
        {sinMensajeros ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            No hay mensajeros en tu zona. Pide a un administrador que asigne
            mensajeros a tu zona para poder asignar órdenes.
          </p>
        ) : (
          <>
            <Select
              value={mensajeroId}
              onValueChange={setMensajeroId}
              options={mensajeroOptions}
              placeholder="Selecciona un mensajero"
              aria-label="Mensajero para el lote"
            />
            {/* Feature 246 (T4.3, R2/R27): la MISMA elección que en bodega central. Va dentro
                de la rama con mensajeros: sin nadie a quien asignar, elegir el día no lleva a
                ninguna acción. */}
            <SelectorDiaReparto
              valor={dia}
              onValorChange={setDia}
              fechas={fechasDiaReparto}
            />
          </>
        )}
        {/* FICHA 407 (R16-a): tras un `conflict` no se asignó nada y el modal sigue en esta
            fase, así que el panel aparece aquí. Es la ruta del caso que originó la ficha: una
            sola orden, bloqueada, cinco días parada. */}
        {panelAutorizacion}
      </div>
      )}
    </Modal>
  );
}
