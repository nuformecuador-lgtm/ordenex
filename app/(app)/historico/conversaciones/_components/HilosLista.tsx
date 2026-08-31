"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import useSWR from "swr";

import { cn } from "@/lib/utils";
import type {
  CursorHilo,
  FiltroHilosHistorico,
  HiloHistoricoDTO,
  ListarHilosHistoricoInput,
  ListarHilosHistoricoResult,
} from "@/lib/types/historico-conversaciones";
import { separadorDia } from "@/lib/utils/separador-dia-cr";

import { guiaVisible } from "@/app/(app)/mis-asignaciones/_components/chat/chat-format";

// Feature 321 / T6.1 (design §5.1 y §5.4, R11/R13/R41/R43/R44) — el LISTADO de hilos.
//
// La unidad es el PAR `(orden, mensajero)` (R42), no una fila de `chat_conversacion`: por eso
// la clave de cada fila son los dos ids juntos y por eso dos mensajeros de la misma orden son
// dos filas distintas y no un duplicado (R44).
//
// TRES decisiones de esta pantalla que no son de estilo:
//
//   1. **La respuesta no trae mensajes (R41)** y no puede traerlos: `HiloHistoricoDTO` no
//      declara dónde ponerlos. Aquí se pinta la fila y nada más; los mensajes los pide
//      `HistoricoHilo` y sólo cuando hay un hilo abierto.
//   2. **Las páginas viven en un `useReducer`, no en un efecto** (design §5.4): el lint del
//      repo prohíbe `setState` dentro de un `useEffect` que lee del navegador, y el
//      `IntersectionObserver` es exactamente eso. El observador SÓLO llama a un manejador
//      asíncrono; quien acumula es el reducer.
//   3. **Al cambiar el filtro, el componente se REMONTA** (el módulo le pasa una `key`
//      derivada del filtro). Así las páginas acumuladas se van solas, sin un efecto que
//      vigile el filtro para vaciarlas — que es donde se cuelan los estados a medias.

/**
 * Cuánto ANTES del borde inferior del panel se pide la página siguiente. Un margen y no `0`
 * para que la lista no se quede seca justo en el momento en que el usuario llega al final.
 */
const MARGEN_CENTINELA = "200px";

/** Texto del distintivo de fusión de números (R43). Plural siempre: `> 1` por definición. */
export function etiquetaNumeros(telefonosCount: number): string {
  return `${telefonosCount} números`;
}

/** Clave estable de un hilo. Es la del contrato, no un id de fila (design §2.2). */
export function claveHilo(hilo: { ordenId: string; mensajeroId: string }): string {
  return `${hilo.ordenId}:${hilo.mensajeroId}`;
}

interface EstadoPaginas {
  /** Páginas EXTRA (la primera la sirve SWR), en el orden en que se pidieron. */
  items: HiloHistoricoDTO[];
  /** Cursor devuelto por la última página extra; `null` = no hay más. */
  siguiente: CursorHilo | null;
  /** Hay una página en vuelo: el centinela no vuelve a pedir hasta que aterrice. */
  cargando: boolean;
  /** Alguna página falló: se dice y se deja reintentar, no se traga. */
  fallo: boolean;
}

type AccionPaginas =
  | { tipo: "pidiendo" }
  | { tipo: "pagina"; items: HiloHistoricoDTO[]; siguiente: CursorHilo | null }
  | { tipo: "fallo" };

const ESTADO_INICIAL: EstadoPaginas = {
  items: [],
  siguiente: null,
  cargando: false,
  fallo: false,
};

function reducirPaginas(estado: EstadoPaginas, accion: AccionPaginas): EstadoPaginas {
  switch (accion.tipo) {
    case "pidiendo":
      return { ...estado, cargando: true, fallo: false };
    case "pagina":
      return {
        items: [...estado.items, ...accion.items],
        siguiente: accion.siguiente,
        cargando: false,
        fallo: false,
      };
    case "fallo":
      return { ...estado, cargando: false, fallo: true };
    default: {
      const exhaustivo: never = accion;
      throw new Error(`Acción de paginación desconocida: ${String(exhaustivo)}`);
    }
  }
}

export interface HilosListaProps {
  filtro: FiltroHilosHistorico;
  /** La Server Action del listado (o su doble en test). */
  listar: (input: ListarHilosHistoricoInput) => Promise<ListarHilosHistoricoResult>;
  /** Hilo abierto, para marcar la fila. `null` = ninguno (R41: no se pide ni un mensaje). */
  seleccionado: { ordenId: string; mensajeroId: string } | null;
  onSeleccionar: (hilo: HiloHistoricoDTO) => void;
  /** Instante de lectura, para rotular la última actividad («hoy 10:20»). */
  ahora: Date;
}

