import type { ReactNode } from "react";

import {
  INTENTOS_LABEL,
  IntentosValor,
  valorIntentos,
} from "@/components/shared/intentos-entrega";
import { formatMonto as formatMontoConfigurado, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (R9): detalle de presentación de una orden del módulo satélite,
// como lista de definición accesible (<dt>/<dd>). Componente puro (sin lógica de
// negocio ni fetch): recibe la orden ya resuelta (nombres, no IDs) por props.
// Espejo de AsignacionDetalle (feature 36), adaptado a RecepcionSateliteDTO (sin
// campo `notas`).

/**
 * Monto con la moneda configurada y separador de miles, o la raya larga si es nulo.
 *
 * Feature 201: el formato sale de `lib/config/moneda.ts` (era una copia del
 * formateador "estilo EEUU", `₡13,331,832.72`). El marcador de ausencia se pasa
 * explícito porque el default del compartido es el guion corto.
 */
function formatMonto(monto: number | null): string {
  return formatMontoConfigurado(monto, SIN_MONTO_RAYA);
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

/**
 * Un dato del detalle. Rediseño ux: MISMO formato que `AsignacionDetalle` del mensajero
 * (etiqueta pequeña en mayúsculas + valor destacado, `mono` para los números que se leen
 * dígito a dígito), para que los dos módulos se lean igual.
 */
function Campo({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm font-semibold text-foreground${mono ? " font-mono" : ""}`}
      >
        {children}
      </dd>
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
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">
      <Campo label="Nº Guía" mono>
        {orden.numGuia ?? "—"}
      </Campo>
      <Campo label="Nº Remisión" mono>
        {orden.numRemision}
      </Campo>
      <Campo label="Estado">{estadoLegible}</Campo>
      <Campo label="Tienda">{orden.tiendaNombre}</Campo>
      <Campo label="Destinatario">{orden.destinatario}</Campo>
      <Campo label="Teléfono" mono>
        {orden.telefonoDest}
      </Campo>
      <Campo label="Dirección">{orden.direccion ?? "—"}</Campo>
      <Campo label="Ubicación">{ubicacion(orden) || "—"}</Campo>
      <Campo label="Producto">{orden.producto}</Campo>
      <Campo label="Monto a cobrar" mono>
        {formatMonto(orden.montoCobrar)}
      </Campo>
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
