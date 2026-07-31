"use client";

import { useState, type ReactNode } from "react";
import {
  Calendar,
  ChevronDown,
  MapPin,
  Store,
  Undo2,
  User,
  Warehouse,
} from "lucide-react";

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
const FACTURA_SOLICITADO_LABEL = "Solicitado";
const FACTURA_RESUELTO_LABEL = "Resuelto";
// Conserva el nombre del panel al que reemplazó: es el que localizan los tests y el E2E.
const FACTURA_RECIBIDO_TITULO = "Totales del cierre";
const FACTURA_LIQUIDACION_TITULO = "Liquidación";
const FACTURA_ORDENES_TITULO = "Órdenes del cierre";
const FACTURA_TOTAL_GENERAL_LABEL = "Total general";
const FACTURA_MOTIVO_RECHAZO_LABEL = "Motivo de rechazo";
const FACTURA_ORDENES_KPI_LABEL = "Órdenes";
// --- Rótulos de la tarjeta compacta del resumen ---
const RESUMEN_TOTAL_LABEL = "Total";
const RESUMEN_VER_DETALLES = "Ver detalles";
const RESUMEN_OCULTAR_DETALLES = "Ocultar";
const RESUMEN_METODOS_TITULO = "Desglose por método";
const RESUMEN_AJUSTES_TITULO = "Ajustes";
const RESUMEN_FECHAS_TITULO = "Fechas";

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

/** Envoltorio del comprobante: card con la franja de marca arriba. */
function HojaFactura({
  ariaLabel,
  children,
}: Readonly<{ ariaLabel: string; children: ReactNode }>) {
  return (
    // gap-0/py-0: la card por defecto separa y acolcha sus hijos; acá la franja de
    // marca tiene que pegarse al borde superior y el padding lo pone el cuerpo.
    //
    // min-h-0 + overflow-y-auto: dentro del modal esta card es un flex item de un
    // contenedor con `max-h`. El `overflow-hidden` que trae `Card` por defecto ya le
    // fijaba `min-height: 0` (regla de tamaño mínimo automático de flexbox), así que
    // en vez de desbordar el contenedor -y hacerlo scrollear- la card se ENCOGÍA y
    // recortaba el comprobante sin dejar barra. Con `overflow-y-auto` el mismo encogido
    // ahora produce scroll dentro de la card; `overflow-x-hidden` conserva el recorte
    // horizontal que redondea las esquinas. Fuera del modal no hay `max-h`, la card
    // crece con su contenido y esto no cambia nada.
    <Card
      aria-label={ariaLabel}
      role="region"
      className="min-h-0 gap-0 overflow-x-hidden overflow-y-auto py-0 shadow-sm"
    >
      <div aria-hidden="true" className="h-1.5 w-full shrink-0 bg-brand" />
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Resumen (cola + histórico) como comprobante
 * ------------------------------------------------------------------ */

/**
 * ¿El monto STRING es cero? Comparación TEXTUAL ("0", "0.00"), no aritmética: sirve para
 * apagar visualmente un renglón sin romper el money-safe (nada de `Number`/`parseFloat`).
 */
function esMontoCero(monto: string): boolean {
  return /^-?0(\.0+)?$/.test(monto.trim());
}

/** Renglón `concepto ..... monto` del desplegable compacto. El monto en cero va apagado. */
function LineaMonto({
  label,
  monto,
  ultima = false,
}: Readonly<{ label: string; monto: string; ultima?: boolean }>) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 py-1 text-[13px]",
        !ultima && "border-b border-dashed border-border",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          esMontoCero(monto)
            ? "text-muted-foreground"
            : "font-medium text-navy",
        )}
      >
        {money(monto)}
      </span>
    </div>
  );
}

/** Rótulo de una columna del desplegable compacto. */
function TituloColumna({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

/** Dato `rótulo / valor` de la columna de fechas. */
function LineaFecha({
  label,
  value,
  ultima = false,
}: Readonly<{ label: string; value: string; ultima?: boolean }>) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 py-1 text-[13px]",
        !ultima && "border-b border-dashed border-border",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-navy tabular-nums">{value}</span>
    </div>
  );
}

export interface CierreFacturaResumenProps {
  cierre: CierreAdminResumen;
  /** Botonera de la fila equivalente en la tabla (Ver / decidir, Destrabar…). */
  acciones?: ReactNode;
}

