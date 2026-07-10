"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, type SelectOption } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import {
  listarMensajeros,
  resumenCargaMasiva,
  asignarMensajeroSugerido,
} from "@/lib/actions/mensajeros";
import type { MensajeroDTO, ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";

export interface OrdenesCargaResumenProps {
  /** `num_remision` del lote recién creado (feature 15, filas con `resultado==="creada"`), R7/R21. */
  numRemisiones: string[];
  /** Se invoca tras confirmar la asignación con éxito (p. ej. para cerrar el paso). */
  onDone?: () => void;
}

type LoadState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

/** Etiqueta legible para una fila sin mensajero seleccionado aún. */
const SIN_ASIGNAR_LABEL = "Sin asignar";

function toMensajeroOptions(mensajeros: MensajeroDTO[]): SelectOption[] {
  return mensajeros.map((m) => ({ value: m.id, label: m.nombre }));
}

/** Deriva el `Record<ordenId, mensajeroId>` inicial a partir del sugerido de cada orden (R27). */
function seleccionInicial(ordenes: ResumenCargaOrdenDTO[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const orden of ordenes) {
    next[orden.id] = orden.mensajeroSugeridoId ?? "";
  }
  return next;
}

/**
 * Segundo paso del modal de carga masiva (feature 14): resumen columna por
 * columna del lote recién creado, con asignación de `mensajero_sugerido_id`
 * vía `select` global "aplicar a todos" + override por fila (R21-R30).
 */
export function OrdenesCargaResumen({ numRemisiones, onDone }: OrdenesCargaResumenProps) {
  const toast = useToast();
  const { mutate } = useSWRConfig();

  const [filasState, setFilasState] = useState<LoadState<ResumenCargaOrdenDTO[]>>({
    status: "loading",
  });
  const [mensajerosState, setMensajerosState] = useState<LoadState<MensajeroDTO[]>>({
    status: "loading",
  });
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [globalMensajeroId, setGlobalMensajeroId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // R31: carga de mensajeros y R6/R7: resumen del lote, ambas por Server Action.
  useEffect(() => {
    let cancelled = false;

    resumenCargaMasiva({ numRemisiones })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          setFilasState({ status: "ok", data: result.ordenes });
          setSeleccion(seleccionInicial(result.ordenes));
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

    listarMensajeros()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          setMensajerosState({ status: "ok", data: result.mensajeros });
        } else {
          setMensajerosState({
            status: "error",
            message: "No se pudo cargar la lista de mensajeros.",
          });
          toast.error("No se pudo cargar la lista de mensajeros.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMensajerosState({
          status: "error",
          message: "No se pudo cargar la lista de mensajeros.",
        });
        toast.error("No se pudo cargar la lista de mensajeros.");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- numRemisiones se fija al montar este paso.
  }, []);

  const filas = filasState.status === "ok" ? filasState.data : [];
  const mensajeroOptions =
    mensajerosState.status === "ok" ? toMensajeroOptions(mensajerosState.data) : [];
  const mensajerosDisponibles = mensajerosState.status === "ok";
  const selectDisabled = !mensajerosDisponibles || submitting;

  function handleGlobalChange(mensajeroId: string) {
    setGlobalMensajeroId(mensajeroId); // R24
    setSeleccion((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const fila of filas) {
        next[fila.id] = mensajeroId; // R25: aplica a TODAS las filas
      }
      return next;
    });
  }

  function handleRowChange(ordenId: string, mensajeroId: string) {
    // R26: sobrescribe solo esta fila; no toca el global ni las demás filas.
    setSeleccion((prev) => ({ ...prev, [ordenId]: mensajeroId }));
  }

  async function handleConfirmar() {
    if (submittingRef.current) return; // R30: anti doble-submit
    submittingRef.current = true;
    setSubmitting(true);

    const asignaciones = filas
      .filter((fila) => Boolean(seleccion[fila.id]))
      .map((fila) => ({ ordenId: fila.id, mensajeroId: seleccion[fila.id] }));

    try {
      const result = await asignarMensajeroSugerido({ asignaciones });
      if (result.status === "ok") {
        toast.success(`Mensajero asignado a ${result.asignadas} orden(es)`); // R28
        void mutate(
          (key) => Array.isArray(key) && key[0] === "ordenes:list", // R33
          undefined,
          { revalidate: true },
        );
        onDone?.();
      } else {
        toast.error("No se pudo asignar el mensajero."); // R29
      }
    } catch {
      toast.error("No se pudo asignar el mensajero."); // R29
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

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
      id: "mensajero",
      value: "Mensajero",
      render: (row) => (
        <Select
          value={seleccion[row.id] ?? ""}
          onValueChange={(mensajeroId) => handleRowChange(row.id, mensajeroId)}
          options={mensajeroOptions}
          placeholder={SIN_ASIGNAR_LABEL}
          disabled={selectDisabled}
          aria-label={`Mensajero para la orden ${row.numRemision}`}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {mensajerosState.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{mensajerosState.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" id="carga-resumen-global-label">
          Asignar mensajero a todas las órdenes
        </span>
        <Select
          value={globalMensajeroId}
          onValueChange={handleGlobalChange}
          options={mensajeroOptions}
          placeholder={SIN_ASIGNAR_LABEL}
          disabled={selectDisabled}
          aria-label="Asignar mensajero a todas las órdenes"
        />
      </div>

      <DataTable<ResumenCargaOrdenDTO>
        columns={columns}
        data={filas}
        rowKey="id"
        isLoading={filasState.status === "loading"}
        error={filasState.status === "error" ? filasState.message : null}
        emptyMessage="No hay órdenes en este lote"
        ariaLabel="Resumen de la carga masiva"
      />

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleConfirmar}
          disabled={submitting || filasState.status !== "ok"}
        >
          {submitting ? "Asignando…" : "Confirmar asignación"}
        </Button>
      </div>
    </div>
  );
}
