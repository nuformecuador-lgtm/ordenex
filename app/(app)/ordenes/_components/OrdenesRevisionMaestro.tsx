"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  listarCatalogoEstatus,
  listarMensajerosParaAsignacion,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { OrdenesApartado } from "./OrdenesApartado";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";

export interface OrdenesRevisionMaestroProps {
  /** R12-UI: `admin` es solo-lectura (sin checkboxes ni botones/modales de acción). */
  readOnly?: boolean;
}

type ModalAbierto = "generar-guia" | "asignar-bodega" | null;

async function catalogoEstatusFetcher() {
  const res = await listarCatalogoEstatus();
  if (res.status !== "ok") throw new Error(res.status);
  return res.estatus;
}

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  return res.mensajeros;
}

/**
 * Orquestador de la vista de revisión del maestro (feature 17, T16/T17):
 * carga en paralelo el catálogo de estados (para resolver `value -> estatusId`,
 * design.md §4) y la lista de mensajeros (R28), y renderiza los 4 apartados por
 * estado (R15/R16) con selección por lote (R17) y las acciones "Generar guía"
 * (R18, sobre `en_fulfillment`/`en_preparacion`) y "Asignar mensajero" (R26,
 * sobre `en_bodega`). El apartado `en_espera_aceptacion` es de solo lectura en
 * esta feature: no tiene acción propia (la respuesta del mensajero es de la
 * feature 36).
 *
 * `readOnly` (R12-UI, `admin`): ningún apartado es seleccionable y no se montan
 * botones ni modales de acción; el backend igual rechaza escrituras (R12,
 * defensa en profundidad).
 *
 * Límites (fuera de alcance): la lista de mensajeros no filtra por zona/GAM
 * (feature 30 restringirá el cuerpo del loader sin cambiar este componente).
 */
export function OrdenesRevisionMaestro({
  readOnly = false,
}: OrdenesRevisionMaestroProps) {
  const { mutate } = useSWRConfig();

  const { data: estatus, error: estatusError } = useSWR(
    "ordenes:catalogo-estatus",
    catalogoEstatusFetcher,
  );
  const { data: mensajeros, error: mensajerosError } = useSWR(
    "ordenes:mensajeros",
    mensajerosFetcher,
  );

  const [modalAbierto, setModalAbierto] = useState<ModalAbierto>(null);
  const [ordenesSeleccionadas, setOrdenesSeleccionadas] = useState<
    OrdenListItemDTO[]
  >([]);

  const estatusIdPorValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of estatus ?? []) map.set(item.value, item.id);
    return map;
  }, [estatus]);

  function abrirGenerarGuia(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("generar-guia");
  }

  function abrirAsignarBodega(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("asignar-bodega");
  }

  function cerrarModal(open: boolean) {
    if (!open) setModalAbierto(null);
  }

  function handleSuccess() {
    setModalAbierto(null);
    // Revalida los 4 apartados (todos comparten el prefijo de key, sin
    // acoplarse a estatusValue/página/tamaño actuales de cada uno).
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:apartado",
      undefined,
      { revalidate: true },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {estatusError ? (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar el catálogo de estados.
        </p>
      ) : null}
      {mensajerosError ? (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar la lista de mensajeros.
        </p>
      ) : null}

      <OrdenesApartado
        titulo="En fulfillment"
        estatusValue="en_fulfillment"
        estatusId={estatusIdPorValue.get("en_fulfillment")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Generar guía"}
        onAction={readOnly ? undefined : abrirGenerarGuia}
      />
      <OrdenesApartado
        titulo="En preparación"
        estatusValue="en_preparacion"
        estatusId={estatusIdPorValue.get("en_preparacion")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Generar guía"}
        onAction={readOnly ? undefined : abrirGenerarGuia}
      />
      <OrdenesApartado
        titulo="En espera de aceptación del mensajero"
        estatusValue="en_espera_aceptacion"
        estatusId={estatusIdPorValue.get("en_espera_aceptacion")}
        selectable={false}
      />
      <OrdenesApartado
        titulo="En bodega"
        estatusValue="en_bodega"
        estatusId={estatusIdPorValue.get("en_bodega")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Asignar mensajero"}
        onAction={readOnly ? undefined : abrirAsignarBodega}
      />

      {!readOnly ? (
        <>
          <GenerarGuiaModal
            open={modalAbierto === "generar-guia"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarBodegaModal
            open={modalAbierto === "asignar-bodega"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
        </>
      ) : null}
    </div>
  );
}
