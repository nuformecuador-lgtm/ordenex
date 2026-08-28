"use client";

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import useSWR from "swr";

import { cn } from "@/lib/utils";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type {
  CursorMensaje,
  HiloHistoricoDTO,
  ListarMensajesHistoricoInput,
  ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";
import { claveDiaCR, separadorDia } from "@/lib/utils/separador-dia-cr";

import { BurbujaContenido } from "@/app/(app)/mis-asignaciones/_components/chat/BurbujaContenido";
import { BurbujaSistema } from "@/app/(app)/mis-asignaciones/_components/chat/BurbujaSistema";
import { Reacciones } from "@/app/(app)/mis-asignaciones/_components/chat/Reacciones";
import {
  guiaVisible,
  horaCorta,
} from "@/app/(app)/mis-asignaciones/_components/chat/chat-format";
import { UbicacionModal } from "@/app/(app)/mis-asignaciones/_components/UbicacionModal";
import type { UbicacionPunto } from "@/app/(app)/mis-asignaciones/_components/ubicacion-mapa-tipos";

import { etiquetaNumeros } from "./HilosLista";

// Feature 318 / T6.2-T6.5 (design §5.1, §5.2, §5.4, §5.5, §5.6) — el HILO abierto.
//
// LAS BURBUJAS SON LAS DEL CHAT DEL MENSAJERO, importadas TAL CUAL desde
// `app/(app)/mis-asignaciones/_components/chat/` (design §5.2). No se escribe aquí ningún
// renderizador por tipo: `BurbujaContenido` tiene un `switch` EXHAUSTIVO con `never` en el
// `default`, que existe para que un tipo nuevo del enum sea un ERROR DE COMPILACIÓN. Un
// segundo renderizador se quedaría atrás en silencio (A3, descartada). Tampoco se MUEVEN a
// `components/shared/chat/`: eso mete 14 archivos ajenos en el diff de una feature de lectura
// (A1, descartada y declarada como deuda).
//
// SOLO LECTURA (R24/R25). Aquí no hay `<textarea>`, ni botón de enviar, ni de adjuntar, ni
// chips de plantilla, ni forma de reaccionar, ni marca de leído. De `lib/actions/chat-whatsapp`
// no se importa NADA —ni siquiera tipos: los tipos que hacen falta viven en
// `lib/types/chat-whatsapp`, que es un módulo de tipos, no de acciones—.
//
// LO QUE SÍ ESCRIBE ESTE ARCHIVO, y es lo único que la reutilización no daba hecho:
//   - la CABECERA del hilo fusionado (R43);
//   - el AVISO de fecha diferenciada (R39);
//   - el SEPARADOR DE DÍA (R23), con la etiqueta y la agrupación de `separador-dia-cr.ts`;
//   - el SCROLL INVERSO que no salta (R22).

/** R39 — lo que se le dice al lector cuando el listado está filtrado por fecha y el hilo no. */
export const AVISO_FECHA_DIFERENCIADA =
  "Filtro de fecha aplicado a la lista; aquí se muestra la conversación completa";

const TEXTO_SIN_HILO = "Elige una conversación para leerla.";

interface EstadoHilo {
  /** Mensajes de las páginas ANTERIORES ya traídas, en orden cronológico ascendente. */
  previos: ChatMensajeVista[];
  /** Cursor de la siguiente página hacia atrás; `null` = no hay más (o aún no se sabe). */
  anterior: CursorMensaje | null;
  /** `true` en cuanto aterriza una página extra: a partir de ahí manda `anterior`. */
  hayPrevios: boolean;
  cargando: boolean;
  fallo: boolean;
}

type AccionHilo =
  | { tipo: "pidiendo" }
  | { tipo: "pagina"; items: ChatMensajeVista[]; anterior: CursorMensaje | null }
  | { tipo: "fallo" };

const ESTADO_INICIAL: EstadoHilo = {
  previos: [],
  anterior: null,
  hayPrevios: false,
  cargando: false,
  fallo: false,
};

function reducirHilo(estado: EstadoHilo, accion: AccionHilo): EstadoHilo {
  switch (accion.tipo) {
    case "pidiendo":
      return { ...estado, cargando: true, fallo: false };
    case "pagina":
      // La página nueva es MÁS ANTIGUA: va DELANTE. El orden relativo no se toca (R42).
      return {
        previos: [...accion.items, ...estado.previos],
        anterior: accion.anterior,
        hayPrevios: true,
        cargando: false,
        fallo: false,
      };
    case "fallo":
      return { ...estado, cargando: false, fallo: true };
    default: {
      const exhaustivo: never = accion;
      throw new Error(`Acción del hilo desconocida: ${String(exhaustivo)}`);
    }
  }
}

/**
 * Una burbuja del histórico. Es un ENVOLTORIO, no un renderizador: decide el `<li>` y su lado
 * y delega TODO el contenido en las piezas del chat del mensajero.
 *
 * Lo único que no se hereda son los ACUSES de entrega (`Acuses`, privado de
 * `ChatConversacion`): a quien lee el histórico no le sirve saber si el mensaje se marcó como
 * leído en el móvil del cliente, y sacarlos exigiría tocar un archivo ajeno (R26/A1).
 */
function BurbujaHistorico({
  mensaje,
  onAbrirUbicacion,
}: Readonly<{
  mensaje: ChatMensajeVista;
  onAbrirUbicacion: (punto: UbicacionPunto) => void;
}>) {
  // El cambio de número del cliente es una fila de SISTEMA, centrada y sin `data-direccion`:
  // no la escribió ninguno de los dos. Es la que hace legible la fusión de teléfonos DENTRO
  // del hilo (R43), y por eso la cabecera no repite el número antiguo.
  if (mensaje.tipo === "sistema") {
    return <BurbujaSistema sistema={mensaje.sistema} ocurridoAt={mensaje.ocurridoAt} />;
  }

  const saliente = mensaje.direccion === "saliente";

  return (
    <li
      className={cn("flex flex-col", saliente ? "items-end" : "items-start")}
      data-direccion={mensaje.direccion}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[65%]",
          saliente
            ? "rounded-br-sm bg-accent text-accent-foreground"
            : "rounded-bl-sm bg-card text-card-foreground",
        )}
      >
        <BurbujaContenido mensaje={mensaje} onAbrirUbicacion={onAbrirUbicacion} />
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[10px] text-muted-foreground">
            {horaCorta(mensaje.ocurridoAt)}
          </span>
        </div>
      </div>
      {/* R28: las reacciones van DENTRO del `<li>` de su mensaje objetivo. El servidor no
          devuelve ninguna burbuja de tipo `reaccion`. */}
      <Reacciones reacciones={mensaje.reacciones} saliente={saliente} />
    </li>
  );
}

