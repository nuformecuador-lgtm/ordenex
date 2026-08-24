"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormField } from "@/components/shared/FormField";
import { useToast } from "@/hooks/useToast";
import {
  listarVehiculos,
  crearVehiculo,
  actualizarVehiculo,
  borrarVehiculo,
} from "@/lib/actions/vehiculos";
import {
  VEHICULO_NOMBRE_MAX,
  normalizarNombreVehiculo,
  type VehiculoDTO,
} from "@/lib/types/vehiculos";

type FieldErrors = Record<string, string[]>;

/**
 * Módulo del catálogo de vehículos: listado con crear/editar (formulario oculto,
 * se muestra al pulsar) y eliminación REAL (no lógica: la tabla no tiene
 * `deleted_at`). Mismo patrón que el módulo de tiendas de Tarifas.
 *
 * El borrado puede quedar bloqueado por las FKs (`usuario.vehiculo_id`,
 * `tarifa_zona_mensajero.vehiculo_id`): ese caso llega como `in_use` y se cuenta
 * con su propio mensaje, porque "está en uso" es accionable y "no se pudo" no.
 */
export function VehiculosModule({ initialVehiculos }: { initialVehiculos: VehiculoDTO[] }) {
  const toast = useToast();

  const [vehiculos, setVehiculos] = useState<VehiculoDTO[]>(initialVehiculos);
  const [cargaError, setCargaError] = useState(false);

  const [view, setView] = useState<"list" | "form">("list");
  const [editando, setEditando] = useState<VehiculoDTO | null>(null);
  const [nombre, setNombre] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VehiculoDTO | null>(null);

  async function refetch() {
    const res = await listarVehiculos();
    if (res.status === "ok") {
      setVehiculos(res.items);
      setCargaError(false);
    } else {
      setCargaError(true);
    }
  }

  function abrirCrear() {
    setEditando(null);
    setNombre("");
    setErrors({});
    setView("form");
  }

  function abrirEditar(v: VehiculoDTO) {
    setEditando(v);
    setNombre(v.name);
    setErrors({});
    setView("form");
  }

  async function guardar() {
    // Se valida contra la MISMA normalización que aplica el servidor, para que el
    // usuario no vea "obligatorio" en un campo que a él le parece lleno de espacios.
    const limpio = normalizarNombreVehiculo(nombre);
    if (limpio === "") {
      setErrors({ name: ["Este campo es obligatorio."] });
      return;
    }

    setGuardando(true);
    try {
      const res = editando
        ? await actualizarVehiculo(editando.id, { name: limpio })
        : await crearVehiculo({ name: limpio });

      if (res.status === "ok") {
        toast.success(editando ? "Vehículo actualizado" : "Vehículo creado");
        setView("list");
        await refetch();
        return;
      }
      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
        toast.error("Revisa los campos: el formulario está incompleto.");
        return;
      }
      if (res.status === "conflict") {
        setErrors({ name: ["Ya existe un vehículo con ese nombre."] });
        toast.error("Ya existe un vehículo con ese nombre.");
        return;
      }
      toast.error(mensajeDeError(res.status));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Tipos de vehículo</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Catálogo que usan los mensajeros al declarar su vehículo y las tarifas
            de zona por tipo.
          </p>
        </div>
        {view === "list" ? (
          <Button type="button" onClick={abrirCrear}>
            Crear vehículo
          </Button>
        ) : null}
      </div>

      {cargaError ? (
        <Alert variant="destructive">
          <AlertDescription>No se pudo cargar el catálogo de vehículos.</AlertDescription>
        </Alert>
      ) : null}

      {view === "form" ? (
        <div className="flex flex-col gap-6 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">
            {editando ? "Editar vehículo" : "Nuevo vehículo"}
          </h3>

          <FormField id="vehiculo-nombre" label="Nombre" error={errors.name} required>
            <Input
              value={nombre}
              maxLength={VEHICULO_NOMBRE_MAX}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Moto, carro, camión…"
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={guardar} loading={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setView("list")}
              disabled={guardando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <VehiculosList
          vehiculos={vehiculos}
          onEditar={abrirEditar}
          onEliminar={setDeleteTarget}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Eliminar vehículo"
        description={
          deleteTarget
            ? `¿Eliminar "${deleteTarget.name}"? Si algún mensajero o alguna tarifa de zona lo usa, no se podrá.`
            : ""
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await borrarVehiculo(deleteTarget.id);
          if (res.status !== "ok") throw res;
          toast.success("Vehículo eliminado");
          await refetch();
        }}
        onError={(err) => {
          const status = (err as { status?: string } | undefined)?.status;
          toast.error(mensajeDeError(status ?? "error"));
        }}
      />
    </section>
  );
}

/** Listado simple con acciones Editar/Eliminar. */
function VehiculosList({
  vehiculos,
  onEditar,
  onEliminar,
}: {
  vehiculos: VehiculoDTO[];
  onEditar: (v: VehiculoDTO) => void;
  onEliminar: (v: VehiculoDTO) => void;
}) {
  if (vehiculos.length === 0) {
    return (
      <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Aún no hay vehículos. Crea el primero con el botón “Crear vehículo”.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {vehiculos.map((v) => (
        <li
          key={v.id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <span className="text-sm font-medium">{v.name}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onEditar(v)}>
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onEliminar(v)}
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

/** Mensaje legible para los estados de error de las acciones del catálogo. */
function mensajeDeError(status: string): string {
  switch (status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "El vehículo no existe.";
    case "conflict":
      return "Ya existe un vehículo con ese nombre.";
    case "in_use":
      return "No se puede eliminar: hay mensajeros o tarifas de zona que lo usan.";
    default:
      return "No se pudo completar la acción.";
  }
}
