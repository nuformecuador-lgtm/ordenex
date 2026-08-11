"use client";

import { CarruselCards } from "@/components/shared/CarruselCards";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import {
  VistaCardsToggle,
  type VistaCards,
} from "@/app/(app)/mis-asignaciones/_components/VistaCardsToggle";
import {
  CLASE_FASE,
  type FaseTransicion,
} from "@/app/(app)/mis-asignaciones/_components/useTransicionVista";
import { TOPE_RECOLECTADAS_HOY } from "@/lib/constants/recoleccion-tienda";
import type { RecolectadaHoyDTO } from "@/lib/types/recoleccion-tienda";

// Feature 167 (R24/R28/R30/R31) — lo que el mensajero YA recolectó hoy. Presentación pura:
// recibe la lista por props, YA acotada al día natural de Costa Rica (R27), YA filtrada al
// propio actor (R21/R29) y YA ordenada de la más reciente a la más antigua por el servidor.
//
// NO reordena ni recorta: si este componente ordenara por su cuenta, el orden del servidor y
// el de la pantalla podrían divergir y el tope dejaría de significar "las más recientes"
// (R31). Aquí solo se pinta.
//
// 2026-08-11 (decisión del humano): pinta la MISMA card que el resto del portal
// (`PosOrderCardMosaico` / `PosOrderCardDetalle`) en vez de su fila propia de guía·remisión·
// tienda·hora. La vista NO la decide este componente: la recibe del módulo, que es donde vive
// el único conmutador del apartado — dos secciones de la misma pantalla conmutando por
// separado serían dos preferencias para una sola mirada.
//
// La HORA se conserva: es el único dato que la card no tiene y el que convierte la lista en el
// trabajo del día. Va por el pie de la card (`acciones`), que es el hueco que la card
// compartida deja para lo propio de cada consumidor.
//
// Sigue montado con el mensajero BLOQUEADO por un cierre pendiente: es historial de lo ya
// hecho, no una acción (R23).

const TITULO = "Recolectadas hoy";

/** R30: el vacío se DICE, no se omite — omitir la lista parecería que el trabajo se perdió. */
const VACIO =
  "Todavía no has recolectado ninguna orden hoy. Las que escanees aparecerán aquí.";

/**
 * R31: la lista viene recortada; se avisa para que nadie la lea como "esto es todo".
 *
 * El número NO se escribe a mano: sale de la MISMA constante que el servidor usa para recortar
 * (`TOPE_RECOLECTADAS_HOY`). Mientras el literal estaba duplicado, cambiar el tope dejaba este
 * aviso mintiendo sin que ningún test lo notara (hallazgo m5 del review).
 */
const RECORTADA = `Se muestran las ${TOPE_RECOLECTADAS_HOY} más recientes de hoy.`;

// Hora FIJA en la zona de Costa Rica: la lectura es estable y no depende de la zona del
// dispositivo. Es la misma convención con la que el servidor decidió qué es "hoy" (R27), así
// que la hora que el mensajero lee y el día al que pertenece la fila no pueden contradecirse.
const HORA_CR = new Intl.DateTimeFormat("es-CR", {
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

function horaDe(fecha: Date): string {
  const ms = fecha.getTime();
  return Number.isNaN(ms) ? "—" : HORA_CR.format(fecha);
}

export interface RecolectadasHoyListaProps {
  /** R28: de la MÁS RECIENTE a la más antigua, tal como llega del servidor. */
  recolectadasHoy: readonly RecolectadaHoyDTO[];
  /** R31: hoy hay más recolecciones de las que trae la lista. */
  recortada?: boolean;
  /** Vista EFECTIVA (la que toca pintar), decidida por el módulo. */
  vista: VistaCards;
  /** Vista PEDIDA: la que el conmutador refleja mientras corre la animación. */
  vistaPedida: VistaCards;
  /** Tramo de la animación del conmutador, para que las dos secciones se muevan a la vez. */
  fase: FaseTransicion;
  /** Cambia la vista del APARTADO entero (el estado vive en el módulo). */
  onVistaChange: (vista: VistaCards) => void;
}

export function RecolectadasHoyLista({
  recolectadasHoy,
  recortada = false,
  vista,
  vistaPedida,
  fase,
  onVistaChange,
}: Readonly<RecolectadasHoyListaProps>) {
  /**
   * Una card «recolectada hoy». La MISMA de «Por recoger» y «Por recolectar»: sin `onGestionar`
   * (solo-visualización) y sin ruta (no son paradas). El `estado` dice en qué punto está.
   */
  function renderCard(orden: RecolectadaHoyDTO, vistaCard: VistaCards) {
    const CardVista =
      vistaCard === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;
    return (
      <CardVista
        orden={orden}
        total={recolectadasHoy.length}
        estado="Recolectada"
        mostrarRuta={false}
        acciones={
          <p className="text-[11px] font-semibold text-muted-foreground">
            Recolectada a las{" "}
            <time
              dateTime={
                Number.isNaN(orden.recolectadaAt.getTime())
                  ? undefined
                  : orden.recolectadaAt.toISOString()
              }
              className="tabular-nums"
            >
              {horaDe(orden.recolectadaAt)}
            </time>
          </p>
        }
      />
    );
  }

  return (
    <section aria-label={TITULO} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{TITULO}</h2>
        {recolectadasHoy.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {recolectadasHoy.length === 1
                ? "1 orden recolectada hoy."
                : `${recolectadasHoy.length} órdenes recolectadas hoy.`}
            </p>
            {/* Conmutador PROPIO de esta sección, sobre el MISMO estado que el de arriba: el
                control queda al alcance de la lista que gobierna, pero la preferencia sigue
                siendo una sola para todo el apartado (los dos conmutadores se mueven juntos). */}
            <VistaCardsToggle vista={vistaPedida} onVistaChange={onVistaChange} />
          </div>
        ) : null}
      </div>

      {recolectadasHoy.length === 0 ? (
        <p className="text-sm text-muted-foreground">{VACIO}</p>
      ) : (
        <>
          {vista === "mosaico" ? (
            <div className={CLASE_FASE[fase]}>
              <CarruselCards
                items={[...recolectadasHoy]}
                getKey={(orden) => orden.id}
                ariaLabel="Órdenes recolectadas hoy"
                singular="Orden"
                plural="Órdenes"
                renderItem={(orden) => renderCard(orden, "mosaico")}
              />
            </div>
          ) : (
            <ul className={`flex flex-col gap-3 ${CLASE_FASE[fase]}`}>
              {recolectadasHoy.map((orden) => (
                <li key={orden.id}>{renderCard(orden, "detalle")}</li>
              ))}
            </ul>
          )}
          {recortada ? (
            <p role="status" className="text-sm text-muted-foreground">
              {RECORTADA}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
