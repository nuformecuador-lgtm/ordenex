"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  // Orden con el modal de gestión abierto; null = cerrado.
  const [gestionOrden, setGestionOrden] = useState<MiAsignacionDTO | null>(null);

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

  async function abrirGestion(orden: MiAsignacionDTO) {
    // R17 (T17): fija el puntero de bloqueo 1-a-1 ANTES de abrir el modal.
    const result = await escogerParaGestion({ ordenId: orden.id });
    if (result.status === "ok") {
      setGestionOrden(orden);
      router.refresh(); // refleja el bloqueo de las demás (ordenEnGestionId)
      return;
    }
    toast.error(
      result.status === "conflict"
        ? "Ya tienes otra orden activa en gestión."
        : "No puedes gestionar esta orden.",
    );
  }

  function handleGestionSuccess() {
    // Path de ÉXITO: el backend YA limpió el puntero dentro de la transacción de
    // `gestionar`. NO se llama a `liberarGestion` aquí (evita doble limpieza).
    setGestionOrden(null);
    router.refresh();
  }

  // R35: cancelar/cerrar manual del modal SIN registrar resultado libera el
  // puntero de bloqueo (`orden_en_gestion_id`) para que las demás vuelvan a ser
  // gestionables. Limpieza best-effort (idempotente en backend); sin Toast.
  async function cancelarGestion() {
    const orden = gestionOrden;
    setGestionOrden(null);
    if (orden) {
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
          <ul className="flex flex-col gap-3">
            {porGestionar.map((orden) => {
              // R19/R20: si hay una orden activa distinta, esta queda bloqueada.
              const bloqueada =
                ordenEnGestionId !== null && ordenEnGestionId !== orden.id;
              const esActiva = ordenEnGestionId === orden.id;
              return (
                <li key={orden.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {orden.numRemision} · {orden.destinatario}
                      </CardTitle>
                      <CardAction>
                        <Button
                          type="button"
                          size="sm"
                          disabled={bloqueada}
                          onClick={() => abrirGestion(orden)}
                        >
                          {esActiva ? "Continuar gestión" : "Gestionar"}
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <AsignacionDetalle orden={orden} />
                      {bloqueada ? (
                        <p className="text-xs text-muted-foreground">
                          Termina la gestión en curso para gestionar esta orden.
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
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

      {/* Gestión 1-a-1 de la orden activa. */}
      <GestionarOrdenModal
        open={gestionOrden !== null}
        orden={gestionOrden}
        onOpenChange={(next) => {
          if (!next) void cancelarGestion();
        }}
        onSuccess={handleGestionSuccess}
      />
    </div>
  );
}