/**
 * Un cierre de la cola o del histórico leído como comprobante COMPACTO: una cabecera de
 * dos líneas —marca, folio, estado, las partes y el total— y el desglose (métodos,
 * ajustes, fechas) detrás de un desplegable. Mismos datos que la fila de la tabla, sin
 * nada derivado acá: los montos llegan STRING y se muestran con `money()`.
 *
 * Lo que NO se esconde tras el desplegable, a propósito: la botonera `acciones` (es la
 * decisión del cierre, no un detalle) y el motivo de rechazo (explica el estado). El
 * toggle se renderiza UNA sola vez y se reordena por CSS: duplicarlo por breakpoint
 * duplicaría también los nombres accesibles de los botones.
 */
export function CierreFacturaResumen({
  cierre,
  acciones,
}: Readonly<CierreFacturaResumenProps>) {
  const [open, setOpen] = useState(false);

  return (
    // gap-0/py-0: el padding lo ponen la cabecera y el panel; la franja de marca es el
    // borde superior de la card, así que no hay hueco que separar.
    <Card
      aria-label={`Comprobante del cierre de ${cierre.mensajeroNombre}`}
      role="region"
      className="gap-0 overflow-hidden border-t-[3px] border-t-brand py-0 shadow-sm"
    >
      <div className="flex flex-col gap-2.5 px-4 py-3.5 md:gap-2 md:px-5">
        {/* Línea 1: marca · título · folio · estado — y a la derecha acciones + toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
              Ordenex
            </span>
            <span className="text-base font-semibold text-navy">
              {FACTURA_TITULO}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              #{folio(cierre.cierreId)}
            </span>
            <EstadoCierreBadge estado={cierre.estado} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {acciones}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={open}
              aria-label={`${
                open ? RESUMEN_OCULTAR_DETALLES : RESUMEN_VER_DETALLES
              } del cierre de ${cierre.mensajeroNombre}`}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? RESUMEN_OCULTAR_DETALLES : RESUMEN_VER_DETALLES}
              <ChevronDown
                size={15}
                aria-hidden="true"
                className={cn("transition-transform", open && "rotate-180")}
              />
            </Button>
          </div>
        </div>

        {/* Línea 2: las partes involucradas — y el total del cierre. */}
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <User size={14} aria-hidden="true" />
              {cierre.mensajeroNombre}
            </span>
            <span aria-hidden="true" className="hidden text-border md:inline">
              |
            </span>
            <span className="flex items-center gap-1">
              <Warehouse size={14} aria-hidden="true" />
              {destino(cierre)}
            </span>
            <span aria-hidden="true" className="hidden text-border md:inline">
              |
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={14} aria-hidden="true" />
              {fecha(cierre.solicitadoAt)}
            </span>
          </div>

          <div className="flex items-baseline gap-2 whitespace-nowrap md:justify-end">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:text-[11px]">
              {RESUMEN_TOTAL_LABEL}
            </span>
            <span className="text-[20px] font-semibold text-navy tabular-nums md:text-[22px]">
              <KpiValorAnimado value={cierre.totales.general} moneda />
            </span>
          </div>
        </div>

        {/* El motivo explica el estado: no se esconde tras el desplegable. */}
        {cierre.motivoRechazo ? (
          <p className="text-[12.5px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {FACTURA_MOTIVO_RECHAZO_LABEL}:{" "}
            </span>
            {cierre.motivoRechazo}
          </p>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-border bg-muted/50 px-4 py-4 md:px-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_1fr_1fr] md:gap-5">
            <section aria-label={FACTURA_RECIBIDO_TITULO}>
              <TituloColumna>{RESUMEN_METODOS_TITULO}</TituloColumna>
              <LineaMonto label="Efectivo" monto={cierre.totales.efectivo} />
              <LineaMonto label="SINPE" monto={cierre.totales.simpe} />
              <LineaMonto
                label="Transferencia"
                monto={cierre.totales.transferencia}
                ultima
              />
            </section>

            <section aria-label={RESUMEN_AJUSTES_TITULO}>
              <TituloColumna>{RESUMEN_AJUSTES_TITULO}</TituloColumna>
              <LineaMonto
                label={PAGO_MENSAJERO_LABEL}
                monto={cierre.totalPagoMensajero}
              />
              <LineaMonto
                label={INGRESO_BODEGA_RECHAZOS_LABEL}
                monto={cierre.totalIngresoBodegaRechazos}
                ultima
              />
            </section>

            <section aria-label={RESUMEN_FECHAS_TITULO}>
              <TituloColumna>{RESUMEN_FECHAS_TITULO}</TituloColumna>
              <LineaFecha
                label={FACTURA_SOLICITADO_LABEL}
                value={fecha(cierre.solicitadoAt)}
              />
              <LineaFecha
                label={FACTURA_RESUELTO_LABEL}
                value={fecha(cierre.resueltoAt)}
                ultima
              />
            </section>
          </div>
        </div>
      ) : null}
    </Card>
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
