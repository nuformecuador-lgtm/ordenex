"use client";

import type { ReactNode } from "react";
import type { MetodoPagoValue } from "@prisma/client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";

// Feature 40 (T8) — helpers y componentes compartidos del detalle de cierre entre
// el módulo de cierres de mensajero (feature 38, `CierresAdminModule`) y los nuevos
// módulos de cierre de bodega (adminSatelite `ConsolidacionBodegaModule` / maestro
// `CierresBodegaAdminModule`). Extraídos verbatim del `CierresAdminModule` original
// para NO duplicar: money-safe (R13), etiquetas i18n-ready, columnas por resultado
// con evidencia firmada (R12) y el visor de evidencia. Sin lógica de dominio propia.

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
export const RESULTADO_LABEL: Record<CierreResultado, string> = {
  entregada: "Entregadas",
  reprogramada: "Reprogramadas",
  devuelta: "Devueltas",
  rechazada: "Rechazadas",
};

export const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
};

export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SIMPE: "SIMPE",
  transferencia: "Transferencia",
};

export const ESTADO_LABEL: Record<CierreEstado, string> = {
  solicitado: "Solicitado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  vencido: "Vencido", // feature 41: etiqueta minima; el tratamiento diferenciado (R20) lo hace frontend_dev
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

// --- Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready) ---
export const PAGO_MENSAJERO_LABEL = "Pago al mensajero";
export const PAGO_MENSAJERO_COL = "Pago mensajero";
// --- Feature 56: etiquetas del ingreso de bodega por rechazos (texto separado, i18n-ready) ---
export const INGRESO_BODEGA_RECHAZOS_LABEL = "Ingreso de bodega por rechazos";
export const INGRESO_BODEGA_RECHAZOS_COL = "Ingreso bodega";
/** Aviso discreto (F1.4-5): pago de una entrega resuelto a ₡0.00 (tarifa faltante). */
export const PAGO_SIN_TARIFA_LABEL = "Sin tarifa";
export const PAGO_SIN_TARIFA_NOTA =
  "El pago al mensajero de esta entrega se resolvió en ₡0.00 (posible tarifa de zona sin configurar).";

/** Orden fijo de las 4 secciones del detalle (R11). */
export const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
];

/**
 * Prefija el símbolo de colón a un monto que YA viene como string (money-safe,
 * R13): NUNCA se parsea a número para no perder precisión. `null` → "—".
 */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
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
 * Panel de totales snapshot por método (R13): efectivo / SIMPE / transferencia +
 * general. Los montos llegan como STRING y se renderizan tal cual (money-safe). Es
 * una `region` accesible con nombre `ariaLabel` para que el E2E la localice.
 */
export function TotalesPanel({
  totales,
  ariaLabel,
  title,
  labelGeneral = "Total general",
}: {
  totales: CierreTotales;
  ariaLabel: string;
  title: string;
  labelGeneral?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <TotalItem label="Efectivo" value={money(totales.efectivo)} />
          <TotalItem label="SIMPE" value={money(totales.simpe)} />
          <TotalItem
            label="Transferencia"
            value={money(totales.transferencia)}
          />
          <TotalItem label={labelGeneral} value={money(totales.general)} emphasis />
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
  if (resultado === "entregada") {
    return [
      ...COLUMNAS_COMUNES,
      { id: "monto", value: "Monto", render: (g) => money(g.montoRecibido) },
      {
        id: "metodo",
        value: "Método",
        render: (g) => (g.metodoPago ? METODO_LABEL[g.metodoPago] : "—"),
      },
      // Feature 39/R16: pago al mensajero snapshot por orden (separado del dinero recibido).
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  if (resultado === "reprogramada") {
    return [
      ...COLUMNAS_COMUNES,
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
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  // rechazada: motivo + evidencia firmada (R12) + ingreso de bodega por rechazos (56/R12)
  return [
    ...COLUMNAS_COMUNES,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    {
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
    },
    COLUMNA_PAGO_MENSAJERO,
    COLUMNA_INGRESO_BODEGA_RECHAZOS,
  ];
}

/**
 * Las 4 secciones por resultado de un cierre (reuso del render de la 37/38, R11):
 * entregadas / reprogramadas / devueltas / rechazadas, cada una como `region`
 * accesible. La evidencia (R12) se abre por `onVerEvidencia` con la URL firmada.
 */
export function DetalleSecciones({
  grupos,
  onVerEvidencia,
}: {
  grupos: CierreGrupos;
  onVerEvidencia: (url: string) => void;
}) {
  return (
    <>
      {ORDEN_RESULTADOS.map((resultado) => {
        const filas = grupos[resultado] ?? [];
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
