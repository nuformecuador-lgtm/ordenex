"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  listarCatalogoEstatus,
  listarMensajerosParaAsignacion,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

import { OrdenesApartado } from "./OrdenesApartado";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";
import { AsignarRecoleccionModal } from "./AsignarRecoleccionModal";
import { RutearSateliteModal } from "./RutearSateliteModal";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";

export interface OrdenesRevisionMaestroProps {
  /** R12-UI: `admin` es solo-lectura (sin checkboxes ni botones/modales de acción). */
  readOnly?: boolean;
  /**
   * Feature 46 (R15/R16): órdenes liberadas HOY (CR) por el cron para la bodega
   * central (`en_bodega_central`), pre-resueltas server-side por el Server Component padre.
   * Alimentan el aviso derivado "Liberadas hoy (reprogramación)". Vacío = sin aviso.
   */
  liberadasHoy?: LiberadaHoyRow[];
}

type ModalAbierto =
  | "generar-guia"
  | "asignar-bodega"
  | "asignar-recoleccion" // feature 157
  | "rutear-satelite"
  | "etiquetas"
  | null;

async function catalogoEstatusFetcher() {
  const res = await listarCatalogoEstatus();
  if (res.status !== "ok") throw new Error(res.status);
  return res.estatus;
}

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  // Ajuste maestro: incluye los ids de mensajeros GAM con cierre abierto para
  // deshabilitarlos en los selectores.
  return {
    mensajeros: res.mensajeros,
    bloqueadosIds: res.bloqueadosIds ?? [],
    // Feature 157 (regla de dedicación): las dos caras de "repartir y recolectar no se
    // mezclan". Ambos fetchers comparten la key SWR, así que devuelven la MISMA forma.
    conRepartoIds: res.conRepartoIds ?? [],
    conRecoleccionIds: res.conRecoleccionIds ?? [],
  };
}

/**
 * Orquestador de la vista de revisión del maestro (feature 17, T16/T17):
 * carga en paralelo el catálogo de estados (para resolver `value -> estatusId`,
 * design.md §4) y la lista de mensajeros (R28), y renderiza los apartados por
 * estado (R15/R16) con selección por lote (R17) y las acciones "Generar guía"
 * (R18, sobre `en_preparacion`) y "Asignar mensajero" (R26, sobre
 * `en_bodega_central`). El apartado `por_recoger` es de solo lectura en esta
 * feature: no tiene acción propia (la respuesta del mensajero es de la
 * feature 36).
 *
 * Feature 30 (T16, R13/R15): añade un 5.º apartado solo-lectura para
 * `en_ruta_bodega_satelite` ("En ruta a bodega satélite") y una acción
 * secundaria "Rutear a bodega satélite" que rutea las órdenes NO-GAM
 * seleccionadas vía `rutearABodegaSatelite`.
 *
 * Feature 156 (R29): esa acción secundaria queda SOLO en `en_bodega_central`. El
 * ruteo a satélite parte de la bodega central (que es donde el paquete está
 * físicamente), así que ofrecerla desde `en_preparacion` era un camino muerto: el
 * service lo rechaza con "estado de origen no permitido".
 *
 * Feature 155 (R32): se retira el apartado del estado interno de fulfillment en
 * bodega, con su acción por lote. Ese value salió del catálogo: las órdenes que ya
 * están en bodega nacen directamente en `en_preparacion`, que es el único apartado
 * de revisión que ofrece "Generar guía".
 *
 * `readOnly` (R12-UI, `admin`): ningún apartado es seleccionable y no se montan
 * botones ni modales de acción; el backend igual rechaza escrituras (R12,
 * defensa en profundidad).
 *
 * Feature 49 (R27/R29): TODOS los apartados reciben `mostrarHistorial` para ofrecer
 * la acción de solo lectura "Ver historial" por fila (mismo `HistorialOrdenSheet`
 * que el listado plano de `OrdenesModule`). Se pasa también en `readOnly` porque el
 * maestro Y el admin ven el historial de cualquier orden (R27) y la acción no muta.
 *
 * Límites (fuera de alcance): la lista de mensajeros no filtra por zona/GAM
 * (feature 30 restringirá el cuerpo del loader sin cambiar este componente).
 */
