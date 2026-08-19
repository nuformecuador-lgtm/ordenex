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
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  CierrePasadoDTO,
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
// Feature 213 (T6/T7): el desglose de pago se formatea en UN solo sitio (R25).
import { desglosePantalla } from "./desglose-pago";

// Vista TIPO FACTURA de un cierre (exploración de UX, feature 38/40). Es una lectura
// alternativa de los MISMOS datos que ya pintan las tablas: el resumen de la cola /
// histórico como comprobante, y el detalle del cierre como documento con sus renglones
// y su liquidación. No hay datos nuevos ni cálculos: todos los montos llegan como STRING
// derivados server-side (money-safe) y se muestran con `money()`.
//
// EXCEPCIÓN CONSCIENTE al money-safe: los KPIs superiores usan `KpiValorAnimado`
// (react-countup), que sí parsea el monto a número para poder animarlo desde 0. Es
// presentación pura y el valor exacto sigue estando en los renglones y en las tablas.
//
// ==============================================================================
// LA HOJA GIRA CON EL TEMA, Y EN PAPEL SALE BLANCA (feature 217)
// ==============================================================================
// Las dos hojas de este archivo —`HojaFactura` (el detalle) y `HojaResumen` (el
// comprobante compacto)— son una superficie más del portal: en oscuro se pintan
// oscuras, sobre `bg-card`, como cualquier otra tarjeta. Al IMPRIMIR vuelven a los
// valores claros, y eso lo hace la clase `papel-al-imprimir` que llevan sus `<Card>`.
//
// Esto REVIERTE una decisión anterior, no arregla un olvido. Hasta la 217 las dos
// hojas se fijaban a los valores claros con un pin en su `<Card>` («la hoja es papel»)
// y su tinta eran 16 utilidades de valor fijo. El pedido humano del 2026-08-13 cambió
// esa decisión: la hoja gira, y al imprimir sigue saliendo blanca.
// `progress/impl_208_modo-oscuro.md` describe la decisión ANTERIOR y no se edita: es
// una foto de lo que era cierto ese día, como un `down.sql`.
//
// POR QUÉ LA IMPRESIÓN FIJA TOKENS Y NO PINTA UN FONDO. Es la medición de la 208
// girada de lado. Dentro de la hoja hay 143 textos: los tokens que GIRAN
// (`muted-foreground`, `border`, `card-foreground`, los cuatro `-strong`, `Badge`,
// `Button`…) son la inmensa mayoría. Medido en su momento sobre el detalle en oscuro:
//     sin tocar nada .................... 20 textos por debajo de 4.5:1
//     con `bg-white` a secas ............ 116 por debajo de 4.5:1   ← PEOR
// Pintar el papel y dejar la tinta del tema mueve el bug de 16 sitios a 116. Por eso la
// regla de impresión (`app/globals.css`, bloque `@media print`) fija los TOKENS —papel,
// tinta, bordes, muted y los cuatro `-strong`— en vez de pintar un fondo. Y hay un
// motivo más duro: los navegadores no imprimen los fondos salvo que el usuario marque
// «gráficos de fondo», que viene DESMARCADO; sin fijar la tinta, imprimir desde tema
// oscuro daría casi-blanco sobre un fondo que no se imprime, es decir, la hoja saldría
// EN BLANCO.
//
// LO QUE LA REGLA DE IMPRESIÓN **NO** APAGA, Y POR QUÉ SE ACEPTA. El variant `dark:` de
// Tailwind se resuelve contra el ANCESTRO (`&:is(.dark *)`), no contra los tokens: al
// imprimir desde tema oscuro, las utilidades `dark:` de las primitivas (`Badge`,
// `Button`) siguen disparando dentro de la hoja. NO es una regresión: «tokens claros +
// `dark:` disparando» es exactamente lo que la hoja mostraba en pantalla ANTES de esta
// feature, así que el resultado impreso es el statu quo. El arreglo de raíz —envolver
// las dos ramas de `@custom-variant dark` en `@media not print`— cambia el
// comportamiento de impresión de TODA la app y sale a ficha propia; no se parchea acá.
//
// EL FLUJO DE IMPRESIÓN YA EXISTE, Y ES LA FEATURE 223. Este párrafo decía, con razón en
// su momento, que no había `@page`, ni márgenes, ni paginación, ni ocultamiento del resto
// de la interfaz, y que por eso la hoja salía recortada dentro del modal. Eso dejó de ser
// cierto: el bloque `@media print` del flujo vive en `app/globals.css`, justo debajo del
// de color de la 217, y su guardia es
// `tests/unit/guards/impresion-flujo.guardia.test.ts`.
//
// LO QUE SIGUE SIENDO CIERTO, y no cambia: **no hay botón** y **no se llama a la API de
// impresión del navegador**. La única forma de imprimir sigue siendo Ctrl+P (decisión
// humana, tomada dos veces). Lo que la 223 añadió es CSS puro.
//
// LO QUE SIGUE SIN CUBRIRSE, dicho para que nadie lo lea como un olvido: al papel va sólo
// lo que está montado. Las filas plegadas y las CUATRO pestañas no visitadas no están en
// el DOM y no se imprimen; traerlas exige cambiar qué se monta y es decisión de producto,
// no de CSS. Está declarado junto al bloque, en `app/globals.css`.
//
// LO QUE SÍ HAY QUE MIRAR AL AÑADIR ALGO A LA HOJA. Cualquier pieza nueva con color
// propio: la guardia `tests/unit/guards/factura-contraste.guardia.test.ts` mantiene el
// inventario CERRADO de pares (tinta, fondo) de las dos hojas y se pone roja si aparece
// una utilidad de color que no mapee a un par medido. Una utilidad de valor fijo (que
// no gire con el tema) también la caza. La deuda de paleta de las primitivas es de las
// fichas 210/216 y se arregla en ellas, para toda la app, no con clases locales acá.

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

