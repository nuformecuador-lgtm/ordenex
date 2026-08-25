"use client";

import { useState } from "react";
import { ChevronDown, MapPin, Package } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { formatMonto as formatMontoConfigurado, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

import { RecepcionDetalle } from "./RecepcionDetalle";

// Rediseño POS (rama ux) aplicado a la bodega satélite: MISMA card compacta que ve el
// mensajero en "Por recoger" / "En reparto" (`PosOrderCardMosaico`), adaptada al DTO del
// satélite (`RecepcionSateliteDTO`, sin ruta ni coordenadas).
//
// Es un componente HERMANO, no una generalización de la card del mensajero: los dos DTO
// no coinciden (aquí no hay `secuenciaRuta`, `peso`, `notas` ni lat/lng) y forzarlos a un
// tipo común acoplaría dos módulos que evolucionan por separado. Lo que se comparte es el
// LENGUAJE VISUAL: remisión en mono, badge de estado, destinatario/producto, ubicación
// sobre navy, monto a cobrar destacado y el desplegable "Ver detalle completo".

/**
 * Monto con la moneda configurada y separador de miles, o la raya larga si es nulo.
 *
 * Feature 201: el formato sale de `lib/config/moneda.ts` (era la cuarta copia del
 * formateador "estilo EEUU", `₡13,331,832.72`). El marcador de ausencia se pasa
 * explícito porque el default del compartido es el guion corto.
 */
function formatMonto(monto: number | null): string {
  return formatMontoConfigurado(monto, SIN_MONTO_RAYA);
}

export interface SateliteOrderCardProps {
  orden: RecepcionSateliteDTO;
  /** Estado legible de la orden ("en bodega satélite de <zona>", …), R9. */
  estadoLegible: string;
}

// Feature 278 (T3.5, R5): la card TENÍA una prop `acciones?: ReactNode` documentada como
// «Acción propia del grupo ("Aceptar", "Recuperar"…)» que pintaba un pie al final. Se
// retira con su contenedor: comprobado en el árbol antes de borrar, **ningún consumidor la
// pasaba**. Su único usuario había sido el botón «Aceptar» que esta ficha quita, y dejarla
// viva no era neutral: un hueco de acción que nadie rellena, documentado con el nombre del
// botón retirado, señala exactamente dónde volver a meterlo.

export function SateliteOrderCard({
  orden,
  estadoLegible,
}: Readonly<SateliteOrderCardProps>) {
  // Estado del desplegable del detalle: UI efímera, de un solo consumidor.
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const intentos = valorIntentos(orden);

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 leading-none">
          <p className="truncate font-mono text-xs font-bold tracking-wide text-foreground">
            {orden.numRemision}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
            {orden.numGuia === null ? "Sin guía" : `Guía ${orden.numGuia}`}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {estadoLegible}
        </span>
      </header>

      <div className="flex items-center gap-2">
        <Package className="size-4 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">
            {orden.destinatario}
          </p>
          <p className="truncate text-xs text-muted-foreground">{orden.producto}</p>
        </div>
      </div>

      {/* Ubicación sobre navy, igual que la card del mensajero: zona a la vista y la
          dirección completa debajo, con elipsis si no cabe. */}
      <div className="flex items-center gap-2 rounded-lg bg-navy px-2 py-1.5 text-white">
        <MapPin className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {orden.cantonNombre}
            {orden.distritoNombre ? (
              <span className="text-white/60"> · {orden.distritoNombre}</span>
            ) : null}
          </span>
          {orden.direccion ? (
            <span className="block truncate text-[0.6875rem] text-white/70">
              {orden.direccion}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            A cobrar
          </p>
          <p className="font-mono text-base font-bold text-foreground">
            {formatMonto(orden.montoCobrar)}
          </p>
        </div>
        {/* Feature 160 (R25): intentos de entrega, siempre visibles (`0` incluido). */}
        <IntentosDato intentos={intentos} />
      </div>

      {/* Detalle COMPLETO desplegable: no se pierde información al compactar la card. */}
      <Collapsible open={detalleAbierto} onOpenChange={setDetalleAbierto}>
        <CollapsibleTrigger className="flex w-full items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted">
          {detalleAbierto ? "Ocultar detalle" : "Ver detalle completo"}
          <ChevronDown
            className={`size-3.5 transition-transform ${detalleAbierto ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted className="collapsible-panel">
          <div className="mt-2 border-t border-border pt-2">
            <RecepcionDetalle orden={orden} estadoLegible={estadoLegible} />
          </div>
        </CollapsibleContent>
      </Collapsible>

    </article>
  );
}
