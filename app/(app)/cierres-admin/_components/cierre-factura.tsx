"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, MapPin, Store, Undo2, Warehouse } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";
import { cn } from "@/lib/utils";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo } from "@/lib/types/cierre";

import {
  money,
  ubicacion,
  esMontoNegativo,
  EstadoCierreBadge,
  METODO_LABEL,
  ORDEN_RESULTADOS,
  RESULTADO_LABEL,
  RESULTADO_VACIO,
  DesgloseIngresoOrdenex,
  desgloseAriaLabel,
  renderPagoMensajero,
  RECHAZO_SLA_BADGE_LABEL,
  RECHAZO_SLA_BADGE_NOTA,
  RECHAZO_MANUAL_BADGE_LABEL,
  RECHAZO_MANUAL_BADGE_NOTA,
  PAGO_MENSAJERO_LABEL,
  INGRESO_BODEGA_RECHAZOS_LABEL,
  INGRESO_BODEGA_RECHAZOS_SLA_LABEL,
  INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL,
  INGRESO_BRUTO_LABEL,
  INGRESO_BRUTO_NOTA,
  GANANCIA_DEBE_LABEL,
  GANANCIA_NOTA,
  PAGO_TIENDA_LABEL,
  PAGO_TIENDA_NOTA,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  INGRESO_TOTAL_LABEL,
  INGRESO_PANEL_LABEL,
} from "./cierre-detalle-shared";

// Vista TIPO FACTURA de un cierre (exploración de UX, feature 38/40). Es una lectura
// alternativa de los MISMOS datos que ya pintan las tablas: el resumen de la cola /
// histórico como comprobante, y el detalle del cierre como documento con sus renglones
// y su liquidación. No hay datos nuevos ni cálculos: todos los montos llegan como STRING
// derivados server-side (money-safe) y se muestran con `money()`.
//
// EXCEPCIÓN CONSCIENTE al money-safe: los KPIs superiores usan `KpiValorAnimado`
// (react-countup), que sí parsea el monto a número para poder animarlo desde 0. Es
// presentación pura y el valor exacto sigue estando en los renglones y en las tablas.

// --- Etiquetas propias de la factura (texto separado, i18n-ready) ---
const FACTURA_TITULO = "Cierre del día";
const FACTURA_FOLIO_LABEL = "Comprobante";
const FACTURA_MENSAJERO_LABEL = "Mensajero";
const FACTURA_DESTINO_LABEL = "Destino";
const FACTURA_SOLICITADO_LABEL = "Solicitado";
const FACTURA_RESUELTO_LABEL = "Resuelto";
// Conserva el nombre del panel al que reemplazó: es el que localizan los tests y el E2E.
const FACTURA_RECIBIDO_TITULO = "Totales del cierre";
const FACTURA_LIQUIDACION_TITULO = "Liquidación";
const FACTURA_ORDENES_TITULO = "Órdenes del cierre";
const FACTURA_TOTAL_GENERAL_LABEL = "Total general";
const FACTURA_MOTIVO_RECHAZO_LABEL = "Motivo de rechazo";
const FACTURA_ORDENES_KPI_LABEL = "Órdenes";

const DESTINO_LABEL: Record<CierreDestinoTipo, string> = {
  bodega_central: "Bodega central",
  bodega_satelite: "Bodega satélite",
};

/** Destino legible de un cierre (tipo + zona). */
function destino(c: CierreAdminResumen): string {
  return `${DESTINO_LABEL[c.destinoTipo]} · ${c.destinoZonaNombre}`;
}

/** Folio corto y estable del comprobante: los últimos 8 del `cierreId`. */
function folio(cierreId: string): string {
  return cierreId.slice(-8).toUpperCase();
}

