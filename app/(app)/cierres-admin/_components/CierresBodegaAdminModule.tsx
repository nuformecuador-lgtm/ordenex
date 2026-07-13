"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import {
  verCierreBodegaDetalle,
  aprobarCierreBodega,
  rechazarCierreBodega,
} from "@/lib/actions/cierre-bodega";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import {
  money,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  DetalleSecciones,
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  TotalesPanel,
  VisorEvidencia,
} from "./cierre-detalle-shared";

// Feature 40 (T8) — módulo cliente de "Cierres de bodega satélite" del maestro (lado
// APROBAR/RECHAZAR, espejo de la 38 aplicado a CierreBodega). Recibe del Server
// Component padre la cola de `solicitado` (R15) y el histórico de resueltos, ya
// acotados server-side (R2). Al abrir un cierre pide el DETALLE AGREGADO por Server
// Action (totales snapshot R11/R13 + cada cierre_dia con sus 4 secciones por
// resultado y evidencias FIRMADAS R12). Las decisiones (aprobar/rechazar con motivo
// obligatorio R17) van por Server Action y refrescan la ruta. Money-safe (R13): los
// montos son STRING; se renderizan con `money()` sin `parseFloat`/`Number`.

export interface CierresBodegaAdminModuleProps {
  /** Cierres de bodega en estado `solicitado` (cola de decisión, R15). */
  pendientes: CierreBodegaResumen[];
  /** Cierres de bodega resueltos (`aprobado`/`rechazado`), solo lectura (R15). */
  historico: CierreBodegaResumen[];
}

/** Detalle abierto: la cabecera del cierre de bodega + sus cierre_dia incluidos. */
interface DetalleAbierto {
  cierre: CierreBodegaResumen;
  cierres: CierreBodegaDetalleCierre[];
}

export function CierresBodegaAdminModule({
  pendientes,
  historico,
}: CierresBodegaAdminModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Detalle del cierre de bodega abierto (null = modal cerrado).
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  // Evidencia (URL firmada, R12) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Sub-modal de rechazo (R17): true = abierto.
  const [rechazando, setRechazando] = useState(false);
  // Motivo del rechazo (obligatorio, R17) + su error de validación.
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);

  /** R11-R13: abre el detalle agregado (pide totales + gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreBodegaId: string) {
    const result = await verCierreBodegaDetalle({ cierreBodegaId });
    if (result.status === "ok") {
      setDetalle({ cierre: result.cierre, cierres: result.cierres });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre de bodega ya no está disponible. Actualizando la lista.");
      router.refresh();
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para ver este cierre de bodega.");
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    // validation_error (id malformado) u otro → feedback genérico.
    toast.error("No se pudo abrir el detalle del cierre de bodega. Intentá de nuevo.");
  }

  function cerrarDetalle() {
    setDetalle(null);
    setRechazando(false);
    setMotivo("");
    setMotivoError(null);
  }

  /** Traduce un resultado de dominio de error a feedback accionable + refresco. */
  function manejarErrorDecision(
    status:
      | "conflict"
      | "no_encontrada"
      | "forbidden"
      | "unauthenticated"
      | "validation_error",
  ) {
    if (status === "conflict") {
      toast.error("Este cierre de bodega ya fue resuelto.");
    } else if (status === "no_encontrada") {
      toast.error("El cierre de bodega ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este cierre de bodega.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo resolver el cierre de bodega. Intentá de nuevo.");
    }
    cerrarDetalle();
    router.refresh();
  }

  /** R16: aprueba el cierre de bodega abierto. */
  async function confirmarAprobacion() {
    if (!detalle) return;
    const result = await aprobarCierreBodega({
      cierreBodegaId: detalle.cierre.cierreBodegaId,
    });
    if (result.status === "ok") {
      toast.success("Cierre de bodega aprobado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    manejarErrorDecision(result.status);
  }

  /** R17: rechaza el cierre de bodega abierto con motivo obligatorio. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError("El motivo de rechazo es obligatorio.");
      return; // R17: sin motivo NO se envía
    }
    const result = await rechazarCierreBodega({
      cierreBodegaId: detalle.cierre.cierreBodegaId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Cierre de bodega rechazado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      setMotivoError(primero ?? "El motivo de rechazo es obligatorio.");
      return;
    }
    manejarErrorDecision(result.status);
  }

  const cierreAbierto = detalle?.cierre ?? null;
  const esPendiente = cierreAbierto?.estado === "solicitado";

  return (
    <section
      aria-label="Cierres de bodega satélite"
      className="flex flex-col gap-8"
    >
      <h2 className="text-lg font-semibold">Cierres de bodega satélite</h2>

      {/* ---------- Cola de pendientes (R15) ---------- */}
      <section
        aria-label="Cierres de bodega pendientes"
        className="flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold">
          Cierres de bodega pendientes{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pendientes.length})
          </span>
        </h3>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasPendientes(abrirDetalle)}
            data={pendientes}
            rowKey="cierreBodegaId"
            ariaLabel="Cierres de bodega pendientes"
            emptyMessage="No hay cierres de bodega pendientes de decisión."
          />
        </div>
      </section>

      {/* ---------- Histórico (solo lectura, R15) ---------- */}
      <section
        aria-label="Cierres de bodega resueltos"
        className="flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold">Cierres de bodega resueltos</h3>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasHistorico(abrirDetalle)}
            data={historico}
            rowKey="cierreBodegaId"
            ariaLabel="Cierres de bodega resueltos"
            emptyMessage="Aún no hay cierres de bodega resueltos."
          />
        </div>
      </section>

      {/* ---------- Detalle agregado del cierre de bodega (R11-R13) ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del cierre de bodega"
        description={
          cierreAbierto
            ? `${cierreAbierto.zonaNombre} · ${cierreAbierto.solicitadoPorNombre}`
            : undefined
        }
        className="max-w-4xl"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
            {/* Panel de totales AGREGADOS snapshot (R11/R13). */}
            <TotalesPanel
              totales={detalle.cierre.totales}
              ariaLabel="Totales del cierre de bodega"
              title="Totales del cierre de bodega"
            />

            {/* Feature 39/R20: agregado a pagar a mensajeros, separado del dinero recibido. */}
            <PagoMensajeroTotal
              value={detalle.cierre.totalPagoMensajero}
              ariaLabel="Pago a mensajeros del cierre de bodega"
              label="Total a pagar a mensajeros"
            />

            {/* Feature 56/R17: agregado del ingreso de bodega por rechazos, separado. */}
            <IngresoBodegaRechazosTotal
              value={detalle.cierre.totalIngresoBodegaRechazos}
              ariaLabel="Ingreso de bodega por rechazos del cierre de bodega"
            />

            {/* Motivo de rechazo si el cierre de bodega del histórico fue rechazado. */}
            {detalle.cierre.motivoRechazo ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Motivo de rechazo:{" "}
                </span>
                {detalle.cierre.motivoRechazo}
              </p>
            ) : null}

            {/* Sub-detalle por cada cierre_dia incluido (R11): mensajero + totales +
                4 secciones por resultado con evidencia firmada (R12). */}
            {detalle.cierres.map((cierreDia) => (
              <section
                key={cierreDia.cierreDiaId}
                aria-label={`Cierre del día · ${cierreDia.mensajeroNombre}`}
                className="flex flex-col gap-4 rounded-lg border border-border p-4"
              >
                <h3 className="text-base font-semibold">
                  {cierreDia.mensajeroNombre}
                </h3>
                <TotalesPanel
                  totales={cierreDia.totales}
                  ariaLabel={`Totales · ${cierreDia.mensajeroNombre}`}
                  title="Totales del cierre del día"
                />
                {/* Feature 39/R20: pago snapshot a este mensajero, separado del dinero recibido. */}
                <PagoMensajeroTotal
                  value={cierreDia.totalPagoMensajero}
                  ariaLabel={`Pago al mensajero · ${cierreDia.mensajeroNombre}`}
                />
                {/* Feature 56/R19: ingreso de bodega por rechazos de este cierre_dia, separado. */}
                <IngresoBodegaRechazosTotal
                  value={cierreDia.totalIngresoBodegaRechazos}
                  ariaLabel={`Ingreso de bodega por rechazos · ${cierreDia.mensajeroNombre}`}
                />
                <DetalleSecciones
                  grupos={cierreDia.grupos}
                  onVerEvidencia={setEvidencia}
                />
              </section>
            ))}

            {/* Acciones: solo en un cierre de bodega PENDIENTE (`solicitado`). */}
            {esPendiente ? (
              <section
                aria-label="Decisión del cierre de bodega"
                className="flex flex-wrap justify-end gap-3 border-t pt-4"
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setMotivo("");
                    setMotivoError(null);
                    setRechazando(true);
                  }}
                >
                  Rechazar
                </Button>
                <Button type="button" onClick={confirmarAprobacion}>
                  Aprobar
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R17) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title="Rechazar cierre de bodega"
        description="Indicá el motivo del rechazo. La bodega satélite lo verá para corregir."
        confirmLabel="Rechazar cierre de bodega"
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="motivo-rechazo-bodega" className="text-sm font-medium">
            Motivo del rechazo
          </label>
          <textarea
            id="motivo-rechazo-bodega"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={
              motivoError ? "motivo-rechazo-bodega-error" : undefined
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="motivo-rechazo-bodega-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Visor de evidencia (URL firmada, R12) ---------- */}
      <VisorEvidencia url={evidencia} onClose={() => setEvidencia(null)} />
    </section>
  );
}

