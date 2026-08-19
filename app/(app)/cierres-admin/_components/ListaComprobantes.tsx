"use client";

import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * La tira de comprobantes que sustituyó a las tablas de cierres (pedido humano del
 * 2026-08-16: «todas las cards de los cierres al componente de vista factura, para todos los
 * roles»). Es el envoltorio que la lista necesita y la hoja no da: los CUATRO estados de un
 * listado —error, carga, vacío y datos—, que es lo que el `DataTable` daba y la hoja no.
 *
 * POR QUÉ NO VIVE EN `cierre-factura.tsx`: aquel archivo está bajo el inventario CERRADO de la
 * feature 217 (`tests/unit/guards/factura-contraste.guardia.test.ts`), que congela el conjunto
 * de utilidades —cromáticas y no cromáticas— de las dos hojas. Este componente pinta
 * esqueletos y rejillas, que son clases nuevas: meterlo ahí pondría roja una guardia de COLOR
 * por un cambio que no es de color. La hoja se queda con la hoja; el listado, aquí.
 *
 * LO QUE CONSERVA DE LA TABLA, y no es adorno: la PRECEDENCIA de estados (error > carga >
 * vacío > datos) y sus roles accesibles (`alert` para el error, un único `status` para la
 * carga, con los esqueletos `aria-hidden`). Un listado que pinte «no hay cierres» cuando lo
 * que pasó es que la lectura falló miente igual sea tabla o tarjeta.
 *
 * LO QUE NO LLEVA, dicho para que no se lea como un olvido: ni paginación ni DESCARGA. Los dos
 * controles viven en la pantalla que monta esta lista —la paginación debajo, junto al `total`
 * del servidor; la descarga arriba, en la misma fila que las pestañas (pedido humano del
 * 2026-08-16)—. La descarga estuvo aquí dentro hasta ese día, encima de la lista: se subió para
 * que el botón quedara alineado con los de «Pendientes/Resueltos» en vez de en una fila propia,
 * y de paso deja de haber un control de descarga por panel oculto: solo existe el de la pestaña
 * que se está mirando.
 */

/** Cuántas tarjetas fantasma se pintan mientras llega la página. */
const ESQUELETOS = 3;

export interface ListaComprobantesProps<T> {
  /** Nombre accesible de la lista. Hereda el de la tabla a la que reemplazó (R13). */
  ariaLabel: string;
  items: readonly T[];
  /** Clave estable de cada comprobante (el id del cierre, como el `rowKey` de la tabla). */
  clave: (item: T) => string;
  render: (item: T) => ReactNode;
  isLoading?: boolean;
  /** Mensaje accionable si la lectura de la página falló; `null` si fue bien. */
  error?: string | null;
  emptyMessage: string;
}

export function ListaComprobantes<T>({
  ariaLabel,
  items,
  clave,
  render,
  isLoading = false,
  error = null,
  emptyMessage,
}: Readonly<ListaComprobantesProps<T>>) {
  let cuerpo: ReactNode;

  if (error) {
    cuerpo = (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {error}
      </p>
    );
  } else if (isLoading) {
    cuerpo = (
      <>
        <span role="status" className="sr-only">
          Cargando
        </span>
        <div className="flex flex-col gap-4">
          {Array.from({ length: ESQUELETOS }).map((_, i) => (
            <Skeleton
              key={`esqueleto-${i}`}
              aria-hidden="true"
              className="h-28 w-full rounded-xl"
            />
          ))}
        </div>
      </>
    );
  } else if (items.length === 0) {
    cuerpo = <EmptyState title={emptyMessage} />;
  } else {
    // `ul`/`li` y no `div`s: la lista de comprobantes es una lista, y así un lector de
    // pantalla anuncia cuántos hay —lo que la tabla daba por su estructura de filas—.
    // El nombre accesible va aquí, sobre la lista, igual que iba sobre la `<table>`.
    cuerpo = (
      <ul aria-label={ariaLabel} className="flex list-none flex-col gap-4 p-0">
        {items.map((item) => (
          <li key={clave(item)}>{render(item)}</li>
        ))}
      </ul>
    );
  }

  // `p-1` = 4px de padding en el contenedor (pedido humano del 2026-08-16). Va en el
  // CONTENEDOR y no en la lista para que valga también en los otros tres estados —carga,
  // error y vacío—: los cuatro ocupan el mismo hueco, y un respiro que solo tuviera el de
  // datos haría saltar la caja al cambiar de estado.
  return <div className="flex w-full flex-col gap-2 p-1">{cuerpo}</div>;
}
