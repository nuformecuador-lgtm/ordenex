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

/** Opciones de una fila: solo los mensajeros de la zona de esa orden. */
function opcionesPorZona(mensajeros: MensajeroDTO[], zonaId: string): SelectOption[] {
  return toMensajeroOptions(mensajeros.filter((m) => m.zonaId === zonaId));
}

/**
 * Deriva el `Record<ordenId, mensajeroId>` inicial (R27). Si la orden trae un
 * mensajero sugerido se respeta; si no, se elige uno AL AZAR entre los mensajeros
 * de la zona de la orden. Queda "" solo si esa zona no tiene mensajeros.
 */
function seleccionInicial(
  ordenes: ResumenCargaOrdenDTO[],
  mensajeros: MensajeroDTO[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const orden of ordenes) {
    if (orden.mensajeroSugeridoId) {
      next[orden.id] = orden.mensajeroSugeridoId;
      continue;
    }
    const deZona = mensajeros.filter((m) => m.zonaId === orden.zonaId);
    next[orden.id] =
      deZona.length > 0 ? deZona[Math.floor(Math.random() * deZona.length)].id : "";
  }
  return next;
}

/**
 * Segundo paso del modal de carga masiva (feature 14): resumen columna por
 * columna del lote recién creado. Cada fila arranca con un mensajero de su zona
 * elegido al azar (o el sugerido si lo trae) y se puede reasignar por fila.
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
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // R31: carga de mensajeros y R6/R7: resumen del lote. Ambas van juntas (una sola
  // resolución) para poder sortear el mensajero inicial de cada fila entre los de
  // su zona una vez que ambas listas están disponibles.
  useEffect(() => {
    let cancelled = false;

    const fallarMensajeros = () => {
      setMensajerosState({
        status: "error",
        message: "No se pudo cargar la lista de mensajeros.",
      });
      toast.error("No se pudo cargar la lista de mensajeros.");
    };
    const fallarResumen = () =>
      setFilasState({
        status: "error",
        message: "No se pudo cargar el resumen de la carga masiva.",
      });

    Promise.allSettled([resumenCargaMasiva({ numRemisiones }), listarMensajeros()])
      .then(([resumen, mensajerosRes]) => {
        if (cancelled) return;

        const mensajeros =
          mensajerosRes.status === "fulfilled" && mensajerosRes.value.status === "ok"
            ? mensajerosRes.value.mensajeros
            : [];

        if (mensajerosRes.status === "fulfilled" && mensajerosRes.value.status === "ok") {
          setMensajerosState({ status: "ok", data: mensajeros });
        } else {
          fallarMensajeros();
        }

        if (resumen.status === "fulfilled" && resumen.value.status === "ok") {
          setFilasState({ status: "ok", data: resumen.value.ordenes });
          setSeleccion(seleccionInicial(resumen.value.ordenes, mensajeros));
        } else {
          fallarResumen();
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- numRemisiones se fija al montar este paso.
  }, []);

  const filas = filasState.status === "ok" ? filasState.data : [];
  const mensajeros = mensajerosState.status === "ok" ? mensajerosState.data : [];
  const mensajerosDisponibles = mensajerosState.status === "ok";
  const selectDisabled = !mensajerosDisponibles || submitting;

  function handleRowChange(ordenId: string, mensajeroId: string) {
    // R26: sobrescribe solo esta fila; no toca las demás.
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
      id: "zona",
      value: "Zona",
      render: (row) => row.zonaNombre,
    },
    {
      id: "mensajero",
      value: "Mensajero",
      render: (row) => (
        <Select
          value={seleccion[row.id] ?? ""}
          onValueChange={(mensajeroId) => handleRowChange(row.id, mensajeroId)}
          options={opcionesPorZona(mensajeros, row.zonaId)}
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

      <DataTable<ResumenCargaOrdenDTO>
        columns={columns}
        data={filas}
        rowKey="id"
        isLoading={filasState.status === "loading"}
        error={filasState.status === "error" ? filasState.message : null}
        emptyMessage="No hay órdenes en este lote"
        ariaLabel="Resumen de la carga masiva"
      />

      <div className="flex justify-end border-t border-border pt-4">
        <Button
          type="button"
          variant="brand-outline"
          onClick={handleConfirmar}
          disabled={submitting || filasState.status !== "ok"}
        >
          {submitting ? "Asignando…" : "Sugerir asignación"}
        </Button>
      </div>
    </div>
  );
}
