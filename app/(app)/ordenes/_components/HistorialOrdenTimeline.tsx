import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";
import {
  ETIQUETA_CORRECCION_DIA,
  textoCorreccionDiaReparto,
} from "@/lib/utils/dia-reparto-textos";

import { estatusLabel } from "./estatus-label";

// Feature 49 (T6.1, R29/R30) — linea de tiempo de PRESENTACION pura del historial de una
// orden. Recibe las entradas ya resueltas por PROPS (R28: no fetchea por si mismo) y las
// pinta en orden cronologico ascendente. Los estados se muestran con
// su etiqueta legible via `estatusLabel` (R30, NUNCA UUIDs); el actor cae a "Sistema"
// cuando la transicion la origino el cron/job (R21/R29) y el motivo solo aparece si existe
// (R22). Sin logica de fetch/estado: es un componente tonto reutilizable por el drawer.
//
// FEATURE 262 (design §14.4) — LA LINEA DE TIEMPO TIENE DOS CLASES DE ENTRADA. Ademas de las
// transiciones de estado, pinta las CORRECCIONES DEL DIA DE REPARTO, que NO TIENEN ESTADO DE
// ORIGEN NI DE DESTINO (R39). El `switch` sobre `entrada.clase` es EXHAUSTIVO y TypeScript lo
// demuestra (`const _exhaustivo: never` en el `default`): si la union gana una tercera clase,
// esto NO COMPILA. Ese rojo ES la funcionalidad (R42) — la alternativa que se descarto era
// volver `estatusDestinoValue` nullable, y entonces este componente habria seguido compilando
// y habria pintado una fila vacia sin que nada se enterase.
//
// ESTE COMPONENTE NO ORDENA NADA (R41): el orden entre las dos fuentes lo decide el servidor
// (`fusionarLineaDeTiempo`, design §14.3). Y NO LLEVA NI UN LITERAL DE FECHA: los textos del dia
// salen de la fuente unica `lib/utils/dia-reparto-textos.ts`, que es pura y no importa `Date`
// ni `Intl` (R18/R41).

/**
 * @pendiente-262-f6 F6 (ver la app) sigue sin hacerse para esta pantalla: falta abrir «Ver
 * historial» de una orden corregida con cuenta maestro/admin y con adminTienda, y comprobar en
 * vivo que la entrada se lee y se distingue. La rama de correccion se escribio en la tanda de
 * backend con el alcance MINIMO —estructura y textos, nada de pulido visual— porque `B24` rompia
 * el build aqui y una rama con el build roto no pasa el gate. Lo que queda es de F7/F8: el estilo
 * fino y el resto de la suite de pantalla. `tests/unit/guards/historial-correccion-dia.guardia.
 * test.ts` explica que vigila cada clausula y por que esta anotacion no se borra sola.
 */

// Formateo FIJO a la zona de Costa Rica: la lectura del timestamp es estable y determinista
// (no depende de la zona horaria del entorno donde corre el render).
//
// El SELLO DE HORA si lo formatea el componente, y no contradice lo de arriba: un INSTANTE
// (`createdAt`) y una FECHA CALENDARIO (el dia de reparto) son cosas distintas. El instante ya
// se formateaba asi para todas las entradas antes de la 262.
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** Actor del sistema (cron/job) cuando `actorNombre` es null (R21/R29). */
const ACTOR_SISTEMA = "Sistema";

function formatFechaHora(fecha: Date): string {
  const ms = fecha.getTime();
  return Number.isNaN(ms) ? "—" : FECHA_HORA.format(fecha);
}

export interface HistorialOrdenTimelineProps {
  /** Entradas ya FUSIONADAS y ordenadas cronologicamente (asc) por el servidor (R26/R28/R41). */
  entradas: OrdenHistorialEntradaDTO[];
}

export function HistorialOrdenTimeline({ entradas }: HistorialOrdenTimelineProps) {
  if (entradas.length === 0) {
    // Estado vacio: orden sin historial (p. ej. creada antes del deploy de la feature).
    return <p className="text-sm text-muted-foreground">Sin historial todavía.</p>;
  }

  return (
    <ol aria-label="Línea de tiempo de estados" className="flex flex-col gap-4">
      {entradas.map((entrada, index) => {
        const createdMs = entrada.createdAt.getTime();
        // La `key` antepone la CLASE: con dos fuentes, dos entradas del mismo instante en la
        // misma posicion producirian `key` iguales y React remonta en silencio (design §14.4).
        const key = `${entrada.clase}-${index}-${Number.isNaN(createdMs) ? "na" : createdMs}`;
        const sello = (
          <time
            dateTime={Number.isNaN(createdMs) ? undefined : entrada.createdAt.toISOString()}
            className="text-xs text-muted-foreground"
          >
            {formatFechaHora(entrada.createdAt)}
          </time>
        );

        switch (entrada.clase) {
          case "transicion": {
            const esCreacion = entrada.estatusOrigenValue === null; // R20: origen vacio = creacion
            const destinoLabel = estatusLabel(entrada.estatusDestinoValue);
            const actor = entrada.actorNombre ?? ACTOR_SISTEMA;

            return (
              <li
                key={key}
                className="relative flex flex-col gap-1 border-l-2 border-border pl-4"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[5px] size-2 rounded-full bg-primary"
                />
                {/* R30: origen -> destino con etiquetas legibles; en la creacion, "Creación · destino". */}
                <p className="flex flex-wrap items-center gap-1 text-sm font-medium">
                  <span>{esCreacion ? "Creación" : estatusLabel(entrada.estatusOrigenValue)}</span>
                  <span aria-hidden="true">{esCreacion ? "·" : "→"}</span>
                  <span>{destinoLabel}</span>
                </p>
                {sello}
                <p className="text-xs text-muted-foreground">Por {actor}</p>
                {entrada.motivo ? <p className="text-sm">Motivo: {entrada.motivo}</p> : null}
              </li>
            );
          }
          case "correccion_dia": {
            // R39: en esta rama NO se llama a `estatusLabel` ni se pinta la flecha de estados.
            // Una correccion no tiene estado de origen ni de destino, y presentarla como una
            // transicion seria mentir sobre la maquina de estados.
            return (
              <li
                key={key}
                className="relative flex flex-col gap-1 border-l-2 border-border pl-4"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[5px] size-2 rounded-full bg-primary"
                />
                <p className="flex flex-wrap items-center gap-1 text-sm font-medium">
                  <span>{ETIQUETA_CORRECCION_DIA}</span>
                </p>
                <p className="text-sm">
                  {textoCorreccionDiaReparto(entrada.fechaAnteriorISO, entrada.fechaNuevaISO)}
                </p>
                {sello}
                <p className="text-xs text-muted-foreground">Por {entrada.actorNombre}</p>
                <p className="text-sm">Motivo: {entrada.motivo}</p>
              </li>
            );
          }
          default: {
            // Exhaustividad DEMOSTRADA: una clase nueva sin rama rompe el build aqui (R42).
            const _exhaustivo: never = entrada;
            void _exhaustivo;
            return null;
          }
        }
      })}
    </ol>
  );
}
