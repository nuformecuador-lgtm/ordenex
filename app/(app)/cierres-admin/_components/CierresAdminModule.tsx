"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
} from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo } from "@/lib/types/cierre";
import {
  money,
  ESTADO_LABEL,
  EstadoCierreBadge,
  ORDEN_RESULTADOS,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  RESULTADO_LABEL,
  RESULTADO_VACIO,
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  TotalesIngresoPanel,
  MontoDerivadoCard,
  INGRESO_BRUTO_LABEL,
  INGRESO_BRUTO_NOTA,
  GANANCIA_DEBE_LABEL,
  PAGO_TIENDA_LABEL,
  PAGO_TIENDA_NOTA,
  GANANCIA_NOTA,
  esMontoNegativo,
  DesgloseIngresoOrdenex,
  desgloseAriaLabel,
  TotalItem,
  columnasPara,
} from "./cierre-detalle-shared";

// Feature 38 (T13, R3-R11): módulo cliente de "Cierres del día" del admin. Recibe
// del Server Component padre los cierres del alcance ya resueltos (pendientes de
// decisión + histórico de solo lectura) y `sinZona`. Al abrir un cierre pide el
// detalle por Server Action (evidencias firmadas, R7) y muestra los totales
// snapshot (R8) + las 4 secciones por resultado (reuso del render de la 37, R6).
// Las decisiones (aprobar/rechazar) van por Server Action y refrescan la ruta. Los
// montos llegan como STRING (money-safe, R9): se renderizan tal cual, sin
// `parseFloat`/`Number`. Los helpers de detalle (money/columnas/etiquetas) viven en
// `cierre-detalle-shared` (compartidos con los módulos de cierre de bodega, feat 40).

export interface CierresAdminModuleProps {
  /** Cierres en estado `solicitado` del alcance del admin (cola de decisión, R4). */
  pendientes: CierreAdminResumen[];
  /** Cierres ya resueltos (`aprobado`/`rechazado`) del alcance, solo lectura (R5). */
  historico: CierreAdminResumen[];
  /** `true` si el adminSatelite no tiene zona asignada (R3). */
  sinZona: boolean;
}

const DESTINO_LABEL: Record<CierreDestinoTipo, string> = {
  bodega_central: "Bodega central",
  bodega_satelite: "Bodega satélite",
};

/** Destino legible de un cierre (tipo + zona). */
function destino(c: CierreAdminResumen): string {
  return `${DESTINO_LABEL[c.destinoTipo]} · ${c.destinoZonaNombre}`;
}

/** Detalle abierto: la cabecera del cierre + sus gestiones agrupadas por resultado. */
interface DetalleAbierto {
  cierre: CierreAdminResumen;
  grupos: CierreGrupos;
  /** Ingreso de Ordenex del cierre por concepto (derivado del snapshot, money-safe). */
  totalesIngreso: TotalesIngresoOrdenex;
  /** Ingreso bruto menos el pago al mensajero, derivado server-side (puede ser negativo). */
  ganancia: string;
  /** Total general menos flete + IVA y comisión + IVA, derivado server-side (puede ser negativo). */
  pagoTienda: string;
}