/** R43 — orden, destinatario, mensajero, número vigente y, si fusiona, cuántos números hay. */
function CabeceraHilo({ cabecera }: Readonly<{ cabecera: HiloHistoricoDTO }>) {
  return (
    <header data-testid="historico-hilo-cabecera" className="border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-xs text-muted-foreground">
          {guiaVisible(cabecera)}
        </span>
        <span className="font-semibold">{cabecera.destinatario}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{cabecera.mensajeroNombre}</span>
        <span className="font-mono">···{cabecera.telefonoVigenteMasked}</span>
        {cabecera.telefonosCount > 1 ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {etiquetaNumeros(cabecera.telefonosCount)}
          </span>
        ) : null}
      </div>
    </header>
  );
}

export interface HistoricoHiloProps {
  /** Hilo abierto. `null` = ninguno, y entonces NO se pide ni un mensaje (R41). */
  hilo: { ordenId: string; mensajeroId: string } | null;
  /** La Server Action de la página de mensajes (o su doble en test). */
  listar: (input: ListarMensajesHistoricoInput) => Promise<ListarMensajesHistoricoResult>;
  /** Instante de lectura, para «hoy»/«ayer» del separador (R23). */
  ahora: Date;
  /** R39 — hay rango de fecha aplicado en el LISTADO; el hilo no se recorta por él (R17). */
  rangoFechaAplicado: boolean;
}

