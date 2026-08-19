"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSeccionColapsable } from "@/hooks/useSeccionColapsable";
import {
  CUERPO_MAX,
  type BorrarNotaResult,
  type OrdenNotaDTO,
  type PublicarNotaResult,
} from "@/lib/types/orden-nota";

// Feature 227 (T3.1, design §5) — UI del HILO de notas de una orden, entre la tienda y el
// mensajero. Vive en `components/shared/` DESDE EL PRIMER DÍA porque lo montan dos pantallas
// distintas con la misma API (`/novedades` del adminTienda y el panel del mensajero en
// `/mis-asignaciones`), que es el criterio de promoción de `docs/architecture.md`.
//
// PRESENTACIÓN + GESTOS, NADA DE REGLA DE NEGOCIO. Este componente no sabe qué es una
// "ventana de escritura", no mira el estatus de la orden y no compara identificadores de
// usuario:
//
//  - `puedeEscribir` lo decide el SERVIDOR y es POR ROL (ventana asimétrica, D1): la tienda
//    escribe con la orden `devuelta`, el mensajero con la orden `en_reparto` y asignada a él.
//    El MISMO hilo, en el MISMO estatus, es escribible para uno y de solo lectura para el
//    otro, así que derivarlo aquí del estatus daría la respuesta equivocada la mitad de las
//    veces (R19).
//  - `esPropia` lo calcula el service, única capa que conoce al actor; por eso el DTO no
//    publica `autorId` y aquí no hay ninguna comparación de ids (R16).
//  - Una nota eliminada llega con `cuerpo: ""` (R34). El texto borrado NO cruza el borde: aquí
//    no hay nada que ocultar, solo un hueco que marcar conservando autor y hora.
//
// El contador de caracteres es una GUARDA DE UI y no sustituye al zod del borde (mismo
// criterio que `HabilitarNovedadModal`): el tope real lo aplica `publicarNotaSchema`. Por eso
// se importa `CUERPO_MAX` del módulo de tipos y no se escribe un `200` a mano — dos topes en
// dos archivos es cómo nacen dos reglas que divergen.
//
// Tras publicar o borrar CON ÉXITO se pide `onRefrescar()`, que re-invoca la acción de
// lectura en el consumidor (R17): el hilo que se pinta siempre viene del servidor, nunca de
// un estado local optimista que sobreviva a un fallo. Ante un rechazo tipado se pinta el
// motivo y NO se toca nada (R18): el borrador se conserva tal cual para que el texto no se
// pierda, y la lista queda como estaba.

/** Textos de la UI, en un solo sitio y fuera del JSX (i18n-ready, patrón del repo). */
const TEXTOS = {
  tituloPorDefecto: "Notas de la orden",
  vacio: "Todavía no hay notas en esta orden.",
  vacioDetalle:
    "Acá queda la conversación sobre esta orden, con el autor y la hora de cada nota.",
  soloLectura: "Ahora mismo solo podés leer este hilo.",
  etiquetaCompositor: "Escribí una nota",
  placeholder: "Contá qué pasa con esta orden…",
  publicar: "Publicar nota",
  publicando: "Publicando…",
  /** Pedido humano del 2026-08-19: el compositor se pide, no ocupa sitio por defecto. */
  agregar: "Agregar nota",
  cancelar: "Cancelar",
  eliminar: "Eliminar",
  eliminada: "Nota eliminada",
  propia: "Vos",
  lista: "Notas de la orden, de la más antigua a la más reciente",
  /** R18 — motivos ACCIONABLES: dicen qué pasó y qué hacer, no "error". */
  rechazoValidacion: `La nota no puede estar vacía ni pasar de ${CUERPO_MAX} caracteres. Corregila y volvé a publicarla.`,
  rechazoPublicarProhibido:
    "No podés escribir en esta orden ahora mismo: su estado ya no lo permite. Actualizá la pantalla para ver el hilo al día.",
  rechazoBorrarProhibido:
    "No se pudo eliminar la nota. Solo podés eliminar tus propias notas mientras la orden siga en el estado que te permite escribir.",
  rechazoSesion: "Tu sesión expiró. Iniciá sesión de nuevo y volvé a intentarlo.",
  falloRed:
    "No se pudo contactar con el servidor. Revisá tu conexión y volvé a intentarlo.",
} as const;

/**
 * Formateo FIJO a la zona de Costa Rica, igual que `HistorialOrdenTimeline`: la hora que se
 * lee en el hilo no debe depender de la zona horaria del dispositivo que renderiza.
 */
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** ISO-8601 -> texto legible. Una fecha ilegible no rompe el hilo: cae a la raya. */
function formatFechaHora(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : FECHA_HORA.format(new Date(ms));
}

/** R18: traduce el rechazo TIPADO de publicar a un motivo accionable. */
function motivoPublicar(res: Exclude<PublicarNotaResult, { status: "ok" }>): string {
  switch (res.status) {
    case "validation_error":
      return TEXTOS.rechazoValidacion;
    case "unauthenticated":
      return TEXTOS.rechazoSesion;
    default:
      return TEXTOS.rechazoPublicarProhibido;
  }
}

