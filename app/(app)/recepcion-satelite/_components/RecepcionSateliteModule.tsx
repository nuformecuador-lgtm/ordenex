"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { recibirLote } from "@/lib/actions/recepcion-satelite";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { envioDevolucionCentralErrorMessage } from "@/app/(app)/ordenes/_components/envio-devolucion-central-error-messages";
import { recuperarBodegaErrorMessage } from "@/app/(app)/ordenes/_components/recuperar-bodega-error-messages";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { SateliteOrderCard } from "./SateliteOrderCard";
import { SateliteOrdenesListado } from "./SateliteOrdenesListado";
import { AsignarSateliteModal } from "./AsignarSateliteModal";
import { DeshacerAsignacionSateliteModal } from "./DeshacerAsignacionSateliteModal";
import {
  BODEGA_BLOQUEADA_TITULO,
  BODEGA_CIERRES_ABIERTOS_DETALLE,
  bodegaBloqueadaLineas,
  bodegaCierresAbiertosTitulo,
  type BodegaBloqueoCausa,
} from "./asignacion-satelite-bloqueo";

// Feature 33 (T12, R6/R7/R8/R9): módulo de la bodega satélite. Recibe los DOS
// grupos ya resueltos por el Server Component padre (datos sensibles por props,
// sin fetch de cliente) y el nombre de la zona / `sinZona`. La ÚNICA acción del
// módulo es la recepción por escaneo (R7: "Por recibir" NO expone asignar ni
// gestionar). Tras cada recepción exitosa se refresca la ruta para releer el
// estado del servidor.

export interface RecepcionSateliteModuleProps {
  /** Órdenes en `en_ruta_bodega_satelite` de la zona del adminSatelite. */
  porRecibir: RecepcionSateliteDTO[];
  /** Órdenes ya en `en_bodega_satelite` de la zona (base de la feature 34). */
  recibidas: RecepcionSateliteDTO[];
  /**
   * Feature 139/T3.3 (R13/R21): órdenes en `por_devolver` de la zona del adminSatelite,
   * elegibles para la acción POR LOTE "Enviar a central" (transición
   * `por_devolver → devolviendo_a_bodega_central`). REEMPLAZA el viejo scope `rechazada`
   * (feature 48): la rechazada sale de ese estado solo al aprobar el cierre, que la deja
   * en `por_devolver`. Acotadas server-side por zona; vacío = sin órdenes por devolver.
   */
  porDevolver?: RecepcionSateliteDTO[];
  /**
   * Feature 139/T3.3 (R21): órdenes en `devolviendo_a_bodega_central` de la zona,
   * INFORMATIVAS (ya enviadas y en tránsito a la central; la recepción la hace la central
   * por QR, no el satélite). Acotadas server-side por zona; solo lectura, sin acción.
   */
  enTransitoACentral?: RecepcionSateliteDTO[];
  /**
   * Feature 100/T4.1 (R12): órdenes en `devuelta` (novedad) de la zona del
   * adminSatelite, elegibles para "Recuperar a bodega" (transición
   * `devuelta → en_bodega_satelite`). Acotadas server-side por zona; vacío = sin
   * órdenes por recuperar.
   */
  devueltas?: RecepcionSateliteDTO[];
  /**
   * Feature 149/T6.4 (R35): órdenes en `por_recoger` de la zona del adminSatelite —ya
   * asignadas a un mensajero que AÚN no las recogió—, elegibles para la acción POR LOTE
   * "Deshacer asignación" (`por_recoger → en_bodega_satelite`). Acotadas server-side por
   * zona; vacío = sin órdenes asignadas pendientes de recogida. El caso (b)
   * (`en_ruta_bodega_satelite`, sección "Por recibir") NO ofrece esta acción (R36).
   */
  asignadas?: RecepcionSateliteDTO[];
  /** Nombre de la zona del adminSatelite (para el display, R9); `null` si no tiene. */
  zonaNombre: string | null;
  /** `true` si el adminSatelite no tiene zona asignada (R5). */
  sinZona: boolean;
  /**
   * Feature 34 (T8/R5): mensajeros de la zona del adminSatelite para el modal de
   * asignación (ya scoped server-side; el módulo no fetchea datos sensibles).
   */
  mensajeros: { id: string; nombre: string }[];
  /**
   * Feature 41 (R22) + ajuste admin_satelite: bloqueo DERIVADO server-side de la bodega
   * satélite. Si `bloqueada` (todos los mensajeros con cierre O CierreBodega pendiente),
   * se muestra el aviso de bloqueo y se deshabilita "Asignar". Si NO está bloqueada pero
   * `cierresAbiertos > 0`, se muestra un aviso INFORMATIVO (no bloqueante) y se puede
   * seguir asignando a los mensajeros sin cierre. `mensajerosConCierreIds` deshabilita a
   * esos mensajeros en el selector del modal.
   */
  bloqueoBodega: BodegaBloqueoCausa & {
    bloqueada: boolean;
    cierresAbiertos?: number;
    totalMensajeros?: number;
    mensajerosConCierreIds?: string[];
  };
  /**
   * Feature 46 (R15/R16): órdenes liberadas HOY (CR) por el cron para esta bodega
   * satélite (`en_bodega_satelite`), pre-resueltas server-side. Alimentan el aviso
   * derivado "Liberadas hoy (reprogramación)". Vacío = sin aviso.
   */
  liberadasHoy?: LiberadaHoyRow[];
}

