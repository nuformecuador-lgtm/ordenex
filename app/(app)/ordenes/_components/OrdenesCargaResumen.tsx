"use client";

import { useEffect, useState } from "react";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { resumenCargaMasiva } from "@/lib/actions/carga-masiva-resumen";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";

export interface OrdenesCargaResumenProps {
  /** `num_remision` del lote recién creado (feature 15, filas con `resultado==="creada"`), R7/R21. */
  numRemisiones: string[];
}

type LoadState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

/**
 * Tercer paso del modal de carga masiva (feature 16/R6): resumen columna por
 * columna del lote recién creado, en SOLO LECTURA.
 *
 * Feature 159 (R12/R13/R14): el componente ya no ofrece ninguna acción. Antes
 * traía un selector de mensajero por fila —con preselección al azar entre los
 * mensajeros de la zona— y un botón "Sugerir asignación"; ese flujo se retiró
 * entero. El mensajero de una orden se decide después, en "Generar guía". Lo que
 * queda es la única confirmación visual de QUÉ se cargó tras subir un archivo de
 * cientos de filas.
 */
export function OrdenesCargaResumen({ numRemisiones }: OrdenesCargaResumenProps) {
  const [filasState, setFilasState] = useState<LoadState<ResumenCargaOrdenDTO[]>>({
    status: "loading",
  });
  // El lote se fija AL MONTAR: la carga ya está cometida, así que sus remisiones no
  // cambian mientras el paso está en pantalla. Congelarlas en estado (en vez de
  // silenciar `exhaustive-deps`) deja el efecto honesto: depende de un valor estable,
  // no de la identidad del array que llegue por prop en cada render.
  const [lote] = useState(numRemisiones);

  // R6/R7: resumen del lote. Una sola lectura al montar el paso; no hay mutación
  // que revalidar (el listado ya se revalida tras la carga real, en el padre).
  useEffect(() => {
    let cancelled = false;

    void resumenCargaMasiva({ numRemisiones: lote })
      .then((resumen) => {
        if (cancelled) return;
        if (resumen.status === "ok") {
          setFilasState({ status: "ok", data: resumen.ordenes });
        } else {
          setFilasState({
            status: "error",
            message: "No se pudo cargar el resumen de la carga masiva.",
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFilasState({
          status: "error",
          message: "No se pudo cargar el resumen de la carga masiva.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [lote]);

  const filas = filasState.status === "ok" ? filasState.data : [];

  const columns: Column<ResumenCargaOrdenDTO>[] = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" }, // R23
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
    { id: "telefonoDest", value: "Teléfono", render: "telefonoDest" },
    { id: "producto", value: "Producto", render: "producto" },
    {
      id: "estatus",
      value: "Estatus",
      render: (row) => row.estatusValue ?? "",
    },
    {
      id: "montoCobrar",
      value: "Monto",
      render: (row) => (row.montoCobrar != null ? row.montoCobrar.toFixed(2) : "-"),
    },
    {
      id: "direccion",
      value: "Dirección",
      render: (row) => row.direccion ?? "-",
    },
    {
      id: "zona",
      value: "Zona",
      render: (row) => row.zonaNombre,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Feature 148 (R18) + 157 (bloque E, R41/R43): manifiesto del lote RECIÉN CARGADO.
          El botón existía desde la 148, pero colgaba de `OrdenesCargaResumenPaso`, que la
          159 dejó huérfano: el modal monta ESTE componente. Resultado hasta ahora: una
          tienda que cargaba por la UI no podía obtener su manifiesto por NINGUNA vía —solo
          el canal de API key lo entregaba—. Aquí queda en el paso que el usuario sí ve.

          La selección son las remisiones nuevas, la única vía de este flujo (el resumen de
          la carga no lleva ids), y cubre el archivo completo, no chunk por chunk. La carga
          ya está cometida: esto es un añadido posterior, no un paso más del asistente. */}
      {numRemisiones.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          <DescargarManifiestoButton
            flujo="carga_masiva"
            seleccion={{ numRemisiones }}
          />
        </div>
      ) : null}

      <DataTable<ResumenCargaOrdenDTO>
        columns={columns}
        data={filas}
        rowKey="id"
        isLoading={filasState.status === "loading"}
        error={filasState.status === "error" ? filasState.message : null}
        emptyMessage="No hay órdenes en este lote"
        ariaLabel="Resumen de la carga masiva"
      />
    </div>
  );
}
