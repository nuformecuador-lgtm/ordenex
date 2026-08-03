"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
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
import type { TotalesIngresoOrdenex } from "@/lib/interfaces/services/ICierreDiaService";
import {
  ESTADO_LABEL,
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  TotalesIngresoPanel,
  MontoDerivadoCard,
  INGRESO_BRUTO_LABEL,
  INGRESO_BRUTO_NOTA,
  GANANCIA_LABEL,
  PAGO_TIENDA_LABEL,
  PAGO_TIENDA_NOTA,
  GANANCIA_NOTA_BODEGA,
  TotalesPanel,
  VisorEvidencia,
} from "./cierre-detalle-shared";
import {
  CierreBodegaFacturaResumen,
  CierreFacturaDetalle,
} from "./cierre-factura";
import {
  BarraFiltrosCierres,
  RANGO_INICIAL,
  SIN_RESULTADOS_FILTRO,
  coincide,
  enRangoFecha,
  opcionesDe,
  type RangoFechas,
} from "./cierres-filtros";

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
  /** Ingreso de Ordenex agregado de toda la bodega, por concepto (derivado del snapshot). */
  totalesIngreso: TotalesIngresoOrdenex;
  /** Ingreso bruto agregado menos el pago a mensajeros (puede ser negativo). */
  ganancia: string;
  /** Total general agregado menos flete + IVA y comisión + IVA (puede ser negativo). */
  pagoTienda: string;
}