/** Destino legible de un cierre (tipo + zona, si se conoce el nombre de la zona). */
function destino(c: { destinoTipo: CierreDestinoTipo; destinoZonaNombre?: string }): string {
  const tipo = DESTINO_LABEL[c.destinoTipo];
  return c.destinoZonaNombre ? `${tipo} · ${c.destinoZonaNombre}` : tipo;
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
        <span className={cn("text-sm", emphasis && "font-medium text-foreground")}>
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
          emphasis && "text-base font-semibold text-foreground",
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
    // `break-inside-avoid` (feature 223, pieza 2 de 5): un renglón `concepto ….. monto`
    // partido por un salto de página es ilegible —el concepto queda en una hoja y su monto
    // en la siguiente—. Es inerte fuera de un medio paginado: en pantalla no hace nada.
    <section aria-label={ariaLabel} className="flex break-inside-avoid flex-col">
      <h4 className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h4>
      <div className="flex flex-col divide-y divide-border/60">{children}</div>
    </section>
  );
}

/**
 * KPI animado del comprobante (contador desde 0, igual que el portal del mensajero).
 *
 * ⚠️ LÍMITE CONOCIDO AL IMPRIMIR (feature 223, D6). El valor se ANIMA al montar
 * (`KpiValorAnimado` cuenta desde 0 hasta la cifra real), así que **una impresión disparada
 * dentro de esa ventana de milisegundos puede llevar al papel una cifra INTERMEDIA** — un
 * número que no es el del cierre. La ventana es corta y hace falta pulsar Ctrl+P justo al
 * abrir la hoja, pero el caso existe.
 *
 * No se arregla aquí, y no es pereza: quitar la animación al imprimir toca el DOM de la
 * hoja, y el DOM de la hoja lo vigila el inventario CERRADO de pares de la 217
 * (`tests/unit/guards/factura-contraste.guardia.test.ts`), que se pondría rojo por un
 * cambio que no es de color. Sale a ficha propia.
 *
 * Queda escrito porque un límite conocido y no escrito es indistinguible de un bug que
 * nadie ha visto todavía: el monto exacto, STRING y money-safe, sigue estando en los
 * renglones y en las tablas, que es donde se compara.
 */
