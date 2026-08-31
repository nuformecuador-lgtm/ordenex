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

  const cargarSiguiente = useCallback(async () => {
    if (paginas.cargando || cursorPendiente === null) return;
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

  const centinelaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const centinela = centinelaRef.current;
    if (!centinela || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) void cargarRef.current();
    });
    observador.observe(centinela);
    return () => observador.disconnect();
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

  const cargandoPrimera = isLoading && data === undefined;
  const errorPrimera = data !== undefined && data.status !== "ok";

  return (
    // `h-full` + `min-h-0`: el `<section>` toma el alto (fijo) de su celda de la rejilla en vez
    // de crecer con las paginas acumuladas, y `min-h-0` es lo que permite que el
    // `overflow-y-auto` recorte de verdad. Sin los dos, el listado se estiraba y el unico
    // scroll acababa siendo el de la pagina entera.
    <section
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
          páginas— para no desmontar y remontar el observador a mitad de recorrido. */}
      <div ref={centinelaRef} data-testid="hilos-centinela" aria-hidden className="h-px" />
    </section>
  );
}