/** R18: lo mismo para eliminar. `forbidden` es opaco a propósito (nota ajena, inexistente,
 *  ya borrada o fuera de ventana comparten resultado), así que el texto no promete un
 *  diagnóstico que el borde no da. */
function motivoBorrar(res: Exclude<BorrarNotaResult, { status: "ok" }>): string {
  switch (res.status) {
    case "validation_error":
      return TEXTOS.rechazoValidacion;
    case "unauthenticated":
      return TEXTOS.rechazoSesion;
    default:
      return TEXTOS.rechazoBorrarProhibido;
  }
}

export interface HiloNotasOrdenProps {
  /** Orden del hilo. Viaja en cada mutación; el alcance lo resuelve el service con el actor. */
  ordenId: string;
  /** Hilo COMPLETO ya leído del servidor, en orden cronológico ascendente (R3). */
  notas: OrdenNotaDTO[];
  /** Lo decide el SERVIDOR (ventana del rol). Sin él: modo solo lectura (R19). */
  puedeEscribir: boolean;
  /** Server Action de publicación, inyectada por el consumidor. */
  onPublicar: (input: { ordenId: string; cuerpo: string }) => Promise<PublicarNotaResult>;
  /** Server Action de borrado lógico, inyectada por el consumidor. */
  onBorrar: (input: { ordenId: string; notaId: string }) => Promise<BorrarNotaResult>;
  /** R17: releer el hilo DEL SERVIDOR tras un éxito. Nunca estado local a secas. */
  onRefrescar: () => void | Promise<void>;
  /** Encabezado del bloque; cada pantalla nombra a su contraparte (i18n-ready). */
  titulo?: string;
  /**
   * Pedido humano del 2026-08-19 — con `true`, el bloque enseña LAS NOTAS y un boton
   * «Agregar nota»; el compositor no se pinta hasta pedirlo, y entonces se despliega con
   * animacion. Es lo que quiere el panel de gestion del mensajero, donde el hilo es una
   * seccion mas de una pantalla larga que se usa en la calle y el area de texto siempre
   * abierta empuja el resto fuera de vista.
   *
   * Default `false`: en una pantalla DEDICADA a las notas (el modal de `/novedades`) el
   * compositor abierto es justo lo que se fue a buscar, y esconderlo seria un clic de mas.
   */
  compositorColapsado?: boolean;
}

