"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { cn } from "@/lib/utils";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
  IngresoOrdenexDTO,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";
// Feature 158 (T2.3): las etiquetas visibles de la causa del incidente viven donde nacieron
// (junto al panel que las captura), no se duplican aquí. Importar un módulo de etiquetas de
// otra ruta tiene precedente EXACTO en este repo: `GestionarOrdenPanel` (mis-asignaciones)
// importa `estatus-label` de `app/(app)/ordenes/_components/`. El value crudo del enum
// (`danado`) no se pinta nunca.
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import {
  RESULTADO_LABEL,
  METODO_LABEL,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
  RECHAZO_MANUAL_BADGE_LABEL,
  MONTO_COBRAR_COL,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  INGRESO_TOTAL_COL,
  CAUSA_INCIDENTE_COL,
  INDEMNIZACION_COL,
} from "./cierre-labels";
import {
  COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
  COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
  COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
  COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
  filaDescargaGestionDevuelta,
  filaDescargaGestionEntregada,
  filaDescargaGestionIncidente,
  filaDescargaGestionRechazada,
  filaDescargaGestionReprogramada,
} from "./cierre-gestiones-descarga-columnas";

// Feature 40 (T8) — helpers y componentes compartidos del detalle de cierre entre
// el módulo de cierres de mensajero (feature 38, `CierresAdminModule`) y los nuevos
// módulos de cierre de bodega (adminSatelite `ConsolidacionBodegaModule` / maestro
// `CierresBodegaAdminModule`). Extraídos verbatim del `CierresAdminModule` original
// para NO duplicar: money-safe (R13), etiquetas i18n-ready, columnas por resultado
// con evidencia firmada (R12) y el visor de evidencia. Sin lógica de dominio propia.

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
//
// Feature 170 (tanda E): las que también necesita el archivo de la descarga viven ahora en
// `cierre-labels.ts` (módulo PURO, sin React) y se RE-EXPORTAN desde aquí, sin cambiar ni un
// texto: los consumidores que ya las importaban de este archivo siguen igual, y el módulo de
// columnas de export puede leerlas sin arrastrar `Card`/`Badge`/`DataTable`.
export {
  RESULTADO_LABEL,
  METODO_LABEL,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
  RECHAZO_MANUAL_BADGE_LABEL,
  MONTO_COBRAR_COL,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  INGRESO_TOTAL_COL,
  CAUSA_INCIDENTE_COL,
  INDEMNIZACION_COL,
};

export const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
  incidente: "No hay incidentes.", // feature 158/R18
};

// Feature 41 (R20): variante de badge por estado para diferenciar VISUALMENTE el
// `vencido` (generado por el corte diario: dinero sin conciliar mas alla del plazo)
// del `solicitado` en la misma cola de pendientes. `vencido` -> destructive (rojo,
// atencion); `solicitado` -> secondary (neutro). Los resueltos conservan su color.
export const ESTADO_BADGE_VARIANT: Record<
  CierreEstado,
  "default" | "secondary" | "destructive" | "outline"
> = {
  solicitado: "secondary",
  aprobado: "outline",
  rechazado: "destructive",
  vencido: "destructive",
};

/**
 * Feature 41 (R20): badge del estado de un cierre, con estilo diferenciado por
 * estado (ver `ESTADO_BADGE_VARIANT`). El `vencido` queda visualmente separado del
 * `solicitado` en la cola de pendientes de `/cierres-admin`. Texto i18n-ready.
 */
export function EstadoCierreBadge({ estado }: { estado: CierreEstado }) {
  return <Badge variant={ESTADO_BADGE_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>;
}

// Feature 109 (R31): en el modelo GLOBAL un cierre `rechazado` NO es terminal. Aunque el
// admin ya actuó (por eso vive en el histórico), sigue BLOQUEANDO al mensajero hasta que
// éste lo RE-SOLICITE (`rechazado → solicitado`) y se APRUEBE. El histórico lo rotula así
// para que no se lea como "resuelto/cerrado". Texto separado, i18n-ready.
export const RECHAZADO_BLOQUEANTE_LABEL = "Bloqueante hasta re-solicitud";
export const RECHAZADO_BLOQUEANTE_NOTA =
  "Un cierre rechazado no es terminal: sigue bloqueando al mensajero hasta que lo vuelva a solicitar y su bodega lo apruebe.";

/**
 * Feature 109 (R31): rótulo del estado de un cierre en el HISTÓRICO de `/cierres-admin`.
 * Un `rechazado` conserva su etiqueta ("Rechazado") pero se anexa el marcador visible
 * "Bloqueante hasta re-solicitud" (con nota accesible), porque NO es un estado resuelto:
 * bloquea hasta que el mensajero lo re-solicite y se apruebe. El resto de estados
 * (`aprobado`) se rotula tal cual. Texto i18n-ready; el marcador no comunica solo por color.
 */
export function EstadoHistoricoRotulo({ estado }: { estado: CierreEstado }) {
  if (estado === "rechazado") {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <span>{ESTADO_LABEL[estado]}</span>
        <Badge
          variant="destructive"
          title={RECHAZADO_BLOQUEANTE_NOTA}
          aria-label={RECHAZADO_BLOQUEANTE_NOTA}
        >
          {RECHAZADO_BLOQUEANTE_LABEL}
        </Badge>
      </span>
    );
  }
  return <>{ESTADO_LABEL[estado]}</>;
}

