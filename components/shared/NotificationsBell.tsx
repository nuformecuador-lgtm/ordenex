"use client";

import { useId, useState, type ComponentType } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import {
  Bell,
  ChevronRight,
  CircleAlert,
  Clock,
  Package,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
  type LucideProps,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { usePreferenciaSonido } from "@/hooks/usePreferenciaSonido";
import { useTonoAlIncrementar } from "@/hooks/useTonoAlIncrementar";
import {
  useNotificaciones,
  type NotificacionesData,
} from "@/hooks/useNotificaciones";
import {
  descartarNotificacion,
  marcarTodasLeidas as marcarTodasLeidasAction,
} from "@/lib/actions/notificaciones";
import type {
  NotificacionDTO,
  NotificationType as NotificacionTipo,
} from "@/lib/types/notificacion";

/** Tipos de notificación soportados; cada uno mapea a un icono distinto. */
export type NotificationType = NotificacionTipo;

/**
 * Alias PÚBLICO del DTO de la acción de listar (R50, F1.4-9). Se conserva el nombre
 * histórico para que los consumidores existentes del componente sigan compilando;
 * la forma la fija `lib/types/notificacion.ts`, frontera contractual de la feature.
 */
export type NotificationItem = NotificacionDTO;

export interface NotificationsBellProps {
  /**
   * Datos iniciales opcionales. Se usan como `fallbackData` de SWR: permiten testear
   * y renderizar sin esperar al primer fetch, y NO obligan a tocar `PageHeader`.
   */
  notifications?: NotificationItem[];
}

/**
 * ⚠️ FICHA 409 (T6.2, R10–R30) — DE BUZÓN A COLA DE TRABAJO, Y EL CRITERIO NO VIVE AQUÍ.
 *
 * Medido en producción el 2026-09-10: **1.214 avisos emitidos y 26 de 39 personas no habían
 * abierto ninguno** (1 de 5 tiendas, 1 de 4 admins). El distintivo contaba MENSAJES SIN LEER, que
 * no es lo mismo que COSAS POR HACER, y por eso se aprendía a ignorarlo.
 *
 * Este componente **sólo pinta**. No clasifica (`accionable` viene del catálogo resuelto con el
 * rol del actor), no compone texto (`titulo`/`detalle`), no calcula tiempo (`cuando` llega en
 * palabras desde el servidor, R31/R32) y no conoce rutas por evento (`atajo`, ya resuelto por el
 * par evento-rol). Si algo de eso vuelve a este archivo, la campana y el push de la 410 acabarán
 * diciendo cosas distintas del mismo aviso.
 *
 * Contrato visual: `design-notificaciones/{Main,Campana}.dc.html`, con las tres correcciones del
 * humano del 2026-09-10: sin botón en el aviso de mapas caídos (no existe esa pantalla), sin pie
 * «Ver todas las notificaciones» (tampoco existe, R29) y el día de reparto como accionable.
 */

/** Los textos de la campana, juntos y en un solo sitio: i18n-ready sin librería (patrón del repo). */
const TEXTOS = {
  tituloPanel: "Notificaciones",
  marcarLeidas: "Marcar todas como leídas",
  vacio: "No tienes notificaciones.",
  bloqueAccion: "Requieren tu acción",
  bloqueInfo: "Para tu información",
  filtroTodas: "Todas",
  filtroGrupo: "Filtrar notificaciones",
  descartar: "Descartar notificación",
  silenciar: "Silenciar el sonido de las notificaciones",
  activarSonido: "Activar el sonido de las notificaciones",
  /** El distintivo DICE la cifra (R11), no la insinúa con un punto rojo. */
  porHacer: (n: string) => `${n} por hacer`,
} as const;

/**
 * El anillo de foco estándar de `DESIGN.md`, UNO SOLO y compartido por todos los controles
 * enfocables del panel (R27). Que sea una constante es lo que permite a
 * `notifications-bell-tokens.guardia.test.ts` contar controles contra anillos: quitárselo a uno
 * pone la guardia roja, en vez de dejar un control sin foco visible que nadie mira.
 */
const ANILLO_FOCO = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Mapa notification_type → icono, pastilla semántica y nombre accesible.
 *
 * Feature 208: `box` era `text-navy` (fijo) y sobre el popover oscuro desaparecía. Los `-soft` son
 * FIJOS, así que en oscuro se usa la técnica soft-badge `bg-{sem}/15` y el texto va en `-strong`,
 * que trae su variante dark por token (`DESIGN.md`). Ni un hex: los del `.dc.html` son del tema
 * claro y copiarlos repetiría el bug que la 208 arregló.
 */
const TYPE_ICON: Record<
  NotificationType,
  { Icon: ComponentType<LucideProps>; pastilla: string; label: string }
> = {
  alert: {
    Icon: CircleAlert,
    pastilla: "bg-danger-soft text-danger-strong dark:bg-danger/15",
    label: "Alerta",
  },
  box: {
    Icon: Package,
    pastilla: "bg-info-soft text-info-strong dark:bg-info/15",
    label: "Paquete",
  },
  warning: {
    Icon: TriangleAlert,
    pastilla: "bg-warning-soft text-warning-strong dark:bg-warning/15",
    label: "Advertencia",
  },
};

/** Tope a partir del cual el distintivo deja de mostrar la cifra exacta (R12). */
const BADGE_MAX = 99;

function contarNoLeidas(items: NotificationItem[]): number {
  return items.filter((n) => !n.read).length;
}

/**
 * R8/R15: lo accionable dentro del conjunto que hay en pantalla. Es la MISMA definición que
 * aplica el servidor —un aviso agregado ya apagado no viaja en `items`—, así que se puede derivar
 * para el optimismo del descarte sin inventar un segundo criterio.
 */
function contarPorHacer(items: NotificationItem[]): number {
  return items.filter((n) => n.accionable === true).length;
}

function datosIniciales(
  notifications: NotificationItem[] | undefined,
): NotificacionesData | undefined {
  if (!notifications) return undefined;
  return {
    items: notifications,
    noLeidas: contarNoLeidas(notifications),
    porHacer: contarPorHacer(notifications),
  };
}

/** Qué bloques se pintan. Estado de cliente puro: no viaja a la URL ni al servidor (R25). */
type Filtro = "todas" | "accion";

export function NotificationsBell({ notifications }: NotificationsBellProps) {
  const { items, noLeidas, porHacer, error, isLoading, mutate, mutateOptimista } =
    useNotificaciones({
      fallbackData: datosIniciales(notifications),
    });

  // Feature 161 (R19/R20) + FICHA 409 (R30, decisión Q8): el tono suena cuando sube LO
  // ACCIONABLE, no las no leídas. Dos criterios distintos para el mismo número acaban en dos
  // verdades sobre el mismo hecho: la campana diría «2 por hacer» y el tono habría sonado por un
  // acuse de recibo que nadie tiene que atender.
  //
  // `null` MIENTRAS no hay conteo real (R24 de la 161): cargando, o lectura fallida -- que degrada
  // a cero por R48 de la 146 y, tomada como dato, haria sonar el tono al recuperarse.
  useTonoAlIncrementar(isLoading || error != null ? null : porHacer);

  // Feature 161 (R16/R18): preferencia de sonido del dispositivo. El hook la lee como
  // fuente externa a React para no romper la hidratacion (ver `usePreferenciaSonido`).
  const { activado: sonidoActivado, establecer: establecerSonido } =
    usePreferenciaSonido();

  const [filtro, setFiltro] = useState<Filtro>("todas");
  const idAccion = useId();
  const idInfo = useId();

  const total = items.length;
  const accionables = items.filter((n) => n.accionable === true);
  const informativas = items.filter((n) => n.accionable !== true);
  const cifraDistintivo = porHacer > BADGE_MAX ? `+${BADGE_MAX}` : String(porHacer);
  const etiquetaDistintivo = TEXTOS.porHacer(cifraDistintivo);

  /** R46 (146) + R15: descarta en el servidor y retira el elemento sin recargar la página. */
  async function dismiss(id: string) {
    const restantes = items.filter((n) => n.id !== id);
    try {
      await mutateOptimista(
        async (current) => {
          await descartarNotificacion(id);
          const lista = (current?.items ?? []).filter((n) => n.id !== id);
          return {
            items: lista,
            noLeidas: contarNoLeidas(lista),
            porHacer: contarPorHacer(lista),
          };
        },
        {
          items: restantes,
          noLeidas: contarNoLeidas(restantes),
          porHacer: contarPorHacer(restantes),
        },
      );
    } catch {
      // R48: el descarte falló; SWR ya revirtió el optimismo y revalidará solo.
      // La campana no rompe la cabecera ni interrumpe al usuario con un error.
    }
  }

  /**
   * R45 (146): marca todas en el servidor y deja el contador de LECTURA en cero sin recargar.
   *
   * ⚠️ R14: `porHacer` NO se toca. Marcar leídas no hace el trabajo — es exactamente la confusión
   * que esta ficha vino a deshacer.
   */
  async function marcarTodas() {
    const leidas = items.map((n) => ({ ...n, read: true }));
    try {
      await mutateOptimista(
        async (current) => {
          await marcarTodasLeidasAction();
          return {
            items: (current?.items ?? []).map((n) => ({ ...n, read: true })),
            noLeidas: 0,
            porHacer: current?.porHacer ?? porHacer,
          };
        },
        { items: leidas, noLeidas: 0, porHacer },
      );
    } catch {
      // R48: fallo silencioso; el próximo refresco (60 s) recupera el estado real.
    }
  }

  return (
    <Popover.Root
      onOpenChange={(open) => {
        // R47: revalidación al abrir el popover, además del polling de 60 s.
        if (open) void mutate();
      }}
    >
      <Popover.Trigger
        aria-label={`${TEXTOS.tituloPanel}${porHacer > 0 ? `, ${etiquetaDistintivo}` : ""}`}
        className={cn(
          "relative flex cursor-pointer items-center gap-1.5 rounded-full p-1 text-foreground transition-colors hover:bg-foreground/10",
          ANILLO_FOCO,
          // R11: con trabajo pendiente el disparador es una PÍLDORA que dice la cifra con
          // palabras. R10: a cero vuelve a ser un icono apagado, sin distintivo de ninguna clase.
          porHacer > 0 &&
            "border border-primary/30 bg-primary/10 py-1 pr-2.5 pl-2 text-primary hover:bg-primary/15",
        )}
      >
        <Bell className="size-5" aria-hidden="true" />
        {porHacer > 0 ? (
          <span className="text-xs font-semibold whitespace-nowrap">
            {etiquetaDistintivo}
          </span>
        ) : null}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          {/* R22: 400 px de contenido (`w-100` = 100 × 0.25rem), acotado por el ancho de la
              ventana en pantallas estrechas. */}
          <Popover.Popup className="flex w-100 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            {/* Cabecera: intacta (R28) salvo el chip del total, que se muda a la fila de filtro. */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="size-4" aria-hidden="true" />
                <h2 className="text-sm font-semibold">{TEXTOS.tituloPanel}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void marcarTodas()}
                  disabled={noLeidas === 0}
                  className={cn(
                    "cursor-pointer rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                    ANILLO_FOCO,
                  )}
                >
                  {TEXTOS.marcarLeidas}
                </button>
                {/* Feature 161 (R18): silenciar el tono. El estado va en el nombre
                    accesible, no solo en el icono. */}
                <button
                  type="button"
                  onClick={() => establecerSonido(!sonidoActivado)}
                  aria-pressed={!sonidoActivado}
                  aria-label={
                    sonidoActivado ? TEXTOS.silenciar : TEXTOS.activarSonido
                  }
                  className={cn(
                    "shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
                    ANILLO_FOCO,
                  )}
                >
                  {sonidoActivado ? (
                    <Volume2 className="size-4" aria-hidden="true" />
                  ) : (
                    <VolumeX className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* R25: la separación que hoy no existe. Dos píldoras; «Requieren tu acción» oculta el
                bloque informativo. Se deshabilita cuando no hay nada accionable: filtrar a un
                panel en blanco no es un estado, es un callejón. */}
            {total > 0 ? (
              <div
                role="group"
                aria-label={TEXTOS.filtroGrupo}
                className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2"
              >
                <button
                  type="button"
                  onClick={() => setFiltro("accion")}
                  aria-pressed={filtro === "accion"}
                  disabled={accionables.length === 0}
                  className={cn(
                    "cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
                    ANILLO_FOCO,
                    filtro === "accion"
                      ? "bg-foreground font-semibold text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TEXTOS.bloqueAccion} ·{" "}
                  <span className="font-semibold">{porHacer}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFiltro("todas")}
                  aria-pressed={filtro === "todas"}
                  className={cn(
                    "cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    ANILLO_FOCO,
                    filtro === "todas"
                      ? "bg-foreground font-semibold text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TEXTOS.filtroTodas} · <span className="font-semibold">{total}</span>
                </button>
              </div>
            ) : null}

            {total === 0 ? (
              // R24: el estado vacío se conserva tal cual estaba.
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {TEXTOS.vacio}
              </p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                {/* R16: los accionables PRIMERO, bajo su encabezado. R23: un bloque sin avisos no
                    pinta ni encabezado ni contenedor. */}
                {accionables.length > 0 ? (
                  <section aria-labelledby={idAccion}>
                    <h3
                      id={idAccion}
                      className="bg-muted/40 px-4 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
                    >
                      {TEXTOS.bloqueAccion}
                    </h3>
                    <ul className="divide-y divide-border border-b border-border">
                      {accionables.map((n) => (
                        <li key={n.id} className="flex gap-3 px-4 py-3.5">
                          <PastillaIcono tipo={n.notification_type} />
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <p className="text-sm leading-snug font-semibold">
                              {n.titulo ?? n.description}
                            </p>
                            {/* R20: la línea de contexto, SIN la etiqueta de jerga «Anexo:». */}
                            {n.detalle ? (
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {n.detalle}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              {/* R17/R21: el atajo navega a SU destino y cierra el panel.
                                  R18: sin atajo declarado no se pinta botón — una promesa falsa
                                  enseña a ignorar las que sí resuelven algo. */}
                              {n.atajo ? (
                                <Popover.Close
                                  render={<Link href={n.atajo.href} />}
                                  className={cn(
                                    "inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
                                    ANILLO_FOCO,
                                  )}
                                >
                                  {n.atajo.etiqueta}
                                  <ChevronRight className="size-3" aria-hidden="true" />
                                </Popover.Close>
                              ) : null}
                              <InstanteRelativo notificacion={n} />
                            </div>
                          </div>
                          <BotonDescartar onClick={() => void dismiss(n.id)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {filtro === "todas" && informativas.length > 0 ? (
                  <section aria-labelledby={idInfo}>
                    <h3
                      id={idInfo}
                      className="bg-muted/40 px-4 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
                    >
                      {TEXTOS.bloqueInfo}
                    </h3>
                    <ul className="divide-y divide-border">
                      {informativas.map((n) => (
                        <li key={n.id} className="flex items-start gap-3 px-4 py-2.5">
                          <span
                            className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
                            aria-hidden="true"
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <p className="text-xs leading-relaxed">
                              {n.titulo ?? n.description}
                            </p>
                            {/* R19: en este bloque NO hay botón de acción, sólo el instante. */}
                            <InstanteRelativo notificacion={n} />
                          </div>
                          {/* R26: descartar se conserva en los DOS bloques. */}
                          <BotonDescartar onClick={() => void dismiss(n.id)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
            {/* R29: NO hay pie. `/notificaciones` no existe y el panel no ofrece controles que
                lleven a una pantalla que no hay (decisión Q7 del humano). */}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** La pastilla semántica del bloque accionable; su nombre accesible es el tipo (146/R49). */
function PastillaIcono({ tipo }: { tipo: NotificationType }) {
  const { Icon, pastilla, label } = TYPE_ICON[tipo];
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        pastilla,
      )}
    >
      <Icon className="size-4.5" aria-label={label} />
    </span>
  );
}

/**
 * R31/R32: el instante llega YA RESUELTO en palabras desde el servidor. Este componente NO lee el
 * reloj del navegador — hacerlo daría dos textos distintos para el mismo nodo entre servidor y
 * cliente, que es la clase de fallo mudo que `usePreferenciaSonido` ya documentó. `createdAt`
 * viaja sólo como `title`, y una guardia impide que alguien vuelva a calcularlo aquí.
 */
function InstanteRelativo({ notificacion }: { notificacion: NotificationItem }) {
  if (!notificacion.cuando) return null;
  return (
    <span
      title={notificacion.createdAt}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
    >
      <Clock className="size-3" aria-hidden="true" />
      {notificacion.cuando}
    </span>
  );
}

function BotonDescartar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={TEXTOS.descartar}
      className={cn(
        "h-fit shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        ANILLO_FOCO,
      )}
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}
