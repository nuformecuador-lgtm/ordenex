"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
  escogerParaGestion,
  liberarGestion,
} from "@/lib/actions/mis-asignaciones";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { EscanerRecoger } from "./EscanerRecoger";
import { InputRecoger } from "./InputRecoger";
import { GestionarOrdenPanel } from "./GestionarOrdenPanel";
import { RutaMapa } from "./RutaMapa";
import { SincronizarRutaButton } from "./SincronizarRutaButton";
import type { RutaMapaOrigen, RutaMapaParada } from "./ruta-mapa-tipos";

// Feature 36 (T15-T17) / rediseño 63 (pedido humano): módulo del mensajero.
// Recibe los DOS grupos ya resueltos por el Server Component padre (datos
// sensibles por props, sin fetch de cliente) y el puntero de bloqueo
// `ordenEnGestionId` (backend, robusto a recarga). Las mutaciones van por Server
// Action (recoger / escoger / gestionar / liberar) y refrescan la ruta
// (router.refresh) para releer el estado del servidor.
//
// UX "En reparto": grilla de cards arriba + PANEL de detalle grande e inline
// debajo (no modal). Siempre hay una orden en el panel de detalle mientras haya
// órdenes en reparto: por defecto la ACTIVA (si hay puntero fijado) o la PRIMERA.
// Solo la orden del panel es gestionable. El bloqueo 1-a-1 (R19/R20) deshabilita
// y oculta los detalles de las demás mientras hay una gestión activa.

export interface MisAsignacionesModuleProps {
  /** Órdenes en `en_espera_aceptacion` (por recoger). */
  porRecoger: MiAsignacionDTO[];
  /** Órdenes en `en_reparto` (por gestionar), YA ordenadas por la ruta (R28). */
  porGestionar: MiAsignacionDTO[];
  /** Orden activa en gestión (R19/R20); `null` = ninguna, todas gestionables. */
  ordenEnGestionId: string | null;
  /** Feature 97 (R27/R28/R30): estado de la ruta optimizada que produjo el orden. */
  ruta: RutaResumenDTO;
}