function KpiFactura({
  label,
  value,
  moneda = false,
}: Readonly<{ label: string; value: string | number; moneda?: boolean }>) {
  return (
    // `break-inside-avoid` (feature 223, pieza 3 de 5): la TARJETA, no la rejilla que las
    // agrupa. Partida, el rótulo («Total general») queda en una página y su cifra en la
    // siguiente: eso es un dato roto. Partir la rejilla, en cambio, corta ENTRE tarjetas, que
    // es un corte natural. El criterio es el efecto sobre el documento, no el tamaño del
    // bloque. Ver la nota de la lista congelada en `impresion-flujo.guardia.test.ts`.
    <div className="flex break-inside-avoid flex-col gap-0.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold text-foreground">
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
        <span className="text-base font-semibold tabular-nums text-foreground">
          {money(pagoMensajero)}
        </span>
      </div>
      <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5 rounded-md border border-dashed border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {INGRESO_BODEGA_RECHAZOS_LABEL}
        </span>
        <span className="text-base font-semibold tabular-nums text-foreground">
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
    // `shrink-0`: dentro del modal esta card es un flex item de un contenedor con
    // `max-h`. Sin esto flexbox la ENCOGE para que quepa —y con varias hojas (el cierre
    // de bodega pinta una por cada cierre_dia) cada una quedaba reducida a su encabezado
    // y sus KPIs, sin barra propia que dejara ver el resto—. Con `shrink-0` cada hoja
    // conserva su alto natural y quien scrollea es el contenedor del modal, que para eso
    // tiene su `overflow-y-auto`. `overflow-hidden` (el de `Card`) conserva el recorte
    // que redondea las esquinas. Fuera del modal no hay `max-h` y esto no cambia nada.
    //
    // `papel-al-imprimir`: en pantalla la hoja gira con el tema; al IMPRIMIR vuelve a los
    // valores claros. Ver la nota grande de la cabecera del archivo.
    //
    // `hoja-imprimible` (feature 223): marca esta hoja como CANDIDATA a ser el documento que
    // se imprime. La lleva SIEMPRE, porque el detalle es un comprobante completo por sí
    // mismo. Cuál de las candidatas acaba en el papel no lo dice la clase: lo decide el
    // contexto, y una hoja dentro de un diálogo gana (`app/globals.css`, bloque del flujo).
    <Card
      aria-label={ariaLabel}
      role="region"
      className="hoja-imprimible papel-al-imprimir shrink-0 gap-0 py-0 shadow-sm"
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
            : "font-medium text-foreground",
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
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export interface CierreFacturaResumenProps {
  cierre: CierreAdminResumen;
  /** Botonera de la fila equivalente en la tabla (Ver / decidir, Destrabar…). */
  acciones?: ReactNode;
  /**
   * Rótulo extra junto al estado. Lo usa el histórico para marcar que un `rechazado` es
   * BLOQUEANTE hasta que el mensajero re-solicite (feature 109/R31): el badge de estado
   * solo dice "Rechazado", que se lee como cerrado.
   */
  rotulo?: ReactNode;
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
  rotulo,
}: Readonly<CierreFacturaResumenProps>) {
  return (
    <HojaResumen
      titulo={FACTURA_TITULO}
      ariaLabel={`Comprobante del cierre de ${cierre.mensajeroNombre}`}
      toggleSufijo={`del cierre de ${cierre.mensajeroNombre}`}
      folio={folio(cierre.cierreId)}
      estado={cierre.estado}
      rotulo={rotulo}
      acciones={acciones}
      partes={[
        { icon: <User size={14} aria-hidden="true" />, texto: cierre.mensajeroNombre },
        { icon: <Warehouse size={14} aria-hidden="true" />, texto: destino(cierre) },
        { icon: <Calendar size={14} aria-hidden="true" />, texto: fecha(cierre.solicitadoAt) },
      ]}
      totales={cierre.totales}
      totalPagoMensajero={cierre.totalPagoMensajero}
      totalIngresoBodegaRechazos={cierre.totalIngresoBodegaRechazos}
      solicitadoAt={cierre.solicitadoAt}
      resueltoAt={cierre.resueltoAt}
      motivoRechazo={cierre.motivoRechazo}
    />
  );
}

/** Una parte involucrada en el cierre, tal como se lista en la segunda línea. */
interface ParteComprobante {
  icon: ReactNode;
  texto: string;
}

interface HojaResumenProps {
  titulo: string;
  ariaLabel: string;
  /** Cola del nombre accesible del toggle ("Ver detalles <sufijo>"). */
  toggleSufijo: string;
  folio: string;
  /**
   * Ausente en un comprobante que NO tiene estado propio que mostrar: el `cierre_dia`
   * consolidable es `aprobado` por definición del listado (40/R5), y pintar ese badge en cada
   * tarjeta sería repetir el criterio de la consulta como si fuera un dato del cierre.
   */
  estado?: CierreAdminResumen["estado"];
  rotulo?: ReactNode;
  acciones?: ReactNode;
  partes: ParteComprobante[];
  totales: CierreAdminResumen["totales"];
  totalPagoMensajero: string;
  totalIngresoBodegaRechazos: string;
  /** Ausente cuando el DTO del listado no las trae (consolidables): la columna no se pinta. */
  solicitadoAt?: string;
  resueltoAt?: string | null;
  motivoRechazo?: string | null;
  /** Datos propios del comprobante (p. ej. cuántos cierres del día consolida). */
  extra?: ReactNode;
  /**
   * Para quién se pinta la hoja compacta, con el MISMO criterio que el detalle (design §7.2):
   * en la vista del `mensajero` se cae el ingreso de bodega por rechazos —plata de la empresa,
   * no suya— y su pago se rotula «Ganancia», como el resto de su pantalla.
   *
   * Importa más aquí que en el detalle, y por eso está escrito: en una TARJETA el desglose
   * llega detrás de un desplegable, así que un dato que no le toca no se ve al primer vistazo
   * —se ve al segundo—, que es exactamente la forma en que estas fugas pasan desapercibidas.
   */
  audiencia?: CierreFacturaAudiencia;
}

/**
 * La hoja compacta en sí, sin saber de qué cierre habla. La comparten el comprobante de
 * un cierre de MENSAJERO y el de un cierre de BODEGA: cambian las partes involucradas y
 * el título, pero la estructura (marca, folio, estado, total, desplegable con métodos /
 * ajustes / fechas) es la misma y no tiene por qué existir dos veces.
 */
function HojaResumen({
  titulo,
  ariaLabel,
  toggleSufijo,
  folio: numeroFolio,
  estado,
  rotulo,
  acciones,
  partes,
  totales,
  totalPagoMensajero,
  totalIngresoBodegaRechazos,
  solicitadoAt,
  resueltoAt,
  motivoRechazo,
  extra,
  audiencia = "admin",
}: Readonly<HojaResumenProps>) {
  const [open, setOpen] = useState(false);
  // Design §7.2: en la hoja del mensajero no entra la plata de la empresa.
  const esMensajero = audiencia === "mensajero";

  return (
    // gap-0/py-0: el padding lo ponen la cabecera y el panel; la franja de marca es el
    // borde superior de la card, así que no hay hueco que separar.
    //
    // `papel-al-imprimir`: mismo comportamiento que `HojaFactura`. Esta hoja es el MISMO
    // comprobante en compacto (su nombre accesible lo dice: "Comprobante del cierre
    // de…"), y abrirla lleva justo a la otra: si una girara con el tema y la otra no, el
    // mismo documento tendría dos materiales. Ver la nota de la cabecera.
    //
    // `hoja-imprimible` CONDICIONADA a `open` (feature 223): esta hoja sólo es candidata a
    // imprimirse mientras su desglose está desplegado, y no es un truco para poder elegir
    // una: PLEGADA NO ES UN DOCUMENTO. Sus tres bloques —métodos, ajustes y fechas— se
    // montan con `{open ? … : null}` aquí abajo, así que plegada le falta la mitad de los
    // datos e imprimirla emitiría un comprobante incompleto. Es la misma regla que hace que
    // las filas plegadas del detalle no salgan al papel: lo que no está en el DOM no se
    // imprime. De rebote resuelve la designación sin inventar un gesto nuevo — desplegar ya
    // era el acto por el que alguien dice «ésta me interesa».
    <Card
      aria-label={ariaLabel}
      role="region"
      className={cn(
        "papel-al-imprimir gap-0 overflow-hidden border-t-[3px] border-t-brand py-0 shadow-sm",
        open && "hoja-imprimible",
      )}
    >
      <div className="flex flex-col gap-2.5 px-4 py-3.5 md:gap-2 md:px-5">
        {/* Línea 1: marca · título · folio · estado — y a la derecha acciones + toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
              Ordenex
            </span>
            <span className="text-base font-semibold text-foreground">{titulo}</span>
            <span className="font-mono text-xs text-muted-foreground">
              #{numeroFolio}
            </span>
            {estado ? <EstadoCierreBadge estado={estado} /> : null}
            {rotulo}
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
              } ${toggleSufijo}`}
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
            {partes.map((parte, i) => (
              <span key={parte.texto} className="flex items-center gap-3.5">
                {i > 0 ? (
                  <span aria-hidden="true" className="hidden text-border md:inline">
                    |
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  {parte.icon}
                  {parte.texto}
                </span>
              </span>
            ))}
          </div>

          <div className="flex items-baseline gap-2 whitespace-nowrap md:justify-end">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:text-[11px]">
              {RESUMEN_TOTAL_LABEL}
            </span>
            {/* Sin contador animado: esto es una FILA de la lista de cierres. Animar el
                total en cada tarjeta pondría a correr un contador por cierre en pantalla,
                y además el valor exacto (STRING) es lo que se compara con la tabla. */}
            <span className="text-[20px] font-semibold text-foreground tabular-nums md:text-[22px]">
              {money(totales.general)}
            </span>
          </div>
        </div>

        {/* El motivo explica el estado: no se esconde tras el desplegable. */}
        {motivoRechazo ? (
          <p className="text-[12.5px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {FACTURA_MOTIVO_RECHAZO_LABEL}:{" "}
            </span>
            {motivoRechazo}
          </p>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-border bg-muted/50 px-4 py-4 md:px-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_1fr_1fr] md:gap-5">
            <section aria-label={FACTURA_RECIBIDO_TITULO}>
              <TituloColumna>{RESUMEN_METODOS_TITULO}</TituloColumna>
              <LineaMonto label="Efectivo" monto={totales.efectivo} />
              <LineaMonto label="SINPE" monto={totales.simpe} />
              <LineaMonto
                label="Transferencia"
                monto={totales.transferencia}
                ultima
              />
            </section>

            <section aria-label={RESUMEN_AJUSTES_TITULO}>
              <TituloColumna>{RESUMEN_AJUSTES_TITULO}</TituloColumna>
              <LineaMonto
                label={etiquetaPago(esMensajero)}
                monto={totalPagoMensajero}
                ultima={esMensajero}
              />
              {/* El ingreso de bodega por rechazos es de la EMPRESA: fuera de la hoja del
                  mensajero, igual que en su detalle (design §7.2). */}
              {esMensajero ? null : (
                <LineaMonto
                  label={INGRESO_BODEGA_RECHAZOS_LABEL}
                  monto={totalIngresoBodegaRechazos}
                  ultima
                />
              )}
            </section>

            {/* Sin `solicitadoAt` no hay columna que pintar: el DTO de los consolidables no
                lleva fechas, y rellenarla con guiones diría «no tiene fecha» cuando lo cierto
                es que este listado no la trae. */}
            {solicitadoAt === undefined ? null : (
              <section aria-label={RESUMEN_FECHAS_TITULO}>
                <TituloColumna>{RESUMEN_FECHAS_TITULO}</TituloColumna>
                <LineaFecha
                  label={FACTURA_SOLICITADO_LABEL}
                  value={fecha(solicitadoAt)}
                />
                <LineaFecha
                  label={FACTURA_RESUELTO_LABEL}
                  value={fecha(resueltoAt ?? null)}
                  ultima
                />
              </section>
            )}
          </div>
          {extra}
        </div>
      ) : null}
    </Card>
  );
}