// --- Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready) ---
export const PAGO_MENSAJERO_LABEL = "Pago al mensajero";
// --- Feature 56: etiquetas del ingreso de bodega por rechazos (texto separado, i18n-ready) ---
export const INGRESO_BODEGA_RECHAZOS_LABEL = "Ingreso de bodega por rechazos";
// --- Feature 102 (R8): subtotales del ingreso de bodega por rechazos, particionado por ORIGEN.
// El total combinado sigue siendo el de la 56 (`INGRESO_BODEGA_RECHAZOS_LABEL`); estos dos son
// las sublíneas del desglose (SLA del cron 99 vs manual del mensajero). Texto i18n-ready. ---
export const INGRESO_BODEGA_RECHAZOS_SLA_LABEL = "Automático (por plazo vencido)";
export const INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL = "Manual (mensajero)";
// --- Feature 102 (R9): marca por fila del ORIGEN de un rechazo, para que cada ingreso de bodega
// sea auditable. `SLA` = escalado por el cron de vencimiento (99); `Manual` = rechazo del
// mensajero. Texto i18n-ready + nota accesible (`title`/`aria-label`). ---
export const RECHAZO_SLA_BADGE_NOTA =
  "Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero).";
export const RECHAZO_MANUAL_BADGE_NOTA =
  "Rechazo registrado manualmente por el mensajero.";
// --- Neto DERIVADO (total general - lo pagado a mensajeros): texto separado, i18n-ready ---
export const NETO_LABEL = "Total neto";
// --- Deuda de la central: el pago a mensajeros que el efectivo no cubrió (i18n-ready) ---
export const CENTRAL_DEBE_LABEL = "Central debe";
export const CENTRAL_DEBE_NOTA =
  "El efectivo no alcanzó para pagarle a todos los mensajeros (el pago no puede ser parcial).";
// --- Desglose del ingreso de Ordenex por orden (texto separado, i18n-ready) ---
export const MONTO_COBRAR_LABEL = "Monto a cobrar";
export const INGRESO_TOTAL_LABEL = "Total Ordenex";
export const INGRESO_PANEL_LABEL = "Ingreso de Ordenex";
// Conceptos AGRUPADOS (cada uno con su IVA incluido): así se leen en tablas y paneles.
// --- Bruto y ganancia del cierre (texto separado, i18n-ready) ---
export const INGRESO_BRUTO_LABEL = "Ingreso bruto";
export const INGRESO_BRUTO_NOTA =
  "Todo lo que facturó Ordenex en el cierre (flete + IVA + comisión + IVA), sin descontar nada.";
export const GANANCIA_LABEL = "Ganancia";
// Cuando la ganancia es NEGATIVA no es ganancia sino una deuda: se rotula "Debe".
export const GANANCIA_DEBE_LABEL = "Debe";
// --- Pago a la tienda: lo recibido menos lo que Ordenex le factura (texto separado, i18n-ready) ---
export const PAGO_TIENDA_LABEL = "Pago a tienda";
export const PAGO_TIENDA_NOTA =
  "Total general menos flete + IVA y comisión + IVA. No descuenta el flete de devolución: una devolución no cobra COD.";
export const GANANCIA_NOTA = "Ingreso bruto menos el pago al mensajero.";
export const GANANCIA_NOTA_BODEGA = "Ingreso bruto menos el pago a los mensajeros.";
export const DESGLOSE_TITULO = "Desglose de ingreso";
export const TARIFA_TITULO = "Tarifa aplicada";
export const TARIFA_NOTA = "Congelada al solicitar el cierre";
export const APLICADA_HINT = "← se aplicó";
export const SIN_COMISION_NOTA = "Esta orden no cobra comisión COD.";
export const SIN_TARIFA_CONGELADA_NOTA =
  "La tienda no tenía tarifa vigente al solicitar el cierre: no se derivó ningún ingreso para esta orden.";
// --- Feature 158 (R34/R9/R19): columnas propias del grupo `incidente` (texto i18n-ready) ---
/**
 * `indemnizacion === null` en un incidente NO es «cero»: es «todavía no se capturó». El monto
 * lo pone el admin AL APROBAR (R19), así que hasta entonces la celda muestra "—" con esta nota
 * accesible. Sin ella, un "—" se leería como «esta orden no se indemniza», que es lo contrario.
 */
export const INDEMNIZACION_PENDIENTE_NOTA =
  "Se captura al aprobar el cierre; todavía no se indemnizó.";

