import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import type { SegmentedOption } from "@/components/shared/SegmentedToggle";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";

// FICHA 463 (T6, design §5.5; R1, R2, R33, R48) — los textos COMPARTIDOS de los filtros de las wallets
// con libro: la caja (`/wallet`) y los cuatro estados de cuenta (tienda, mensajero, bodega satélite y
// `/mi-wallet`). Escritos una vez para que la caja y el estado de cuenta no digan lo mismo con dos
// frases distintas. Sin siglas y sin jerga (R48).
//
// FICHA 467 — las «dos zonas» de la 463 son ahora UNA barra encima del libro: se retiraron sus textos
// de alcance, sus nombres de zona y «Aplicar»/«Quitar periodo». El nombre del archivo («zonas») queda
// HISTÓRICO a propósito: la ayuda en pantalla y las guardias citan esta ruta.
//
// Los placeholders del buscador NO viven aquí: cada superficie busca en campos distintos (R25–R27) y el
// placeholder es la documentación de lo que se puede buscar, así que va junto a cada superficie.

/** La barra del libro (FICHA 467: la única de cada wallet). */
export const ZONA_LIBRO_TEXTO = {
  /** Nombre accesible del campo de búsqueda. */
  buscar: "Buscar en el libro",
} as const;

/**
 * R33 — el control de orden: dos opciones, «Más recientes» y «Más antiguas».
 *
 * FICHA 467 (R4) — con ICONO: la barra del libro es la de `/ordenes` y su conmutador va en `soloIcono`.
 * Los iconos son LOS MISMOS que la dirección por fecha de órdenes (`OPCIONES_DIRECCION.created_at` de
 * `ordenamiento-ordenes.ts`); se importan de `lucide-react` y no de aquel módulo, que vive en `app/`.
 * La etiqueta no se pierde: es el nombre accesible y el texto emergente de cada botón.
 */
export const ORDEN_LIBRO = {
  nombre: "Ordenar el libro",
  opciones: [
    { valor: "desc", etiqueta: "Más recientes", Icono: ArrowDownWideNarrow },
    { valor: "asc", etiqueta: "Más antiguas", Icono: ArrowUpNarrowWide },
  ] as const satisfies readonly SegmentedOption<DireccionOrden>[],
} as const;

/** R34 — el orden con el que se entra a cualquier libro de wallet: lo más nuevo primero. */
export const ORDEN_LIBRO_POR_DEFECTO: DireccionOrden = "desc";
