"use client";

import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import {
  avisoReservaParaOtroDia,
  ETIQUETA_PARA_MANANA,
} from "@/lib/utils/dia-reparto-textos";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "../AsignacionDetalle";
import { PosAmountRow } from "./PosAmountRow";
import { PosCardHeader } from "./PosCardHeader";
import { PosNavBlock } from "./PosNavBlock";
import { seccionesVisibles, type PosSecciones } from "./pos-secciones";

// POS card · card de una orden EN REPARTO, réplica del `PosCardExpand` de la
// referencia (terminal de reparto: navegación primero, targets grandes, alto
// contraste, paleta navy/brand del rebrand). Ensambla las piezas separadas
// (cabecera, navegación, cobro) y conserva las señales del módulo del mensajero:
// badges de ruta/"gestionar más tarde" y el detalle COMPLETO inline
// (feature 113/R1) plegado para no perder información.
//
// Pedido humano (rama ux): la card NO lleva acciones de contacto ("Llamar" /
// "WhatsApp") ni el CTA "Gestionar orden". El contacto vive en el panel de gestión;
// la selección se hace pulsando la card, que para eso es un target accesible
// (`aria-label` + foco de teclado con Enter/Espacio).

export interface PosOrderCardProps {
  orden: MiAsignacionDTO;
  /** Total de órdenes en reparto, para el "N de total" de la cabecera. */
  total: number;
  /** La orden tiene el puntero de gestión 1-a-1 fijado (R19/R20). */
  esActiva?: boolean;
  /** La orden es la mostrada en el panel de detalle grande de abajo. */
  esDetalle?: boolean;
  /** Mensajero bloqueado por cierre pendiente (feature 111/R14): deshabilita gestionar. */
  bloqueado?: boolean;
  /**
   * Selecciona esta orden para el panel de gestión. Si NO se pasa, la card es de
   * solo-visualización (superficies como "Por recoger"): no es clickeable ni
   * enfocable.
   */
  onGestionar?: () => void;
  /** Etiqueta de estado; por defecto se deriva de `esActiva`/`esDetalle`. */
  estado?: string;
  /**
   * `false` para superficies sin ruta optimizada ("Por recoger"): oculta el nº de parada
   * de la cabecera y la marca "Pendiente de optimizar". Default `true`.
   */
  mostrarRuta?: boolean;
  /**
   * Controles propios del consumidor al PIE de la card, DENTRO de ella (pedido humano:
   * el toggle "gestionar más tarde" va dentro de la tarjeta, no como hermano suelto).
   * La card es un `<article>`, no un botón, así que alojar controles es HTML válido; el
   * gate de selección los ignora (ver `pos-seleccion`), no seleccionan de rebote.
   */
  acciones?: ReactNode;
  /**
   * Qué secciones se pintan (feature 196). Todas van a `true` por defecto, así que NINGUNA
   * superficie existente cambia y la prop es puramente aditiva. Las TRES vistas la
   * respetan: la resuelve `seccionesVisibles` en un solo sitio (`pos-secciones`).
   */
  secciones?: PosSecciones;
}