// --- Columnas de la cola de pendientes (R15) ---
function columnasPendientes(
  abrir: (cierreBodegaId: string) => void,
): Column<CierreBodegaResumen>[] {
  return [
    { id: "zona", value: "Zona", render: (c) => c.zonaNombre },
    {
      id: "solicitadoPor",
      value: "Solicitó",
      render: (c) => c.solicitadoPorNombre,
    },
    {
      id: "solicitadoAt",
      value: "Fecha",
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
      id: "ingresoBodegaRechazos",
      value: INGRESO_BODEGA_RECHAZOS_COL,
      render: (c) => money(c.totalIngresoBodegaRechazos),
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (c) => (
        <Button
          type="button"
          size="sm"
          onClick={() => abrir(c.cierreBodegaId)}
        >
          Ver / decidir
        </Button>
      ),
    },
  ];
}

// --- Columnas del histórico (solo lectura, R15) ---
function columnasHistorico(
  abrir: (cierreBodegaId: string) => void,
): Column<CierreBodegaResumen>[] {
  return [
    { id: "estado", value: "Estado", render: (c) => ESTADO_LABEL[c.estado] },
    { id: "zona", value: "Zona", render: (c) => c.zonaNombre },
    {
      id: "solicitadoPor",
      value: "Solicitó",
      render: (c) => c.solicitadoPorNombre,
    },
    {
      id: "resueltoAt",
      value: "Fecha resuelta",
      render: (c) => c.resueltoAt?.slice(0, 10) ?? "—",
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
      id: "ingresoBodegaRechazos",
      value: INGRESO_BODEGA_RECHAZOS_COL,
      render: (c) => money(c.totalIngresoBodegaRechazos),
    },
    {
      id: "motivoRechazo",
      value: "Motivo",
      render: (c) => c.motivoRechazo ?? "—",
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (c) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => abrir(c.cierreBodegaId)}
        >
          Ver
        </Button>
      ),
    },
  ];
}