/** Aviso discreto (F1.4-5): pago de una entrega resuelto a ₡0.00 (tarifa faltante). */
export const PAGO_SIN_TARIFA_LABEL = "Sin tarifa";
export const PAGO_SIN_TARIFA_NOTA =
  "El pago al mensajero de esta entrega se resolvió en ₡0.00 (posible tarifa de zona sin configurar).";

/**
 * Orden fijo de las secciones del detalle (R11). Feature 158/R18: `incidente` es un grupo
 * PROPIO y va AL FINAL, tras los cuatro desenlaces normales — mismo criterio que el detalle
 * del mensajero (37) y que el paso de resultados del panel.
 */
export const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

/**
 * Prefija el símbolo de colón a un monto que YA viene como string (money-safe,
 * R13): NUNCA se parsea a número para no perder precisión. `null` → "—".
 */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/**
 * ¿El monto (STRING money-safe, escala 2 con signo, p. ej. "-12.50") es negativo?
 * Se lee el signo del texto: NO se parsea a número (money-safe, R13).
 */
export function esMontoNegativo(value: string | null): boolean {
  return value !== null && value.trimStart().startsWith("-");
}

/** Une la jerarquía geográfica en una línea legible (omite los vacíos). */
export function ubicacion(g: CierreDetalleGestion): string {
  return [g.zonaNombre, g.provinciaNombre, g.cantonNombre, g.distritoNombre]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

/** Ítem del panel de totales. */
export function TotalItem({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={emphasis ? "text-lg font-semibold" : "text-base font-medium"}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Panel de totales snapshot por método (R13): efectivo / SINPE / transferencia +
 * general. Los montos llegan como STRING y se renderizan tal cual (money-safe). Es
 * una `region` accesible con nombre `ariaLabel` para que el E2E la localice.
 */
export function TotalesPanel({
  totales,
  ariaLabel,
  title,
  labelGeneral = "Total general",
  neto,
}: {
  totales: CierreTotales;
  ariaLabel: string;
  title: string;
  labelGeneral?: string;
  /**
   * Neto DERIVADO server-side (STRING money-safe), si el consumidor lo tiene: se muestra
   * como un ítem MÁS del panel, junto al total general. Omitirlo deja el panel de 4 ítems
   * de siempre (los cierres de mensajero no derivan neto).
   */
  neto?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <Card>
        <CardContent
          className={`grid grid-cols-2 gap-4 pt-6 ${neto === undefined ? "sm:grid-cols-4" : "sm:grid-cols-5"}`}
        >
          <TotalItem label="Efectivo" value={money(totales.efectivo)} />
          <TotalItem label="SINPE" value={money(totales.simpe)} />
          <TotalItem
            label="Transferencia"
            value={money(totales.transferencia)}
          />
          <TotalItem label={labelGeneral} value={money(totales.general)} emphasis />
          {neto === undefined ? null : (
            <TotalItem label={NETO_LABEL} value={money(neto)} emphasis />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 39 (R17/R18/R20): total a pagar al mensajero, en un panel PROPIO y
 * SEPARADO del panel de dinero recibido (`TotalesPanel`) — es dinero que la empresa
 * DEBE al mensajero, no dinero recibido (R21). El monto llega como STRING y se
 * renderiza tal cual (money-safe). `region` accesible por `ariaLabel`.
 */
export function PagoMensajeroTotal({
  value,
  ariaLabel,
  label = PAGO_MENSAJERO_LABEL,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Card de un monto DERIVADO del cierre (bruto / ganancia), con la nota que explica de dónde
 * sale. Los montos llegan como STRING ya derivados server-side: acá no se resta dinero.
 * `region` accesible por `ariaLabel` (por defecto, la propia etiqueta).
 */
export function MontoDerivadoCard({
  value,
  label,
  nota,
  ariaLabel,
  tone = "default",
}: Readonly<{
  value: string;
  label: string;
  nota: string;
  ariaLabel?: string;
  /** `danger` pinta el monto en rojo (p. ej. una ganancia negativa = deuda). */
  tone?: "default" | "danger";
}>) {
  return (
    <section aria-label={ariaLabel ?? label} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{nota}</span>
          </span>
          <span
            className={cn(
              "text-lg font-semibold",
              tone === "danger" && "text-danger-strong",
            )}
          >
            {money(value)}
          </span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Deuda de la central con los mensajeros: la parte del pago que el EFECTIVO de la zona no
 * alcanzó a cubrir. El monto se deriva SERVER-SIDE y llega como STRING escala 2 (acá no se
 * hace aritmética de dinero). Se pinta en tono de atención porque es plata que alguien más
 * tiene que poner, no un total informativo. `region` accesible por `ariaLabel`.
 */
export function CentralDebeTotal({
  value,
  ariaLabel,
  label = CENTRAL_DEBE_LABEL,
  nota = CENTRAL_DEBE_NOTA,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
  nota?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{nota}</span>
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 56 (R10/R16/R17/R19): total del ingreso de bodega por rechazos, en un panel
 * PROPIO y SEPARADO del dinero recibido (`TotalesPanel`) y del pago al mensajero
 * (`PagoMensajeroTotal`). Espejo visual de `PagoMensajeroTotal`. El monto llega como
 * STRING y se renderiza tal cual (money-safe). `region` accesible por `ariaLabel`.
 */
export function IngresoBodegaRechazosTotal({
  value,
  ariaLabel,
  label = INGRESO_BODEGA_RECHAZOS_LABEL,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 102 (R8): desglose del ingreso de bodega por rechazos, particionado por ORIGEN.
 * Hermano de `IngresoBodegaRechazosTotal` (misma card dashed) pero, DEBAJO del total combinado
 * ya existente (56), muestra las dos sublíneas del desglose: subtotal SLA (cron 99) y subtotal
 * manual (mensajero). Por construcción `sla + manual === total` (server-side, R5): acá NO se hace
 * aritmética. Los tres montos llegan como STRING (money-safe) y se renderizan con `money()`.
 * `region` accesible por `ariaLabel` (mismo nombre que `IngresoBodegaRechazosTotal` para que los
 * consumidores existentes lo sigan localizando).
 */
export function IngresoBodegaRechazosDesglose({
  desglose,
  ariaLabel,
  label = INGRESO_BODEGA_RECHAZOS_LABEL,
}: {
  desglose: { sla: string; manual: string; total: string };
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-2 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
            <span className="text-lg font-semibold">{money(desglose.total)}</span>
          </div>
          {/* Sublíneas del desglose (R8): separan el origen del ingreso sin recomputar el total. */}
          <div className="flex flex-col gap-1 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{RECHAZO_SLA_BADGE_LABEL}</Badge>
                {INGRESO_BODEGA_RECHAZOS_SLA_LABEL}
              </span>
              <span className="text-sm font-medium">{money(desglose.sla)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{RECHAZO_MANUAL_BADGE_LABEL}</Badge>
                {INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL}
              </span>
              <span className="text-sm font-medium">{money(desglose.manual)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 39/56 (R16/R20/R23): render del pago al mensajero por orden. Money-safe: el
 * monto llega como STRING y se muestra tal cual. El aviso "Sin tarifa" ahora se decide
 * por el flag `tarifaFaltante` resuelto SERVER-SIDE (F1.4-Q6): reemplaza la heurística
 * de string `entregada && pago === "0.00"` de la 39 y aplica a ENTREGAS Y RECHAZOS.
 */
export function renderPagoMensajero(g: CierreDetalleGestion): ReactNode {
  return (
    <span className="inline-flex items-center gap-2">
      {money(g.pagoMensajero)}
      {g.tarifaFaltante ? (
        <Badge
          variant="outline"
          title={PAGO_SIN_TARIFA_NOTA}
          aria-label={PAGO_SIN_TARIFA_NOTA}
        >
          {PAGO_SIN_TARIFA_LABEL}
        </Badge>
      ) : null}
    </span>
  );
}

/** Columna del pago al mensajero por orden (R16/R20), reutilizable por sección. */
export const COLUMNA_PAGO_MENSAJERO: Column<CierreDetalleGestion> = {
  id: "pagoMensajero",
  value: PAGO_MENSAJERO_COL,
  render: renderPagoMensajero,
};

/**
 * Feature 56 (R12): columna del ingreso de bodega por rechazos por orden. Solo aplica a
 * la sección `rechazada`; money-safe (el monto llega como STRING, `null` → "—" vía
 * `money()`, NUNCA se parsea a número). Concepto separado del pago al mensajero.
 */
export const COLUMNA_INGRESO_BODEGA_RECHAZOS: Column<CierreDetalleGestion> = {
  id: "ingresoBodegaRechazo",
  value: INGRESO_BODEGA_RECHAZOS_COL,
  render: (g) => money(g.ingresoBodegaRechazo),
};

/**
 * Feature 102 (R9): marca por fila del ORIGEN de un rechazo — `SLA` (escalado por el cron 99)
 * o `Manual` (rechazo del mensajero), según `g.esRechazoSla`. El badge trae su nota accesible
 * (`title`/`aria-label`) para que el origen de cada ingreso de bodega sea auditable.
 */
export function renderRechazoOrigen(g: CierreDetalleGestion): ReactNode {
  return g.esRechazoSla ? (
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
  );
}

/**
 * Feature 102 (R9): columna del origen del rechazo. Solo aplica a la sección `rechazada`.
 * Marca cada fila como SLA o manual, sin exponer ningún subtotal (el desglose vive en el panel).
 */
export const COLUMNA_RECHAZO_ORIGEN: Column<CierreDetalleGestion> = {
  id: "rechazoOrigen",
  value: RECHAZO_ORIGEN_COL,
  render: renderRechazoOrigen,
};

/**
 * Un renglón del desglose desplegable: etiqueta a la izquierda, valor a la derecha. `hint`
 * explica de dónde sale el número (la fórmula aplicada), que es justo lo que el admin viene
 * a auditar.
 */
function DesgloseFila({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className={emphasis ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={emphasis ? "text-sm font-semibold" : "text-sm"}>{value}</span>
    </div>
  );
}

/** Porcentaje ya normalizado a STRING 0..100 por el server; solo se le pega el símbolo. */
function pct(value: string): string {
  return `${value} %`;
}

/**
 * Desglose completo del dinero de UNA orden: los conceptos derivados (flete, IVA, comisión)
 * con la fórmula que los produjo, y la tarifa CONGELADA de la que salieron — incluida la
 * variante que NO se aplicó, para que se vea por qué se eligió una u otra.
 *
 * Todos los montos llegan como STRING desde el server (money-safe): acá no se hace ninguna
 * aritmética de dinero, solo se muestran y se etiquetan.
 */
export function DesgloseIngresoOrdenex({ g }: { g: CierreDetalleGestion }) {
  const ing = g.ingresoOrdenex;
  if (!ing) return null;

  // Gap conocido (feature 69/R9): la tienda no tenía tarifa vigente al solicitar el cierre,
  // así que NO se derivó ningún concepto. Es un aviso real, no un error: el cierre es válido.
  if (ing.tarifa === null) {
    return (
      <div className="flex flex-col gap-1">
        <p role="note" className="text-sm text-destructive">
          {SIN_TARIFA_CONGELADA_NOTA}
        </p>
        <DesgloseFila label={MONTO_COBRAR_LABEL} value={money(ing.montoCobrar)} />
      </div>
    );
  }

  const t = ing.tarifa;
  // La zona elige la COLUMNA de tarifa, no la fórmula (feature 69/R21): mostrar cuál se
  // aplicó y cuál no es la mitad de la auditoría.
  const fleteAplicado = ing.esCentral ? t.valorFleteGam : t.valorFlete;
  const fleteDevAplicado = ing.esCentral ? t.valorFleteDevueltoGam : t.valorFleteDevuelto;
  const variante = ing.esCentral ? "GAM" : "no GAM";

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* --- Lo que se derivó, con su fórmula --- */}
      <div className="flex flex-col">
        <h4 className="mb-1 text-sm font-semibold">{DESGLOSE_TITULO}</h4>
        <DesgloseFila label={MONTO_COBRAR_LABEL} value={money(ing.montoCobrar)} />
        {ing.flete === null ? null : (
          <DesgloseFila
            label="Flete"
            value={money(ing.flete)}
            hint={`tarifa ${variante}: ₡${fleteAplicado}`}
          />
        )}
        {ing.ivaFlete === null ? null : (
          <DesgloseFila
            label="IVA flete"
            value={money(ing.ivaFlete)}
            hint={`${pct(t.ivaFlete)} de ₡${fleteAplicado}`}
          />
        )}
        {ing.fleteDevolucion === null ? null : (
          <DesgloseFila
            label="Flete devolución"
            value={money(ing.fleteDevolucion)}
            hint={`tarifa ${variante}: ₡${fleteDevAplicado}`}
          />
        )}
        {ing.ivaFleteDevolucion === null ? null : (
          <DesgloseFila
            label="IVA flete devolución"
            value={money(ing.ivaFleteDevolucion)}
            hint={`${pct(t.ivaFlete)} de ₡${fleteDevAplicado}`}
          />
        )}
        {ing.comisionCod === null ? null : (
          <DesgloseFila
            label="Comisión COD"
            value={money(ing.comisionCod)}
            hint={`${pct(t.comisionCod)} de ${money(ing.montoCobrar)}`}
          />
        )}
        {ing.ivaComisionCod === null ? null : (
          <DesgloseFila
            label="IVA comisión"
            value={money(ing.ivaComisionCod)}
            hint={`${pct(t.ivaComisionCod)} de ${money(ing.comisionCod)}`}
          />
        )}
        {/* `cobraComision: false` no es un 0.00: la orden no genera comisión, y decirlo
            explícitamente evita que se lea como un cálculo que dio cero. */}
        {ing.cobraComision ? null : (
          <p className="pt-1 text-xs text-muted-foreground">{SIN_COMISION_NOTA}</p>
        )}
        <div className="mt-1 border-t pt-1">
          <DesgloseFila label={INGRESO_TOTAL_LABEL} value={money(ing.total)} emphasis />
        </div>
      </div>

      {/* --- La tarifa congelada completa, tal cual quedó al solicitar --- */}
      <div className="flex flex-col">
        <h4 className="mb-1 text-sm font-semibold">{TARIFA_TITULO}</h4>
        <p className="pb-1 text-xs text-muted-foreground">
          {TARIFA_NOTA} · <span className="font-mono">{t.tarifaId}</span>
        </p>
        <DesgloseFila
          label="Valor flete"
          value={money(t.valorFlete)}
          hint={ing.esCentral ? undefined : APLICADA_HINT}
        />
        <DesgloseFila
          label="Valor flete GAM"
          value={money(t.valorFleteGam)}
          hint={ing.esCentral ? APLICADA_HINT : undefined}
        />
        <DesgloseFila
          label="Flete devuelto"
          value={money(t.valorFleteDevuelto)}
          hint={ing.esCentral ? undefined : APLICADA_HINT}
        />
        <DesgloseFila
          label="Flete devuelto GAM"
          value={money(t.valorFleteDevueltoGam)}
          hint={ing.esCentral ? APLICADA_HINT : undefined}
        />
        <DesgloseFila label="Comisión COD" value={pct(t.comisionCod)} />
        <DesgloseFila label="IVA flete" value={pct(t.ivaFlete)} />
        <DesgloseFila label="IVA comisión" value={pct(t.ivaComisionCod)} />
      </div>
    </div>
  );
}

/** Nombre accesible del botón de desplegar: identifica SU orden, no un genérico repetido. */
export function desgloseAriaLabel(g: CierreDetalleGestion): string {
  return `${DESGLOSE_TITULO} de la orden ${g.numRemision} · ${g.destinatario}`;
}

// --- Columnas de dinero derivado por orden (solo el detalle admin las puebla) ---
const COLUMNA_MONTO_COBRAR: Column<CierreDetalleGestion> = {
  id: "montoCobrar",
  value: MONTO_COBRAR_COL,
  render: (g) => money(g.ingresoOrdenex?.montoCobrar ?? null),
};

/** Columna de un concepto derivado; `null` (no aplica a este resultado) → "—" vía `money`. */
function columnaConcepto(
  id: string,
  value: string,
  pick: (i: IngresoOrdenexDTO) => string | null,
): Column<CierreDetalleGestion> {
  return {
    id,
    value,
    render: (g) => money(g.ingresoOrdenex ? pick(g.ingresoOrdenex) : null),
  };
}

/**
 * Feature 158 (R9/R34): columna de la CAUSA tipificada del incidente. La etiqueta sale de
 * `CAUSA_INCIDENTE_LABEL` (derivada del SEED): nunca el slug crudo del enum. `null` sólo
 * podría verse si un resultado que no es `incidente` cayera en esta sección, y ahí "—" es la
 * lectura correcta.
 */
export const COLUMNA_CAUSA_INCIDENTE: Column<CierreDetalleGestion> = {
  id: "causaIncidente",
  value: CAUSA_INCIDENTE_COL,
  render: (g) => (g.causaIncidente ? CAUSA_INCIDENTE_LABEL[g.causaIncidente] : "—"),
};

/**
 * Feature 158 (R19/R22/R34): columna del MONTO de la indemnización. Money-safe: el monto llega
 * como STRING y se muestra tal cual con `money()`, sin `parseFloat`. `null` → "—" CON su nota:
 * el cierre todavía no se aprobó y el monto aún no existe (ver `INDEMNIZACION_PENDIENTE_NOTA`).
 */
export const COLUMNA_INDEMNIZACION: Column<CierreDetalleGestion> = {
  id: "indemnizacion",
  value: INDEMNIZACION_COL,
  render: (g) =>
    g.indemnizacion === null ? (
      <span title={INDEMNIZACION_PENDIENTE_NOTA} aria-label={INDEMNIZACION_PENDIENTE_NOTA}>
        —
      </span>
    ) : (
      money(g.indemnizacion)
    ),
};

/**
 * Columna de la evidencia FIRMADA (R12), compartida por `rechazada` e `incidente`
 * (feature 158/R18): abre el visor con la URL que ya llega firmada del servidor, nunca el
 * `storage_path` crudo. Se extrajo para no duplicar el render en dos ramas.
 */
const COLUMNA_EVIDENCIA = (
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion> => ({
  id: "evidencia",
  value: "Evidencia",
  render: (g) =>
    g.evidenciaUrl ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => verEvidencia(g.evidenciaUrl as string)}
      >
        Ver evidencia
      </Button>
    ) : (
      "—"
    ),
});

const COLUMNA_INGRESO_TOTAL: Column<CierreDetalleGestion> = {
  id: "ingresoTotal",
  value: INGRESO_TOTAL_COL,
  render: (g) =>
    g.ingresoOrdenex ? (
      <span className="font-medium">{money(g.ingresoOrdenex.total)}</span>
    ) : (
      "—"
    ),
};

// --- Columnas comunes a las 4 secciones del detalle (R11, reuso de la 37) ---
export const COLUMNAS_COMUNES: Column<CierreDetalleGestion>[] = [
  { id: "numGuia", value: "Nº Guía", render: (g) => g.numGuia ?? "—" },
  { id: "numRemision", value: "Nº Remisión" },
  { id: "destinatario", value: "Destinatario" },
  { id: "direccion", value: "Dirección", render: (g) => g.direccion ?? "—" },
  { id: "ubicacion", value: "Ubicación", render: (g) => ubicacion(g) || "—" },
  { id: "producto", value: "Producto" },
  { id: "tiendaNombre", value: "Tienda" },
];

/**
 * Construye las columnas de una sección del detalle: las comunes (R11) + las
 * específicas del resultado (monto+método si entregada R13; fecha+motivo si
 * reprogramada; motivo si devuelta; motivo+evidencia firmada si rechazada, R12).
 */
export function columnasPara(
  resultado: CierreResultado,
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion>[] {
  // Feature 158 (R17/R18/R34): el `incidente` NO deriva ningún concepto de ingreso de Ordenex
  // (ni flete, ni comisión, ni sus IVA), NO paga al mensajero y NO genera ingreso de bodega:
  // esas columnas serían "—" en todas las filas. Lo que SÍ lleva es el rastro del reporte
  // (causa + motivo + evidencia firmada) y el ÚNICO dinero que le corresponde: la
  // indemnización, que se captura al aprobar y hasta entonces es "—" (no es cero).
  if (resultado === "incidente") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      COLUMNA_CAUSA_INCIDENTE,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      COLUMNA_EVIDENCIA(verEvidencia),
      COLUMNA_INDEMNIZACION,
    ];
  }
  if (resultado === "entregada") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      { id: "monto", value: "Recibido", render: (g) => money(g.montoRecibido) },
      {
        id: "metodo",
        value: "Método",
        render: (g) => (g.metodoPago ? METODO_LABEL[g.metodoPago] : "—"),
      },
      // Conceptos que aplican a una ENTREGA, cada uno CON su IVA (los de devolución no se
      // listan acá: serían una columna de "—" en todas las filas). El split flete/IVA vive
      // en la fila desplegable.
      columnaConcepto("fleteConIva", FLETE_CON_IVA_LABEL, (i) => i.fleteConIva),
      columnaConcepto("comisionConIva", COMISION_CON_IVA_LABEL, (i) => i.comisionConIva),
      COLUMNA_INGRESO_TOTAL,
      // Feature 39/R16: pago al mensajero snapshot por orden (separado del dinero recibido).
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  if (resultado === "reprogramada") {
    // Una reprogramación no aporta a ningún concepto (la fórmula devuelve vacío): no se
    // pintan columnas de ingreso que serían "—" en todas las filas.
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      {
        id: "fechaReprogramacion",
        value: "Nueva fecha",
        render: (g) => g.fechaReprogramacion ?? "—",
      },
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  if (resultado === "devuelta") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaConcepto("fleteDevolucion", "Flete devolución", (i) => i.fleteDevolucion),
      columnaConcepto("ivaFleteDevolucion", "IVA flete dev.", (i) => i.ivaFleteDevolucion),
      COLUMNA_INGRESO_TOTAL,
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  // rechazada: origen SLA/manual (102/R9) + motivo + evidencia firmada (R12) + ingreso de bodega
  // por rechazos (56/R12). Un rechazo deriva los MISMOS conceptos que una devolución (flete + IVA).
  return [
    ...COLUMNAS_COMUNES,
    COLUMNA_RECHAZO_ORIGEN,
    COLUMNA_MONTO_COBRAR,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    COLUMNA_EVIDENCIA(verEvidencia),
    columnaConcepto(
      "fleteDevolucionConIva",
      FLETE_DEV_CON_IVA_LABEL,
      (i) => i.fleteDevolucionConIva,
    ),
    COLUMNA_INGRESO_TOTAL,
    COLUMNA_PAGO_MENSAJERO,
    COLUMNA_INGRESO_BODEGA_RECHAZOS,
  ];
}

/**
 * Totales por concepto del cierre completo, sumados desde el MISMO desglose por orden que
 * muestran las tablas. Llegan ya derivados del server (`totalesIngresoOrdenex`): acá no se
 * suma dinero, solo se muestra (money-safe).
 */
export function TotalesIngresoPanel({
  totales,
  ariaLabel = INGRESO_PANEL_LABEL,
}: Readonly<{
  totales: TotalesIngresoOrdenex;
  ariaLabel?: string;
}>) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{INGRESO_PANEL_LABEL}</h3>
      <Card>
        {/* Cada concepto va CON su IVA en un solo monto: el IVA no es un concepto aparte,
            es parte de lo que se factura. El desglose separado vive en la fila desplegable. */}
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <TotalItem label={FLETE_CON_IVA_LABEL} value={money(totales.fleteConIva)} />
          <TotalItem label={COMISION_CON_IVA_LABEL} value={money(totales.comisionConIva)} />
          <TotalItem
            label={FLETE_DEV_CON_IVA_LABEL}
            value={money(totales.fleteDevolucionConIva)}
          />
          <TotalItem label={INGRESO_TOTAL_LABEL} value={money(totales.total)} emphasis />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 170 (T E.5) — columnas y proyección de export POR RESULTADO. Vive aquí y no en el
 * módulo de columnas porque un `Record` exportado desde un `*-descarga-columnas.ts` se le
 * escaparía a la guardia de datos sensibles, que solo reconoce arrays de columnas y
 * funciones de proyección. Allí están las cinco declaraciones sueltas —vigiladas una a una—
 * y aquí, el mapa que elige cuál toca.
 */
const DESCARGA_POR_RESULTADO: Record<
  CierreResultado,
  { columnas: DescargaColumna[]; fila: (g: CierreDetalleGestion) => DescargaFila }
> = {
  entregada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
    fila: filaDescargaGestionEntregada,
  },
  reprogramada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
    fila: filaDescargaGestionReprogramada,
  },
  devuelta: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
    fila: filaDescargaGestionDevuelta,
  },
  rechazada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
    fila: filaDescargaGestionRechazada,
  },
  incidente: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
    fila: filaDescargaGestionIncidente,
  },
};

/**
 * Las 4 secciones por resultado de un cierre (reuso del render de la 37/38, R11):
 * entregadas / reprogramadas / devueltas / rechazadas, cada una como `region`
 * accesible. La evidencia (R12) se abre por `onVerEvidencia` con la URL firmada.
 */
export function DetalleSecciones({
  grupos,
  onVerEvidencia,
  contexto,
}: {
  grupos: CierreGrupos;
  onVerEvidencia: (url: string) => void;
  /**
   * Feature 170 (T E.5): de QUIÉN son estas secciones (hoy, el nombre del mensajero del
   * `cierre_dia`). Se anexa al nombre de la descarga.
   *
   * No es cosmética: el detalle de un cierre de BODEGA monta estas secciones una vez POR
   * mensajero incluido, así que sin el contexto habría tres botones llamados «Descargar
   * Entregadas» en el mismo modal y ninguno diría de quién (R13). También hace que el
   * archivo se llame `entregadas-<mensajero>-<fecha>.xlsx` en vez de `entregadas-…`.
   */
  contexto?: string;
}) {
  return (
    <>
      {ORDEN_RESULTADOS.map((resultado) => {
        const filas = grupos[resultado] ?? [];
        // Pedido: no mostrar las secciones sin registros (p. ej. reprogramadas con 0).
        if (filas.length === 0) return null;
        const descarga = DESCARGA_POR_RESULTADO[resultado];
        const tituloDescarga = contexto
          ? `${RESULTADO_LABEL[resultado]} · ${contexto}`
          : RESULTADO_LABEL[resultado];
        return (
          <section
            key={resultado}
            aria-label={RESULTADO_LABEL[resultado]}
            className="flex flex-col gap-3"
          >
            <h4 className="text-sm font-semibold">
              {RESULTADO_LABEL[resultado]}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({filas.length})
              </span>
            </h4>
            <div className="overflow-x-auto">
              <DataTable
                columns={columnasPara(resultado, onVerEvidencia)}
                data={filas}
                rowKey="gestionId"
                ariaLabel={RESULTADO_LABEL[resultado]}
                emptyMessage={RESULTADO_VACIO[resultado]}
                /**
                 * Feature 170 (T E.5, R1/R8/R11/R22/R26/R30/R37) — UNA DESCARGA POR SECCIÓN
                 * (decisión del humano, P2 ratificada): cada resultado tiene sus columnas y
                 * su botón, y no hay un archivo único del cierre.
                 *
                 * Familia B: `filas` es el grupo COMPLETO que ya llegó con el detalle, así
                 * que el archivo sale de lo que la tabla pinta, en su mismo orden y sin
                 * releer. Descargar no toca el estado del modal ni la fila desplegada (R37):
                 * el control vive fuera del `<table>` y no llama a ningún setter.
                 *
                 * La URL FIRMADA de la evidencia NO viaja al archivo: la columna
                 * correspondiente es un «Sí/No» (R22).
                 */
                descarga={{
                  titulo: tituloDescarga,
                  columnas: descarga.columnas,
                  obtenerFilas: () => filasLocales(filas, descarga.fila),
                }}
                // Solo el detalle de admin trae `ingresoOrdenex`. Sin él se devuelve `null`
                // (y no un componente que renderiza vacío): así la tabla no pinta el botón
                // de desplegar sobre una fila que no tiene nada que mostrar.
                renderExpanded={(g) =>
                  g.ingresoOrdenex ? <DesgloseIngresoOrdenex g={g} /> : null
                }
                expandAriaLabel={desgloseAriaLabel}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}

/**
 * Visor de la evidencia fotográfica (URL FIRMADA, R12): nunca el storage_path
 * crudo. `url === null` → cerrado. Modal reutilizable entre módulos.
 */
export function VisorEvidencia({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={url !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Evidencia de la gestión"
      confirmLabel="Cerrar"
      hideCancel
      onConfirm={onClose}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Evidencia fotográfica de la gestión"
          className="max-h-[60vh] w-full rounded-md object-contain"
        />
      ) : null}
    </Modal>
  );
}
