"use client";

import { type ComponentType } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Bell,
  CircleAlert,
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

/** Mapa notification_type → icono + color de acento. */
const TYPE_ICON: Record<
  NotificationType,
  { Icon: ComponentType<LucideProps>; className: string; label: string }
> = {
  alert: { Icon: CircleAlert, className: "text-danger", label: "Alerta" },
  box: { Icon: Package, className: "text-navy", label: "Paquete" },
  warning: {
    Icon: TriangleAlert,
    className: "text-warning",
    label: "Advertencia",
  },
};

/** Tope a partir del cual el distintivo deja de mostrar la cifra exacta (R42). */
const BADGE_MAX = 99;

function contarNoLeidas(items: NotificationItem[]): number {
  return items.filter((n) => !n.read).length;
}

function datosIniciales(
  notifications: NotificationItem[] | undefined,
): NotificacionesData | undefined {
  if (!notifications) return undefined;
  return { items: notifications, noLeidas: contarNoLeidas(notifications) };
}

/**
 * Campana de notificaciones con dropdown (Popover de Base UI). Los datos vienen
 * EXCLUSIVAMENTE de la Server Action de listar vía `useNotificaciones` (R40): no hay
 * ejemplos quemados ni estado local de datos. Muestra un badge rojo con el total sin
 * leer (R41–R43); al abrir revalida (R47) y despliega la cabecera (campana + total +
 * "marcar todas como leídas", R45) y la lista, cada una con su icono según
 * `notification_type`, descripción, anexo (R49) y una X para descartar (R46).
 */
export function NotificationsBell({ notifications }: NotificationsBellProps) {
  const { items, noLeidas, error, isLoading, mutate, mutateOptimista } =
    useNotificaciones({
      fallbackData: datosIniciales(notifications),
    });

  // Feature 161 (R19/R20): el tono suena cuando el polling de 60 s trae mas no leidas.
  // Las bajadas no suenan, asi que marcar todas como leidas o descartar no dispara nada.
  //
  // `null` MIENTRAS no hay conteo real (R24): cargando, o lectura fallida -- que degrada a
  // cero por R48 de la 146 y, tomada como dato, haria sonar el tono al recuperarse.
  useTonoAlIncrementar(isLoading || error != null ? null : noLeidas);

  // Feature 161 (R16/R18): preferencia de sonido del dispositivo. El hook la lee como
  // fuente externa a React para no romper la hidratacion (ver `usePreferenciaSonido`).
  const { activado: sonidoActivado, establecer: establecerSonido } =
    usePreferenciaSonido();

  const total = items.length;
  const badge = noLeidas > BADGE_MAX ? `+${BADGE_MAX}` : String(noLeidas);

  /** R46: descarta en el servidor y retira el elemento sin recargar la página. */
  async function dismiss(id: string) {
    const restantes = items.filter((n) => n.id !== id);
    try {
      await mutateOptimista(
        async (current) => {
          await descartarNotificacion(id);
          const lista = (current?.items ?? []).filter((n) => n.id !== id);
          return { items: lista, noLeidas: contarNoLeidas(lista) };
        },
        { items: restantes, noLeidas: contarNoLeidas(restantes) },
      );
    } catch {
      // R48: el descarte falló; SWR ya revirtió el optimismo y revalidará solo.
      // La campana no rompe la cabecera ni interrumpe al usuario con un error.
    }
  }

  /** R45: marca todas en el servidor y deja el contador en cero sin recargar. */
  async function marcarTodas() {
    const leidas = items.map((n) => ({ ...n, read: true }));
    try {
      await mutateOptimista(
        async (current) => {
          await marcarTodasLeidasAction();
          return {
            items: (current?.items ?? []).map((n) => ({ ...n, read: true })),
            noLeidas: 0,
          };
        },
        { items: leidas, noLeidas: 0 },
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
        aria-label={`Notificaciones${noLeidas > 0 ? `, ${noLeidas} sin leer` : ""}`}
        className="relative flex cursor-pointer items-center rounded-md p-1 text-navy outline-none transition-colors hover:bg-navy/5 focus-visible:ring-2 focus-visible:ring-navy/40"
      >
        <Bell className="size-5" aria-hidden="true" />
        {noLeidas > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {badge}
          </span>
        ) : null}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup className="flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-background text-navy shadow-lg outline-none">
            {/* Cabecera: campana + total + marcar todas como leídas */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="size-4" aria-hidden="true" />
                <span className="text-sm font-semibold">Notificaciones</span>
                <span className="rounded-full bg-navy/10 px-1.5 py-0.5 text-xs font-medium">
                  {total}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void marcarTodas()}
                  disabled={noLeidas === 0}
                  className="text-xs font-medium text-navy/70 outline-none transition-colors hover:text-navy focus-visible:underline disabled:pointer-events-none disabled:opacity-40"
                >
                  Marcar todas como leídas
                </button>
                {/* Feature 161 (R18): silenciar el tono. El estado va en el nombre
                    accesible, no solo en el icono. */}
                <button
                  type="button"
                  onClick={() => establecerSonido(!sonidoActivado)}
                  aria-pressed={!sonidoActivado}
                  aria-label={
                    sonidoActivado
                      ? "Silenciar el sonido de las notificaciones"
                      : "Activar el sonido de las notificaciones"
                  }
                  className="shrink-0 cursor-pointer rounded-md p-1 text-navy/70 outline-none transition-colors hover:bg-navy/5 hover:text-navy focus-visible:ring-2 focus-visible:ring-navy/40"
                >
                  {sonidoActivado ? (
                    <Volume2 className="size-4" aria-hidden="true" />
                  ) : (
                    <VolumeX className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Lista de notificaciones */}
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No tienes notificaciones.
              </p>
            ) : (
              <ul className="max-h-[360px] divide-y divide-border overflow-auto">
                {items.map((n) => {
                  const { Icon, className, label } = TYPE_ICON[n.notification_type];
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3",
                        n.read ? "opacity-60" : "bg-navy/[0.03]",
                      )}
                    >
                      <Icon
                        className={cn("mt-0.5 size-5 shrink-0", className)}
                        aria-label={label}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="text-sm leading-snug">{n.description}</p>
                        {n.anexo ? (
                          <span className="text-xs text-muted-foreground">
                            Anexo: {n.anexo}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void dismiss(n.id)}
                        aria-label="Descartar notificación"
                        className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-navy/40"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
