"use client";

import { useState, type ComponentType } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Bell,
  CircleAlert,
  Package,
  TriangleAlert,
  X,
  type LucideProps,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Tipos de notificación soportados; cada uno mapea a un icono distinto. */
export type NotificationType = "alert" | "box" | "warning";

export interface NotificationItem {
  id: string;
  /** Determina el icono mostrado (alert | box | warning). */
  notification_type: NotificationType;
  /** Descripción breve de la notificación. */
  description: string;
  /** Texto anexo/adjunto opcional (p. ej. Nº de remisión, guía, etc.). */
  anexo?: string;
  /** Marca si ya fue leída. Por defecto no leída. */
  read?: boolean;
}

export interface NotificationsBellProps {
  /** Lista de notificaciones. Si se omite, usa ejemplos quemados. */
  notifications?: NotificationItem[];
}

/** Mapa notification_type → icono + color de acento. */
const TYPE_ICON: Record<
  NotificationType,
  { Icon: ComponentType<LucideProps>; className: string; label: string }
> = {
  alert: { Icon: CircleAlert, className: "text-red-500", label: "Alerta" },
  box: { Icon: Package, className: "text-navy", label: "Paquete" },
  warning: {
    Icon: TriangleAlert,
    className: "text-amber-500",
    label: "Advertencia",
  },
};

/** Notificaciones de ejemplo (quemadas) usadas cuando no llegan por props. */
const EXAMPLE_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    notification_type: "alert",
    description: "Una orden fue rechazada por el destinatario.",
    anexo: "REM-0042",
  },
  {
    id: "n2",
    notification_type: "box",
    description: "Nuevo lote de 15 órdenes cargado correctamente.",
    anexo: "Lote #128",
  },
  {
    id: "n3",
    notification_type: "warning",
    description: "3 órdenes llevan más de 48h sin mensajero asignado.",
    anexo: "Zona Centro",
  },
  {
    id: "n4",
    notification_type: "box",
    description: "El mensajero Juan Pérez confirmó la recolección.",
    anexo: "Ruta 7",
  },
  {
    id: "n5",
    notification_type: "alert",
    description: "Un pago contra entrega no fue registrado.",
    anexo: "REM-0051",
  },
  {
    id: "n6",
    notification_type: "warning",
    description: "El stock de guías físicas está por agotarse.",
    anexo: "Bodega Norte",
  },
  {
    id: "n7",
    notification_type: "box",
    description: "5 órdenes fueron entregadas con éxito hoy.",
    anexo: "Zona Sur",
  },
  {
    id: "n8",
    notification_type: "warning",
    description: "Una zona quedó sin tarifa configurada.",
    anexo: "Zona Valle",
  },
  {
    id: "n9",
    notification_type: "alert",
    description: "Un mensajero reportó una novedad en una entrega.",
    anexo: "REM-0063",
    read: true,
  },
  {
    id: "n10",
    notification_type: "box",
    description: "El cierre de caja del día está disponible.",
    anexo: "Caja #12",
    read: true,
  },
];

/**
 * Campana de notificaciones con dropdown (Popover de Base UI). Muestra un badge
 * rojo con el total sin leer; al abrir despliega la cabecera (campana + total +
 * "marcar todas como leídas") y la lista, cada una con su icono según
 * `notification_type`, descripción, anexo y una X para descartar.
 */
export function NotificationsBell({
  notifications = EXAMPLE_NOTIFICATIONS,
}: NotificationsBellProps) {
  const [items, setItems] = useState<NotificationItem[]>(notifications);

  const total = items.length;
  const unread = items.filter((n) => !n.read).length;
  const badge = unread > 99 ? "+99" : String(unread);

  function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  function marcarTodasLeidas() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Notificaciones${unread > 0 ? `, ${unread} sin leer` : ""}`}
        className="relative flex cursor-pointer items-center rounded-md p-1 text-navy outline-none transition-colors hover:bg-navy/5 focus-visible:ring-2 focus-visible:ring-navy/40"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
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
              <button
                type="button"
                onClick={marcarTodasLeidas}
                disabled={unread === 0}
                className="text-xs font-medium text-navy/70 outline-none transition-colors hover:text-navy focus-visible:underline disabled:pointer-events-none disabled:opacity-40"
              >
                Marcar todas como leídas
              </button>
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
                        onClick={() => dismiss(n.id)}
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
