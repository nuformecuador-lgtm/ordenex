"use client";

// Tabla de resumen de analitica: envoltorio FINO sobre `components/shared/DataTable`
// (Q4, R22). No emite ningun `<table>` propio, asi que hereda skeleton, vacio,
// error, scroll horizontal y la descarga opt-in que la 134 va a querer.
//
// Lo que aporta —y que lo hace algo mas que un re-export, condicion de Q4 para
// que este archivo exista (`design.md §7.1`)—:
//   1. fija el formato de cada celda por la `MetricaUnidad` de SU columna, con la
//      MISMA funcion pura que las graficas (R38). El llamador no pasa formateadores.
//   2. calcula la fila de totales con una funcion pura (`totalizar`), nunca
//      sumando dentro del JSX (R23), y la renderiza distinguible de las de datos.

import { DataTable, type Column } from "@/components/shared/DataTable";

import { formatearValor, totalizar } from "./formato";
import type { ColumnaResumen, EstadoVisual, FilaResumen, TextoVacio } from "./tipos";

/** Clase de la fila de totales: la distingue de las filas de datos (R23). */
const CLASE_TOTALES = "border-t-2 border-t-foreground/30 font-semibold";

export interface TablaResumenProps extends EstadoVisual {
  /** `<caption>` de la tabla y su nombre accesible. */
  readonly titulo: string;
  /** Cabecera de la primera columna (la de la categoria). */
  readonly encabezadoCategoria: string;
  readonly columnas: readonly ColumnaResumen[];
  readonly filas: readonly FilaResumen[];
  /**
   * Declara la fila de totales y aporta SU etiqueta. Que el texto venga del
   * llamador evita incrustar cadenas de UI en el paquete; que sea la propia
   * presencia de la prop la que declara la fila evita un booleano suelto.
   */
  readonly totales?: { readonly etiqueta: string };
  readonly vacio: TextoVacio;
  readonly className?: string;
}

/** Fila interna: la de totales viaja marcada para que `rowClassName` la distinga. */
interface FilaTabla extends FilaResumen {
  readonly esTotal: boolean;
}

function filaDeTotales(
  columnas: readonly ColumnaResumen[],
  filas: readonly FilaResumen[],
  etiqueta: string,
): FilaTabla {
  const valores: Record<string, number | null> = {};
  for (const columna of columnas) {
    valores[columna.id] = totalizar(filas.map((fila) => fila.valores[columna.id] ?? null));
  }
  return { id: "__totales", categoria: etiqueta, valores, esTotal: true };
}

export function TablaResumen({
  titulo,
  encabezadoCategoria,
  columnas,
  filas,
  totales,
  vacio,
  cargando = false,
  error = null,
  className,
}: TablaResumenProps) {
  const columnasTabla: Column<FilaTabla>[] = [
    { id: "categoria", value: encabezadoCategoria, render: (fila) => fila.categoria },
    ...columnas.map((columna) => ({
      id: columna.id,
      value: columna.etiqueta,
      render: (fila: FilaTabla) =>
        formatearValor(fila.valores[columna.id] ?? null, columna.unidad),
    })),
  ];

  const datos: FilaTabla[] = filas.map((fila) => ({ ...fila, esTotal: false }));
  if (totales && filas.length > 0) {
    datos.push(filaDeTotales(columnas, filas, totales.etiqueta));
  }

  return (
    <div className={className}>
      <DataTable
        columns={columnasTabla}
        data={datos}
        caption={titulo}
        isLoading={cargando}
        error={error}
        emptyState={{ title: vacio.titulo, description: vacio.descripcion }}
        rowClassName={(fila) => (fila.esTotal ? CLASE_TOTALES : undefined)}
      />
    </div>
  );
}