export function OrdenesRevisionMaestro({
  readOnly = false,
  liberadasHoy = [],
}: OrdenesRevisionMaestroProps) {
  const { mutate } = useSWRConfig();

  const { data: estatus, error: estatusError } = useSWR(
    "ordenes:catalogo-estatus",
    catalogoEstatusFetcher,
  );
  const { data: mensajerosData, error: mensajerosError } = useSWR(
    "ordenes:mensajeros",
    mensajerosFetcher,
  );
  const mensajeros = mensajerosData?.mensajeros ?? [];
  const mensajerosBloqueadosIds = mensajerosData?.bloqueadosIds ?? [];
  // Feature 157 (regla de dedicación): repartir y recolectar son viajes incompatibles.
  const mensajerosConRepartoIds = mensajerosData?.conRepartoIds ?? [];
  const mensajerosConRecoleccionIds = mensajerosData?.conRecoleccionIds ?? [];

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

  // Feature 157/R3: quien va a la tienda a recoger el lote. No transiciona la orden.
  function abrirAsignarRecoleccion(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("asignar-recoleccion");
  }

  // Feature 30/R13: "Rutear a bodega satélite" solo aplica a órdenes NO-GAM
  // (`zonaEsGam === false`). Se filtra el snapshot seleccionado antes de abrir el
  // modal; el service revalida (defensa en profundidad).
  function abrirRutearSatelite(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === false));
    setModalAbierto("rutear-satelite");
  }

  // Feature 32/R11/R13: "Imprimir etiquetas" sobre la selección de un apartado
  // con `num_guia`. El backend descarta las órdenes sin guía (R2, aviso en el
  // modal) y rechaza a roles no autorizados (R13); solo `maestro` (no `readOnly`)
  // ve la acción (decisión F1.4 (f)).
  function abrirEtiquetas(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("etiquetas");
  }

  function cerrarModal(open: boolean) {
    if (!open) setModalAbierto(null);
  }

  function handleSuccess() {
    setModalAbierto(null);
    // Revalida todos los apartados (comparten el prefijo de key, sin
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
        titulo="En preparación"
        estatusValue="en_preparacion"
        estatusId={estatusIdPorValue.get("en_preparacion")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Generar guía"}
        onAction={readOnly ? undefined : abrirGenerarGuia}
        mostrarHistorial
      />
      {/* Feature 32/R13/F1.4(f): órdenes con `num_guia`. La respuesta del
          mensajero sigue fuera de alcance (feature 36); la única acción del
          maestro aquí es "Imprimir etiquetas". */}
      <OrdenesApartado
        titulo="En espera de aceptación del mensajero"
        estatusValue="por_recoger"
        estatusId={estatusIdPorValue.get("por_recoger")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Imprimir etiquetas"}
        onAction={readOnly ? undefined : abrirEtiquetas}
        mostrarHistorial
      />
      {/* Feature 157 (R1/R2): el paquete sigue en la TIENDA. Va antes de "En bodega" porque
          ese es su lugar en el flujo v2: la orden nace aqui (155) y solo llega a la central
          cuando el mensajero la recolecta. Estas ordenes nacen CON `num_guia` y etiqueta, de
          ahi la accion secundaria. La columna "Mensajero" ya pinta el asignado con fallback
          "—", asi que R2 sale de la variante de columnas por defecto. */}
      <OrdenesApartado
        titulo="Por recolectar en tienda"
        estatusValue="por_recolectar_en_tienda"
        estatusId={estatusIdPorValue.get("por_recolectar_en_tienda")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Asignar mensajero para recolección"}
        onAction={readOnly ? undefined : abrirAsignarRecoleccion}
        secondaryActionLabel={readOnly ? undefined : "Imprimir etiquetas"}
        onSecondaryAction={readOnly ? undefined : abrirEtiquetas}
        mostrarHistorial
      />
      <OrdenesApartado
        titulo="En bodega"
        estatusValue="en_bodega_central"
        estatusId={estatusIdPorValue.get("en_bodega_central")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Asignar mensajero"}
        onAction={readOnly ? undefined : abrirAsignarBodega}
        secondaryActionLabel={readOnly ? undefined : "Rutear a bodega satélite"}
        onSecondaryAction={readOnly ? undefined : abrirRutearSatelite}
        tertiaryActionLabel={readOnly ? undefined : "Imprimir etiquetas"}
        onTertiaryAction={readOnly ? undefined : abrirEtiquetas}
        mostrarHistorial
      />
      {/* Feature 46 (R15/R16): aviso derivado "Liberadas hoy (reprogramación)" de la
          bodega central (en_bodega_central). Datos por props; se oculta si no hay. */}
      <BodegaLiberadasHoy liberadas={liberadasHoy} />
      {/* Feature 30/R15: 5.º apartado. Feature 32/R13/F1.4(f): sus órdenes ya
          tienen `num_guia`, así que el maestro puede "Imprimir etiquetas"
          (selección por checkbox); sigue sin acciones de escritura. */}
      <OrdenesApartado
        titulo="En ruta a bodega satélite"
        estatusValue="en_ruta_bodega_satelite"
        estatusId={estatusIdPorValue.get("en_ruta_bodega_satelite")}
        selectable={!readOnly}
        actionLabel={readOnly ? undefined : "Imprimir etiquetas"}
        onAction={readOnly ? undefined : abrirEtiquetas}
        mostrarHistorial
      />
      {/* Feature 139/R9: apartado de las órdenes RECHAZADA, ahora SOLO LECTURA. La
          salida manual "Devolver a la tienda" se retiró: la única salida de `rechazada`
          es la APROBACIÓN DEL CIERRE (backend), que la deja en `por_devolver` (satélite)
          o `por_devolver_a_tienda` (central). Solo listado + "Ver historial". */}
      <OrdenesApartado
        titulo="Rechazadas"
        estatusValue="rechazada"
        estatusId={estatusIdPorValue.get("rechazada")}
        selectable={!readOnly}
        mostrarHistorial
      />
      {/* Feature 48/R14: apartado de solo lectura del terminal del retorno para que
          el maestro VEA las órdenes ya devueltas a su tienda de origen. Sin acción de
          escritura (no re-transiciona); solo listado + "Ver historial". */}
      <OrdenesApartado
        titulo="Devueltas a origen"
        estatusValue="devolviendo_a_tienda"
        estatusId={estatusIdPorValue.get("devolviendo_a_tienda")}
        selectable={!readOnly}
        mostrarHistorial
      />

      {!readOnly ? (
        <>
          {/* Feature 156/R30: "Generar guía" NO requiere mensajeros (ya no asigna). */}
          <GenerarGuiaModal
            open={modalAbierto === "generar-guia"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarRecoleccionModal
            open={modalAbierto === "asignar-recoleccion"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros}
            mensajerosBloqueadosIds={mensajerosBloqueadosIds}
            mensajerosConRepartoIds={mensajerosConRepartoIds}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarBodegaModal
            open={modalAbierto === "asignar-bodega"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros}
            mensajerosBloqueadosIds={mensajerosBloqueadosIds}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <RutearSateliteModal
            open={modalAbierto === "rutear-satelite"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <EtiquetasGuiaModal
            open={modalAbierto === "etiquetas"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
          />
        </>
      ) : null}
    </div>
  );
}
