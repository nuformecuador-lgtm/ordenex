"use client";

import { useEffect, useState } from "react";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { Button } from "@/components/ui/button";
import { resumenCargaMasiva } from "@/lib/actions/carga-masiva-resumen";
import { formatMonto } from "@/lib/config/moneda";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";

import { EstatusBadge } from "./EstatusBadge";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";

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
  // Etiquetas del lote recién cargado. Se abre sobre las filas YA resueltas del resumen,
  // que son las que traen el `id` de cada orden (las remisiones del prop no bastan).
  const [etiquetasAbierto, setEtiquetasAbierto] = useState(false);

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
    {
      id: "numRemision",
      value: "Nº Remisión",
      render: "numRemision",
      minWidth: "120px",
    }, // R23
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
    { id: "telefonoDest", value: "Teléfono", render: "telefonoDest" },
    { id: "producto", value: "Producto", render: "producto", minWidth: "300px" },
    {
      id: "estatus",
      value: "Estatus",
      // Era el ÚNICO punto del flujo de carga masiva que pintaba el value crudo de
      // la DB (`en_preparacion`, `por_recolectar_en_tienda`): el mismo chip del
      // listado deja la traducción y los colores en una sola fuente (`EstatusBadge`).
      // Sin `estatusValue` el chip saldría vacío, así que la ausencia cae al mismo
      // guion que ya usan la dirección y el monto de esta misma tabla (`-`, no el
      // `—` de `estatusLabel`: manda la tabla en la que vive la celda).
      render: (row) =>
        row.estatusValue ? (
          <EstatusBadge value={row.estatusValue} zonaNombre={row.zonaNombre} />
        ) : (
          "-"
        ),
    },
    {
      id: "montoCobrar",
      value: "Monto",
      // Feature 230 (R13): el monto pasa por el formateador compartido en vez de
      // serializarse a mano. Era la unica celda del arbol que pintaba el numero
      // crudo, asi que gana el simbolo y el separador de miles que el resto de la
      // app ya tenia. `formatMonto` devuelve el mismo `-` que esta celda ponia a
      // mano cuando no hay monto (`SIN_MONTO`), asi que la ausencia no cambia.
      render: (row) => formatMonto(row.montoCobrar),
    },
    {
      id: "direccion",
      value: "Dirección",
      render: (row) => row.direccion ?? "-",
      minWidth: "200px",
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
          {/* Etiquetas del lote recién cargado. Las órdenes de una tienda SIN fulfillment
              nacen ya CON `num_guia` (feature 155), así que su etiqueta existe desde este
              mismo momento y el mensajero puede llevárselas impresas. Las que nacen en
              `en_preparacion` todavía no tienen guía: el modal las reporta como omitidas
              "sin guía" en vez de fallar, y sus etiquetas salen tras "Generar guía".

              El botón espera a que el resumen resuelva porque necesita los `id` de las
              órdenes, que es lo que la generación consume; las remisiones del prop no los
              traen. Mientras carga no se ofrece, para no abrir un modal vacío. */}
          {filas.length > 0 ? (
            <Button
              type="button"
              variant="brand-outline"
              onClick={() => setEtiquetasAbierto(true)}
            >
              Descargar etiquetas
            </Button>
          ) : null}
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

      <EtiquetasGuiaModal
        open={etiquetasAbierto}
        ordenes={filas}
        onOpenChange={setEtiquetasAbierto}
      />
    </div>
  );
}
