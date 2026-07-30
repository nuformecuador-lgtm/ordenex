import type { ReactNode } from "react";

import {
  INTENTOS_LABEL,
  IntentosValor,
  valorIntentos,
} from "@/components/shared/intentos-entrega";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (R9): detalle de presentación de una orden del módulo satélite,
// como lista de definición accesible (<dt>/<dd>). Componente puro (sin lógica de
// negocio ni fetch): recibe la orden ya resuelta (nombres, no IDs) por props.
// Espejo de AsignacionDetalle (feature 36), adaptado a RecepcionSateliteDTO (sin
// campo `notas`).

/** Monto en colones (₡) con separador de miles, o "—" si es nulo. */
function formatMonto(monto: number | null): string {
  if (monto === null) return "—";
  const [entero, decimales] = monto.toFixed(2).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₡${conMiles}.${decimales}`;
}

/** Une la jerarquía geográfica en una línea legible (omite los vacíos). */
function ubicacion(orden: RecepcionSateliteDTO): string {
  return [
    orden.zonaNombre,
    orden.provinciaNombre,
    orden.cantonNombre,
    orden.distritoNombre,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export interface RecepcionDetalleProps {
  orden: RecepcionSateliteDTO;
  /** Estado legible ("en bodega satélite de <zona>" / "en ruta..."), R9. */
  estadoLegible: string;
}

/** Detalle de una orden del módulo satélite (R9). */
export function RecepcionDetalle({ orden, estadoLegible }: RecepcionDetalleProps) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo label="Nº Guía">{orden.numGuia ?? "—"}</Campo>
      <Campo label="Nº Remisión">{orden.numRemision}</Campo>
      <Campo label="Estado">{estadoLegible}</Campo>
      <Campo label="Tienda">{orden.tiendaNombre}</Campo>
      <Campo label="Destinatario">{orden.destinatario}</Campo>
      <Campo label="Teléfono">{orden.telefonoDest}</Campo>
      <Campo label="Dirección">{orden.direccion ?? "—"}</Campo>
      <Campo label="Ubicación">{ubicacion(orden) || "—"}</Campo>
      <Campo label="Producto">{orden.producto}</Campo>
      <Campo label="Monto a cobrar">{formatMonto(orden.montoCobrar)}</Campo>
      {/* Feature 160 (R18/R19/R25): intentos de entrega como UN CAMPO MAS del detalle
          —mismo `Campo` (<dt>/<dd>) que sus hermanos, misma jerarquia—, en los dos
          grupos que se presentan como cards ("Por recibir" y "Devueltas"). Se muestra
          siempre, `0` incluido; sin umbral (R20). */}
      <Campo label={INTENTOS_LABEL}>
        <IntentosValor intentos={valorIntentos(orden)} />
      </Campo>
    </dl>
  );
}