export function HiloNotasOrden({
  ordenId,
  notas,
  puedeEscribir,
  onPublicar,
  onBorrar,
  onRefrescar,
  titulo = TEXTOS.tituloPorDefecto,
  compositorColapsado = false,
}: Readonly<HiloNotasOrdenProps>) {
  const compositorId = useId();
  const contadorId = `${compositorId}-contador`;
  const formId = `${compositorId}-form`;
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  /** Id de la nota que se está borrando (null = ninguna): deshabilita SU botón, no todos. */
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Pedido humano del 2026-08-19 — el compositor como acordeón. Sin `compositorColapsado`
   * arranca ABIERTO y no se pinta ningún disparador: el bloque es el mismo de siempre, y el
   * hook se limita a devolver `abierta`/`montada` en `true`.
   */
  const compositor = useSeccionColapsable(!compositorColapsado);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Abrir el compositor deja el cursor dentro: quien pulsó «Agregar nota» ya dijo que va a
  // escribir, y un área de texto que aparece sin foco pide un segundo clic. Solo cuando el
  // acordeón está en juego — con el compositor siempre abierto, tomar el foco al montar la
  // pantalla movería el scroll sin que nadie lo pidiera.
  useEffect(() => {
    if (!compositorColapsado || !compositor.abierta) return;
    textareaRef.current?.focus();
  }, [compositorColapsado, compositor.abierta]);

  const cuerpoLimpio = borrador.trim();
  // El vacío tras recortar lo rechaza el service (R6); aquí solo se evita el viaje inútil.
  const publicarBloqueado =
    enviando || cuerpoLimpio === "" || borrador.length > CUERPO_MAX;

  async function handlePublicar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (publicarBloqueado) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await onPublicar({ ordenId, cuerpo: borrador });
      if (res.status !== "ok") {
        // R18: el borrador NO se limpia y el hilo NO se refresca — nada se pinta como
        // aplicado.
        setError(motivoPublicar(res));
        return;
      }
      setBorrador("");
      // Publicada, la nota ya está en la lista: el compositor vuelve a plegarse y la
      // pantalla queda enseñando el hilo, que es lo que se vino a mirar.
      if (compositorColapsado) compositor.cerrar();
      await onRefrescar(); // R17
    } catch {
      // No vacío (R29): un fallo de transporte se dice, y el borrador se conserva.
      setError(TEXTOS.falloRed);
    } finally {
      setEnviando(false);
    }
  }

  async function handleBorrar(notaId: string) {
    setBorrandoId(notaId);
    setError(null);
    try {
      const res = await onBorrar({ ordenId, notaId });
      if (res.status !== "ok") {
        setError(motivoBorrar(res)); // R18: la nota sigue en el hilo tal cual
        return;
      }
      await onRefrescar(); // R17
    } catch {
      setError(TEXTOS.falloRed); // no vacío (R29): la nota sigue tal cual
    } finally {
      setBorrandoId(null);
    }
  }

  return (
    <section
      aria-label={titulo}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <h3 className="text-sm font-bold text-foreground">{titulo}</h3>

      {notas.length === 0 ? (
        /* R19: estado vacío legible, no una lista sin filas. */
        <div role="status" className="flex flex-col gap-1 text-center">
          <p className="text-sm font-medium text-foreground">{TEXTOS.vacio}</p>
          <p className="text-xs text-muted-foreground">{TEXTOS.vacioDetalle}</p>
        </div>
      ) : (
        <ol aria-label={TEXTOS.lista} className="flex flex-col gap-2">
          {notas.map((nota) => (
            <li
              key={nota.id}
              /* La marca de propia/ajena es visual (fondo, alineación y la etiqueta "Vos")
                 y también estructural, para que no dependa de leer una clase de Tailwind. */
              data-propia={nota.esPropia ? "true" : "false"}
              className={`flex flex-col gap-1 rounded-xl border px-3 py-2 ${
                nota.esPropia
                  ? "self-end border-brand/40 bg-brand-soft/40 text-right"
                  : "self-start border-border bg-muted/30 text-left"
              }`}
            >
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {nota.autorNombre}
                </span>
                {nota.esPropia ? <span>· {TEXTOS.propia}</span> : null}
                <time dateTime={nota.createdAt}>
                  {formatFechaHora(nota.createdAt)}
                </time>
              </p>

              {nota.eliminada ? (
                /* R34: el hueco se conserva —posición, autor y hora— con la marca visible.
                   No hay cuerpo que pintar: no llegó ninguno. */
                <p className="text-sm italic text-muted-foreground">
                  {TEXTOS.eliminada}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {nota.cuerpo}
                </p>
              )}

              {/* R31/R32/R35: eliminar solo lo PROPIO y solo dentro de la ventana que el
                  servidor abrió. Fuera de ella el control no existe (R19). */}
              {nota.esPropia && !nota.eliminada && puedeEscribir ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={borrandoId === nota.id}
                    onClick={() => void handleBorrar(nota.id)}
                    aria-label={`${TEXTOS.eliminar} mi nota del ${formatFechaHora(nota.createdAt)}`}
                  >
                    <Trash2 aria-hidden="true" />
                    {TEXTOS.eliminar}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      ) : null}

      {puedeEscribir ? (
        <div className="flex flex-col gap-2">
          {/* Pedido humano del 2026-08-19: con el compositor plegado, lo que se ofrece es el
              botón. Reaparece en cuanto empieza el cierre (`abierta` ya es `false` mientras
              corre la animación de salida), así que no queda un hueco sin acción. */}
          {compositorColapsado && !compositor.abierta ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              aria-expanded={false}
              onClick={compositor.abrir}
            >
              <Plus aria-hidden="true" />
              {TEXTOS.agregar}
            </Button>
          ) : null}

          {/* `montada` y no `abierta`: el formulario sigue en el árbol mientras corre la
              animación de salida; con `prefers-reduced-motion` no hay tramo que sostener y
              desaparece en el acto. */}
          {compositor.montada ? (
            <form
              id={formId}
              onSubmit={handlePublicar}
              className={`flex flex-col gap-1.5 ${
                compositorColapsado ? compositor.clase : ""
              }`}
            >
              <Label htmlFor={compositorId}>{TEXTOS.etiquetaCompositor}</Label>
              <Textarea
                id={compositorId}
                ref={textareaRef}
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                rows={3}
                maxLength={CUERPO_MAX}
                placeholder={TEXTOS.placeholder}
                aria-describedby={contadorId}
                className="resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <span
                  id={contadorId}
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {borrador.length}/{CUERPO_MAX}
                </span>
                <div className="flex items-center gap-2">
                  {/* Cerrar NO descarta lo tecleado: el borrador se conserva, igual que
                      cuando el servidor rechaza la publicación (R18). */}
                  {compositorColapsado ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={enviando}
                      onClick={compositor.cerrar}
                    >
                      {TEXTOS.cancelar}
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" disabled={publicarBloqueado}>
                    {enviando ? TEXTOS.publicando : TEXTOS.publicar}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        /* R19: modo solo lectura. No es un compositor deshabilitado —eso prometería que en
           algún momento de esta pantalla se puede escribir—, es la ausencia del compositor
           con una línea que lo explica. */
        <p className="text-xs text-muted-foreground">{TEXTOS.soloLectura}</p>
      )}
    </section>
  );
}