export function HilosLista({
  filtro,
  listar,
  seleccionado,
  onSeleccionar,
  ahora,
}: Readonly<HilosListaProps>) {
  const claveFiltro = useMemo(() => JSON.stringify(filtro), [filtro]);
  const hayFiltro = Object.keys(filtro).length > 0;

  // PRIMERA página por SWR, como el resto del repo. Las siguientes NO son otra clave de SWR:
  // son una continuación del mismo recorrido y se acumulan en el reducer.
  const { data, isLoading } = useSWR<ListarHilosHistoricoResult>(
    ["historico-hilos", claveFiltro],
    () => listar(hayFiltro ? { filtro } : {}),
    { revalidateOnFocus: false },
  );

  const [paginas, dispatch] = useReducer(reducirPaginas, ESTADO_INICIAL);

  const primera = data?.status === "ok" ? data : null;
  /** Cursor que le toca al centinela: el de la última página aterrizada. */
  const cursorPendiente =
    paginas.items.length === 0 ? (primera?.siguiente ?? null) : paginas.siguiente;

  /**
   * Cerrojo SÍNCRONO de la petición en vuelo. `paginas.cargando` no basta y no es un descuido
   * del reducer: `dispatch` no cambia el estado en el acto, así que dos avisos del observador
   * encadenados en el mismo turno de microtareas leen los DOS `cargando: false` y piden la
   * MISMA página dos veces —medido: tres llamadas seguidas con idéntico cursor—. Una ref se
   * escribe en el momento, antes de ceder el turno, y por eso sí cierra la ventana.
   *
   * Se libera en un efecto, no en un `finally`: soltarlo aquí lo dejaría abierto durante el
   * hueco entre el `dispatch` y su commit, que es exactamente el instante en el que otra
   * microtarea entraría todavía con el cursor viejo.
   */
  const enVueloRef = useRef(false);

  const cargarSiguiente = useCallback(async () => {
    if (enVueloRef.current || paginas.cargando || cursorPendiente === null) return;
    enVueloRef.current = true;
    dispatch({ tipo: "pidiendo" });
    try {
      const res = await listar({
        ...(hayFiltro ? { filtro } : {}),
        cursor: cursorPendiente,
      });
      if (res.status !== "ok") {
        dispatch({ tipo: "fallo" });
        return;
      }
      dispatch({ tipo: "pagina", items: res.items, siguiente: res.siguiente });
    } catch {
      dispatch({ tipo: "fallo" });
    }
  }, [paginas.cargando, cursorPendiente, listar, filtro, hayFiltro]);

  // El observador se registra UNA vez y lee el manejador fresco por ref: reconectarlo en cada
  // render (o meter `cargarSiguiente` en las dependencias) lo desconectaría y volvería a
  // conectarlo por cada página, que es como se pierde una intersección a mitad de scroll.
  const cargarRef = useRef(cargarSiguiente);
  useEffect(() => {
    cargarRef.current = cargarSiguiente;
  });

  const seccionRef = useRef<HTMLElement>(null);
  const centinelaRef = useRef<HTMLDivElement>(null);
  const observadorRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const centinela = centinelaRef.current;
    if (!centinela || typeof IntersectionObserver === "undefined") return;
    // `root`: el que scrollea es el `<section>`, NO el viewport. Con el `root` implícito el
    // observador mide contra la ventana y sólo acierta de rebote, por el recorte que le impone
    // el ancestro con `overflow`. `rootMargin` pide la página ANTES de tocar el borde, que es
    // lo que evita el parpadeo de «llegué al fondo y no hay nada».
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void cargarRef.current();
      },
      { root: seccionRef.current, rootMargin: MARGEN_CENTINELA },
    );
    observador.observe(centinela);
    observadorRef.current = observador;
    return () => {
      observadorRef.current = null;
      observador.disconnect();
    };
  }, []);

  /**
   * Las dos fuentes en una sola lista y SIN duplicados (R13). El servidor ya pagina con una
   * clave total, así que un duplicado sería un fallo suyo; deduplicar aquí evita además que
   * ese fallo se convierta en dos `key` de React iguales, que es un error mudo y peor.
   */
  const hilos = useMemo(() => {
    const porClave = new Map<string, HiloHistoricoDTO>();
    for (const hilo of [...(primera?.items ?? []), ...paginas.items]) {
      const clave = claveHilo(hilo);
      if (!porClave.has(clave)) porClave.set(clave, hilo);
    }
    return [...porClave.values()];
  }, [primera, paginas.items]);

  /**
   * RE-ARMA el observador después de cada página. Es la pieza que sostiene el recorrido, no
   * una optimización: `IntersectionObserver` sólo avisa cuando la visibilidad CAMBIA, así que
   * si la página que acaba de aterrizar no llega a empujar el centinela fuera de vista, no hay
   * transición que notificar y la cadena se para para siempre —sin error, sin petición y sin
   * nada que mirar en el log—.
   *
   * Medido el 2026-08-31 con páginas de 5 en un panel de 642 px y filas de 61: 5 filas ocupan
   * 305 px y 10 ocupan 610, o sea que el centinela nunca deja de verse y el listado moría en
   * 10 de 18. `observe()` sobre un elemento ya observado vuelve a encolar un aviso con el
   * estado ACTUAL, que es justo lo que hace falta: si sigue a la vista, se pide otra página
   * hasta llenar el panel; si ya no, el aviso llega con `false` y no pasa nada.
   *
   * Depende de `hilos.length` (cambió lo pintado) y de `paginas.cargando` (una página aterrizó,
   * aunque el servidor la devolviera entera duplicada y `hilos` no creciera). Re-armar mientras
   * `cargando` es `true` es inofensivo: el guardia de `cargarSiguiente` corta esa llamada.
   */
  useEffect(() => {
    // Se suelta el cerrojo YA CONFIRMADO el estado, y antes de re-armar: así el aviso que
    // provoque el `observe` de abajo entra con el cursor nuevo, nunca con el que ya se usó.
    if (!paginas.cargando) enVueloRef.current = false;

    const observador = observadorRef.current;
    const centinela = centinelaRef.current;
    if (observador === null || centinela === null) return;
    observador.unobserve(centinela);
    observador.observe(centinela);
  }, [hilos.length, paginas]);

  const cargandoPrimera = isLoading && data === undefined;
  const errorPrimera = data !== undefined && data.status !== "ok";

  return (
    // `h-full` + `min-h-0`: el `<section>` toma el alto (fijo) de su celda de la rejilla en vez
    // de crecer con las paginas acumuladas, y `min-h-0` es lo que permite que el
    // `overflow-y-auto` recorte de verdad. Sin los dos, el listado se estiraba y el unico
    // scroll acababa siendo el de la pagina entera.
    <section
      ref={seccionRef}
      aria-label="Conversaciones"
      className="flex h-full min-h-0 flex-col overflow-y-auto rounded-lg border border-border bg-card"
    >
      {cargandoPrimera ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando conversaciones…</p>
      ) : null}

      {errorPrimera ? (
        <p role="alert" className="p-4 text-sm text-muted-foreground">
          No se pudieron cargar las conversaciones.
        </p>
      ) : null}

      {!cargandoPrimera && !errorPrimera && hilos.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Ninguna conversación coincide con los filtros.
        </p>
      ) : null}

      {hilos.length > 0 ? (
        <ul aria-label="Conversaciones del histórico" className="divide-y divide-border">
          {hilos.map((hilo) => {
            const clave = claveHilo(hilo);
            const abierta =
              seleccionado !== null && claveHilo(seleccionado) === clave;
            return (
              <li key={clave}>
                <button
                  type="button"
                  // `aria-current` y no `aria-pressed`: la fila no es un interruptor, es la
                  // que se está leyendo ahora mismo.
                  aria-current={abierta ? "true" : undefined}
                  onClick={() => onSeleccionar(hilo)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    abierta && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {guiaVisible(hilo)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {hilo.ultimaActividadAt === null
                        ? "Sin mensajes"
                        : separadorDia(hilo.ultimaActividadAt, ahora)}
                    </span>
                  </span>
                  <span className="truncate font-medium">{hilo.destinatario}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{hilo.mensajeroNombre}</span>
                    {/* Pedido humano (2026-08-31): el numero COMPLETO, ya no `···1234`.
                        Quien lee el historico lo necesita entero para reconocer al cliente y
                        para poder buscarlo en el propio campo de busqueda. */}
                    <span className="font-mono">{hilo.telefonoVigente}</span>
                    {hilo.telefonosCount > 1 ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        {etiquetaNumeros(hilo.telefonosCount)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {paginas.fallo ? (
        <p role="alert" className="p-3 text-xs text-muted-foreground">
          No se pudieron cargar más conversaciones.
        </p>
      ) : null}

      {paginas.cargando ? (
        <p className="p-3 text-xs text-muted-foreground">Cargando más…</p>
      ) : null}

      {/* Centinela del scroll infinito (design §5.4). Va SIEMPRE en el árbol —también sin más
          páginas— para no desmontar y remontar el observador a mitad de recorrido.

          `shrink-0` NO es decorativo: dentro de un `flex-col` que desborda, este `div` es el
          único hijo que puede encogerse por debajo de su contenido, así que el `h-px` acababa
          midiendo 0 px de alto (medido). Chromium todavía lo reporta como visible; el resto de
          motores no lo garantizan para un rectángulo de área cero. */}
      <div ref={centinelaRef} data-testid="hilos-centinela" aria-hidden className="h-px shrink-0" />
    </section>
  );
}
