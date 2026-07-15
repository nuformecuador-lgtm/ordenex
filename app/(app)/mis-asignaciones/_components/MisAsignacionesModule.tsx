"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Modal } from "@/components/shared/Modal";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import {
  escogerParaGestion,
  liberarGestion,
  recogerAsignaciones,
} from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
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
  /** Órdenes en `en_reparto` (por gestionar). */
  porGestionar: MiAsignacionDTO[];
  /** Orden activa en gestión (R19/R20); `null` = ninguna, todas gestionables. */
  ordenEnGestionId: string | null;
}

export function MisAsignacionesModule({
  porRecoger,
  porGestionar,
  ordenEnGestionId,
}: MisAsignacionesModuleProps) {
  const router = useRouter();
  const toast = useToast();

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

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Apartado: Por recoger (en_espera_aceptacion) ---------- */}
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
        <h2 className="text-lg font-semibold">En reparto / por gestionar</h2>
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
                      <span className="font-semibold text-foreground">
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