export function HistoricoHilo({
  hilo,
  listar,
  ahora,
  rangoFechaAplicado,
}: Readonly<HistoricoHiloProps>) {
  const [ubicacion, setUbicacion] = useState<UbicacionPunto | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [estado, dispatch] = useReducer(reducirHilo, ESTADO_INICIAL);

  // CARGA PEREZOSA (R41): sin hilo seleccionado la clave es `null` y SWR no llama a nadie —
  // exactamente lo que hace `ChatConversacion` con `ordenId === null`.
  const { data, isLoading } = useSWR<ListarMensajesHistoricoResult>(
    hilo === null ? null : ["historico-hilo", hilo.ordenId, hilo.mensajeroId],
    hilo === null
      ? null
      : () => listar({ ordenId: hilo.ordenId, mensajeroId: hilo.mensajeroId }),
    { revalidateOnFocus: false },
  );

  const paginaOk = data?.status === "ok" ? data : null;

  /** Cursor hacia atrás: el de la última página aterrizada (R19/R21). */
  const cursorAnterior = estado.hayPrevios ? estado.anterior : (paginaOk?.anterior ?? null);

  const cargarAnteriores = useCallback(async () => {
    if (hilo === null || estado.cargando || cursorAnterior === null) return;
    dispatch({ tipo: "pidiendo" });

    const contenedor = scrollRef.current;
    // R22 — se MIDE ANTES de pedir nada. Insertar 30 mensajes arriba empuja la vista hacia
    // abajo tantos píxeles como midan; sin esta corrección el lector pierde el sitio, que es
    // el defecto por defecto del scroll inverso.
    const alturaPrevia = contenedor?.scrollHeight ?? 0;

    try {
      const res = await listar({
        ordenId: hilo.ordenId,
        mensajeroId: hilo.mensajeroId,
        cursor: cursorAnterior,
      });
      if (res.status !== "ok") {
        dispatch({ tipo: "fallo" });
        return;
      }
      // `flushSync`: la corrección del scroll sólo vale si se aplica cuando los mensajes YA
      // están en el DOM. Con una actualización asíncrona se mediría la altura vieja y la
      // corrección sería cero — que es justo la implementación ingenua que R22 prohíbe.
      flushSync(() => {
        dispatch({ tipo: "pagina", items: res.mensajes, anterior: res.anterior });
      });
      if (contenedor !== null) {
        contenedor.scrollTop += contenedor.scrollHeight - alturaPrevia;
      }
    } catch {
      dispatch({ tipo: "fallo" });
    }
  }, [hilo, estado.cargando, cursorAnterior, listar]);

  const cargarRef = useRef(cargarAnteriores);
  useEffect(() => {
    cargarRef.current = cargarAnteriores;
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

  const mensajes = useMemo(
    () => [...estado.previos, ...(paginaOk?.mensajes ?? [])],
    [estado.previos, paginaOk],
  );

  // R21 — se aterriza ABAJO, en lo más reciente, y SOLO la primera vez. Volver a anclar al
  // cargar una página anterior desharía la corrección de R22 en el mismo tick.
  const anclado = useRef(false);
  useEffect(() => {
    if (anclado.current || paginaOk === null) return;
    anclado.current = true;
    const contenedor = scrollRef.current;
    if (contenedor !== null) contenedor.scrollTop = contenedor.scrollHeight;
  }, [paginaOk]);

  if (hilo === null) {
    return (
      <section
        aria-label="Conversación"
        className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-muted p-8 text-center"
      >
        <p className="text-sm text-muted-foreground">{TEXTO_SIN_HILO}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Conversación"
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-muted"
    >
      {paginaOk === null ? null : <CabeceraHilo cabecera={paginaOk.cabecera} />}

      {/* R39 — la diferencia entre las dos superficies se DICE. Sin esto, quien viene de
          filtrar por un día cree que está leyendo un hilo recortado. */}
      {rangoFechaAplicado ? (
        <p role="status" className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {AVISO_FECHA_DIFERENCIADA}
        </p>
      ) : null}

      <div
        ref={scrollRef}
        data-testid="historico-hilo-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {/* El centinela va ARRIBA: el hilo se pagina hacia ATRÁS (R21). */}
        <div ref={centinelaRef} data-testid="hilo-centinela" aria-hidden className="h-px" />

        {estado.cargando ? (
          <p className="text-center text-xs text-muted-foreground">Cargando anteriores…</p>
        ) : null}

        {estado.fallo ? (
          <p role="alert" className="text-center text-xs text-muted-foreground">
            No se pudieron cargar los mensajes anteriores.
          </p>
        ) : null}

        {isLoading && data === undefined ? (
          <p className="text-sm text-muted-foreground">Cargando conversación…</p>
        ) : null}

        {data !== undefined && data.status !== "ok" ? (
          <p role="alert" className="text-sm text-muted-foreground">
            No se pudo cargar la conversación.
          </p>
        ) : null}

        {paginaOk !== null && mensajes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Esta conversación no tiene mensajes.</p>
        ) : null}

        {mensajes.length > 0 ? (
          <ul aria-label="Historial de mensajes" className="flex flex-col gap-1.5">
            {mensajes.map((mensaje, indice) => {
              // R23 — un separador por DÍA CALENDARIO DE CR, no por mensaje. La clave de
              // agrupación y la etiqueta salen del MISMO módulo, así que no pueden discrepar.
              const anteriorMensaje = indice === 0 ? null : mensajes[indice - 1];
              const abreDia =
                anteriorMensaje === null ||
                claveDiaCR(anteriorMensaje.ocurridoAt) !== claveDiaCR(mensaje.ocurridoAt);
              return (
                <Fragment key={mensaje.id}>
                  {abreDia ? (
                    // `role="separator"`: es una marca estructural, no un elemento de la
                    // lista de mensajes. Así el conteo de burbujas sigue siendo el de los
                    // mensajes y el lector de pantalla no anuncia un ítem que nadie escribió.
                    <li role="separator" className="my-2 flex justify-center">
                      <span className="rounded-full bg-muted-foreground/10 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                        {separadorDia(mensaje.ocurridoAt, ahora)}
                      </span>
                    </li>
                  ) : null}
                  <BurbujaHistorico mensaje={mensaje} onAbrirUbicacion={setUbicacion} />
                </Fragment>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Ver el punto que compartió el cliente es LECTURA: no escribe nada (R25). */}
      <UbicacionModal
        punto={ubicacion}
        onOpenChange={(abierto) => {
          if (!abierto) setUbicacion(null);
        }}
        descripcion="El punto que compartió el cliente en esta conversación."
      />
    </section>
  );
}