export function MisAsignacionesModule({
  porRecoger,
  porGestionar,
  ordenEnGestionId,
  ruta,
}: MisAsignacionesModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Feature 97: última ubicación GPS capturada por el botón de sincronización. Se usa como
  // punto de partida del mapa. Sobrevive a `router.refresh()` (estado de cliente), así que el
  // origen se mantiene dibujado tras recalcular la ruta. NO se pide GPS al montar (R25: nunca
  // se fuerza el permiso; solo se captura cuando el mensajero pulsa "Sincronizar ruta").
  const [ubicacionActual, setUbicacionActual] = useState<RutaMapaOrigen | null>(
    null,
  );
  const [mostrarMapa, setMostrarMapa] = useState(true);

  // R28/mapa: paradas dibujables = las en reparto CON coordenadas (feature 91). Las que no
  // tienen coords se omiten del mapa pero siguen en la lista (no se pierden).
  const paradasMapa = useMemo<RutaMapaParada[]>(
    () =>
      porGestionar
        .filter((o) => o.latitud !== null && o.longitud !== null)
        .map((o) => ({
          id: o.id,
          secuencia: o.secuenciaRuta,
          lat: o.latitud as number,
          lng: o.longitud as number,
          etiqueta: `${o.numRemision} · ${o.destinatario}`,
        })),
    [porGestionar],
  );

  // R30: la ruta no refleja el estado real si la última optimización falló
  // (`desactualizada`) o si entraron paradas nuevas sin posición todavía.
  const rutaDesactualizada =
    ruta.estado === "desactualizada" || ruta.paradasSinOptimizar > 0;
  // R24: aviso de que el punto de partida usado es aproximado (no GPS reciente).
  const origenAproximado =
    ruta.origenFuente === "centroide" || ruta.origenFuente === "ultima_conocida";

  // Orden que el mensajero eligió explícitamente para el panel de detalle. Es
  // solo una PREFERENCIA: la orden mostrada se DERIVA (ver `detalleOrden`) para
  // no quedar pegada a una orden que ya no existe tras `router.refresh()`.
  const [seleccionId, setSeleccionId] = useState<string | null>(null);

  // Orden mostrada en el panel de detalle. Nunca `null` si hay al menos una en
  // reparto. Prioridad: (1) la ACTIVA (puntero fijado); (2) la elegida por el
  // mensajero si sigue existiendo; (3) la PRIMERA de la lista. Derivada en cada
  // render → estable ante cambios de `porGestionar`/`ordenEnGestionId`.
  const detalleOrden = useMemo<MiAsignacionDTO | null>(() => {
    if (porGestionar.length === 0) return null;
    if (ordenEnGestionId !== null) {
      return (
        porGestionar.find((o) => o.id === ordenEnGestionId) ?? porGestionar[0]
      );
    }
    if (seleccionId !== null) {
      const elegida = porGestionar.find((o) => o.id === seleccionId);
      if (elegida) return elegida;
    }
    return porGestionar[0];
  }, [porGestionar, ordenEnGestionId, seleccionId]);

  // Seleccionar una card la lleva al panel de detalle. Bloqueada si hay otra
  // gestión activa (R19/R20): no se puede cambiar la orden del panel.
  function seleccionar(orden: MiAsignacionDTO) {
    if (ordenEnGestionId !== null && ordenEnGestionId !== orden.id) return;
    setSeleccionId(orden.id);
  }

  // R17 (T17): al pulsar "Gestionar pedido" se fija el puntero de bloqueo 1-a-1
  // sobre la orden del panel de detalle. Devuelve `true` si quedó fijado (el
  // panel revela los 4 botones).
  async function gestionarPedido(): Promise<boolean> {
    if (!detalleOrden) return false;
    const result = await escogerParaGestion({ ordenId: detalleOrden.id });
    if (result.status === "ok") {
      router.refresh(); // refleja el bloqueo de las demás (ordenEnGestionId)
      return true;
    }
    toast.error(
      result.status === "conflict"
        ? "Ya tienes otra orden activa en gestión."
        : "No puedes gestionar esta orden.",
    );
    return false;
  }

  function handleGestionSuccess() {
    // Path de ÉXITO: el backend YA limpió el puntero dentro de la transacción de
    // `gestionar`. NO se llama a `liberarGestion` aquí (evita doble limpieza).
    setSeleccionId(null);
    router.refresh();
  }

  // R35: "Cancelar gestión" libera el puntero de bloqueo (`orden_en_gestion_id`)
  // para que las demás vuelvan a ser gestionables, sin cambiar de orden en el
  // panel. Solo se ofrece cuando el puntero está fijado. Best-effort; sin Toast.
  async function cancelarGestion() {
    if (!detalleOrden) return;
    await liberarGestion({ ordenId: detalleOrden.id });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Apartado: Por recoger (en_espera_aceptacion) ---------- */}
      {/* Feature 96: la recogida queda SOLO por dos vías, ambas resuelven el num_guia
          contra `porRecoger` (restricción "asignada a mí") y aceptan con la MISMA action
          `recogerAsignaciones`, directo al confirmar (sin modal):
            (1) input de número de guía tecleado + Enter/botón;
            (2) escáner de cámara (QR de la etiqueta -> num_guia). */}
      <InputRecoger porRecoger={porRecoger} onRecogida={() => router.refresh()} />
      <EscanerRecoger
        porRecoger={porRecoger}
        onRecogida={() => router.refresh()}
      />

      {/* Lista de SOLO-VISUALIZACIÓN (feature 96): reutiliza la sección compartida "por
          aceptar" con `mostrarAcciones={false}` (ya no hay botones "Recoger todas" /
          "Recoger"). El mensajero sigue viendo qué guías tiene por recoger; la acción
          vive en el input y el escáner de arriba. */}
      <PorAceptarSection
        titulo="Por recoger"
        nuevasLabel={(n) => `${n} Órdenes nuevas asignadas`}
        ordenes={porRecoger}
        mostrarAcciones={false}
        vacio="No hay órdenes por recoger."
        renderDetalle={(orden) => <AsignacionDetalle orden={orden} />}
      />

      {/* ---------- Apartado: En reparto / por gestionar (en_reparto) ---------- */}
      {/* Cards COMPACTAS en grilla (1/2/3 col). Seleccionar una la lleva al panel
          de detalle grande e inline (abajo). El bloqueo 1-a-1 (R19/R20)
          deshabilita las demás mientras hay una gestión activa. */}
      <section
        aria-label="En reparto / por gestionar"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">En reparto / por gestionar</h2>
          {/* R31/R32: sincronización manual de la ruta. El botón captura el GPS del
              navegador (best-effort) y lo eleva aquí para dibujar el origen en el mapa. */}
          <SincronizarRutaButton onUbicacion={setUbicacionActual} />
        </div>

        {/* R30: aviso VISIBLE de que el orden mostrado no está actualizado. */}
        {rutaDesactualizada ? (
          <Alert variant="destructive">
            <AlertTitle>El orden mostrado no está actualizado</AlertTitle>
            <AlertDescription>
              La ruta cambió desde el último cálculo. Pulsa «Sincronizar ruta»
              para recalcular el orden de entrega.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* R28/mapa: recorrido optimizado sobre OpenStreetMap. Solo si hay paradas
            con coordenadas; las paradas sin coords van igual en la lista de abajo. */}
        {paradasMapa.length > 0 && mostrarMapa ? (
          <div
            aria-label="Mapa de ruta"
            role="group"
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Mapa de ruta
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setMostrarMapa(false)}
              >
                Ocultar mapa
              </Button>
            </div>
            {origenAproximado ? (
              <p className="text-xs text-muted-foreground">
                El punto de partida es aproximado (no se usó tu ubicación GPS
                reciente).
              </p>
            ) : null}
            <RutaMapa paradas={paradasMapa} origen={ubicacionActual} />
          </div>
        ) : null}
        {paradasMapa.length > 0 && !mostrarMapa ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="w-fit"
            onClick={() => setMostrarMapa(true)}
          >
            Mostrar mapa de ruta
          </Button>
        ) : null}

        {porGestionar.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay órdenes en reparto.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {porGestionar.map((orden) => {
              // R19/R20: si hay una orden activa distinta, esta queda bloqueada.
              const bloqueada =
                ordenEnGestionId !== null && ordenEnGestionId !== orden.id;
              const esActiva = ordenEnGestionId === orden.id;
              const esDetalle = detalleOrden?.id === orden.id;
              return (
                <li key={orden.id}>
                  <button
                    type="button"
                    disabled={bloqueada}
                    aria-pressed={esDetalle}
                    onClick={() => seleccionar(orden)}
                    aria-label={`Gestionar orden ${orden.numRemision} · ${orden.destinatario}`}
                    className={`group flex h-full w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60 ${
                      esDetalle
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold text-foreground">
                        {/* R28: nº de parada en la ruta optimizada. */}
                        {orden.secuenciaRuta !== null ? (
                          <>
                            <span className="sr-only">
                              Parada {orden.secuenciaRuta} de la ruta
                            </span>
                            <span
                              aria-hidden="true"
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                            >
                              {orden.secuenciaRuta}
                            </span>
                          </>
                        ) : null}
                        {orden.numRemision}
                      </span>
                      {esActiva ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          En gestión
                        </span>
                      ) : esDetalle ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          En detalle
                        </span>
                      ) : null}
                    </div>
                    {/* R28: las paradas que entraron tras la última optimización
                        no tienen posición todavía; el backend ya las ordena al
                        final, aquí solo se marcan. */}
                    {orden.secuenciaRuta === null ? (
                      <Badge variant="outline" className="w-fit">
                        Pendiente de optimizar
                      </Badge>
                    ) : null}
                    {/* Mientras hay una gestión activa en OTRA orden, esta card
                        oculta sus detalles (destinatario/producto/teléfono) y solo
                        muestra el Nº y el aviso: foco en la orden en gestión. */}
                    {bloqueada ? (
                      <p className="mt-auto text-xs text-muted-foreground">
                        Termina la gestión en curso para gestionar esta orden.
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-foreground">
                            {orden.destinatario}
                          </span>
                          <span className="text-muted-foreground">
                            {orden.producto}
                          </span>
                          <span className="text-muted-foreground">
                            {orden.telefonoDest}
                          </span>
                        </div>
                        <span className="mt-auto text-sm font-medium text-primary">
                          {esDetalle ? "En detalle" : "Ver / Gestionar"}
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Panel de detalle grande e inline: SIEMPRE muestra una orden mientras
            haya alguna en reparto (la activa o la primera por defecto). Se remonta
            con `key` al cambiar de orden para reiniciar su estado interno. */}
        {detalleOrden ? (
          <GestionarOrdenPanel
            key={detalleOrden.id}
            orden={detalleOrden}
            count={porGestionar?.length || 0}
            yaActiva={ordenEnGestionId === detalleOrden.id}
            onGestionarPedido={gestionarPedido}
            onCancelarGestion={cancelarGestion}
            onSuccess={handleGestionSuccess}
          />
        ) : null}
      </section>
    </div>
  );
}