/** Fecha ISO → `YYYY-MM-DD` (lo mismo que muestran las tablas). `null` → "—". */
function fecha(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

/* ------------------------------------------------------------------ *
 * Piezas del comprobante
 * ------------------------------------------------------------------ */

/** Bloque `etiqueta / valor` de la cabecera del comprobante. */
function DatoCabecera({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium text-navy">{children}</span>
    </div>
  );
}

/**
 * Renglón de la factura: concepto a la izquierda, monto a la derecha, alineados por
 * una guía punteada. `nota` explica de dónde sale el monto (lo mismo que ya decían
 * las cards del detalle).
 */
function Renglon({
  label,
  value,
  nota,
  emphasis = false,
  tone = "default",
}: Readonly<{
  label: string;
  value: string;
  nota?: string;
  emphasis?: boolean;
  tone?: "default" | "danger";
}>) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
      <span className="flex flex-col gap-0.5">
        <span className={cn("text-sm", emphasis && "font-medium text-navy")}>
          {label}
        </span>
        {nota ? (
          <span className="text-xs text-muted-foreground">{nota}</span>
        ) : null}
      </span>
      {/* Guía punteada: ocupa el hueco entre el concepto y el monto, como en una factura. */}
      <span
        aria-hidden="true"
        className="mt-auto mb-1 h-px min-w-6 flex-1 border-b border-dotted border-border"
      />
      <span
        className={cn(
          "tabular-nums text-sm",
          emphasis && "text-base font-semibold text-navy",
          tone === "danger" && "text-danger-strong",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Grupo de renglones bajo un rótulo de sección del comprobante. En el DETALLE es una
 * `region` accesible con el nombre del bloque (hereda los nombres que exponían los
 * paneles a los que reemplazó); en el resumen se deja sin nombre para no duplicarlos.
 */
function BloqueRenglones({
  titulo,
  children,
  ariaLabel,
}: Readonly<{ titulo: string; children: ReactNode; ariaLabel?: string }>) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col">
      <h4 className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h4>
      <div className="flex flex-col divide-y divide-border/60">{children}</div>
    </section>
  );
}

/** Total de cierre del comprobante, destacado sobre fondo de marca. */
function TotalFactura({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-navy px-4 py-3 text-white">
      <span className="text-sm font-medium uppercase tracking-wider">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** KPI animado del comprobante (contador desde 0, igual que el portal del mensajero). */
function KpiFactura({
  label,
  value,
  moneda = false,
}: Readonly<{ label: string; value: string | number; moneda?: boolean }>) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold text-navy">
        <KpiValorAnimado value={value} moneda={moneda} />
      </span>
    </div>
  );
}

/**
 * Par de conceptos que van SIEMPRE juntos en la misma línea: lo que se le paga al
 * mensajero y lo que la bodega ingresa por rechazos. Son dos caras del mismo movimiento
 * del cierre, así que se leen de corrido en vez de en dos renglones separados.
 */
function ParPagoIngreso({
  pagoMensajero,
  ingresoBodegaRechazos,
}: Readonly<{ pagoMensajero: string; ingresoBodegaRechazos: string }>) {
  return (
    <div className="flex flex-wrap items-stretch gap-3 py-2">
      <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5 rounded-md border border-dashed border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {PAGO_MENSAJERO_LABEL}
        </span>
        <span className="text-base font-semibold tabular-nums text-navy">
          {money(pagoMensajero)}
        </span>
      </div>
      <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5 rounded-md border border-dashed border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {INGRESO_BODEGA_RECHAZOS_LABEL}
        </span>
        <span className="text-base font-semibold tabular-nums text-navy">
          {money(ingresoBodegaRechazos)}
        </span>
      </div>
    </div>
  );
}

/** Cabecera común del comprobante: marca, folio, estado y las partes involucradas. */
function CabeceraFactura({
  cierre,
  acciones,
}: Readonly<{ cierre: CierreAdminResumen; acciones?: ReactNode }>) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-brand">
            Ordenex
          </span>
          <h3 className="text-lg font-semibold text-navy">{FACTURA_TITULO}</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {FACTURA_FOLIO_LABEL} #{folio(cierre.cierreId)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <EstadoCierreBadge estado={cierre.estado} />
          {acciones}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DatoCabecera label={FACTURA_MENSAJERO_LABEL}>
          {cierre.mensajeroNombre}
        </DatoCabecera>
        <DatoCabecera label={FACTURA_DESTINO_LABEL}>
          {destino(cierre)}
        </DatoCabecera>
        <DatoCabecera label={FACTURA_SOLICITADO_LABEL}>
          {fecha(cierre.solicitadoAt)}
        </DatoCabecera>
        <DatoCabecera label={FACTURA_RESUELTO_LABEL}>
          {fecha(cierre.resueltoAt)}
        </DatoCabecera>
      </div>
    </div>
  );
}

