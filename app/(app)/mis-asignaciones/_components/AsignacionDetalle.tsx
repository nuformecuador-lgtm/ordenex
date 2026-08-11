import type { ReactNode } from "react";
import { MapPin } from "lucide-react";

import {
  INTENTOS_LABEL,
  IntentosValor,
  valorIntentos,
} from "@/components/shared/intentos-entrega";
import { formatMonto as formatMontoConfigurado, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 (R11) / rediseño 63: detalle de una orden asignada en TRES secciones
// (Pedido, Entrega, Cobro), cada una como lista de definición accesible (<dt>/<dd>).
// Componente de presentación puro, sin lógica de negocio ni fetch; recibe la orden ya
// resuelta (nombres, no IDs). El botón "Gestionar esta orden" NO vive aquí.
//
// Rediseño ux (pedido humano): cada sección es una CARD con su título en color de marca,
// la dirección va destacada en un bloque con pin, y el cobro se lee de un tirón en un
// bloque navy (el dato que el mensajero canta en la puerta). Lo consumen el panel de
// gestión y el desplegable de las cards POS, así que el cambio es el mismo en los tres.

/**
 * Monto a cobrar con la moneda configurada, con 2 decimales y separador de miles,
 * o la raya larga si es nulo.
 *
 * Feature 201: el formato sale de `lib/config/moneda.ts`. Aquí vivía una copia del
 * formateador "estilo EEUU" (`₡13,331,832.72`), la misma que en `pos-format.ts`,
 * `RecepcionDetalle` y `SateliteOrderCard`. El marcador de ausencia se pasa
 * explícito (`SIN_MONTO_RAYA`) porque el default del compartido es el guion corto.
 */
function formatMonto(monto: number | null): string {
  return formatMontoConfigurado(monto, SIN_MONTO_RAYA);
}

/** Peso en kilogramos (p. ej. "1.5 kg"), o "—" si es nulo. */
function formatPeso(peso: number | null): string {
  if (peso === null) return "—";
  return `${peso} kg`;
}

/** Un dato del detalle: etiqueta pequeña en mayúsculas + valor destacado. */
function Campo({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  /** `true` para números que se leen dígito a dígito (guía, teléfono). */
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

function Seccion({
  titulo,
  children,
}: Readonly<{ titulo: string; children: ReactNode }>) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-brand">
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
    <div className="flex flex-col gap-3">
      {/* Sección 1 — Pedido */}
      <Seccion titulo="Pedido">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Campo label="Nº Guía" mono>
            {orden.numGuia ?? "—"}
          </Campo>
          <Campo label="Nombre">{orden.destinatario}</Campo>
          <Campo label="Teléfono" mono>
            {orden.telefonoDest}
          </Campo>
          <Campo label="Producto">{orden.producto}</Campo>
        </dl>
      </Seccion>

      {/* Sección 2 — Entrega */}
      <Seccion titulo="Entrega">
        {/* La dirección manda: bloque propio con pin, legible de un vistazo al llegar. */}
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-muted/60 p-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug text-foreground">
              {orden.direccion ?? "—"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {orden.distritoNombre === null
                ? orden.cantonNombre
                : `${orden.distritoNombre}, ${orden.cantonNombre}`}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-4">
          <Campo label="Provincia">{orden.provinciaNombre}</Campo>
          <Campo label="Cantón">{orden.cantonNombre}</Campo>
          <Campo label="Distrito">{orden.distritoNombre ?? "—"}</Campo>
        </dl>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 border-t border-border pt-4">
          <Campo label="Notas">{orden.notas ?? "—"}</Campo>
          {/* Feature 160 (R18/R19/R24): intentos de entrega como UN CAMPO MAS del
              detalle, con el mismo <dt>/<dd> que sus hermanos. Vive en "Entrega" porque
              califica al reparto, no al pedido. Siempre visible, `0` incluido. */}
          <div className="text-right">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {INTENTOS_LABEL}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">
              <IntentosValor intentos={valorIntentos(orden)} />
            </dd>
          </div>
        </dl>
      </Seccion>

      {/* Sección 3 — Cobro */}
      <Seccion titulo="Cobro">
        {/* `@container`: el peso se descuelga por el ancho REAL de esta caja, no por el del
            viewport. Este detalle se pinta en sitios muy distintos —el panel del mensajero,
            una card del mosaico en grilla de 3— así que un breakpoint de pantalla mentiría:
            en un monitor ancho la card sigue midiendo ~300px. */}
        <dl className="@container flex items-stretch gap-3">
          <div className="flex flex-1 flex-col justify-center rounded-xl bg-navy px-4 py-3 text-white">
            <dt className="text-xs font-medium uppercase tracking-wide text-white/70">
              Valor a cobrar
            </dt>
            <dd className="font-mono text-2xl font-bold">
              {formatMonto(orden.montoCobrar)}
            </dd>
          </div>
          {/* `@xs` = 20rem de CONTENEDOR: por debajo de eso el peso le roba sitio al valor a
              cobrar, que es EL dato de la puerta, así que se descuelga. */}
          <div className="hidden w-24 flex-col justify-center rounded-xl border border-border px-4 py-3 @xs:flex">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Peso
            </dt>
            <dd className="font-mono text-lg font-bold text-foreground">
              {formatPeso(orden.peso)}
            </dd>
          </div>
        </dl>
      </Seccion>
    </div>
  );
}
