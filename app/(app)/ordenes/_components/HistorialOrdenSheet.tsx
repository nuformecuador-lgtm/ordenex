"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { ObtenerHistorialOrdenResult } from "@/lib/actions/orden-historial";

import { HistorialOrdenTimeline } from "./HistorialOrdenTimeline";

// Feature 49 (T6.2, R28/R29) — drawer "Ver historial" por fila. Al ABRIRSE llama a la
// Server Action `obtenerHistorialOrden(ordenId)` (borde de servidor: resuelve el actor por
// sesion y autoriza por visibilidad de la orden, R27) y pasa el resultado por PROPS al
// timeline de presentacion. NUNCA fetchea datos sensibles con SWR desde el navegador (R28).
//
// Feature 49 (T6.3, punto de extension F1.4-f — REALTIME feature 35): HOY la linea de tiempo
// se lee UNA vez, al abrir el drawer (ver el useEffect de abajo). La feature 35 (realtime)
// engancha aqui: suscribir los cambios de estado de la orden y re-consultar
// `obtenerHistorial(ordenId)` (o aplicar el delta) para refrescar el timeline en vivo. El
// timeline es tonto (consume una lista de entradas), asi que la 35 no necesita tocarlo.

type ObtenerHistorialFn = (ordenId: string) => Promise<ObtenerHistorialOrdenResult>;

type CargaState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | ObtenerHistorialOrdenResult;

/**
 * Fetcher por defecto: importa la Server Action de forma PEREZOSA (solo al abrir el drawer).
 * Asi el grafo de modulos del cliente que monta la lista de ordenes NO arrastra el borde de
 * servidor (`next/headers`/prisma) hasta que realmente se consulta el historial. En test se
 * inyecta un doble por la prop `obtenerHistorial`.
 */
const obtenerHistorialPorDefecto: ObtenerHistorialFn = async (ordenId) => {
  const mod = await import("@/lib/actions/orden-historial");
  return mod.obtenerHistorialOrden(ordenId);
};

export interface HistorialOrdenSheetProps {
  /** Orden cuya linea de tiempo se consulta al abrir (R28). */
  ordenId: string;
  /** Referencia legible para el titulo/etiqueta (p. ej. Nº de remision). Opcional. */
  referencia?: string;
  /** Texto del disparador. Default "Ver historial". */
  triggerLabel?: string;
  /** Inyectable para test; por defecto la Server Action real (via import perezoso). */
  obtenerHistorial?: ObtenerHistorialFn;
}

export function HistorialOrdenSheet({
  ordenId,
  referencia,
  triggerLabel = "Ver historial",
  obtenerHistorial = obtenerHistorialPorDefecto,
}: HistorialOrdenSheetProps) {
  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<CargaState>({ status: "idle" });

  // Marca "cargando" al transicionar a `open` como AJUSTE de estado durante el render
  // (patron del repo, AsignarBodegaModal): evita un setState sincrono dentro del efecto.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setEstado({ status: "loading" });
  }

  // Carga bajo demanda: la consulta async corre al abrir el drawer (server boundary); el
  // resultado se aplica en el callback de la promesa. Ver la nota del cabezal sobre el punto
  // de extension de realtime (feature 35, T6.3).
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    obtenerHistorial(ordenId)
      .then((r) => {
        if (!cancelado) setEstado(r);
      })
      .catch(() => {
        if (!cancelado) setEstado({ status: "error" });
      });
    return () => {
      cancelado = true;
    };
  }, [open, ordenId, obtenerHistorial]);

  const titulo = referencia
    ? `Historial de la orden ${referencia}`
    : "Historial de la orden";

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(true)}
              aria-label={`Ver historial de la orden ${referencia ?? ordenId}`}
            >
              <History className="size-4" />
            </Button>
          }
        />
        <TooltipContent>{triggerLabel}</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={(next) => setOpen(next)}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{titulo}</SheetTitle>
            <SheetDescription>
              Cambios de estado de la orden en orden cronológico.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <HistorialOrdenBody estado={estado} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Renderiza el cuerpo del drawer segun el estado de carga/resultado de la Server Action. */
function HistorialOrdenBody({ estado }: { estado: CargaState }) {
  switch (estado.status) {
    case "idle":
    case "loading":
      return (
        <div
          role="status"
          aria-label="Cargando historial"
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      );
    case "ok": {
      // R29: datos por props al timeline de presentacion.
      // Feature 47 (T4.2, R15/R16/R17): junto al timeline, el conteo de intentos
      // de entrega DERIVADO ("Intento X de N", N = umbral configurable). SOLO se
      // muestra cuando la orden lleva >= 1 devolucion (R16); con `intentos === 0`
      // no se pinta el badge. La VISIBILIDAD se hereda del propio `ok`: la Server
      // Action ya autorizo por visibilidad de la orden (R17), asi que un
      // forbidden/not_found/unauthenticated nunca llega aqui y el badge no aparece
      // para quien no tiene visibilidad; no se añade regla de permisos nueva.
      const { intentos, umbral } = estado;
      const intentosLabel = `Intento ${intentos} de ${umbral}`;
      return (
        <div className="flex flex-col gap-4">
          {intentos >= 1 ? (
            <Badge
              variant="secondary"
              role="status"
              aria-label={`Intentos de entrega: ${intentos} de ${umbral}`}
              className="self-start"
            >
              {intentosLabel}
            </Badge>
          ) : null}
          <HistorialOrdenTimeline entradas={estado.entradas} />
        </div>
      );
    }
    case "forbidden":
      // R27: sin visibilidad de la orden, sin filtrar datos.
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes acceso al historial de esta orden.
        </p>
      );
    case "not_found":
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          Orden no encontrada.
        </p>
      );
    case "unauthenticated":
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          Tu sesión expiró. Vuelve a iniciar sesión para ver el historial.
        </p>
      );
    case "error":
    default:
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el historial. Inténtalo de nuevo.
        </p>
      );
  }
}