export function PosOrderCard({
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

  // Seleccionar la orden pulsando CUALQUIER parte de la card (pedido humano). La card ya
  // no tiene CTA propio, así que este handler es la única vía de selección.
  //
  // La card contiene sus PROPIOS controles (Ir, el desplegable del detalle), y un
  // `<article>` clickeable no puede envolverlos en un botón sin producir HTML inválido:
  // se queda como `<article>` con `aria-label` + `tabIndex` en lugar de `role="button"`.
  // El click se ignora cuando nace dentro de un control: navegar o abrir el detalle NO
  // debe seleccionar de rebote.
  function nacidoEnControl(target: EventTarget | null) {
    return Boolean(
      (target as HTMLElement | null)?.closest("a, button, input, summary, label"),
    );
  }

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    if (!onGestionar || bloqueado) return;
    if (nacidoEnControl(event.target)) return;
    onGestionar();
  }

  // Paridad de teclado con el click: Enter/Espacio sobre la card la selecciona. Solo
  // cuando la tecla nace en la card misma, para no secuestrar los controles internos.
  function handleCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!onGestionar || bloqueado) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onGestionar();
  }

  // Feature 196: las secciones se pintan salvo que el consumidor las apague.
  const {
    navegacion: verNavegacion,
    cobro: verCobro,
    detalle: verDetalle,
    intentos: verIntentos,
  } = seccionesVisibles(secciones);

  // La card responde a puntero/teclado solo si hay selección disponible y no está bloqueada.
  const seleccionable = Boolean(onGestionar) && !bloqueado;
  const estado =
    estadoProp ??
    (esActiva ? "En gestión" : esDetalle ? "En detalle" : "En reparto");

  return (
    <article
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      tabIndex={seleccionable ? 0 : undefined}
      aria-label={
        onGestionar
          ? `Gestionar orden ${orden.numRemision} · ${orden.destinatario}`
          : undefined
      }
      className={`overflow-hidden rounded-3xl bg-card shadow-sm ring-2 transition-all ${
        esDetalle ? "ring-brand" : "ring-border"
      } ${
        seleccionable
          ? "cursor-pointer hover:ring-brand/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          : ""
      }`}
    >
      <PosCardHeader
        orden={orden}
        total={total}
        estado={estado}
        mostrarParada={mostrarRuta}
      />

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
            {verIntentos ? (
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                <IntentosDato intentos={valorIntentos(orden)} />
              </p>
            ) : null}
          </div>
        </div>

        {/* R28 (pendiente de optimizar) + feature 115/R18 (gestionar más tarde) + feature
            246/R22 (para mañana): marcas informativas de la card, en una fila que envuelve. */}
        {(mostrarRuta && orden.secuenciaRuta === null) ||
        orden.marcarLuego ||
        orden.esParaManana ? (
          <div className="flex flex-wrap gap-1.5">
            {mostrarRuta && orden.secuenciaRuta === null ? (
              <Badge variant="outline" className="w-fit">
                Pendiente de optimizar
              </Badge>
            ) : null}
            {/* Feature 246 (T5.2, R22). La marca va TAMBIÉN aquí, y no sólo en las dos cards que
                el portal monta hoy: las tres son PARALELAS, no variantes, y una card que no
                dijera «Para mañana» dejaría de distinguir la orden reservada en cuanto alguien
                la montara. Que hoy no esté montada no la hace correcta.
                ⏳ FEATURE 261 (2026-08-21, F4) — LA REGLA CAMBIÓ y este comentario con ella. La
                decisión D5 de la 246 —la que dejaba la reserva como defensa sólo frente al corte
                nocturno— quedó REVERTIDA: una orden reservada para un día posterior ya no se
                puede recoger, ni escoger, ni gestionar hasta ese día, y el bloqueo real vive en
                el servidor. R23 sigue en pie: la marca no esconde la orden y la card se monta
                entera — lo que se restringe es la ACCIÓN, no la visibilidad (R9). Por eso debajo
                va el aviso en palabras: un control gris sin explicación es un misterio.
                Ver `specs/261-dia-reparto-protege`. */}
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

        {/* Feature 261 (F2, R11): el badge dice QUÉ es la orden; esta línea dice POR QUÉ todavía
            no se puede trabajar y DESDE QUÉ DÍA se podrá. El literal NO se escribe aquí: sale de
            la fuente única (`avisoReservaParaOtroDia`, R15), la misma frase que devuelve el
            servidor cuando rechaza y la misma que lee la tienda. La fecha viaja YA RESUELTA por
            el servidor en `fechaRepartoISO` (R14): aquí no se construye ningún `Date`. */}
        {orden.esParaManana ? (
          <p role="note" className="text-xs font-semibold text-muted-foreground">
            {avisoReservaParaOtroDia(orden.fechaRepartoISO)}
          </p>
        ) : null}

        {verNavegacion ? <PosNavBlock orden={orden} /> : null}
        {verCobro ? <PosAmountRow montoCobrar={orden.montoCobrar} /> : null}

        {/* Feature 113/R1: detalle COMPLETO (Pedido/Entrega/Cobro) disponible sin salir
            de la card, plegado para no competir con la navegación. Es un `Collapsible` de
            Base UI (no un `<details>`) para que abra y cierre BARRIENDO la altura, igual
            que el resto de desplegables de la app (`collapsible-panel`, globals.css);
            `keepMounted` deja el detalle en el DOM plegado, así la información sigue
            estando (y siendo buscable) sin depender de la animación. */}
        {verDetalle ? (
          <Collapsible
            open={detalleAbierto}
            onOpenChange={setDetalleAbierto}
            className="group/detalle rounded-2xl border border-border bg-muted/40 px-3 py-2"
          >
            <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Ver detalle completo
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform duration-200 group-data-[open]/detalle:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted className="collapsible-panel">
              <div className="mt-3 border-t border-border pt-3">
                <AsignacionDetalle orden={orden} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {acciones}
      </div>
    </article>
  );
}