export function CierresAdminModule({
  pendientes,
  historico,
  sinZona,
}: Readonly<CierresAdminModuleProps>) {
  const router = useRouter();
  const toast = useToast();

  // Detalle del cierre abierto (null = modal cerrado).
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  // Evidencia (URL firmada, R7) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Sub-modal de rechazo (R11): true = abierto.
  const [rechazando, setRechazando] = useState(false);
  // Motivo del rechazo (obligatorio, R11) + su error de validación.
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);

  // R3: adminSatelite sin zona → aviso accionable, sin tablas de acción.
  if (sinZona) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        No tenés una zona asignada; contactá a tu administrador.
      </p>
    );
  }

  /** Abre el detalle de un cierre (pide las gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreId: string) {
    const result = await verCierreDetalle({ cierreId });
    if (result.status === "ok") {
      setDetalle({
        cierre: result.cierre,
        grupos: result.grupos,
        totalesIngreso: result.totalesIngreso,
        ganancia: result.ganancia,
        pagoTienda: result.pagoTienda,
      });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre ya no está disponible. Actualizando la lista.");
      router.refresh();
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    toast.error("No se pudo abrir el detalle del cierre. Intentá de nuevo.");
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
      toast.error("Este cierre ya fue resuelto por otro administrador.");
    } else if (status === "no_encontrada") {
      toast.error("El cierre ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este cierre.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo resolver el cierre. Intentá de nuevo.");
    }
    cerrarDetalle();
    router.refresh();
  }

  /** R10: aprueba el cierre abierto. */
  async function confirmarAprobacion() {
    if (!detalle) return;
    const result = await aprobarCierre({ cierreId: detalle.cierre.cierreId });
    if (result.status === "ok") {
      toast.success("Cierre aprobado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    manejarErrorDecision(result.status);
  }

  /** R11: rechaza el cierre abierto con motivo obligatorio. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError("El motivo de rechazo es obligatorio.");
      return; // R11: sin motivo NO se envía
    }
    const result = await rechazarCierre({
      cierreId: detalle.cierre.cierreId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Cierre rechazado correctamente.");
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
  // Feature 41 (R20): los dos estados RESOLUBLES (`solicitado` y `vencido`) exponen
  // los botones aprobar/rechazar; el backend permite resolver un `vencido` igual que
  // un `solicitado` (guardia de transicion extendida). El histórico es solo lectura.
  const esPendiente =
    cierreAbierto?.estado === "solicitado" || cierreAbierto?.estado === "vencido";

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Pendientes de decisión (R4) ---------- */}
      <section
        aria-label="Pendientes de decisión"
        className="flex flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">
          Pendientes de decisión{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pendientes.length})
          </span>
        </h2>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasPendientes(abrirDetalle)}
            data={pendientes}
            rowKey="cierreId"
            ariaLabel="Pendientes de decisión"
            emptyMessage="No hay cierres pendientes de decisión."
          />
        </div>
      </section>

      {/* ---------- Histórico (solo lectura, R5) ---------- */}
      <section aria-label="Histórico" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Histórico</h2>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasHistorico(abrirDetalle)}
            data={historico}
            rowKey="cierreId"
            ariaLabel="Histórico"
            emptyMessage="Aún no hay cierres resueltos."
          />
        </div>
      </section>

      {/* ---------- Detalle del cierre (R6-R8) ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del cierre"
        description={
          cierreAbierto
            ? `${cierreAbierto.mensajeroNombre} · ${destino(cierreAbierto)}`
            : undefined
        }
        // Sin ancho propio: el default del Modal (75% de la pantalla) es el que corresponde
        // a un detalle con tablas anchas.
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
            {/* Panel de totales snapshot por método (R8). */}
            <section
              aria-label="Totales del cierre"
              className="flex flex-col gap-3"
            >
              <h3 className="text-base font-semibold">Totales del cierre</h3>
              <Card>
                <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
                  <TotalItem
                    label="Efectivo"
                    value={money(detalle.cierre.totales.efectivo)}
                  />
                  <TotalItem
                    label="SIMPE"
                    value={money(detalle.cierre.totales.simpe)}
                  />
                  <TotalItem
                    label="Transferencia"
                    value={money(detalle.cierre.totales.transferencia)}
                  />
                  <TotalItem
                    label="Total general"
                    value={money(detalle.cierre.totales.general)}
                    emphasis
                  />
                </CardContent>
              </Card>
            </section>

            {/* Primero los ingresos: qué facturó Ordenex. Después la resta completa, en
                orden: bruto, pago al mensajero, ganancia. */}
            <TotalesIngresoPanel totales={detalle.totalesIngreso} />

            {/* Bruto y ganancia: el bruto es el mismo total del panel de arriba, repetido
                acá a propósito para que la resta de la ganancia se lea completa. */}
            <MontoDerivadoCard
              value={detalle.totalesIngreso.total}
              label={INGRESO_BRUTO_LABEL}
              nota={INGRESO_BRUTO_NOTA}
            />
            {/* Feature 39/R17: total snapshot a pagar al mensajero, separado del dinero recibido.
                Va encima de la ganancia: es el sustraendo, así que la resta se lee de arriba
                hacia abajo (bruto − pago = ganancia). */}
            <PagoMensajeroTotal
              value={detalle.cierre.totalPagoMensajero}
              ariaLabel="Pago al mensajero del cierre"
            />
            {/* La ganancia solo se muestra cuando es NEGATIVA: ahí Ordenex pagó al
                mensajero más de lo que facturó, así que es una DEUDA ("Debe") y el
                monto va en rojo. Si es ≥ 0 no se muestra card de ganancia. */}
            {esMontoNegativo(detalle.ganancia) ? (
              <MontoDerivadoCard
                value={detalle.ganancia}
                label={GANANCIA_DEBE_LABEL}
                nota={GANANCIA_NOTA}
                tone="danger"
              />
            ) : null}

            {/* Feature 56/R16: total snapshot del ingreso de bodega por rechazos, separado. */}
            <IngresoBodegaRechazosTotal
              value={detalle.cierre.totalIngresoBodegaRechazos}
              ariaLabel="Ingreso de bodega por rechazos del cierre"
            />

            {/* Cierra el detalle: lo que se le paga a la tienda. Parte del total general
                RECIBIDO, no del bruto facturado — por eso va aparte de la ganancia. */}
            <MontoDerivadoCard
              value={detalle.pagoTienda}
              label={PAGO_TIENDA_LABEL}
              nota={PAGO_TIENDA_NOTA}
            />

            {/* Motivo de rechazo si el cierre del histórico fue rechazado. */}
            {detalle.cierre.motivoRechazo ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Motivo de rechazo:{" "}
                </span>
                {detalle.cierre.motivoRechazo}
              </p>
            ) : null}

            {/* Secciones por resultado (reuso del render de la 37, R6). */}
            {ORDEN_RESULTADOS.map((resultado) => {
              const filas = detalle.grupos[resultado] ?? [];
              // Pedido: no mostrar las secciones sin registros (p. ej. reprogramadas con 0).
              if (filas.length === 0) return null;
              return (
                <section
                  key={resultado}
                  aria-label={RESULTADO_LABEL[resultado]}
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-base font-semibold">
                    {RESULTADO_LABEL[resultado]}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({filas.length})
                    </span>
                  </h3>
                  <div className="overflow-x-auto">
                    <DataTable
                      columns={columnasPara(resultado, setEvidencia)}
                      data={filas}
                      rowKey="gestionId"
                      ariaLabel={RESULTADO_LABEL[resultado]}
                      emptyMessage={RESULTADO_VACIO[resultado]}
                      // Desglose por orden: de qué tarifa salió cada monto.
                      renderExpanded={(g) =>
                        g.ingresoOrdenex ? <DesgloseIngresoOrdenex g={g} /> : null
                      }
                      expandAriaLabel={desgloseAriaLabel}
                    />
                  </div>
                </section>
              );
            })}

            {/* Acciones: solo en un cierre PENDIENTE (`solicitado`); histórico = solo lectura. */}
            {esPendiente ? (
              <section
                aria-label="Decisión del cierre"
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

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R11) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title="Rechazar cierre"
        description="Indicá el motivo del rechazo. El mensajero lo verá para corregir."
        confirmLabel="Rechazar cierre"
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="motivo-rechazo" className="text-sm font-medium">
            Motivo del rechazo
          </label>
          <textarea
            id="motivo-rechazo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={motivoError ? "motivo-rechazo-error" : undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="motivo-rechazo-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Visor de evidencia (URL firmada, R7) ---------- */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title="Evidencia de la gestión"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica de la gestión"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

// --- Columnas de la cola de pendientes (R4) ---
function columnasPendientes(
  abrir: (cierreId: string) => void,
): Column<CierreAdminResumen>[] {
  return [
    // Feature 41 (R20): estado diferenciado (`solicitado` vs `vencido`) en la cola.
    {
      id: "estado",
      value: "Estado",
      render: (c) => <EstadoCierreBadge estado={c.estado} />,
    },
    { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
    {
      id: "fecha",
      value: "Fecha",
      render: (c) => c.solicitadoAt.slice(0, 10),
    },
    { id: "destino", value: "Destino", render: (c) => destino(c) },
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
        <Button type="button" size="sm" onClick={() => abrir(c.cierreId)}>
          Ver / decidir
        </Button>
      ),
    },
  ];
}

// --- Columnas del histórico (solo lectura, R5) ---
function columnasHistorico(
  abrir: (cierreId: string) => void,
): Column<CierreAdminResumen>[] {
  return [
    { id: "estado", value: "Estado", render: (c) => ESTADO_LABEL[c.estado] },
    { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
    {
      id: "resueltoAt",
      value: "Fecha resuelta",
      render: (c) => c.resueltoAt?.slice(0, 10) ?? "—",
    },
    { id: "destino", value: "Destino", render: (c) => destino(c) },
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
          onClick={() => abrir(c.cierreId)}
        >
          Ver
        </Button>
      ),
    },
  ];
}
