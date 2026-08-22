"use client";

import { MapPin, Navigation } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import {
  avisoReservaParaOtroDia,
  ETIQUETA_PARA_MANANA,
} from "@/lib/utils/dia-reparto-textos";

import { UbicacionTrigger } from "../UbicacionTrigger";
import { formatMonto } from "./pos-format";
import { estadoBadgeClass, estadoPorDefecto, textoParada } from "./pos-estado";
import { posSeleccionHandlers } from "./pos-seleccion";
import { seccionesVisibles } from "./pos-secciones";
import type { PosOrderCardProps } from "./PosOrderCard";

// POS card · vista DETALLE en FILA (rama ux, pedido humano): una línea por orden con la
// acción de navegar a la izquierda (target grande, lo primero que necesita el mensajero
// en la calle), los datos de identificación al centro y el monto a cobrar a la derecha.
// Componente NUEVO y hermano de `PosOrderCard` (que se conserva intacta) y de
// `PosOrderCardMosaico`: comparten interfaz de props, así que son intercambiables.
//
// El botón de navegar es un ENLACE real a Google Maps (mismo criterio que `PosNavBlock`:
// ruta directa, pestaña nueva, sin forzar permisos de GPS), no un botón decorativo. Al ser
// un control interno, pulsarlo NO selecciona la orden de rebote (ver `pos-seleccion`).

export function PosOrderCardDetalle({
  orden,
  total,
  esActiva = false,
  esDetalle = false,
  bloqueado = false,
  onGestionar,
  estado: estadoProp,
  mostrarRuta = true,
  secciones,
  acciones,
}: PosOrderCardProps) {
  const estado = estadoProp ?? estadoPorDefecto(esActiva, esDetalle);
  // Feature 196: las mismas compuertas que las otras dos vistas, con el mismo default.
  // `detalle` no tiene nada que apagar AQUÍ: esta vista es una fila y nunca llevó el
  // desplegable "Ver detalle completo" (lo dice el encabezado del componente).
  const {
    navegacion: verNavegacion,
    cobro: verCobro,
    intentos: verIntentos,
  } = seccionesVisibles(secciones);
  const { seleccionable, onClick, onKeyDown } = posSeleccionHandlers({
    onGestionar,
    bloqueado,
  });

  // Ubicación en una línea: cantón · distrito — dirección (lo que falta se omite).
  const ubicacion = [
    [orden.cantonNombre, orden.distritoNombre].filter(Boolean).join(" · "),
    orden.direccion,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <article
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={seleccionable ? 0 : undefined}
      // Mismo criterio que en la vista mosaico: la card conserva su nombre accesible aunque
      // ya no seleccione al tocarla (rama ux).
      aria-label={
        onGestionar
          ? `Gestionar orden ${orden.numRemision} · ${orden.destinatario}`
          : `Orden ${orden.numRemision} · ${orden.destinatario}`
      }
      className={`flex flex-col gap-2 rounded-xl border bg-card p-2.5 shadow-sm transition-all ${
        esDetalle ? "border-brand ring-1 ring-brand" : "border-border"
      } ${
        seleccionable
          ? "cursor-pointer hover:border-brand/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          : ""
      }`}
    >
      <div className="flex items-center gap-3">
      {verNavegacion ? (
        <UbicacionTrigger
          orden={orden}
          ariaLabel={`Ver en el mapa la ubicación de ${orden.destinatario}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-transform hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          <Navigation className="size-5" aria-hidden="true" />
        </UbicacionTrigger>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {mostrarRuta ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-navy text-[10px] font-black text-white">
              <span className="sr-only">
                {orden.secuenciaRuta === null
                  ? "Sin posición en la ruta"
                  : `Parada ${orden.secuenciaRuta} de ${total}`}
              </span>
              <span aria-hidden="true">{textoParada(orden)}</span>
            </span>
          ) : null}
          <span className="font-mono text-[11px] font-bold text-foreground">
            {orden.numRemision}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${estadoBadgeClass(estado)}`}
          >
            {estado}
          </span>
          {/* Marcas de EXCEPCIÓN (R28 / feature 115/R18 / feature 246/R22), solo si aplican. */}
          {mostrarRuta && orden.secuenciaRuta === null ? (
            <Badge variant="outline">Pendiente de optimizar</Badge>
          ) : null}
          {/* Feature 246 (T5.2, R22): orden RESERVADA para el día siguiente, dicha con palabras.
              El dato lo deriva el servidor (`esParaManana`, R26) y deja de ser cierto solo, al
              llegar el día (R25).
              ⏳ FEATURE 261 (2026-08-21): la decisión D5 quedó REVERTIDA — la reserva ya no
              protege sólo del corte, también del mensajero: la orden no se puede recoger ni
              gestionar hasta su día, y el bloqueo vive en el servidor. R23 sigue en pie: la marca
              **no oculta** la orden y la card sigue entera. Ver `specs/261-dia-reparto-protege`. */}
          {orden.esParaManana ? (
            <Badge variant="info">{ETIQUETA_PARA_MANANA}</Badge>
          ) : null}
          {orden.marcarLuego ? (
            <Badge variant="warning">Gestionar más tarde</Badge>
          ) : null}
        </div>
        <p className="truncate text-sm font-bold text-foreground">
          {orden.destinatario}
        </p>
        {/* La línea de ubicación es parte de la NAVEGACIÓN, no del identificador: sin ella
            el "Sin dirección" del fallback afirmaría un hueco donde no hay dato que dar. */}
        {verNavegacion ? (
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden="true" />
            {ubicacion || "Sin dirección"}
          </p>
        ) : null}
        {/* Feature 160/R19: intentos siempre visibles, `0` incluido, en las superficies que
            los tienen; la 196 permite apagarlos donde no existen. */}
        {verIntentos ? (
          <p className="text-[11px] font-semibold text-muted-foreground">
            <IntentosDato intentos={valorIntentos(orden)} />
          </p>
        ) : null}
        {/* Feature 261 (F2, R11): el badge dice QUÉ es la orden; esta línea dice POR QUÉ todavía
            no se puede trabajar y DESDE QUÉ DÍA se podrá. El literal NO se escribe aquí: sale de
            la fuente única (`avisoReservaParaOtroDia`, R15), la misma frase que devuelve el
            servidor al rechazar y la misma que lee la tienda. La fecha llega YA RESUELTA en
            `fechaRepartoISO` (R14): aquí no se construye ningún `Date`. */}
        {orden.esParaManana ? (
          <p role="note" className="text-[11px] font-semibold text-muted-foreground">
            {avisoReservaParaOtroDia(orden.fechaRepartoISO)}
          </p>
        ) : null}
      </div>

      {verCobro ? (
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cobrar
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            {formatMonto(orden.montoCobrar)}
          </span>
        </div>
      ) : null}
      </div>

      {/* Controles del consumidor al pie, DENTRO de la card (p. ej. el toggle
          "gestionar más tarde", feature 115/R5/R6). */}
      {acciones ? (
        <div className="border-t border-dashed border-border pt-2">{acciones}</div>
      ) : null}
    </article>
  );
}
