"use client";

import { useState } from "react";
import { MessageSquareDot, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

import { coincideBusqueda } from "../mis-asignaciones-buscador";
import { ESTADO_CHIP, estadoDe, iniciales, zonaCorta } from "./chat-format";

// Rediseño del chat (rama ux) — columna izquierda: un contacto por orden EN REPARTO (su
// destinatario). Filtra en cliente con el MISMO criterio que el buscador del módulo
// (`coincideBusqueda`: guía, remisión, teléfono o nombre), así que buscar aquí se siente
// igual que buscar allá. Nada de datos inventados: cada fila muestra solo lo que trae el
// DTO de la asignación — remisión (identificador que el mensajero canta por radio), guía
// cuando existe, estado y zona.
//
// SIN LEER: cada fila puede llevar un distintivo con los entrantes que el cliente mandó y el
// mensajero todavía no ha visto. El conteo llega ya resuelto desde `ChatFlotante` (servidor,
// `resumenNoLeidosChat`); aquí solo se pinta. Una fila sin entrada en el mapa es cero.

/** Tope del distintivo: por encima se pinta `+9` (el ancho de la burbuja es fijo). */
const BADGE_MAX = 9;

function OrdenFila({
  orden,
  seleccionada,
  noLeidos,
  onSeleccionar,
}: {
  orden: MiAsignacionDTO;
  seleccionada: boolean;
  /** Entrantes sin leer de esta conversación; 0 = sin distintivo. */
  noLeidos: number;
  onSeleccionar: (id: string) => void;
}) {
  const chip = ESTADO_CHIP[estadoDe(orden.estatusValue)];
  return (
    <button
      type="button"
      onClick={() => onSeleccionar(orden.id)}
      aria-current={seleccionada ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        seleccionada && "bg-accent",
      )}
    >
      <div className="relative shrink-0">
        <div
          className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
          aria-hidden="true"
        >
          {iniciales(orden.destinatario)}
        </div>
        {noLeidos > 0 ? (
          // Mismos tokens que el distintivo del botón flotante y que la campana: `-strong` es
          // la variante contrast-safe (AA) del semántico, con `text-background` acompañando su
          // giro entre temas. Va sobre el avatar, que es el ancla visual de la fila.
          <span
            data-testid={`chat-no-leidos-${orden.id}`}
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-card bg-danger-strong px-1 text-[11px] font-semibold leading-none text-background"
          >
            {noLeidos > BADGE_MAX ? `+${BADGE_MAX}` : noLeidos}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {orden.destinatario}
          </p>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {orden.numRemision}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {orden.numGuia !== null ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {orden.numGuia}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
              chip.className,
            )}
          >
            {chip.label}
          </span>
        </div>

        <p className="mt-1 truncate text-xs text-muted-foreground">
          {zonaCorta(orden)}
        </p>

        {/* El distintivo de arriba es una cifra suelta sobre el avatar: fuera de contexto no
            dice de qué es. El nombre accesible del botón lo dice con palabras. */}
        {noLeidos > 0 ? (
          <span className="sr-only">
            {noLeidos === 1 ? "1 mensaje sin leer" : `${noLeidos} mensajes sin leer`}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export interface ChatOrdenesListaProps {
  /** Órdenes en reparto: una fila por orden (su destinatario es el interlocutor). */
  ordenes: MiAsignacionDTO[];
  /**
   * Entrantes sin leer por `ordenId`. Ausencia = cero. Lo resuelve `ChatFlotante` contra el
   * servidor; la lista no consulta nada por su cuenta.
   */
  noLeidos: ReadonlyMap<string, number>;
  /** Conversación abierta ahora mismo. */
  seleccionadaId: string | null;
  /** Orden en gestión (la del detalle): se ancla arriba, separada del resto. */
  ordenEnDetalleId: string | null;
  onSeleccionar: (id: string) => void;
  className?: string;
}

export function ChatOrdenesLista({
  ordenes,
  noLeidos,
  seleccionadaId,
  ordenEnDetalleId,
  onSeleccionar,
  className,
}: Readonly<ChatOrdenesListaProps>) {
  const [query, setQuery] = useState("");

  const q = normalizeName(query);
  const filtradas = ordenes.filter((o) => coincideBusqueda(o, q));
  const enGestion = filtradas.find((o) => o.id === ordenEnDetalleId) ?? null;
  const resto = filtradas.filter((o) => o.id !== ordenEnDetalleId);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-border bg-card md:border-r",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Conversaciones
        </h2>
        {/* `mr-10` (40px): en móvil la lista ocupa todo el ancho y esta esquina cae justo
            debajo de la X de cierre del Dialog. En ≥md la lista es la columna izquierda y la
            X queda lejos, así que el margen se anula. */}
        <span className="mr-10 text-[11px] text-muted-foreground md:mr-0">
          {ordenes.length} en reparto
        </span>
      </header>

      <div className="px-3 py-3">
        <div className="flex items-center gap-2 rounded-full bg-muted px-3.5 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar guía o destinatario"
            aria-label="Buscar guía o destinatario"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* Orden en gestión: se ancla arriba con la barra de marca (mismo lenguaje que
            el MODO FOCO del módulo). */}
        {enGestion ? (
          <section aria-label="Orden en gestión">
            <div className="flex items-center gap-1.5 px-4 pb-1 pt-1">
              <MessageSquareDot className="size-3.5 text-primary" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                En gestión
              </span>
            </div>
            <div className="border-l-[3px] border-primary bg-primary/5">
              <OrdenFila
                orden={enGestion}
                seleccionada={seleccionadaId === enGestion.id}
                noLeidos={noLeidos.get(enGestion.id) ?? 0}
                onSeleccionar={onSeleccionar}
              />
            </div>
          </section>
        ) : null}

        <section aria-label="Todas las órdenes en reparto">
          <div className="px-4 pb-1 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Todas en reparto
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {resto.map((orden) => (
              <OrdenFila
                key={orden.id}
                orden={orden}
                seleccionada={seleccionadaId === orden.id}
                noLeidos={noLeidos.get(orden.id) ?? 0}
                onSeleccionar={onSeleccionar}
              />
            ))}
          </div>
          {filtradas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {ordenes.length === 0
                ? "No tienes órdenes en reparto."
                : "Ninguna conversación coincide con la búsqueda."}
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
