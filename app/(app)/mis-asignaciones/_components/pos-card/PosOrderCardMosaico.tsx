"use client";

import { useState } from "react";
import { ChevronDown, MapPin, Navigation, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { ETIQUETA_PARA_MANANA } from "@/lib/utils/dia-reparto-textos";

import { AsignacionDetalle } from "../AsignacionDetalle";
import { UbicacionTrigger } from "../UbicacionTrigger";
import { formatMonto, formatPeso } from "./pos-format";
import { estadoBadgeClass, estadoPorDefecto, textoParada } from "./pos-estado";
import { posSeleccionHandlers } from "./pos-seleccion";
import { seccionesVisibles } from "./pos-secciones";
import type { PosOrderCardProps } from "./PosOrderCard";

// POS card · vista MOSAICO (rama ux, pedido humano): tarjeta COMPACTA para ver muchas
// órdenes de un vistazo en la grilla de "En reparto / por gestionar". Es un componente
// NUEVO y hermano de `PosOrderCard` (la card completa, que se conserva intacta): misma
// interfaz de props, así que las tres vistas son intercambiables sin tocar el consumidor.
//
// Qué se conserva respecto de la card completa: número de remisión, parada de ruta,
// badge de estado, destinatario/producto, intentos, cantón·distrito sobre navy, monto a
// cobrar y las marcas de excepción (pendiente de optimizar / gestionar más tarde).
// más el desplegable "Ver detalle completo" (feature 113/R1), igual que la card completa:
// en mosaico se prioriza el barrido, pero la información NO se pierde ni obliga a ir al
// panel. Lo único que se omite es el bloque de navegación grande ("Ir" + dirección), que
// es el protagonista de la vista de detalle en fila.

export function PosOrderCardMosaico({
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
  // Estado del desplegable del detalle: UI efímera, de un solo consumidor.
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const estado = estadoProp ?? estadoPorDefecto(esActiva, esDetalle);
  // Feature 196: las mismas cuatro compuertas que la card completa, con el mismo default.
  const {
    navegacion: verNavegacion,
    cobro: verCobro,
    detalle: verDetalle,
    intentos: verIntentos,
  } = seccionesVisibles(secciones);
  const { seleccionable, onClick, onKeyDown } = posSeleccionHandlers({
    onGestionar,
    bloqueado,
  });

  return (
    <article
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={seleccionable ? 0 : undefined}
      // Sin selección por toque (rama ux: en reparto se gestiona desde el botón del pie) la
      // card sigue necesitando NOMBRE: es la etiqueta con la que se la anuncia y se la
      // localiza, aunque no sea un target.
      aria-label={
        onGestionar
          ? `Gestionar orden ${orden.numRemision} · ${orden.destinatario}`
          : `Orden ${orden.numRemision} · ${orden.destinatario}`
      }
      className={`flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-sm transition-all ${
        esDetalle ? "border-brand ring-1 ring-brand" : "border-border"
      } ${
        seleccionable
          ? "cursor-pointer hover:border-brand/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          : ""
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {mostrarRuta ? (
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-navy text-[11px] font-black text-white"
            >
              {textoParada(orden)}
            </span>
          ) : null}
          <div className="min-w-0 leading-none">
            <p className="truncate font-mono text-xs font-bold tracking-wide text-foreground">
              {orden.numRemision}
            </p>
            {/* R28: posición en la ruta + peso, mismo texto que la cabecera de la card
                completa (`PosCardHeader`) para no perder la señal al compactar. */}
            <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
              {mostrarRuta ? (
                <>
                  {orden.secuenciaRuta !== null ? (
                    <>
                      <span className="sr-only">Parada </span>
                      {orden.secuenciaRuta} de {total}
                    </>
                  ) : (
                    "Sin posición"
                  )}{" "}
                  ·{" "}
                </>
              ) : null}
              {formatPeso(orden.peso)}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${estadoBadgeClass(estado)}`}
        >
          {estado}
        </span>
      </header>

      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-foreground">
          {orden.destinatario}
        </p>
        <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
          <Package className="size-3 shrink-0 text-brand" aria-hidden="true" />
          {orden.producto}
        </p>
        {/* Feature 160/R19: los intentos son un DATO de la orden, siempre visible (`0` incluido)
            en las superficies que los tienen; la 196 permite apagarlos donde no existen. */}
        {verIntentos ? (
          <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
            <IntentosDato intentos={valorIntentos(orden)} />
          </p>
        ) : null}
      </div>

      {/* Bloque de ubicación sobre navy. Es un ENLACE real a Google Maps (mismo criterio
          que `PosNavBlock`: ruta directa, pestaña nueva, sin forzar permisos de GPS): en el
          mosaico no cabe el bloque "Ir" grande, así que la propia ubicación navega. Al ser
          un control interno, pulsarlo NO selecciona la orden de rebote. */}
      {verNavegacion ? (
        <UbicacionTrigger
          orden={orden}
          ariaLabel={`Ver en el mapa la ruta hasta ${orden.direccion ?? orden.cantonNombre}`}
          className="flex w-full items-center gap-2 rounded-lg bg-navy px-2 py-1.5 text-left text-white transition-colors hover:bg-navy-deep"
        >
          <MapPin className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          {/* `min-w-0` en el contenedor + `truncate` en cada línea: una dirección larga se
              corta con elipsis en vez de ensanchar la card del mosaico. */}
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
          <Navigation className="size-3.5 shrink-0" aria-hidden="true" />
        </UbicacionTrigger>
      ) : null}

      {/* R28 (pendiente de optimizar) + feature 115/R18 (gestionar más tarde) + feature 246/R22
          (para mañana): marcas de EXCEPCIÓN, solo si aplican, para no engordar el mosaico. */}
      {(mostrarRuta && orden.secuenciaRuta === null) ||
      orden.marcarLuego ||
      orden.esParaManana ? (
        <div className="flex flex-wrap gap-1.5">
          {mostrarRuta && orden.secuenciaRuta === null ? (
            <Badge variant="outline" className="w-fit">
              Pendiente de optimizar
            </Badge>
          ) : null}
          {/* Feature 246 (T5.2, R22): la orden está RESERVADA para el día siguiente. Se dice con
              PALABRAS y no sólo con un color, porque un chip de otro tono no explica qué es.
              `esParaManana` lo decide el SERVIDOR (R26) y caduca solo al llegar el día (R25):
              aquí no se compara ninguna fecha ni se lee ningún reloj.
              R23/R24 — la marca no oculta ni bloquea nada: la card sigue entera y la orden se
              puede recoger y gestionar igual. La reserva protege del corte de la noche, no del
              mensajero (decisión D5). */}
          {orden.esParaManana ? (
            <Badge variant="info" className="w-fit">
              {ETIQUETA_PARA_MANANA}
            </Badge>
          ) : null}
          {orden.marcarLuego ? (
            <Badge variant="warning" className="w-fit">
              Gestionar más tarde
            </Badge>
          ) : null}
        </div>
      ) : null}

      {verCobro ? (
        <div className="flex items-center justify-between border-t border-dashed border-border pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cobrar
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            {formatMonto(orden.montoCobrar)}
          </span>
        </div>
      ) : null}

      {/* Feature 113/R1: detalle COMPLETO (Pedido/Entrega/Cobro) disponible sin salir de
          la card, plegado para no romper el barrido del mosaico. Mismo `Collapsible` de
          Base UI que la card completa (barre la altura como el resto de desplegables de la
          app) y con `keepMounted`, así la información sigue en el DOM (y siendo buscable)
          aunque esté plegada o la animación no corra. */}
      {verDetalle ? (
        <Collapsible
          open={detalleAbierto}
          onOpenChange={setDetalleAbierto}
          className="group/detalle rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
        >
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Ver detalle completo
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform duration-200 group-data-[open]/detalle:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted className="collapsible-panel">
            <div className="mt-2 border-t border-border pt-2">
              <AsignacionDetalle orden={orden} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Controles del consumidor al pie, DENTRO de la card (p. ej. el toggle
          "gestionar más tarde", feature 115/R5/R6). */}
      {acciones}
    </article>
  );
}
