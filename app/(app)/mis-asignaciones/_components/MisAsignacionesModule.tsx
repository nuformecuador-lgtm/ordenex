"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import { useUbicacionActual } from "@/hooks/useUbicacionActual";
import {
  escogerParaGestion,
  liberarGestion,
  recogerAsignaciones,
} from "@/lib/actions/mis-asignaciones";
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { EscanerRecoger } from "./EscanerRecoger";
import { GestionarOrdenPanel } from "./GestionarOrdenPanel";

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
  /**
   * Órdenes en `en_reparto` (por gestionar), YA ORDENADAS por el servidor
   * (feature 92, R28: secuencia optimizada asc y las sin posición al final).
   * Feature 93 / R28: este componente las RENDERIZA EN EL ORDEN RECIBIDO y no
   * hace ningún `sort` en cliente — el orden es una decisión del servidor.
   */
  porGestionar: MiAsignacionDTO[];
  /** Orden activa en gestión (R19/R20); `null` = ninguna, todas gestionables. */
  ordenEnGestionId: string | null;
  /**
   * Feature 92/93 (R30): estado de la ruta optimizada, resuelto SERVER-SIDE.
   * `listarMisAsignaciones` lo entrega SIEMPRE en su rama `ok`; se acepta
   * `undefined` como defensa en profundidad: sin datos de ruta el módulo NO
   * muestra aviso (fail-closed; no supone "desactualizada").
   */
  ruta?: RutaResumenDTO;
  /**
   * Feature 93 (R31): rol del actor. El botón de sincronización SOLO se
   * renderiza para `mensajero`. Fail-closed: sin rol explícito no se renderiza.
   */
  rol?: string;
}

