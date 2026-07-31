"use client";

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
}

export function RecolectadasHoyLista({
  recolectadasHoy,
  recortada = false,
}: Readonly<RecolectadasHoyListaProps>) {
  return (
    <section aria-label={TITULO} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{TITULO}</h2>
        {recolectadasHoy.length > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {recolectadasHoy.length === 1
              ? "1 orden recolectada hoy."
              : `${recolectadasHoy.length} órdenes recolectadas hoy.`}
          </p>
        ) : null}
      </div>

      {recolectadasHoy.length === 0 ? (
        <p className="text-sm text-muted-foreground">{VACIO}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {recolectadasHoy.map((orden) => (
              <li
                key={orden.ordenId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm"
              >
                <span className="font-semibold tabular-nums">
                  Guía {orden.numGuia ?? "—"}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {orden.numRemision}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {orden.tiendaNombre} ·{" "}
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
                </span>
              </li>
            ))}
          </ul>
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
