"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { listarZonas, obtenerZona, borrarZona } from "@/lib/actions/zonas";
import { listarArbolGeografico } from "@/lib/actions/geografia";
import type { ZonaDTO } from "@/lib/types/zona";
import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import {
  CrearZonaForm,
  cobroVacio,
  type ZonaFormInitial,
} from "./CrearZonaForm";
import type { CobroVehiculoValue } from "./CobroVehiculoTarifas";

const PAGE_SIZE = 100;

/**
 * Módulo cliente de "Costos por zona": texto introductorio + botón Crear zona,
 * listado de zonas con Editar/Eliminar, formulario de crear/editar (precargado
 * en edición) y modal de confirmación de borrado (no se cierra por click fuera:
 * `dismissible={false}`). Notifica creación/edición/eliminación/error con toast.
 */
export function ZonasTarifasModule({
  initialZonas,
  provincias: initialProvincias,
  vehiculos,
}: {
  initialZonas: ZonaDTO[];
  provincias: ProvinciaArbolDTO[];
  vehiculos: VehiculoDTO[];
}) {
  const toast = useToast();
  const [zonas, setZonas] = useState<ZonaDTO[]>(initialZonas);
  // El árbol también es estado: tras crear/editar/eliminar cambia la marca
  // `zonaId` de los distritos, y la edición la deriva de ahí.
  const [provincias, setProvincias] =
    useState<ProvinciaArbolDTO[]>(initialProvincias);
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"crear" | "editar">("crear");
  const [formInitial, setFormInitial] = useState<ZonaFormInitial | undefined>();
  // Cambia al abrir crear/editar para remontar el form y leer `initial` fresco.
  const [formKey, setFormKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ZonaDTO | null>(null);

  async function refetch() {
    const [zonasRes, arbolRes] = await Promise.all([
      listarZonas({ page: 1, pageSize: PAGE_SIZE }),
      listarArbolGeografico(),
    ]);
    if (zonasRes.status === "ok") setZonas(zonasRes.items);
    if (arbolRes.status === "ok") setProvincias(arbolRes.provincias);
  }

  function abrirCrear() {
    setFormMode("crear");
    setFormInitial(undefined);
    setFormKey((k) => k + 1);
    setView("form");
  }

  async function abrirEditar(zona: ZonaDTO) {
    // Zona completa (incluye tarifas) + distritos derivados del árbol geográfico.
    const res = await obtenerZona(zona.id);
    if (res.status !== "ok") {
      toast.error("No se pudo cargar la zona.");
      return;
    }
    const full = res.zona;
    const distritoIds: string[] = [];
    for (const p of provincias)
      for (const c of p.cantones)
        for (const d of c.distritos)
          if (d.zonaId === full.id) distritoIds.push(d.id);

    const cobro: CobroVehiculoValue = {
      cobroVehiculo: full.cobroVehiculo,
      tarifas: (full.tarifas ?? []).map((t) => ({
        cobroEntregado: t.cobroEntregado,
        cobroRechazado: t.cobroRechazado,
        ...(t.vehiculoId ? { vehiculoId: t.vehiculoId } : {}),
      })),
    };
    if (!full.cobroVehiculo && cobro.tarifas.length === 0) {
      cobro.tarifas = cobroVacio().tarifas;
    }

    setFormMode("editar");
    setFormInitial({
      zonaId: full.id,
      nombre: full.nombre,
      distritoIds,
      cobro,
      esGam: full.esGam,
    });
    setFormKey((k) => k + 1);
    setView("form");
  }

  function onSaved() {
    setView("list");
    void refetch();
  }

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">
            Costos por zona (pago a mensajeros)
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Lo que Ordenex le paga al mensajero por entrega y por no entrega,
            según la zona donde reparte.
          </p>
        </div>
        {view === "list" ? (
          <Button type="button" onClick={abrirCrear}>
            Crear zona
          </Button>
        ) : null}
      </div>

      {view === "form" ? (
        <CrearZonaForm
          key={formKey}
          mode={formMode}
          provincias={provincias}
          vehiculos={vehiculos}
          zonas={zonas}
          initial={formInitial}
          onSaved={onSaved}
          onCancel={() => setView("list")}
        />
      ) : (
        <ZonasList
          zonas={zonas}
          onEditar={abrirEditar}
          onEliminar={setDeleteTarget}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Eliminar zona"
        description={
          deleteTarget
            ? `¿Eliminar la zona "${deleteTarget.nombre}"? Esta acción no se puede deshacer.`
            : ""
        }
        confirmLabel="Aceptar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        // No se cierra por click fuera ni Escape: sólo Cancelar o Aceptar.
        dismissible={false}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await borrarZona(deleteTarget.id);
          if (res.status !== "ok") throw res; // mantiene el modal abierto; onError avisa
          toast.success("Zona eliminada");
          await refetch();
          // Éxito: el Modal cierra solo (closeOnConfirm) -> onOpenChange limpia target.
        }}
        onError={(e) => {
          const status = (e as { status?: string } | null)?.status;
          toast.error(
            status === "conflict"
              ? "No se puede eliminar: la zona está en uso."
              : "No se pudo eliminar la zona.",
          );
        }}
      />
    </section>
  );
}

/** Listado simple de zonas con acciones Editar/Eliminar. */
function ZonasList({
  zonas,
  onEditar,
  onEliminar,
}: {
  zonas: ZonaDTO[];
  onEditar: (zona: ZonaDTO) => void;
  onEliminar: (zona: ZonaDTO) => void;
}) {
  if (zonas.length === 0) {
    return (
      <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Aún no hay zonas. Crea la primera con “Crear zona”.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {zonas.map((z) => (
        <li
          key={z.id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium">{z.nombre}</span>
            <span className="text-xs text-muted-foreground">
              {z.distritosCount} distrito{z.distritosCount === 1 ? "" : "s"}
              {z.cobroVehiculo ? " · cobro por vehículo" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEditar(z)}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onEliminar(z)}
            >
              <Trash2 aria-hidden="true" />
              Eliminar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