export function MisAsignacionesModule({
  porRecoger,
  porGestionar,
  ordenEnGestionId,
  ruta,
  rol,
}: MisAsignacionesModuleProps) {
  const router = useRouter();
  const toast = useToast();
  const { pedirUbicacion } = useUbicacionActual();

  // R32: la sincronización es síncrona en la action; el botón se deshabilita
  // mientras corre para no encadenar pulsaciones (R34 lo cubre en el servidor).
  const [sincronizando, setSincronizando] = useState(false);

  // R30: aviso visible cuando la ruta está desactualizada O hay paradas que
  // entraron después de la última optimización.
  //
  // El estado sale SIEMPRE del prop, nunca de un estado local: la action real de
  // la 92 devuelve `{ status, omitida }` y NO la ruta, así que el único camino
  // por el que esto cambia es el `router.refresh()` que re-renderiza el Server
  // Component (R32). Cachear aquí una ruta "optimista" mostraría un estado que
  // el servidor no ha confirmado.
  const avisoRuta =
    ruta !== undefined &&
    (ruta.estado === "desactualizada" || ruta.paradasSinOptimizar > 0);

  // Confirmación de recogida (lote o de a una): ids a recoger; null = cerrado.
  const [recogerIds, setRecogerIds] = useState<string[] | null>(null);
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

  async function confirmRecoger() {
    if (!recogerIds) return;
    const result = await recogerAsignaciones({ ordenIds: recogerIds });
    if (result.status === "ok") {
      toast.success(`${result.recogidas.length} orden(es) recogida(s).`);
      setRecogerIds(null);
      router.refresh();
      return;
    }
    toast.error(
      result.status === "conflict"
        ? "Alguna orden ya no está por recoger."
        : "No se pudieron recoger las órdenes.",
    );
  }

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

  // R31/R32: sincronización manual. R25 es el punto delicado: si el permiso de
  // geolocalización se deniega o expira, `pedirUbicacion()` resuelve `null` y la
  // action se llama IGUAL, solo que sin `ubicacion`; el backend degrada al
  // fallback de origen (R24). La denegación NUNCA aborta la sincronización.
  async function sincronizar() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const coords = await pedirUbicacion();
      // Solo `ubicacion` (contrato de la 92): la ruta la lee el servidor de la
      // DB. Mandar los ids de lo que la UI está pintando dejaría al cliente
      // influir en un orden que es decisión exclusiva del servidor.
      const result = await sincronizarRuta(coords ? { ubicacion: coords } : {});
      if (result.status === "ok") {
        // `omitida` es un desenlace CORRECTO (guarda de coste del service): la
        // ruta vigente sigue siendo válida, así que no se reporta como error.
        toast.success("Ruta sincronizada.");
        router.refresh(); // R32: el orden nuevo llega por el camino que ya existe
        return;
      }
      toast.error(
        result.status === "conflict"
          ? "Espera unos segundos antes de volver a sincronizar."
          : result.status === "forbidden"
            ? "No tienes permiso para sincronizar la ruta."
            : result.status === "unauthenticated"
              ? "Tu sesión expiró. Inicia sesión de nuevo."
              : "No se pudo sincronizar la ruta.",
      );
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Apartado: Por recoger (en_espera_aceptacion) ---------- */}
      {/* Recoger por escaneo: al escanear la etiqueta de un paquete se ACEPTA la
          orden con la MISMA action que el botón "Recoger" (recogerAsignaciones). El
          escáner resuelve el num_guia contra `porRecoger` para obtener el id. */}
      <EscanerRecoger
        porRecoger={porRecoger}
        onRecogida={() => router.refresh()}
      />

      {/* Reutiliza la sección compartida "por aceptar": banner con contador de
          nuevas + "Recoger todas" (lote, R16) + "Recoger" por-orden (R14, única
          acción). La confirmación en Modal y la action `recogerAsignaciones` se
          disparan igual que antes, vía `setRecogerIds`. */}
      <PorAceptarSection
        titulo="Por recoger"
        nuevasLabel={(n) => `${n} Órdenes nuevas asignadas`}
        ordenes={porRecoger}
        onAceptarTodas={(ids) => setRecogerIds(ids)}
        onAceptarUna={(id) => setRecogerIds([id])}
        textoBotonTodas="Recoger todas"
        textoBotonUna="Recoger"
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
          {/* R31: solo el mensajero ve el botón de sincronización manual. */}
          {rol === "mensajero" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={sincronizar}
              disabled={sincronizando}
              aria-busy={sincronizando}
            >
              {sincronizando ? "Sincronizando…" : "Sincronizar ruta"}
            </Button>
          ) : null}
        </div>

        {/* R30: el orden mostrado no está al día. `status` (no `alert`) porque es
            informativo y no exige acción inmediata. */}
        {avisoRuta ? (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            El orden de entrega no está actualizado. Sincroniza la ruta para
            recalcularlo.
          </p>
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
                      <span className="flex items-center gap-2">
                        {/* R28: la POSICIÓN en la ruta la calcula el servidor
                            (`secuenciaRuta`, 1-based). Aquí solo se pinta. Las
                            que entraron después de la última optimización
                            llegan con `null` y se marcan como pendientes, para
                            que el mensajero no las lea como parada final. */}
                        {orden.secuenciaRuta !== null ? (
                          <span
                            aria-label={`Parada ${orden.secuenciaRuta} de la ruta`}
                            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                          >
                            {orden.secuenciaRuta}
                          </span>
                        ) : (
                          <span
                            aria-label="Pendiente de optimizar"
                            title="Pendiente de optimizar"
                            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-xs font-semibold text-muted-foreground"
                          >
                            ·
                          </span>
                        )}
                        <span className="font-semibold text-foreground">
                          {orden.numRemision}
                        </span>
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
            yaActiva={ordenEnGestionId === detalleOrden.id}
            onGestionarPedido={gestionarPedido}
            onCancelarGestion={cancelarGestion}
            onSuccess={handleGestionSuccess}
          />
        ) : null}
      </section>

      {/* Confirmación de recogida (lote o de a una). */}
      <Modal
        open={recogerIds !== null}
        onOpenChange={(next) => {
          if (!next) setRecogerIds(null);
        }}
        title="Recoger órdenes"
        description={
          recogerIds
            ? `Vas a recoger ${recogerIds.length} orden(es). Pasarán a "en reparto".`
            : undefined
        }
        confirmLabel="Recoger"
        onConfirm={confirmRecoger}
        closeOnConfirm={false}
      />
    </div>
  );
}