// --- Rótulos propios del comprobante de bodega ---
const BODEGA_TITULO = "Cierre de bodega";
const BODEGA_CIERRES_LABEL = "Cierres del día consolidados";

export interface CierreBodegaFacturaResumenProps {
  cierre: CierreBodegaResumen;
  acciones?: ReactNode;
}

/**
 * El mismo comprobante compacto, para un cierre de BODEGA: las partes son la zona y quien
 * lo solicitó (no un mensajero), y el desplegable añade cuántos cierres del día consolida.
 * Los totales son los AGREGADOS snapshot, STRING como el resto.
 */
export function CierreBodegaFacturaResumen({
  cierre,
  acciones,
}: Readonly<CierreBodegaFacturaResumenProps>) {
  return (
    <HojaResumen
      titulo={BODEGA_TITULO}
      ariaLabel={`Comprobante del cierre de bodega de ${cierre.zonaNombre}`}
      toggleSufijo={`del cierre de bodega de ${cierre.zonaNombre}`}
      folio={folio(cierre.cierreBodegaId)}
      estado={cierre.estado}
      acciones={acciones}
      partes={[
        { icon: <Warehouse size={14} aria-hidden="true" />, texto: cierre.zonaNombre },
        { icon: <User size={14} aria-hidden="true" />, texto: cierre.solicitadoPorNombre },
        { icon: <Calendar size={14} aria-hidden="true" />, texto: fecha(cierre.solicitadoAt) },
      ]}
      totales={cierre.totales}
      totalPagoMensajero={cierre.totalPagoMensajero}
      totalIngresoBodegaRechazos={cierre.totalIngresoBodegaRechazos}
      solicitadoAt={cierre.solicitadoAt}
      resueltoAt={cierre.resueltoAt}
      motivoRechazo={cierre.motivoRechazo}
      extra={
        <p className="mt-3 border-t border-border pt-2 text-[13px] text-muted-foreground">
          {BODEGA_CIERRES_LABEL}:{" "}
          <b className="font-medium text-foreground tabular-nums">
            {cierre.cantidadCierres}
          </b>
        </p>
      }
    />
  );
}

