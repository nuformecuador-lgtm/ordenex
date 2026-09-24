import { NOTA_AYUDA_SOLICITADA } from "@/components/shared/nota-pendiente-confirmacion";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import type { OrdenEventoTipo } from "@/lib/types/orden-evento";
import type {
  OrdenHistorialEntradaDTO,
  OrdenHistorialEventoDTO,
} from "@/lib/types/orden-historial";
import {
  ETIQUETA_CORRECCION_DIA,
  textoCorreccionDiaReparto,
} from "@/lib/utils/dia-reparto-textos";

import { estatusLabel, resultadoLabel } from "./estatus-label";
import { motivoVisible } from "./motivo-historial";

// Feature 49 (T6.1, R29/R30) — linea de tiempo de PRESENTACION pura del historial de una
// orden. Recibe las entradas ya resueltas por PROPS (R28: no fetchea por si mismo) y las
// pinta en orden cronologico ascendente. Los estados se muestran con
// su etiqueta legible via `estatusLabel` (R30, NUNCA UUIDs); el actor cae a "Sistema"
// cuando la transicion la origino el cron/job (R21/R29) y el motivo solo aparece si existe
// (R22). Sin logica de fetch/estado: es un componente tonto reutilizable por el drawer.
//
// FICHA 427 (T20, design §9, R26/R29) — Y UNA TERCERA CLASE: el TRASPASO de la orden ENTRE
// MENSAJEROS. Llego exactamente por donde la 262 dijo que llegaria, y el `const _exhaustivo: never`
// del `default` hizo su trabajo: aterrizar el tipo nuevo SIN esta rama no compilaba. La entrada
// nombra al mensajero de origen, al de destino y a quien lo ejecuto, con su ROL CONGELADO (R26) —
// nunca el rol vivo de esa persona.
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
 * historial» de una orden corregida, en PREVIEW, con cuenta maestro/admin y con adminTienda, y
 * comprobar en vivo que la entrada se lee, se distingue y sale en su sitio cronologico.
 *
 * QUE CAMBIO Y QUE NO, para que nadie lea esta anotacion desactualizada. La tanda de backend la
 * dejo cubriendo DOS cosas: F6 y el pulido de F7/F8. **El pulido de F7/F8 ya esta hecho** —el
 * estilo de la entrada (anillo hueco y filo discontinuo, ninguno de color), el nombre accesible
 * de la lista, la descripcion del drawer y la suite de pantalla con la lista larga y el «se
 * distingue por texto»—, asi que esa mitad se RETIRA del texto. F6 no, y no se retira: ninguna
 * comprobacion automatica puede abrir un navegador contra preview con tres cuentas reales, y
 * este repo tiene la leccion medida de que ver la app encontro 7 textos rotos que 12.000 tests
 * daban por buenos. Lo que jsdom NO puede afirmar es justo lo visual: las clases de Tailwind
 * ahi son cadenas, nadie calcula el `border-style` ni el contraste del anillo.
 *
 * `tests/unit/guards/historial-correccion-dia.guardia.test.ts` explica que vigila cada clausula
 * y por que esta anotacion no se borra sola: quien la retire tiene que hacerlo A PROPOSITO,
 * borrando tambien la clausula (f) de esa guardia y dejando la evidencia en `progress/`.
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

/**
 * FICHA 427 (T20, R29) — los dos textos de la entrada de TRASPASO, en constantes de modulo y no
 * incrustados en el JSX (mismo criterio que `ACTOR_SISTEMA` y que `ETIQUETA_CORRECCION_DIA`): la
 * capa de presentacion queda lista para i18n y el texto se cambia en un solo sitio.
 *
 * LENGUAJE CLARO Y SIN SIGLAS, y sin nombrar ningun estado: un traspaso NO cambia el estado de la
 * orden (R21), asi que la entrada no puede leerse como si lo hiciera.
 */
const ETIQUETA_TRASPASO = "Traspaso a otro mensajero";

/** R29: «de quien a quien», con los dos nombres que el servidor ya resolvio. */
function textoTraspasoMensajero(anterior: string, nuevo: string): string {
  return `De ${anterior} a ${nuevo}`;
}

/**
 * FICHA 454 (T2.3, R30) — la primera línea de cada HECHO sin transición (`orden_evento`): dice QUÉ
 * pasó, en lenguaje claro y sin siglas. Indexado por el tipo con `Record` exhaustivo: un tipo nuevo
 * del enum no compila hasta que alguien decida cómo se lee.
 *
 * La de la ayuda es la MISMA nota que acompaña a la orden en las pantallas (decisión del humano,
 * `NOTA_AYUDA_SOLICITADA`), no un sinónimo. Ninguna nombra un estado: un evento NO lo cambia.
 */