/** Envoltorio del comprobante: card con la franja de marca arriba. */
function HojaFactura({
  ariaLabel,
  children,
}: Readonly<{ ariaLabel: string; children: ReactNode }>) {
  return (
    // gap-0/py-0: la card por defecto separa y acolcha sus hijos; acá la franja de
    // marca tiene que pegarse al borde superior y el padding lo pone el cuerpo.
    <Card
      aria-label={ariaLabel}
      role="region"
      className="gap-0 overflow-hidden py-0 shadow-sm"
    >
      <div aria-hidden="true" className="h-1.5 w-full bg-brand" />
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Resumen (cola + histórico) como comprobante
 * ------------------------------------------------------------------ */

export interface CierreFacturaResumenProps {
  cierre: CierreAdminResumen;
  /** Botonera de la fila equivalente en la tabla (Ver / decidir, Destrabar…). */
  acciones?: ReactNode;
}

/**
 * Un cierre de la cola o del histórico leído como comprobante: cabecera con las partes,
 * KPIs animados, el desglose del dinero recibido y el total. Mismos datos que la fila de
 * la tabla, sin nada derivado acá.
 */
export function CierreFacturaResumen({
  cierre,
  acciones,
}: Readonly<CierreFacturaResumenProps>) {
  return (
    <HojaFactura
      ariaLabel={`Comprobante del cierre de ${cierre.mensajeroNombre}`}
    >
      <CabeceraFactura cierre={cierre} acciones={acciones} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiFactura
          label={FACTURA_TOTAL_GENERAL_LABEL}
          value={cierre.totales.general}
          moneda
        />
        <KpiFactura
          label={PAGO_MENSAJERO_LABEL}
          value={cierre.totalPagoMensajero}
          moneda
        />
        <KpiFactura
          label={INGRESO_BODEGA_RECHAZOS_LABEL}
          value={cierre.totalIngresoBodegaRechazos}
          moneda
        />
      </div>

      <BloqueRenglones titulo={FACTURA_RECIBIDO_TITULO}>
        <Renglon label="Efectivo" value={money(cierre.totales.efectivo)} />
        <Renglon label="SINPE" value={money(cierre.totales.simpe)} />
        <Renglon
          label="Transferencia"
          value={money(cierre.totales.transferencia)}
        />
      </BloqueRenglones>

      {/* Pago al mensajero e ingreso de bodega: siempre en la misma línea. */}
      <ParPagoIngreso
        pagoMensajero={cierre.totalPagoMensajero}
        ingresoBodegaRechazos={cierre.totalIngresoBodegaRechazos}
      />

      <TotalFactura
        label={FACTURA_TOTAL_GENERAL_LABEL}
        value={money(cierre.totales.general)}
      />

      {cierre.motivoRechazo ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {FACTURA_MOTIVO_RECHAZO_LABEL}:{" "}
          </span>
          {cierre.motivoRechazo}
        </p>
      ) : null}
    </HojaFactura>
  );
}

/* ------------------------------------------------------------------ *
 * Detalle del cierre como comprobante
 * ------------------------------------------------------------------ */

export interface CierreFacturaDetalleProps {
  cierre: CierreAdminResumen;
  grupos: CierreGrupos;
  totalesIngreso: TotalesIngresoOrdenex;
  desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
  ganancia: string;
  pagoTienda: string;
  /** Abre el visor con la URL FIRMADA de la evidencia (nunca el storage_path). */
  onVerEvidencia?: (url: string) => void;
}

// --- Rótulos de la tabla compacta del detalle (texto separado, i18n-ready) ---
const FILA_GUIA_COL = "Guía";
const FILA_DESTINATARIO_COL = "Destinatario";
const FILA_COBRADO_COL = "Cobrado";
const FILA_RECIBIDO_LABEL = "Recibido";
const FILA_TIENDA_LABEL = "Tienda";
const FILA_MOTIVO_LABEL = "Motivo";
const FILA_NUEVA_FECHA_LABEL = "Nueva fecha";
const FILA_VER_EVIDENCIA = "Ver evidencia";
const FOOTER_RECAUDADO_LABEL = "Total recaudado";
const FOOTER_ENTREGAS_LABEL = "entregas";

/** Tono de la píldora de conteo de cada pestaña, por resultado. */
const TAB_TONO: Record<CierreResultado, "success" | "warning" | "neutral"> = {
  entregada: "success",
  reprogramada: "warning",
  devuelta: "neutral",
  rechazada: "neutral",
  // Feature 158/R18: `incidente` es un cierre EN ERROR. `EstatusBadge` lo pinta `danger`,
  // pero esta píldora no ofrece ese tono; `warning` es el más cercano y lo separa de las
  // salidas rutinarias (devuelta/rechazada), que sí van en neutro.
  incidente: "warning",
};

/**
 * Tarjeta de un total destacado del encabezado del detalle. `tone="success"` es la
 * lectura principal (lo que se le paga a la tienda); el resto va en neutro.
 */
function TarjetaTotal({
  icon,
  label,
  value,
  nota,
  ariaLabel,
  tone = "neutral",
}: Readonly<{
  icon: ReactNode;
  label: string;
  value: string;
  nota?: ReactNode;
  /** Nombre de la `region` accesible; por defecto, la propia etiqueta. */
  ariaLabel?: string;
  tone?: "success" | "neutral";
}>) {
  const esExito = tone === "success";
  return (
    <section
      aria-label={ariaLabel ?? label}
      className={cn(
        // `success/15` y no `success-soft`: el soft es un hex claro fijo sin variante
        // dark, y `success-strong` sí se invierte (quedaría claro sobre claro). El par
        // strong ↔ success/15 es el que trae contraste medido en ambos temas.
        "flex flex-col gap-0.5 rounded-xl px-4 py-3.5",
        esExito ? "bg-success/15" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          esExito ? "text-success-strong" : "text-muted-foreground",
        )}
      >
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-medium tabular-nums",
          esExito ? "text-success-strong" : "text-navy",
        )}
      >
        {value}
      </span>
      {nota ? (
        <span
          className={cn(
            "text-[0.6875rem]",
            esExito ? "text-success-strong/80" : "text-muted-foreground",
          )}
        >
          {nota}
        </span>
      ) : null}
    </section>
  );
}

