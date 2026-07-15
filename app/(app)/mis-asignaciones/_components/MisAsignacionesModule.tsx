"use client";

import { useState } from "react";
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
import { GestionarOrdenModal } from "./GestionarOrdenModal";

// Feature 36 (T15-T17): módulo del mensajero. Recibe los DOS grupos ya
// resueltos por el Server Component padre (datos sensibles por props, sin fetch
// de cliente) y el puntero de bloqueo `ordenEnGestionId` (backend, robusto a
// recarga). Las mutaciones van por Server Action (recoger / escoger / gestionar)
// y refrescan la ruta (router.refresh) para releer el estado del servidor.

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
  // Orden seleccionada cuyo detalle grande está abierto; null = cerrado.
  const [detalleOrden, setDetalleOrden] = useState<MiAsignacionDTO | null>(null);
  // ¿El puntero 1-a-1 fue fijado en ESTA sesión de detalle? Determina si cerrar
  // sin guardar debe liberar (R35). Falso mientras solo se ve el detalle.
  const [punteroFijado, setPunteroFijado] = useState(false);

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

  // Seleccionar una card abre su detalle grande. Si ya es la orden activa, el
  // puntero 1-a-1 ya está fijado (se reanuda la gestión en curso).
  function seleccionar(orden: MiAsignacionDTO) {
    setDetalleOrden(orden);
    setPunteroFijado(ordenEnGestionId === orden.id);
  }

  // R17 (T17): al pulsar "Gestionar pedido" se fija el puntero de bloqueo 1-a-1.
  // Devuelve `true` si quedó fijado (el modal revela los 4 botones).
  async function gestionarPedido(): Promise<boolean> {
    if (!detalleOrden) return false;
    const result = await escogerParaGestion({ ordenId: detalleOrden.id });
    if (result.status === "ok") {
      setPunteroFijado(true);
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
    setDetalleOrden(null);
    setPunteroFijado(false);
    router.refresh();
  }

  // R35: cerrar el detalle SIN registrar resultado libera el puntero de bloqueo
  // (`orden_en_gestion_id`) para que las demás vuelvan a ser gestionables — pero
  // SOLO si llegó a fijarse (se pulsó "Gestionar pedido"). Si solo se miró el
  // detalle, no hay puntero que soltar. Limpieza best-effort; sin Toast.
  async function cerrarDetalle() {
    const orden = detalleOrden;
    const fijado = punteroFijado;
    setDetalleOrden(null);
    setPunteroFijado(false);
    if (orden && fijado) {
      await liberarGestion({ ordenId: orden.id });
      router.refresh();
    }
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
      {/* Cards COMPACTAS en grilla (1/2/3 col). Seleccionar una abre su detalle
          grande y centrado (GestionarOrdenModal). El bloqueo 1-a-1 (R19/R20)
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
              return (
                <li key={orden.id}>
                  <button
                    type="button"
                    disabled={bloqueada}
                    onClick={() => seleccionar(orden)}
                    aria-label={`Gestionar orden ${orden.numRemision} · ${orden.destinatario}`}
                    className="group flex h-full w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        {orden.numRemision}
                      </span>
                      {esActiva ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          En gestión
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
                          Ver / Gestionar
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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

      {/* Detalle grande + gestión 1-a-1 de la orden seleccionada. */}
      <GestionarOrdenModal
        open={detalleOrden !== null}
        orden={detalleOrden}
        yaActiva={detalleOrden !== null && ordenEnGestionId === detalleOrden.id}
        onGestionarPedido={gestionarPedido}
        onOpenChange={(next) => {
          if (!next) void cerrarDetalle();
        }}
        onSuccess={handleGestionSuccess}
      />
    </div>
  );
}