export function CierresBodegaAdminModule({
  pendientes,
  historico,
}: Readonly<CierresBodegaAdminModuleProps>) {
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
  // Filtros de las listas (cliente): rango de fechas —últimos 7 días de arranque—, zona
  // y estado. Vacío = todos.
  const [rango, setRango] = useState<RangoFechas>(RANGO_INICIAL);
  const [zonasFiltro, setZonasFiltro] = useState<string[]>([]);
  const [estadosFiltro, setEstadosFiltro] = useState<string[]>([]);

  /** R11-R13: abre el detalle agregado (pide totales + gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreBodegaId: string) {
    const result = await verCierreBodegaDetalle({ cierreBodegaId });
    if (result.status === "ok") {
      setDetalle({
        cierre: result.cierre,
        cierres: result.cierres,
        totalesIngreso: result.totalesIngreso,
        ganancia: result.ganancia,
        pagoTienda: result.pagoTienda,
      });
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

  // Los filtros acotan AMBAS listas: son las dos caras de la misma bodega, y tener que
  // repetir zona y estado en cada sección para mirar una zona sería trabajo de más.
  const enFiltro = (c: CierreBodegaResumen) =>
    enRangoFecha(c.solicitadoAt, rango) &&
    coincide(c.zonaNombre, zonasFiltro) &&
    coincide(ESTADO_LABEL[c.estado], estadosFiltro);
  const pendientesVisibles = pendientes.filter(enFiltro);
  const historicoVisible = historico.filter(enFiltro);

  const todos = [...pendientes, ...historico];
  const filtros = [
    {
      key: "zona",
      label: "Zona",
      options: opcionesDe(todos.map((c) => c.zonaNombre)),
      value: zonasFiltro,
      onChange: setZonasFiltro,
    },
    {
      key: "estado",
      label: "Estado",
      options: opcionesDe(todos.map((c) => ESTADO_LABEL[c.estado])),
      value: estadosFiltro,
      onChange: setEstadosFiltro,
    },
  ];

  return (
    <section
      aria-label="Cierres de bodega satélite"
      className="flex flex-col gap-8"
    >
      <h2 className="text-lg font-semibold">Cierres de bodega satélite</h2>

      {/* ---------- Filtros (fecha del cierre + zona + estado) ---------- */}
      <BarraFiltrosCierres onRangoChange={setRango} multis={filtros} />

      {/* ---------- Cola de pendientes (R15) ---------- */}
      <section
        aria-label="Cierres de bodega pendientes"
        className="flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold">
          Cierres de bodega pendientes{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pendientesVisibles.length})
          </span>
        </h3>
        {/* Cada cierre de bodega se lee como COMPROBANTE, igual que los del mensajero. */}
        <div className="grid gap-4 xl:grid-cols-2">
          {pendientesVisibles.map((c) => (
            <CierreBodegaFacturaResumen
              key={c.cierreBodegaId}
              cierre={c}
              acciones={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => abrirDetalle(c.cierreBodegaId)}
                >
                  Ver / decidir
                </Button>
              }
            />
          ))}
          {pendientesVisibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {pendientes.length === 0
                ? "No hay cierres de bodega pendientes de decisión."
                : SIN_RESULTADOS_FILTRO}
            </p>
          ) : null}
        </div>
      </section>

      {/* ---------- Histórico (solo lectura, R15) ---------- */}
      <section
        aria-label="Cierres de bodega resueltos"
        className="flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold">Cierres de bodega resueltos</h3>
        <div className="grid gap-4 xl:grid-cols-2">
          {historicoVisible.map((c) => (
            <CierreBodegaFacturaResumen
              key={c.cierreBodegaId}
              cierre={c}
              acciones={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => abrirDetalle(c.cierreBodegaId)}
                >
                  Ver
                </Button>
              }
            />
          ))}
          {historicoVisible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {historico.length === 0
                ? "Aún no hay cierres de bodega resueltos."
                : SIN_RESULTADOS_FILTRO}
            </p>
          ) : null}
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
        // Sin ancho propio: el default del Modal (75% de la pantalla) es el que corresponde
        // a un detalle con tablas anchas.
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

            {/* Primero los ingresos: qué facturó Ordenex y qué le queda. Recién después,
                lo que se paga o se debe (mismo orden que el detalle del cierre de mensajero). */}
            <TotalesIngresoPanel
              totales={detalle.totalesIngreso}
              ariaLabel="Ingreso de Ordenex del cierre de bodega"
            />

            {/* Bruto y ganancia agregados: el mismo cálculo que en el cierre de mensajero. */}
            <MontoDerivadoCard
              value={detalle.totalesIngreso.total}
              label={INGRESO_BRUTO_LABEL}
              nota={INGRESO_BRUTO_NOTA}
              ariaLabel="Ingreso bruto del cierre de bodega"
            />
            {/* Feature 39/R20: agregado a pagar a mensajeros, separado del dinero recibido.
                Va encima de la ganancia: es el sustraendo. */}
            <PagoMensajeroTotal
              value={detalle.cierre.totalPagoMensajero}
              ariaLabel="Pago a mensajeros del cierre de bodega"
              label="Total a pagar a mensajeros"
            />
            <MontoDerivadoCard
              value={detalle.ganancia}
              label={GANANCIA_LABEL}
              nota={GANANCIA_NOTA_BODEGA}
              ariaLabel="Ganancia del cierre de bodega"
            />

            {/* Feature 56/R17: agregado del ingreso de bodega por rechazos, separado. */}
            <IngresoBodegaRechazosTotal
              value={detalle.cierre.totalIngresoBodegaRechazos}
              ariaLabel="Ingreso de bodega por rechazos del cierre de bodega"
            />

            {/* Cierra el detalle agregado: lo que se les paga a las tiendas. */}
            <MontoDerivadoCard
              value={detalle.pagoTienda}
              label={PAGO_TIENDA_LABEL}
              nota={PAGO_TIENDA_NOTA}
              ariaLabel="Pago a tienda del cierre de bodega"
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

            {/* Sub-detalle por cada cierre_dia incluido (R11): EL MISMO comprobante que el
                maestro ya lee en la cola y el histórico de cierres de mensajero
                (`CierreFacturaDetalle`). Reemplaza a la pila de paneles sueltos + las 4
                tablas por resultado sin perder ningún dato: totales snapshot, ingreso de
                Ordenex, liquidación y gestiones con evidencia firmada (R12) viven todos
                ahí dentro. La cabecera de cada hoja se compone con lo que es del cierre
                de bodega (estado, zona destino, fechas) y lo que es del cierre_dia
                (mensajero, totales). */}
            {detalle.cierres.map((cierreDia) => (
              <CierreFacturaDetalle
                key={cierreDia.cierreDiaId}
                cierre={{
                  cierreId: cierreDia.cierreDiaId,
                  estado: detalle.cierre.estado,
                  destinoTipo: "bodega_satelite",
                  destinoZonaNombre: detalle.cierre.zonaNombre,
                  totales: cierreDia.totales,
                  totalPagoMensajero: cierreDia.totalPagoMensajero,
                  totalIngresoBodegaRechazos:
                    cierreDia.totalIngresoBodegaRechazos,
                  solicitadoAt: detalle.cierre.solicitadoAt,
                  resueltoAt: detalle.cierre.resueltoAt,
                  // El motivo es del cierre de BODEGA, no de cada cierre_dia: ya se
                  // muestra una sola vez arriba, repetirlo en cada hoja sería ruido.
                  motivoRechazo: null,
                  mensajeroNombre: cierreDia.mensajeroNombre,
                }}
                grupos={cierreDia.grupos}
                totalesIngreso={cierreDia.totalesIngreso}
                // El snapshot de bodega guarda el agregado por cierre_dia, no el desglose
                // SLA/manual: la tarjeta se queda con el total.
                desgloseIngresoBodegaRechazos={{
                  total: cierreDia.totalIngresoBodegaRechazos,
                }}
                ganancia={cierreDia.ganancia}
                pagoTienda={cierreDia.pagoTienda}
                onVerEvidencia={setEvidencia}
              />
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
