"use client";

import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Feature 63 (reuse mensajero -> adminSatelite): sección REUTILIZABLE "por aceptar"
// extraída de "Por recoger" del mensajero. Un banner con el contador de nuevas
// arriba de la lista + un botón "aceptar todas" (lote) + tarjetas con botón
// "aceptar" por-orden. Componente de presentación puro: NO conoce Server Actions ni
// estado de negocio; el consumidor cablea `onAceptarTodas`/`onAceptarUna` y el
// render del detalle. Textos entran por props (i18n-ready), sin hardcodear en la UI.

/** Forma mínima que cada orden debe cumplir para renderizar título y acciones. */
export interface PorAceptarOrdenBase {
  id: string;
  numRemision: string;
  destinatario: string;
}

export interface PorAceptarSectionProps<T extends PorAceptarOrdenBase> {
  /** Título de la sección (también su nombre accesible, `aria-label`). */
  titulo: string;
  /**
   * Texto del banner con el contador de nuevas (p. ej. "3 Órdenes nuevas
   * asignadas"). Recibe la cantidad para componerlo; sólo se muestra si hay > 0.
   */
  nuevasLabel: (cantidad: number) => ReactNode;
  /** Órdenes a listar en este apartado. */
  ordenes: T[];
  /**
   * Lote: acepta TODAS las órdenes listadas (recibe todos sus ids). Opcional: solo se
   * usa con `mostrarAcciones` (una lista de solo-visualización no lo necesita).
   */
  onAceptarTodas?: (ids: string[]) => void;
  /** Una: acepta la orden indicada por su id. Opcional (ver `onAceptarTodas`). */
  onAceptarUna?: (id: string) => void;
  /** Texto del botón en lote ("Recoger todas" / "Aceptar todas"). Opcional. */
  textoBotonTodas?: string;
  /** Texto del botón por-orden ("Recoger" / "Aceptar"). Opcional. */
  textoBotonUna?: string;
  /** Texto cuando no hay órdenes. */
  vacio: string;
  /** Render opcional del detalle de cada orden (evita acoplar el detalle). */
  renderDetalle?: (orden: T) => ReactNode;
  /**
   * Render opcional de la TARJETA COMPLETA de cada orden. Si se pasa, reemplaza la
   * `Card` por defecto (título + acción + `renderDetalle`): el consumidor pinta su
   * propia card — p. ej. el mensajero reutiliza la card POS de "En reparto" para que
   * "Por recoger" tenga el mismo estilo. La sección sigue aportando el encabezado,
   * el banner del contador y el estado vacío.
   */
  renderItem?: (orden: T) => ReactNode;
  /** Clases de la `<ul>` (p. ej. una grilla). Default: columna con separación. */
  listClassName?: string;
  /**
   * Si es `false`, oculta el botón en lote y los botones por-orden (p. ej. el
   * adminSatelite sin zona: se listan, pero no se puede aceptar). Default `true`.
   */
  mostrarAcciones?: boolean;
}

/**
 * Sección "por aceptar" compartida (mensajero "Por recoger" / adminSatelite "Por
 * recibir"). Banner de contador + acción en lote + tarjetas con acción por-orden.
 */
export function PorAceptarSection<T extends PorAceptarOrdenBase>({
  titulo,
  nuevasLabel,
  ordenes,
  onAceptarTodas,
  onAceptarUna,
  textoBotonTodas,
  textoBotonUna,
  vacio,
  renderDetalle,
  renderItem,
  listClassName = "flex flex-col gap-3",
  mostrarAcciones = true,
}: PorAceptarSectionProps<T>) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{titulo}</h2>
        {mostrarAcciones ? (
          <Button
            type="button"
            onClick={() => onAceptarTodas?.(ordenes.map((o) => o.id))}
            disabled={ordenes.length === 0}
          >
            {textoBotonTodas}
          </Button>
        ) : null}
      </div>

      {/* Banner con el contador de nuevas, arriba de la lista (sólo si hay). */}
      {ordenes.length > 0 ? (
        <p
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
        >
          {nuevasLabel(ordenes.length)}
        </p>
      ) : null}

      {ordenes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <ul className={listClassName}>
          {ordenes.map((orden) => (
            <li key={orden.id}>
              {renderItem ? (
                renderItem(orden)
              ) : (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {orden.numRemision} · {orden.destinatario}
                  </CardTitle>
                  {mostrarAcciones ? (
                    <CardAction>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onAceptarUna?.(orden.id)}
                      >
                        {textoBotonUna}
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                {renderDetalle ? (
                  <CardContent>{renderDetalle(orden)}</CardContent>
                ) : null}
              </Card>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