/**
 * Estado legible "en bodega satélite de <zona>" (R9): deriva del `estatusValue`
 * (etiqueta de `estatusLabel`) y del nombre de zona de la orden.
 */
function estadoLegible(orden: RecepcionSateliteDTO, zonaNombre: string | null): string {
  const base = estatusLabel(orden.estatusValue);
  const zona = orden.zonaNombre || zonaNombre;
  return zona ? `${base} de ${zona}` : base;
}

export function RecepcionSateliteModule({
  porRecibir,
  recibidas,
  porDevolver = [],
  enTransitoACentral = [],
  devueltas = [],
  asignadas = [],
  zonaNombre,
  sinZona,
  mensajeros,
  bloqueoBodega,
  liberadasHoy = [],
}: RecepcionSateliteModuleProps) {
  const router = useRouter();
  const toast = useToast();
  // Órdenes elegidas para asignar: SNAPSHOT que el listado entrega al pulsar "Asignar".
  // Vive aquí porque es lo que consume el modal de asignación.
  const [ordenesAAsignar, setOrdenesAAsignar] = useState<RecepcionSateliteDTO[]>(
    [],
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [enviandoACentral, setEnviandoACentral] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  // Feature 149/T6.4 (R35): lote que va al modal de "Deshacer asignación" y estado de ese
  // modal. MISMO patrón que la asignación: el listado entrega el snapshot al pulsar.
  const [ordenesADeshacer, setOrdenesADeshacer] = useState<
    RecepcionSateliteDTO[]
  >([]);
  const [deshacerOpen, setDeshacerOpen] = useState(false);
  // Feature 148 (T13, R22): ids del ÚLTIMO envío a central que salieron `ok`. El lote
  // vive solo aquí (el service es por-orden, §9.1), así que se conserva para poder
  // ofrecer su manifiesto después del refresco. Vacío = sin descarga que ofrecer (R17).
  const [ultimoEnvioACentral, setUltimoEnvioACentral] = useState<string[]>([]);

  // Pedido humano: "Por recibir" (tarjeta de recepción + lista) solo se pinta si hay algo
  // que recibir y el actor tiene zona; el separador del listado depende de lo mismo.
  const mostrarPorRecibir = !sinZona && porRecibir.length > 0;

  // Feature 139/T3.3 + pedido humano: las listas por estado se presentan en un solo
  // listado filtrable. El orden de concatenación es el del flujo de la bodega, y es el que
  // ve quien no toca los filtros. Feature 149/T6.4 (R35): `asignadas` (`por_recoger`) entra
  // como un grupo MÁS de ese listado —justo después de "Recibidas", que es de donde salen—
  // en vez de tener sección y tabla propias: el rediseño ux fundió las secciones.
  const ordenesBodega = useMemo<RecepcionSateliteDTO[]>(
    () => [
      ...recibidas,
      ...asignadas,
      ...porDevolver,
      ...enTransitoACentral,
      ...devueltas,
    ],
    [recibidas, asignadas, porDevolver, enTransitoACentral, devueltas],
  );

  // Feature 63: recepción EN LOTE ("Aceptar todas" / "Aceptar" por-orden), análoga
  // al "Recoger" del mensajero. Cablea la Server Action `recibirLote`; tras éxito
  // releé el estado del servidor (patrón feature 33) y da feedback por toast.
  async function aceptarRecepcion(ordenIds: string[]) {
    if (ordenIds.length === 0) return;
    const result = await recibirLote({ ordenIds });
    if (result.status === "ok") {
      toast.success(`${result.recibidas} orden(es) recibida(s).`);
      router.refresh();
      return;
    }
    toast.error(
      result.status === "sin_zona"
        ? "No tienes una zona asignada para recibir órdenes."
        : "No se pudieron recibir las órdenes.",
    );
  }

  /** Abre el modal de asignación con lo seleccionado en el listado. */
  function abrirAsignacion(ordenes: RecepcionSateliteDTO[]) {
    if (ordenes.length === 0) return;
    setOrdenesAAsignar(ordenes);
    setModalOpen(true);
  }

  /**
   * Feature 100 (T4.1, R12) — recuperación `devuelta → en_bodega_satelite`. Antes era una
   * acción POR FILA; con el listado único pasa a LOTE sobre la selección, con el mismo
   * patrón que el envío a central: bucle `await`, se acumulan los errores para no ocultar
   * un fallo parcial y en cualquier caso se relee el estado del servidor.
   */
  async function recuperarSeleccionadas(seleccionadas: RecepcionSateliteDTO[]) {
    if (seleccionadas.length === 0 || recuperando) return;
    setRecuperando(true);
    let recuperadas = 0;
    const errores: string[] = [];
    for (const orden of seleccionadas) {
      const result = await recuperarABodega({ ordenId: orden.id });
      if (result.status === "ok") recuperadas += 1;
      else errores.push(recuperarBodegaErrorMessage(result.status));
    }
    setRecuperando(false);
    if (recuperadas > 0) {
      toast.success(`${recuperadas} orden(es) recuperada(s) a bodega.`);
    }
    if (errores.length > 0) toast.error(errores[0]);
    router.refresh();
  }

  function handleSuccess() {
    setOrdenesAAsignar([]);
    setModalOpen(false);
    router.refresh(); // relee el estado del servidor (patrón feature 33)
  }

  /**
   * Feature 149/T6.4 (R35/R37) — abre el modal de "Deshacer asignación" con lo
   * seleccionado. El cierre de día pendiente de un mensajero NO bloquea esta acción
   * (Q1 CERRADA, R19): a diferencia de "Asignar", no mira `bloqueoBodega`.
   */
  function abrirDeshacer(ordenes: RecepcionSateliteDTO[]) {
    if (ordenes.length === 0) return;
    setOrdenesADeshacer(ordenes);
    setDeshacerOpen(true);
  }

  // R38: éxito ⇒ cierra el modal y RELEE el estado del servidor (la orden desaparece de
  // "Asignadas" y reaparece en "Recibidas").
  function handleDeshacerSuccess() {
    setOrdenesADeshacer([]);
    setDeshacerOpen(false);
    router.refresh();
  }

  // ---------- Feature 139/T3.3 (R13/R21) — envío por lote a bodega central ----------
  // R13: "Enviar a central" recorre la selección de `por_devolver` y dispara
  // `enviarACentral({ ordenId })` por cada una (loop await, patrón DevolverATiendaModal),
  // acumulando errores para no ocultar un fallo parcial. Feedback por toast; en cualquier
  // caso se relee el estado del servidor y se limpia la selección.
  async function enviarSeleccionadasACentral(
    seleccionadas: RecepcionSateliteDTO[],
  ) {
    const ids = seleccionadas.map((orden) => orden.id);
    if (ids.length === 0) return;
    setEnviandoACentral(true);
    let enviadas = 0;
    const errores: string[] = [];
    // Feature 148/R22: solo las EFECTIVAMENTE enviadas entran al manifiesto; las que
    // fallaron quedan fuera. No cambia el manejo del resultado de negocio (R25/R27).
    const enviadasIds: string[] = [];
    for (const id of ids) {
      const result = await enviarACentral({ ordenId: id });
      if (result.status === "ok") {
        enviadas += 1;
        enviadasIds.push(id);
      } else errores.push(envioDevolucionCentralErrorMessage(result.status));
    }
    setEnviandoACentral(false);
    setUltimoEnvioACentral(enviadasIds);
    if (enviadas > 0) {
      toast.success(`${enviadas} orden(es) enviada(s) a bodega central.`);
    }
    if (errores.length > 0) toast.error(errores[0]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* R5: aviso accionable si el adminSatelite no tiene zona asignada. */}
      {sinZona ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No tienes una zona asignada. Pide a un administrador que te asigne una
          zona para poder recibir órdenes.
        </p>
      ) : null}

      {/* ---------- Sección: Por recibir (en_ruta_bodega_satelite) ---------- */}
      {/* Pedido humano: sin NADA por recibir, ni la tarjeta de recepción ni la lista se
          muestran — no hay guía que resolver, así que solo estorbarían. Con zona sin
          asignar (R5) tampoco: el aviso de arriba explica el porqué. */}
      {mostrarPorRecibir ? (
        <>
          {/* Recepción por guía: MISMA tarjeta que la recogida del mensajero
              (`EscanerGuiaCard`), con los dos caminos — cámara y número tecleado. */}
          <EscanerRecepcion onRecibida={() => router.refresh()} />
          {/* Feature 63: REUTILIZA la sección compartida "por aceptar" del mensajero:
              banner con contador de nuevas + "Aceptar todas" (lote -> recibirLote con
              todos los ids) + "Aceptar" por-orden (recibirLote con uno). Sin zona no se
              muestran los botones (solo se listan). */}
          <PorAceptarSection
            titulo="Por recibir"
            nuevasLabel={(n) => `${n} Órdenes nuevas por recibir`}
            ordenes={porRecibir}
            onAceptarTodas={(ids) => void aceptarRecepcion(ids)}
            onAceptarUna={(id) => void aceptarRecepcion([id])}
            textoBotonTodas="Aceptar todas"
            textoBotonUna="Aceptar"
            vacio="No hay órdenes por recibir."
            mostrarAcciones={!sinZona}
            listClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            // Rediseño ux: la card completa la pinta el módulo (`renderItem`), con el
            // MISMO lenguaje visual que las del mensajero. "Aceptar" va al pie de cada
            // card; sin zona asignada (R5) se listan sin acción.
            renderItem={(orden) => (
              <SateliteOrderCard
                orden={orden}
                estadoLegible={estadoLegible(orden, zonaNombre)}
                acciones={
                  sinZona ? null : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void aceptarRecepcion([orden.id])}
                    >
                      Aceptar
                    </Button>
                  )
                }
              />
            )}
          />
        </>
      ) : null}

      {/* ---------- Listado único de la bodega (pedido humano) ---------- */}
      {/* Las cuatro secciones por estado (Recibidas / Por devolver / En tránsito a
          central / Devueltas) se funden en UN listado con la barra de filtros del admin.
          Las acciones pasan a ser de LOTE sobre la selección, habilitadas según el estado
          común de lo seleccionado (ver `SateliteOrdenesListado`). */}
      {/* El separador solo tiene sentido si ARRIBA hay algo de lo que separarse: sin
          sección "Por recibir" el listado es lo primero de la pantalla. */}
      <section
        className={`flex flex-col gap-3${mostrarPorRecibir ? " border-t pt-6" : ""}`}
      >
        {/* Feature 41 (R22): aviso de bodega BLOQUEADA con causa diferenciada (bloqueo
            duro: todos los mensajeros con cierre O CierreBodega pendiente). */}
        {bloqueoBodega.bloqueada ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="font-medium">{BODEGA_BLOQUEADA_TITULO}</span>
            <ul className="list-disc pl-5">
              {bodegaBloqueadaLineas(bloqueoBodega).map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </div>
        ) : (bloqueoBodega.cierresAbiertos ?? 0) > 0 ? (
          /* Ajuste admin_satelite: aviso INFORMATIVO (no bloqueante) cuando algunos —no
             todos— los mensajeros tienen un cierre abierto. La asignación sigue activa. */
          <div
            role="status"
            className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong"
          >
            <span className="font-medium">
              {bodegaCierresAbiertosTitulo(bloqueoBodega.cierresAbiertos ?? 0)}
            </span>
            <span>{BODEGA_CIERRES_ABIERTOS_DETALLE}</span>
          </div>
        ) : null}

        {/* Feature 148 (T13, R22): manifiesto del ÚLTIMO envío a central, solo con las
            órdenes que salieron `ok`. Botón EXPLÍCITO (§9.7): ni descarga automática ni
            acción dentro del toast. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DescargarManifiestoButton
            flujo="devolucion_central"
            seleccion={{ ordenIds: ultimoEnvioACentral }}
            label="Descargar manifiesto del último envío"
          />
        </div>

        <SateliteOrdenesListado
          ordenes={ordenesBodega}
          zonaNombre={zonaNombre}
          puedeAsignar={!bloqueoBodega.bloqueada}
          onAsignar={abrirAsignacion}
          onEnviarACentral={(ordenes) =>
            void enviarSeleccionadasACentral(ordenes)
          }
          onRecuperar={(ordenes) => void recuperarSeleccionadas(ordenes)}
          onDeshacerAsignacion={abrirDeshacer}
          enviandoACentral={enviandoACentral}
          recuperando={recuperando}
        />
      </section>

      {/* Feature 46 (R15/R16): aviso derivado "Liberadas hoy (reprogramación)" de la
          bodega satélite (en_bodega_satelite). Datos por props; se oculta si no hay. */}
      <BodegaLiberadasHoy liberadas={liberadasHoy} />

      <AsignarSateliteModal
        open={modalOpen}
        ordenes={ordenesAAsignar}
        mensajeros={mensajeros}
        mensajerosBloqueadosIds={bloqueoBodega.mensajerosConCierreIds ?? []}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />

      {/* Feature 149/T6.4 (R37/R38/R39): motivo obligatorio y traducción de errores viven
          en el modal compartido; aquí solo se le entrega el lote y se relee al terminar. */}
      <DeshacerAsignacionSateliteModal
        open={deshacerOpen}
        ordenes={ordenesADeshacer}
        onOpenChange={setDeshacerOpen}
        onSuccess={handleDeshacerSuccess}
      />
    </div>
  );
}
