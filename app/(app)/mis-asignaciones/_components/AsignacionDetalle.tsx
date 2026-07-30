import type { ReactNode } from "react";

import {
  INTENTOS_LABEL,
  IntentosValor,
  valorIntentos,
} from "@/components/shared/intentos-entrega";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 (R11) / rediseño 63 (pedido humano): detalle de una orden asignada,
// presentado en TRES secciones visualmente separadas (Pedido, Entrega, Cobro),
// cada una como lista de definición accesible (<dt>/<dd>). Componente de
// presentación puro, sin lógica de negocio ni fetch; recibe la orden ya resuelta
// (nombres, no IDs) por props desde el Server Component padre. El botón
// "Gestionar esta orden" NO vive aquí (lo pone el panel de gestión).

/**
 * Formatea el monto a cobrar en colones (₡) con 2 decimales y separador de
 * miles, o "—" si es nulo. Formateo determinista (no depende de datos ICU de
 * locale, que varían por entorno).
 */
function formatMonto(monto: number | null): string {
  if (monto === null) return "—";
  const [entero, decimales] = monto.toFixed(2).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₡${conMiles}.${decimales}`;
}

/** Peso en kilogramos (p. ej. "1.5 kg"), o "—" si es nulo. */
function formatPeso(peso: number | null): string {
  if (peso === null) return "—";
  return `${peso} kg`;
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Seccion({
  titulo,
  divider,
  children,
}: Readonly<{
  titulo: string;
  divider?: boolean;
  children: ReactNode;
}>) {
  return (
    <section
      className={`flex flex-col gap-2${divider ? " border-t border-border pt-4" : ""}`}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export interface AsignacionDetalleProps {
  orden: MiAsignacionDTO;
}

/** Detalle de una orden en 3 secciones (R11 / 63), reutilizado por ambos apartados. */
export function AsignacionDetalle({ orden }: AsignacionDetalleProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Sección 1 — Pedido */}
      <Seccion titulo="Pedido">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo label="Nº Guía">{orden.numGuia ?? "—"}</Campo>
          <Campo label="Nombre">{orden.destinatario}</Campo>
          <Campo label="Teléfono">{orden.telefonoDest}</Campo>
          <Campo label="Producto">{orden.producto}</Campo>
        </dl>
      </Seccion>

      {/* Sección 2 — Entrega */}
      <Seccion titulo="Entrega">
        <dl className="flex flex-col gap-3">
          <Campo label="Dirección">
            <span className="font-medium">{orden.direccion ?? "—"}</span>
          </Campo>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo label="Provincia">{orden.provinciaNombre}</Campo>
            <Campo label="Cantón">{orden.cantonNombre}</Campo>
            <Campo label="Distrito">{orden.distritoNombre ?? "—"}</Campo>
          </div>
          <Campo label="Notas">{orden.notas ?? "—"}</Campo>
          {/* Feature 160 (R18/R19/R24): intentos de entrega como UN CAMPO MAS del
              detalle, con el mismo `Campo` (<dt>/<dd>) que Nº Guía, Nombre, Teléfono o
              Producto. Vive en "Entrega" porque califica al reparto, no al pedido. Lo
              ve el mensajero en "por recoger" (PorAceptarSection) y dentro del
              desplegable de la card POS. Siempre visible, `0` incluido; sin umbral. */}
          <Campo label={INTENTOS_LABEL}>
            <IntentosValor intentos={valorIntentos(orden)} />
          </Campo>
        </dl>
      </Seccion>

      {/* Sección 3 — Cobro */}
      <Seccion titulo="Cobro">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo label="Valor a cobrar">{formatMonto(orden.montoCobrar)}</Campo>
          <Campo label="Peso">{formatPeso(orden.peso)}</Campo>
        </dl>
      </Seccion>
    </div>
  );
}
