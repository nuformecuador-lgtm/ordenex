"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import { solicitarCierreBodega } from "@/lib/actions/cierre-bodega";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import {
  money,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  PagoMensajeroTotal,
  TotalesPanel,
} from "./cierre-detalle-shared";

// Feature 40 (T8) — módulo cliente del "Cierre de bodega" del adminSatelite (lado
// SOLICITAR, espejo de la 37 un nivel arriba). Recibe del Server Component padre los
// cierre_dia aprobados consolidables de SU zona (R5), los totales agregados (R10),
// el gate `puedesSolicitar`/`motivoBloqueo` (R6/R7) y su histórico propio (F1.4-h),
// todo ya acotado server-side (R1/R3). La única mutación (Solicitar cierre de
// bodega) va por Server Action y refresca la ruta. Money-safe (R13): los montos son
// STRING; se renderizan con `money()` sin `parseFloat`/`Number`.

export interface ConsolidacionBodegaModuleProps {
  /** cierre_dia `aprobado` sin cierre de bodega de la zona (R5). */
  consolidables: CierreBodegaResumenLite[];
  /** Suma snapshot de los consolidables (R10). */
  totalesAgregados: CierreTotales;
  /** Feature 39/R18: suma snapshot del pago a mensajeros (STRING), separado de los totales. */
  totalPagoMensajeroAgregado: string;
  /** Gate de "Solicitar cierre de bodega" (R6/R7). */
  puedesSolicitar: boolean;
  /** Texto accionable del bloqueo si `!puedesSolicitar`. */
  motivoBloqueo: string | null;
  /** Histórico de cierres de bodega de la zona (solo lectura, F1.4-h). */
  cierresBodegaPasados: CierreBodegaResumen[];
  /** `true` si el adminSatelite no tiene zona asignada (R4). */
  sinZona: boolean;
}