export interface CierreFacturaResumenPropioProps {
  cierre: CierrePasadoDTO;
  /** Botonera de la fila equivalente en la tabla que reemplazó ("Ver detalle"). */
  acciones?: ReactNode;
}

/**
 * El comprobante compacto de un cierre PROPIO del mensajero (su histórico). Es el mismo de
 * `CierreFacturaResumen` con una parte menos: el mensajero NO se lista, porque el cierre es
 * suyo y decir su nombre en cada tarjeta de su propia pantalla no informa de nada. Tampoco
 * hay nombre de zona destino —el DTO trae el id, no el nombre—, así que la parte del destino
 * es el TIPO, exactamente lo que ya decía la columna «Destino» de la tabla.
 */
export function CierreFacturaResumenPropio({
  cierre,
  acciones,
}: Readonly<CierreFacturaResumenPropioProps>) {
  const dia = fecha(cierre.solicitadoAt);
  return (
    <HojaResumen
      titulo={FACTURA_TITULO}
      ariaLabel={`Comprobante de tu cierre del ${dia}`}
      toggleSufijo={`de tu cierre del ${dia}`}
      folio={folio(cierre.cierreId)}
      estado={cierre.estado}
      acciones={acciones}
      partes={[
        {
          icon: <Warehouse size={14} aria-hidden="true" />,
          texto: destino({ destinoTipo: cierre.destinoTipo }),
        },
        { icon: <Calendar size={14} aria-hidden="true" />, texto: dia },
      ]}
      totales={cierre.totales}
      totalPagoMensajero={cierre.totalPagoMensajero}
      totalIngresoBodegaRechazos={cierre.totalIngresoBodegaRechazos}
      solicitadoAt={cierre.solicitadoAt}
      resueltoAt={cierre.resueltoAt ?? null}
      motivoRechazo={cierre.motivoRechazo ?? null}
      audiencia="mensajero"
    />
  );
}