const ETIQUETA_EVENTO: Record<OrdenEventoTipo, string> = {
  gestion_registrada: "Gestión registrada",
  gestion_anulada: "Gestión anulada",
  gestion_corregida: "Gestión corregida",
  ayuda_solicitada: NOTA_AYUDA_SOLICITADA,
  ayuda_rescatada: "Ayuda cerrada: la orden vuelve a gestionarse",
  ayuda_habilitada_api: "Ayuda cerrada por la integración de la tienda",
};

/**
 * FICHA 454 (R30) — la segunda línea: el RESULTADO de la gestión, con su nombre canónico
 * (`resultadoLabel`, el mismo mapa que el chip de estado). En la corrección, «de A a B». Los hechos
 * de la ayuda no llevan segunda línea (`null`).
 */
function textoResultadoEvento(entrada: OrdenHistorialEventoDTO): string | null {
  if (entrada.resultado === null) return null;
  if (entrada.tipo === "gestion_corregida" && entrada.resultadoAnterior !== null) {
    return `De ${resultadoLabel(entrada.resultadoAnterior)} a ${resultadoLabel(entrada.resultado)}`;
  }
  return `Resultado: ${resultadoLabel(entrada.resultado)}`;
}

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
    // F7 — EL NOMBRE ACCESIBLE DE LA LISTA YA NO PUEDE DECIR «de estados». Decia «Línea de
    // tiempo de estados» desde la 49, cuando la lista tenia UNA sola clase de entrada. Con la
    // 262 tiene dos, y una de ellas NO ES UN ESTADO (R39): a quien navega con lector de
    // pantalla se le anunciaba la lista entera como si lo fuera, que es exactamente lo que R39
    // prohibe, por la unica puerta donde no se ve. Los cuatro consumidores del nombre viejo se
    // actualizaron (un test de componente de la 155 y tres specs de Playwright); el nombre
    // nuevo queda fijado a mano en `tests/components/HistorialOrdenTimeline.test.tsx`.
    <ol aria-label="Línea de tiempo de la orden" className="flex flex-col gap-4">
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
                {/* FICHA 455 (F10): el motivo de las migraciones de retiro llega con el código
                    crudo; `motivoVisible` lo nombra con el formato de R11. */}
                {entrada.motivo ? <p className="text-sm">Motivo: {motivoVisible(entrada.motivo)}</p> : null}
              </li>
            );
          }
          case "correccion_dia": {
            // R39: en esta rama NO se llama a `estatusLabel` ni se pinta la flecha de estados.
            // Una correccion no tiene estado de origen ni de destino, y presentarla como una
            // transicion seria mentir sobre la maquina de estados.
            //
            // F7 — LA ENTRADA SE DISTINGUE POR TEXTO, Y ADEMAS POR FORMA. NUNCA POR COLOR.
            // Lo que la distingue de verdad es la primera linea, que dice QUE es (R38/R39, design
            // §14.4). Encima de eso, y solo encima, hay dos marcas VISUALES que sobreviven a una
            // captura en escala de grises y a cualquier daltonismo, porque no son de color:
            //
            //   · el punto es un ANILLO HUECO (`border-2` + `bg-popover`) y no un disco lleno;
            //   · el filo de la entrada es DISCONTINUO (`border-dashed`) y no continuo.
            //
            // Los TOKENS DE COLOR son EXACTAMENTE los mismos que usa la transicion
            // (`border-border`, `border-primary`): no se introduce ningun tono nuevo. Este repo
            // tiene guardia de contraste y una leccion escrita sobre medir color en el navegador
            // -la herramienta miente-, asi que un tono distinto no habria demostrado nada y
            // ademas no dice QUE es la entrada. `tests/components/HistorialOrdenTimeline.test.tsx`
            // afirma las dos mitades: que se distingue leyendo SOLO el texto, y que la diferencia
            // visual incluye al menos una marca que NO es de color.
            return (
              <li
                key={key}
                className="relative flex flex-col gap-1 border-l-2 border-dashed border-border pl-4"
              >
                {/* El hueco del anillo va en `bg-popover` y NO en `bg-background`, y esto se
                    MIDIO en un navegador, no se supuso: la superficie donde vive esta lista es
                    el `SheetContent` del drawer, que es `bg-popover` (`components/ui/sheet.tsx`).
                    Con `bg-background` el hueco salia en `rgb(10,21,36)` sobre un panel
                    `rgb(16,32,58)` en tema oscuro -un disco mas oscuro, no un hueco-. Y
                    `--popover` vale lo MISMO que `--card` en los dos temas, asi que tambien casa
                    si esta lista acaba dentro de una card. */}
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[6px] size-2.5 rounded-full border-2 border-primary bg-popover"
                />
                {/* La primera linea nombra la CLASE de entrada; el orden de las cinco lineas es
                    el de design §14.4 y no se altera. */}
                <p className="text-sm font-medium">{ETIQUETA_CORRECCION_DIA}</p>
                <p className="text-sm">
                  {textoCorreccionDiaReparto(entrada.fechaAnteriorISO, entrada.fechaNuevaISO)}
                </p>
                {sello}
                <p className="text-xs text-muted-foreground">Por {entrada.actorNombre}</p>
                <p className="text-sm">Motivo: {entrada.motivo}</p>
              </li>
            );
          }
          case "traspaso_mensajero": {
            // FICHA 427 (T20, R29) — LA TERCERA CLASE. Igual que la correccion del dia: en esta
            // rama NO se llama a `estatusLabel` ni se pinta la flecha de estados, porque un
            // traspaso NO cambia el estado de la orden (R21) y presentarlo como una transicion
            // seria mentir sobre la maquina de estados.
            //
            // Se distingue por TEXTO —la primera linea dice QUE es— y, encima de eso, por la misma
            // marca de FORMA que ya usa la correccion (anillo hueco + filo discontinuo), sin
            // introducir ningun tono de color nuevo. Este repo tiene guardia de contraste y una
            // leccion escrita sobre medir color en el navegador.
            //
            // ⚠️ EL ROL QUE SE PINTA ES EL CONGELADO DE LA FILA (R26), el que el DTO trae. No se
            // resuelve el rol vivo de esa persona en ningun punto de esta cadena: el dia que a
            // quien traspaso lo asciendan, esta entrada tiene que seguir diciendo lo de entonces.
            const rolLabel = ROL_LABELS[entrada.actorRol] ?? entrada.actorRol;

            return (
              <li
                key={key}
                className="relative flex flex-col gap-1 border-l-2 border-dashed border-border pl-4"
              >
                {/* El hueco del anillo va en `bg-popover` por lo MEDIDO en la 262: la superficie
                    donde vive esta lista es el `SheetContent` del drawer, que es `bg-popover`. */}
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[6px] size-2.5 rounded-full border-2 border-primary bg-popover"
                />
                <p className="text-sm font-medium">{ETIQUETA_TRASPASO}</p>
                <p className="text-sm">
                  {textoTraspasoMensajero(
                    entrada.mensajeroAnteriorNombre,
                    entrada.mensajeroNuevoNombre,
                  )}
                </p>
                {sello}
                <p className="text-xs text-muted-foreground">
                  Por {entrada.actorNombre} ({rolLabel})
                </p>
                <p className="text-sm">Motivo: {entrada.motivo}</p>
              </li>
            );
          }
          case "evento_orden": {
            // FICHA 454 (T2.3, R30) — LA CUARTA CLASE: un hecho SIN transición. Igual que la
            // corrección del día y el traspaso: NO se llama a `estatusLabel` sobre un origen ni se
            // pinta la flecha, porque la orden no cambió de estado (sigue `en_reparto` hasta que
            // se apruebe el cierre). Se distingue por TEXTO (la primera línea dice qué pasó) y por
            // la misma marca de FORMA que sus dos hermanas (anillo hueco + filo discontinuo), sin
            // tono nuevo. El rol que se pinta es el CONGELADO de la fila (427/R26).
            const rolLabel = ROL_LABELS[entrada.actorRol] ?? entrada.actorRol;
            const resultado = textoResultadoEvento(entrada);

            return (
              <li
                key={key}
                className="relative flex flex-col gap-1 border-l-2 border-dashed border-border pl-4"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[6px] size-2.5 rounded-full border-2 border-primary bg-popover"
                />
                <p className="text-sm font-medium">{ETIQUETA_EVENTO[entrada.tipo]}</p>
                {resultado !== null ? <p className="text-sm">{resultado}</p> : null}
                {sello}
                <p className="text-xs text-muted-foreground">
                  Por {entrada.actorNombre} ({rolLabel})
                </p>
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