export function ConsolidacionBodegaModule({
  consolidables,
  totalesAgregados,
  totalPagoMensajeroAgregado,
  puedesSolicitar,
  motivoBloqueo,
  cierresBodegaPasados,
  sinZona,
}: ConsolidacionBodegaModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Confirmación de "Solicitar cierre de bodega"; true = modal abierto.
  const [confirmar, setConfirmar] = useState(false);

  /** R6-R10: crea la solicitud de cierre de bodega de la zona. */
  async function confirmarSolicitud() {
    const result = await solicitarCierreBodega();
    if (result.status === "ok") {
      toast.success("Cierre de bodega solicitado correctamente.");
      setConfirmar(false);
      router.refresh();
      return;
    }
    // conflict (R6 pendientes / R7 vacío / R8 duplicado) → motivo accionable.
    if (result.status === "conflict") {
      toast.error(result.motivo);
    } else if (result.status === "validation_error") {
      // R4: sin zona.
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      toast.error(primero ?? "No se pudo solicitar el cierre de bodega.");
    } else if (result.status === "forbidden") {
      toast.error("No tenés permiso para solicitar el cierre de bodega.");
    } else if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo solicitar el cierre de bodega. Intentá de nuevo.");
    }
    setConfirmar(false);
    router.refresh();
  }

  return (
    <section aria-label="Cierre de bodega" className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold">Cierre de bodega</h2>

      {/* R4: adminSatelite sin zona → aviso accionable, sin tablas de acción. */}
      {sinZona ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No tenés una zona asignada; contactá a tu administrador.
        </p>
      ) : (
        <>
          {/* ---------- Totales agregados a consolidar (R10/R13) ---------- */}
          <TotalesPanel
            totales={totalesAgregados}
            ariaLabel="Totales a consolidar"
            title="Totales a consolidar"
          />

          {/* Feature 39/R18: agregado a pagar a mensajeros, separado del dinero recibido. */}
          <PagoMensajeroTotal
            value={totalPagoMensajeroAgregado}
            ariaLabel="Pago a mensajeros a consolidar"
            label="Total a pagar a mensajeros"
          />

          {/* ---------- Cierres del día a consolidar (R5) ---------- */}
          <section
            aria-label="Cierres del día a consolidar"
            className="flex flex-col gap-3"
          >
            <h3 className="text-base font-semibold">
              Cierres del día a consolidar{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({consolidables.length})
              </span>
            </h3>
            <div className="overflow-x-auto">
              <DataTable
                columns={COLUMNAS_CONSOLIDABLES}
                data={consolidables}
                rowKey="cierreDiaId"
                ariaLabel="Cierres del día a consolidar"
                emptyMessage="No hay cierres del día aprobados para consolidar."
              />
            </div>
          </section>

          {/* ---------- Solicitar cierre de bodega (R6/R7) ---------- */}
          <section
            aria-label="Solicitar cierre de bodega"
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => setConfirmar(true)}
                disabled={!puedesSolicitar}
                title={!puedesSolicitar ? (motivoBloqueo ?? undefined) : undefined}
                aria-describedby={
                  !puedesSolicitar && motivoBloqueo
                    ? "motivo-bloqueo-bodega"
                    : undefined
                }
              >
                Solicitar cierre de bodega
              </Button>
            </div>
            {!puedesSolicitar && motivoBloqueo ? (
              <p
                id="motivo-bloqueo-bodega"
                role="note"
                className="text-sm text-muted-foreground"
              >
                {motivoBloqueo}
              </p>
            ) : null}
          </section>
        </>
      )}

      {/* ---------- Histórico de cierres de bodega (solo lectura, F1.4-h) ---------- */}
      <section
        aria-label="Cierres de bodega solicitados"
        className="flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold">Cierres de bodega solicitados</h3>
        <div className="overflow-x-auto">
          <DataTable
            columns={COLUMNAS_PASADOS}
            data={cierresBodegaPasados}
            rowKey="cierreBodegaId"
            ariaLabel="Cierres de bodega solicitados"
            emptyMessage="Aún no has solicitado ningún cierre de bodega."
          />
        </div>
      </section>

      {/* Confirmación de "Solicitar cierre de bodega". */}
      <Modal
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Solicitar cierre de bodega"
        description="Se consolidarán todos los cierres del día aprobados de tu zona en una solicitud a la bodega central. Esta acción no se puede deshacer."
        confirmLabel="Solicitar cierre de bodega"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />
    </section>
  );
}

// --- Columnas de los cierre_dia consolidables (R5, money-safe R13) ---
const COLUMNAS_CONSOLIDABLES: Column<CierreBodegaResumenLite>[] = [
  { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
  { id: "efectivo", value: "Efectivo", render: (c) => money(c.totales.efectivo) },
  { id: "simpe", value: "SIMPE", render: (c) => money(c.totales.simpe) },
  {
    id: "transferencia",
    value: "Transferencia",
    render: (c) => money(c.totales.transferencia),
  },
  {
    id: "general",
    value: "Total general",
    render: (c) => money(c.totales.general),
  },
  {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (c) => money(c.totalPagoMensajero),
  },
];

// --- Columnas del histórico de cierres de bodega (solo lectura, F1.4-h) ---
const COLUMNAS_PASADOS: Column<CierreBodegaResumen>[] = [
  { id: "estado", value: "Estado", render: (c) => ESTADO_LABEL[c.estado] },
  {
    id: "solicitadoAt",
    value: "Fecha solicitud",
    render: (c) => c.solicitadoAt.slice(0, 10),
  },
  {
    id: "cantidadCierres",
    value: "Cierres del día",
    render: (c) => String(c.cantidadCierres),
  },
  {
    id: "general",
    value: "Total general",
    render: (c) => money(c.totales.general),
  },
  {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (c) => money(c.totalPagoMensajero),
  },
  {
    id: "motivoRechazo",
    value: "Motivo",
    render: (c) => c.motivoRechazo ?? "—",
  },
];