export interface CierreConsolidableFacturaResumenProps {
  cierre: CierreBodegaResumenLite;
}

/**
 * Un `cierre_dia` CONSOLIDABLE leído como comprobante: lo que el adminSatelite repasa antes
 * de solicitar el cierre de su bodega. El DTO es el más pobre de los cuatro —mensajero y
 * totales, nada más (40/R5)—, así que la hoja va sin estado y sin fechas: los tres son
 * `aprobado` por definición del listado, y las fechas no viajan. Se pintan los mismos montos
 * que enseñaban las siete columnas de la tabla, STRING de punta a punta.
 */
export function CierreConsolidableFacturaResumen({
  cierre,
}: Readonly<CierreConsolidableFacturaResumenProps>) {
  return (
    <HojaResumen
      titulo={FACTURA_TITULO}
      ariaLabel={`Comprobante del cierre de ${cierre.mensajeroNombre}`}
      toggleSufijo={`del cierre de ${cierre.mensajeroNombre}`}
      folio={folio(cierre.cierreDiaId)}
      partes={[
        { icon: <User size={14} aria-hidden="true" />, texto: cierre.mensajeroNombre },
      ]}
      totales={cierre.totales}
      totalPagoMensajero={cierre.totalPagoMensajero}
      totalIngresoBodegaRechazos={cierre.totalIngresoBodegaRechazos}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Detalle del cierre como comprobante
 * ------------------------------------------------------------------ */

/**
 * Cabecera que necesita el comprobante detallado. `CierreAdminResumen` la satisface tal cual;
 * el mensajero la compone desde su `CierrePasadoDTO` (que no trae `mensajeroNombre` porque el
 * cierre es suyo, ni el nombre de la zona destino).
 */
export interface CierreFacturaCabecera {
  cierreId: string;
  estado: CierreAdminResumen["estado"];
  destinoTipo: CierreDestinoTipo;
  destinoZonaNombre?: string;
  totales: CierreAdminResumen["totales"];
  totalPagoMensajero: string;
  totalIngresoBodegaRechazos: string;
  solicitadoAt: string;
  resueltoAt: string | null;
  motivoRechazo: string | null;
  /** Solo en la vista de admin: de quién es el cierre. */
  mensajeroNombre?: string;
}

/**
 * Para quién se pinta el comprobante. `admin` (default) es la vista completa de las features
 * 38/40. `mensajero` es la MISMA hoja recortada a lo que es suyo: se caen el ingreso de
 * Ordenex, la liquidación, el pago a la tienda y el ingreso de bodega por rechazos —plata de
 * la empresa, no del mensajero (design §7.2)—, y los renglones muestran lo recibido y su pago
 * en vez de lo facturado.
 */
export type CierreFacturaAudiencia = "admin" | "mensajero";

/**
 * Cómo se llama ESE monto según quién lo lea: para la empresa es "Pago al mensajero" (un
 * egreso); para el mensajero es su "Ganancia" —el mismo rótulo que usa el resto de su
 * pantalla de cierre del día—.
 */
const GANANCIA_MENSAJERO_LABEL = "Ganancia";
function etiquetaPago(esMensajero: boolean): string {
  return esMensajero ? GANANCIA_MENSAJERO_LABEL : PAGO_MENSAJERO_LABEL;
}

export interface CierreFacturaDetalleProps {
  cierre: CierreFacturaCabecera;
  grupos: CierreGrupos;
  /** Solo `admin`: en la vista del mensajero estos bloques no se pintan. */
  totalesIngreso?: TotalesIngresoOrdenex;
  /**
   * `sla`/`manual` son el desglose por origen del cierre del mensajero. El cierre de
   * BODEGA solo conserva el agregado, así que ahí llega el total solo y la sublínea de
   * origen no se pinta.
   */
  desgloseIngresoBodegaRechazos?: { sla?: string; manual?: string; total: string };
  ganancia?: string;
  pagoTienda?: string;
  audiencia?: CierreFacturaAudiencia;
  /** Abre el visor con la URL FIRMADA de la evidencia (nunca el storage_path). */
  onVerEvidencia?: (url: string) => void;
  /**
   * Pedido humano (2026-08-19): abre la corrección del desglose de pago de una gestión.
   * Ausente = la hoja es de solo lectura, que es lo que sigue siendo en un cierre resuelto,
   * para el rol que no corrige y en la vista del mensajero.
   */
  onCorregirPagos?: (g: CierreDetalleGestion) => void;
}

/**
 * Pedido humano (2026-08-19): rótulo del acceso a la CORRECCIÓN del desglose de pago. Dice
 * «corregir» y no «editar» a propósito — lo que se arregla es un dato mal registrado en la
 * calle, no una preferencia—, y nombra los MÉTODOS porque el total no se toca.
 */
const FILA_CORREGIR_METODOS = "Corregir métodos de pago";

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
          esExito ? "text-success-strong" : "text-foreground",
        )}
      >
        {value}
      </span>
      {nota ? (
        <span
          className={cn(
            // Sin `/80`: un token `-strong` existe para garantizar 4.5:1, y aplicarle una
            // opacidad anula justo la garantía por la que se eligió (medido: 3.36 en los
            // dos temas). Feature 217/R8.
            "text-[0.6875rem]",
            esExito ? "text-success-strong" : "text-muted-foreground",
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
        // El indicador de selección NO va a `primary`: acá el mismo condicional pinta el
        // borde Y la etiqueta, y `--primary` mide 3.18 sobre blanco — cumple el 3:1 de
        // componente pero NO el 4.5:1 de texto (es la deuda abierta de la ficha 216).
        // `foreground` mantiene los dos por encima del umbral.
        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
        active
          ? "border-foreground font-medium text-foreground"
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
  esMensajero = false,
  onVerEvidencia,
  onCorregirPagos,
}: Readonly<{
  g: CierreDetalleGestion;
  /** Vista del mensajero: las dos cifras de la fila son lo RECIBIDO y SU pago. */
  esMensajero?: boolean;
  onVerEvidencia?: (url: string) => void;
  /**
   * Pedido humano (2026-08-19): abre la corrección del desglose de ESTA gestión. Ausente = no
   * se ofrece, que es lo que pasa en un cierre ya resuelto, para el rol que no corrige y en la
   * vista del mensajero. Igual que `onVerEvidencia`: el permiso no se decide aquí, se recibe.
   */
  onCorregirPagos?: (g: CierreDetalleGestion) => void;
}>) {
  const [open, setOpen] = useState(false);
  const ing = g.ingresoOrdenex ?? null;
  // Feature 213 (T7): un método -> su etiqueta, como siempre; dos o más -> cada uno con su
  // monto, en el orden del DTO. `null` cuando la entrega no tiene líneas de pago.
  const desglose = desglosePantalla(g.pagos);

  return (
    // `break-inside-avoid` (feature 223, pieza 1 de 5, y la que más importa): esta fila se
    // repite N veces y es la que decide dónde caen los cortes de un cierre largo. Partida,
    // deja la guía en una página y el monto en la siguiente.
    <div className="mb-2 break-inside-avoid overflow-hidden rounded-[10px] border border-border">
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
        <span className="text-[13px] font-medium text-foreground">
          {g.numGuia ?? "—"}
        </span>
        <span className="flex flex-col">
          <span className="text-[13px] text-foreground">{g.destinatario}</span>
          <span className="text-[11px] text-muted-foreground">
            {g.numRemision} · {g.producto}
          </span>
        </span>
        <span className="text-right text-[13px] tabular-nums text-foreground">
          {money(esMensajero ? g.montoRecibido : (ing?.montoCobrar ?? null))}
        </span>
        <span className="text-right text-[13px] font-medium tabular-nums text-success-strong">
          {money(esMensajero ? g.pagoMensajero : (ing?.total ?? null))}
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
              // Feature 213/R23: el método sale del DESGLOSE, no del campo escalar. Sin
              // líneas la fila queda EXACTAMENTE como hoy —solo el monto—, sin texto nuevo
              // (R22); el marcador de ausencia de esta fila es que no se pinta (`DatoFila`
              // con `value` nulo), y eso no cambia.
              value={
                g.montoRecibido === null
                  ? null
                  : `${money(g.montoRecibido)}${
                      desglose ? ` · ${desglose}` : ""
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
              label={etiquetaPago(esMensajero)}
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
            {/* Solo donde hay algo que repartir: una ENTREGA que cobró. Los otros resultados no
                tienen desglose, y una entrega sin cobro no reparte cero colones entre métodos
                (misma regla que el servidor, que rechaza las dos cosas). */}
            {onCorregirPagos && g.resultado === "entregada" && g.pagos.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-fit"
                aria-label={`${FILA_CORREGIR_METODOS} de la orden ${g.numRemision} · ${g.destinatario}`}
                onClick={() => onCorregirPagos(g)}
              >
                {FILA_CORREGIR_METODOS}
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
  audiencia = "admin",
  onVerEvidencia,
  onCorregirPagos,
}: Readonly<CierreFacturaDetalleProps>) {
  // Vista del MENSAJERO: la misma hoja, sin la plata de la empresa (design §7.2).
  const esMensajero = audiencia === "mensajero";
  const gananciaNegativa = ganancia !== undefined && esMontoNegativo(ganancia);
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
      ariaLabel={
        cierre.mensajeroNombre
          ? `Comprobante detallado del cierre de ${cierre.mensajeroNombre}`
          : "Comprobante detallado de tu cierre"
      }
    >
      {/* Encabezado: estado + de quién es el cierre y a qué bodega va.
          `break-inside-avoid` (feature 223, pieza 4 de 5): es la identidad del comprobante
          —marca, folio, estado, fechas—. Partida en dos páginas, la primera hoja deja de
          identificar de qué cierre habla. */}
      <div className="flex flex-wrap items-start justify-between gap-3 break-inside-avoid border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-medium text-foreground">
              {FACTURA_TITULO}
            </span>
            <EstadoCierreBadge estado={cierre.estado} />
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Warehouse size={15} aria-hidden="true" />
            {destino(cierre)}
            {cierre.mensajeroNombre
              ? ` · ${FACTURA_MENSAJERO_LABEL} ${cierre.mensajeroNombre}`
              : null}
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

      {/* Los dos totales de cabecera de la referencia. Ambos son plata de la EMPRESA (lo que
          se le paga a la tienda y lo que ingresa la bodega por rechazos): en la vista del
          mensajero no se pintan. */}
      {esMensajero || pagoTienda === undefined || !desgloseIngresoBodegaRechazos ? null : (
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
          // Sin desglose por origen (cierre de bodega) la tarjeta se queda con el total.
          nota={
            desgloseIngresoBodegaRechazos.sla === undefined ||
            desgloseIngresoBodegaRechazos.manual === undefined ? null : (
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
            )
          }
        />
      </div>
      )}

      {/* La rejilla de KPI NO lleva `break-inside-avoid`, y es deliberado: partirla entre dos
          páginas corta ENTRE tarjetas, que es un corte natural y no rompe ningún dato. Lo que
          no puede partirse es cada tarjeta, y ahí es donde va la protección (`KpiFactura`). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiFactura
          label={FACTURA_TOTAL_GENERAL_LABEL}
          value={cierre.totales.general}
          moneda
        />
        {esMensajero || !totalesIngreso ? null : (
          <KpiFactura
            label={INGRESO_TOTAL_LABEL}
            value={totalesIngreso.total}
            moneda
          />
        )}
        <KpiFactura
          label={etiquetaPago(esMensajero)}
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

      {/* Ingreso de Ordenex y liquidación: facturación de la EMPRESA, fuera de la vista del
          mensajero (design §7.2). */}
      {esMensajero || !totalesIngreso ? null : (
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
      )}

      {esMensajero || !totalesIngreso ? null : (
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
      )}

      {/* Pago al mensajero e ingreso de bodega: siempre en la misma línea (el desglose
          por origen del ingreso ya vive en la tarjeta de cabecera). En la vista del
          mensajero solo queda SU pago: el ingreso de bodega no es suyo. */}
      {esMensajero || !desgloseIngresoBodegaRechazos ? (
        <BloqueRenglones titulo={etiquetaPago(esMensajero)}>
          <Renglon
            label={etiquetaPago(esMensajero)}
            value={money(cierre.totalPagoMensajero)}
            emphasis
          />
        </BloqueRenglones>
      ) : (
        <ParPagoIngreso
          pagoMensajero={cierre.totalPagoMensajero}
          ingresoBodegaRechazos={desgloseIngresoBodegaRechazos.total}
        />
      )}

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
            <span className="text-right">
              {esMensajero ? FILA_RECIBIDO_LABEL : FILA_COBRADO_COL}
            </span>
            <span className="text-right">
              {esMensajero ? GANANCIA_MENSAJERO_LABEL : INGRESO_TOTAL_LABEL}
            </span>
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
                esMensajero={esMensajero}
                onVerEvidencia={onVerEvidencia}
                onCorregirPagos={onCorregirPagos}
              />
            ))
          )}
        </section>
      </section>

      {/* Pie: lo recaudado del cierre y cuántas entregas lo produjeron.
          `break-inside-avoid` (feature 223, pieza 5 de 5): franja corta y con el total; no
          debe quedar huérfana ni partida al final del comprobante. */}
      <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 break-inside-avoid border-t border-border bg-muted/50 px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {FOOTER_RECAUDADO_LABEL}{" "}
          <b className="font-medium text-foreground tabular-nums">
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
