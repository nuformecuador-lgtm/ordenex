"use client";

import { Package, StickyNote, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "../AsignacionDetalle";
import { PosAmountRow } from "./PosAmountRow";
import { PosCardHeader } from "./PosCardHeader";
import { PosComms } from "./PosComms";
import { PosNavBlock } from "./PosNavBlock";

// POS card · card de una orden EN REPARTO, réplica del `PosCardExpand` de la
// referencia (terminal de reparto: navegación primero, targets grandes, alto
// contraste, paleta navy/brand del rebrand). Ensambla las piezas separadas
// (cabecera, navegación, cobro, contacto) y conserva las señales del módulo del
// mensajero: badges de ruta/"gestionar más tarde", preview de la nota privada y el
// detalle COMPLETO inline (feature 113/R1) plegado en un `<details>` para no perder
// información. El botón "Gestionar orden" reemplaza el click-en-toda-la-card: al
// pulsarlo se selecciona la orden y se abre el panel de gestión grande de abajo.

export interface PosOrderCardProps {
  orden: MiAsignacionDTO;
  /** Total de órdenes en reparto, para el "N de total" de la cabecera. */
  total: number;
  /** La orden tiene el puntero de gestión 1-a-1 fijado (R19/R20). */
  esActiva: boolean;
  /** La orden es la mostrada en el panel de detalle grande de abajo. */
  esDetalle: boolean;
  /** Mensajero bloqueado por cierre pendiente (feature 111/R14): deshabilita gestionar. */
  bloqueado: boolean;
  /** Selecciona esta orden para el panel de gestión (equivale al antiguo click en la card). */
  onGestionar: () => void;
}

export function PosOrderCard({
  orden,
  total,
  esActiva,
  esDetalle,
  bloqueado,
  onGestionar,
}: PosOrderCardProps) {
  const estado = esActiva ? "En gestión" : esDetalle ? "En detalle" : "En reparto";

  return (
    <article
      className={`overflow-hidden rounded-3xl bg-card shadow-sm ring-2 transition-all ${
        esDetalle ? "ring-brand" : "ring-border"
      }`}
    >
      <PosCardHeader orden={orden} total={total} estado={estado} />

      <div className="space-y-3 p-4">
        {/* Destinatario + producto (réplica del bloque `Package` de la referencia). */}
        <div className="flex items-center gap-2">
          <Package className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-foreground">
              {orden.destinatario}
            </h3>
            <p className="truncate font-mono text-xs uppercase text-muted-foreground">
              {orden.producto}
            </p>
            {/* Feature 160 (R18/R19/R24): intentos de entrega como DATO de la card, en
                el mismo bloque de campos que Destinatario y Producto y con su mismo
                tratamiento. NO va en la fila de marcas informativas de abajo: ahí viven
                "Pendiente de optimizar" y "Gestionar más tarde", que son marcas de
                EXCEPCIÓN, y D6 decidió que los intentos son un dato. Siempre visible,
                `0` incluido; sin umbral (R20). */}
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              <IntentosDato intentos={valorIntentos(orden)} />
            </p>
          </div>
        </div>

        {/* R28 (pendiente de optimizar) + feature 115/R18 (gestionar más tarde):
            marcas informativas de la card, en una fila que envuelve. */}
        {orden.secuenciaRuta === null || orden.marcarLuego ? (
          <div className="flex flex-wrap gap-1.5">
            {orden.secuenciaRuta === null ? (
              <Badge variant="outline" className="w-fit">
                Pendiente de optimizar
              </Badge>
            ) : null}
            {orden.marcarLuego ? (
              <Badge variant="warning" className="w-fit">
                Gestionar más tarde
              </Badge>
            ) : null}
          </div>
        ) : null}

        {/* Feature 116/R12: indicador de la NOTA PRIVADA del mensajero (badge + preview). */}
        {orden.notaPrivada ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="shrink-0">
              <StickyNote aria-hidden="true" />
              Mi nota
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {orden.notaPrivada}
            </span>
          </div>
        ) : null}

        <PosNavBlock orden={orden} />
        <PosAmountRow montoCobrar={orden.montoCobrar} />
        <PosComms telefono={orden.telefonoDest} nombre={orden.destinatario} />

        {/* Feature 113/R1: detalle COMPLETO (Pedido/Entrega/Cobro) disponible sin salir
            de la card, plegado para no competir con la navegación. */}
        <details className="rounded-2xl border border-border bg-muted/40 px-3 py-2 [&_summary]:cursor-pointer">
          <summary className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Ver detalle completo
          </summary>
          <div className="mt-3 border-t border-border pt-3">
            <AsignacionDetalle orden={orden} />
          </div>
        </details>

        {/* "Gestionar orden": selecciona la orden y abre el panel de gestión grande de
            abajo. Reemplaza el click en toda la card; deshabilitado si el mensajero
            está bloqueado por cierre pendiente (feature 111/R14). */}
        <button
          type="button"
          disabled={bloqueado}
          aria-pressed={esDetalle}
          onClick={onGestionar}
          aria-label={`Gestionar orden ${orden.numRemision} · ${orden.destinatario}`}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-5 text-lg font-black uppercase tracking-wide text-white shadow-lg shadow-brand/20 transition-transform active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
        >
          <Truck className="size-6" aria-hidden="true" /> Gestionar orden
        </button>
      </div>
    </article>
  );
}
