"use client";

import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Sección «por aceptar»: encabezado, banner con el contador de nuevas y la lista de
// órdenes. Componente de presentación PURO: no conoce Server Actions ni estado de
// negocio, y todos sus textos entran por props (i18n-ready).
//
// QUIÉN LA USA, medido en el árbol el 2026-08-24 (ficha 279, R4): **un solo consumidor
// real**, el portal del `adminSatelite` («Por recibir»), más su propio test. La cabecera
// que había aquí decía otra cosa: que el mensajero la compartía. Eso dejó de ser verdad
// hace tiempo —el mensajero ya no la monta— y se corrige, porque una documentación que
// nombra consumidores inexistentes invita a «no tocar por si acaso» justo lo que sí se
// puede tocar. Si mañana vuelve a compartirse, se dice aquí y con fecha.
//
// QUÉ NO OFRECE, y por qué está escrito en negativo:
// - **Ninguna acción en lote.** El «aceptar todas» se retiró el 2026-08-19 (pedido humano):
//   aceptar de golpe todo lo que hay en pantalla se firma sin mirar.
// - **Ninguna acción por-orden.** El botón «Aceptar» se retiró en la ficha 279 (R1/R3): la
//   recepción del satélite es SOLO por QR, con el escáner. Con él se fueron las props
//   `onAceptarUna`, `textoBotonUna` y `mostrarAcciones` —esta última existía únicamente
//   para ocultar ese botón— y el `CardAction` + `<Button>` de la tarjeta por defecto.
//
// Las dos ausencias las vigila `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts`,
// porque una ausencia se rompe sin que nadie se entere.

/** Forma mínima que cada orden debe cumplir para renderizar su título. */
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
  /** Texto cuando no hay órdenes. */
  vacio: string;
  /** Render opcional del detalle de cada orden (evita acoplar el detalle). */
  renderDetalle?: (orden: T) => ReactNode;
  /**
   * Render opcional de la TARJETA COMPLETA de cada orden. Si se pasa, reemplaza la
   * `Card` por defecto (título + `renderDetalle`): el consumidor pinta su propia card.
   * La sección sigue aportando el encabezado, el banner del contador y el estado vacío.
   */
  renderItem?: (orden: T) => ReactNode;
  /** Clases de la `<ul>` (p. ej. una grilla). Default: columna con separación. */
  listClassName?: string;
}

/**
 * Sección «por aceptar» del portal del `adminSatelite` («Por recibir»): encabezado,
 * banner del contador de nuevas y lista de órdenes. **Sin ninguna acción**: ni por-orden
 * ni en lote (ver la cabecera del archivo).
 */
export function PorAceptarSection<T extends PorAceptarOrdenBase>({
  titulo,
  nuevasLabel,
  ordenes,
  vacio,
  renderDetalle,
  renderItem,
  listClassName = "flex flex-col gap-3",
}: PorAceptarSectionProps<T>) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{titulo}</h2>

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