/** Pestaña de un resultado, con su píldora de conteo. */
function TabResultado({
  resultado,
  count,
  active,
  onSelect,
}: Readonly<{
  resultado: CierreResultado;
  count: number;
  active: boolean;
  onSelect: () => void;
}>) {
  const tonos = {
    success: "bg-success/15 text-success-strong",
    warning: "bg-warning/15 text-warning-strong",
    neutral: "bg-muted text-muted-foreground",
  };
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
        active
          ? "border-navy font-medium text-navy"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {RESULTADO_LABEL[resultado]}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[0.6875rem]",
          tonos[TAB_TONO[resultado]],
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** Un dato del desplegable de una fila: rótulo + valor, o nada si el valor no aplica. */
function DatoFila({
  label,
  value,
  icon,
}: Readonly<{ label?: string; value: ReactNode; icon?: ReactNode }>) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <span className="flex items-center gap-1">
      {icon}
      {label ? <span>{label}: </span> : null}
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

/**
 * Fila compacta de una gestión: guía, destinatario (con remisión y producto debajo),
 * monto a cobrar y total de Ordenex. Al desplegarla aparece el resto de lo que ya
 * mostraba la tabla de esa sección: ubicación, dinero recibido, tienda, los conceptos
 * facturados, el pago al mensajero y —en rechazos— el origen y la evidencia.
 */
function FilaGestion({
  g,
  onVerEvidencia,
}: Readonly<{
  g: CierreDetalleGestion;
  onVerEvidencia?: (url: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const ing = g.ingresoOrdenex ?? null;

  return (
    <div className="mb-2 overflow-hidden rounded-[10px] border border-border">
      <button
        type="button"
        aria-expanded={open}
        // Con snapshot el desplegable ES el desglose de ingreso: conserva ese nombre
        // (el que ya usaban los tests/E2E). Sin snapshot no hay desglose que anunciar.
        aria-label={
          ing
            ? desgloseAriaLabel(g)
            : `Detalle de la orden ${g.numRemision} · ${g.destinatario}`
        }
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[40px_1.4fr_1fr_1fr_24px] items-center gap-2 px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="text-[13px] font-medium text-navy">
          {g.numGuia ?? "—"}
        </span>
        <span className="flex flex-col">
          <span className="text-[13px] text-foreground">{g.destinatario}</span>
          <span className="text-[11px] text-muted-foreground">
            {g.numRemision} · {g.producto}
          </span>
        </span>
        <span className="text-right text-[13px] tabular-nums text-foreground">
          {money(ing?.montoCobrar ?? null)}
        </span>
        <span className="text-right text-[13px] font-medium tabular-nums text-success-strong">
          {money(ing?.total ?? null)}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="px-2 pb-3 pl-12 text-xs text-muted-foreground">
          <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 border-t border-border pt-2.5 sm:grid-cols-2">
            <DatoFila
              value={g.direccion}
              icon={<MapPin size={13} aria-hidden="true" />}
            />
            <DatoFila value={ubicacion(g) || null} />
            <DatoFila
              label={FILA_RECIBIDO_LABEL}
              value={
                g.montoRecibido === null
                  ? null
                  : `${money(g.montoRecibido)}${
                      g.metodoPago ? ` · ${METODO_LABEL[g.metodoPago]}` : ""
                    }`
              }
            />
            <DatoFila label={FILA_TIENDA_LABEL} value={g.tiendaNombre} />
            <DatoFila
              label={FLETE_CON_IVA_LABEL}
              value={ing?.fleteConIva ? money(ing.fleteConIva) : null}
            />
            <DatoFila
              label={COMISION_CON_IVA_LABEL}
              value={ing?.comisionConIva ? money(ing.comisionConIva) : null}
            />
            <DatoFila
              label={FLETE_DEV_CON_IVA_LABEL}
              value={
                ing?.fleteDevolucionConIva
                  ? money(ing.fleteDevolucionConIva)
                  : null
              }
            />
            {/* `renderPagoMensajero` y no `money()`: trae consigo el badge "Sin tarifa"
                (56/R23) cuando el pago se resolvió sin tarifa vigente. */}
            <DatoFila
              label={PAGO_MENSAJERO_LABEL}
              value={g.pagoMensajero === null ? null : renderPagoMensajero(g)}
            />
            <DatoFila
              label={FILA_NUEVA_FECHA_LABEL}
              value={g.fechaReprogramacion}
            />
            <DatoFila label={FILA_MOTIVO_LABEL} value={g.motivo} />
            {g.resultado === "rechazada" ? (
              <>
                <DatoFila
                  label={INGRESO_BODEGA_RECHAZOS_LABEL}
                  value={
                    g.ingresoBodegaRechazo === null
                      ? null
                      : money(g.ingresoBodegaRechazo)
                  }
                />
                <span className="flex items-center gap-1">
                  {g.esRechazoSla ? (
                    <Badge
                      variant="secondary"
                      title={RECHAZO_SLA_BADGE_NOTA}
                      aria-label={RECHAZO_SLA_BADGE_NOTA}
                    >
                      {RECHAZO_SLA_BADGE_LABEL}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      title={RECHAZO_MANUAL_BADGE_NOTA}
                      aria-label={RECHAZO_MANUAL_BADGE_NOTA}
                    >
                      {RECHAZO_MANUAL_BADGE_LABEL}
                    </Badge>
                  )}
                </span>
              </>
            ) : null}
            {g.evidenciaUrl && onVerEvidencia ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-fit"
                aria-label={`${FILA_VER_EVIDENCIA} de la orden ${g.numRemision} · ${g.destinatario}`}
                onClick={() => onVerEvidencia(g.evidenciaUrl as string)}
              >
                {FILA_VER_EVIDENCIA}
              </Button>
            ) : null}
          </div>

          {/* Desglose auditable de la orden: de qué tarifa CONGELADA salió cada monto y
              con qué fórmula. Es lo que antes vivía en la fila desplegable de la tabla. */}
          {ing ? (
            <div className="mt-3 border-t border-border pt-2.5">
              <DesgloseIngresoOrdenex g={g} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * El detalle del cierre leído como documento: los dos totales de cabecera (pago a
 * tienda e ingreso por rechazos), la liquidación completa (bruto − pago = ganancia /
 * deuda) y las órdenes en pestañas por resultado, cada una desplegable. Todos los
 * montos vienen derivados server-side; acá solo se ordenan y se rotulan.
 */
export function CierreFacturaDetalle({
  cierre,
  grupos,
  totalesIngreso,
  desgloseIngresoBodegaRechazos,
  ganancia,
  pagoTienda,
  onVerEvidencia,
}: Readonly<CierreFacturaDetalleProps>) {
  const gananciaNegativa = esMontoNegativo(ganancia);
  const ordenes = ORDEN_RESULTADOS.reduce(
    (total, resultado) => total + (grupos[resultado]?.length ?? 0),
    0,
  );
  // Arranca en la primera sección CON órdenes: abrir en una pestaña vacía no dice nada.
  const [tab, setTab] = useState<CierreResultado>(
    ORDEN_RESULTADOS.find((r) => (grupos[r]?.length ?? 0) > 0) ?? "entregada",
  );
  const filas = grupos[tab] ?? [];

  return (
    <HojaFactura
      ariaLabel={`Comprobante detallado del cierre de ${cierre.mensajeroNombre}`}
    >
      {/* Encabezado: estado + de quién es el cierre y a qué bodega va. */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-medium text-navy">
              {FACTURA_TITULO}
            </span>
            <EstadoCierreBadge estado={cierre.estado} />
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Warehouse size={15} aria-hidden="true" />
            {destino(cierre)} · {FACTURA_MENSAJERO_LABEL}{" "}
            {cierre.mensajeroNombre}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono">
            {FACTURA_FOLIO_LABEL} #{folio(cierre.cierreId)}
          </span>
          <span>
            {FACTURA_SOLICITADO_LABEL} {fecha(cierre.solicitadoAt)} ·{" "}
            {FACTURA_RESUELTO_LABEL} {fecha(cierre.resueltoAt)}
          </span>
        </div>
      </div>

      {/* Los dos totales de cabecera de la referencia. */}
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <TarjetaTotal
          tone="success"
          icon={<Store size={15} aria-hidden="true" />}
          label={PAGO_TIENDA_LABEL}
          value={money(pagoTienda)}
          nota={PAGO_TIENDA_NOTA}
        />
        <TarjetaTotal
          icon={<Undo2 size={15} aria-hidden="true" />}
          label={INGRESO_BODEGA_RECHAZOS_LABEL}
          ariaLabel="Ingreso de bodega por rechazos del cierre"
          value={money(desgloseIngresoBodegaRechazos.total)}
          // Feature 102/R8: las dos sublíneas del desglose por origen, cada rótulo en su
          // propio elemento (el total NO se recomputa acá: `sla + manual === total`).
          nota={
            <span className="flex flex-wrap items-center gap-x-1">
              <span>{INGRESO_BODEGA_RECHAZOS_SLA_LABEL}</span>
              <b className="font-medium tabular-nums">
                {money(desgloseIngresoBodegaRechazos.sla)}
              </b>
              <span aria-hidden="true">·</span>
              <span>{INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL}</span>
              <b className="font-medium tabular-nums">
                {money(desgloseIngresoBodegaRechazos.manual)}
              </b>
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiFactura
          label={FACTURA_TOTAL_GENERAL_LABEL}
          value={cierre.totales.general}
          moneda
        />
        <KpiFactura
          label={INGRESO_TOTAL_LABEL}
          value={totalesIngreso.total}
          moneda
        />
        <KpiFactura
          label={PAGO_MENSAJERO_LABEL}
          value={cierre.totalPagoMensajero}
          moneda
        />
        <KpiFactura label={FACTURA_ORDENES_KPI_LABEL} value={ordenes} />
      </div>

      <BloqueRenglones
        titulo={FACTURA_RECIBIDO_TITULO}
        ariaLabel={FACTURA_RECIBIDO_TITULO}
      >
        <Renglon label="Efectivo" value={money(cierre.totales.efectivo)} />
        <Renglon label="SINPE" value={money(cierre.totales.simpe)} />
        <Renglon
          label="Transferencia"
          value={money(cierre.totales.transferencia)}
        />
        <Renglon
          label={FACTURA_TOTAL_GENERAL_LABEL}
          value={money(cierre.totales.general)}
          emphasis
        />
      </BloqueRenglones>

      <BloqueRenglones titulo={INGRESO_PANEL_LABEL} ariaLabel={INGRESO_PANEL_LABEL}>
        <Renglon
          label={FLETE_CON_IVA_LABEL}
          value={money(totalesIngreso.fleteConIva)}
        />
        <Renglon
          label={COMISION_CON_IVA_LABEL}
          value={money(totalesIngreso.comisionConIva)}
        />
        <Renglon
          label={FLETE_DEV_CON_IVA_LABEL}
          value={money(totalesIngreso.fleteDevolucionConIva)}
        />
        <Renglon
          label={INGRESO_TOTAL_LABEL}
          value={money(totalesIngreso.total)}
          emphasis
        />
      </BloqueRenglones>

      <BloqueRenglones
        titulo={FACTURA_LIQUIDACION_TITULO}
        ariaLabel={FACTURA_LIQUIDACION_TITULO}
      >
        <Renglon
          label={INGRESO_BRUTO_LABEL}
          nota={INGRESO_BRUTO_NOTA}
          value={money(totalesIngreso.total)}
        />
        {/* La ganancia solo aparece cuando es NEGATIVA: ahí Ordenex pagó al mensajero
            más de lo que facturó, así que es una DEUDA ("Debe") y va en rojo. Si es ≥ 0
            no se pinta (misma regla que tenían las cards a las que reemplazó). El pago a
            tienda tampoco se repite acá: ya es la tarjeta principal de la cabecera. */}
        {gananciaNegativa ? (
          <Renglon
            label={GANANCIA_DEBE_LABEL}
            nota={GANANCIA_NOTA}
            value={money(ganancia)}
            emphasis
            tone="danger"
          />
        ) : null}
      </BloqueRenglones>

      {/* Pago al mensajero e ingreso de bodega: siempre en la misma línea (el desglose
          por origen del ingreso ya vive en la tarjeta de cabecera). */}
      <ParPagoIngreso
        pagoMensajero={cierre.totalPagoMensajero}
        ingresoBodegaRechazos={desgloseIngresoBodegaRechazos.total}
      />

      {/* Órdenes en pestañas por resultado, cada fila desplegable. */}
      <section aria-label={FACTURA_ORDENES_TITULO} className="flex flex-col">
        <div role="tablist" className="flex gap-1.5 border-b border-border">
          {ORDEN_RESULTADOS.map((resultado) => (
            <TabResultado
              key={resultado}
              resultado={resultado}
              count={grupos[resultado]?.length ?? 0}
              active={tab === resultado}
              onSelect={() => setTab(resultado)}
            />
          ))}
        </div>

        {/* La sección activa conserva el nombre accesible que tenía su tabla
            ("Entregadas", "Rechazadas"…): es como la localizan los tests y el E2E. */}
        <section aria-label={RESULTADO_LABEL[tab]} className="pt-2">
          <div className="grid grid-cols-[40px_1.4fr_1fr_1fr_24px] gap-2 px-2 py-1 text-[11px] text-muted-foreground">
            <span>{FILA_GUIA_COL}</span>
            <span>{FILA_DESTINATARIO_COL}</span>
            <span className="text-right">{FILA_COBRADO_COL}</span>
            <span className="text-right">{INGRESO_TOTAL_LABEL}</span>
            <span />
          </div>
          {filas.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {RESULTADO_VACIO[tab]}
            </p>
          ) : (
            filas.map((g) => (
              <FilaGestion
                key={g.gestionId}
                g={g}
                onVerEvidencia={onVerEvidencia}
              />
            ))
          )}
        </section>
      </section>

      {/* Pie: lo recaudado del cierre y cuántas entregas lo produjeron. */}
      <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/50 px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {FOOTER_RECAUDADO_LABEL}{" "}
          <b className="font-medium text-navy tabular-nums">
            {money(cierre.totales.general)}
          </b>{" "}
          · {grupos.entregada?.length ?? 0} {FOOTER_ENTREGAS_LABEL}
        </span>
        {cierre.motivoRechazo ? (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {FACTURA_MOTIVO_RECHAZO_LABEL}:{" "}
            </span>
            {cierre.motivoRechazo}
          </span>
        ) : null}
      </div>
    </HojaFactura>
  );
}
