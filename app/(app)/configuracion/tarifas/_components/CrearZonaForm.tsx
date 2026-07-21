"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  crearZonaSchema,
  type ZonaActionError,
  type ZonaDTO,
} from "@/lib/types/zona";
import { crearZona, actualizarZona } from "@/lib/actions/zonas";
import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import { GeografiaSelector } from "./GeografiaSelector";
import {
  CobroVehiculoTarifas,
  type CobroVehiculoValue,
} from "./CobroVehiculoTarifas";

type FieldErrors = Record<string, string[]>;

/** Valores pre-cargados para editar (o vacíos al crear). */
export interface ZonaFormInitial {
  /** Presente sólo en edición. */
  zonaId?: string;
  nombre: string;
  distritoIds: string[];
  cobro: CobroVehiculoValue;
  /** Marca de zona central (a lo sumo una en true). */
  esCentral?: boolean;
}

export const cobroVacio = (): CobroVehiculoValue => ({
  cobroVehiculo: false,
  tarifas: [{ cobroEntregado: 0, cobroRechazado: 0 }],
});

/**
 * Formulario de crear/editar zona. Compone nombre + selección de distritos
 * (GeografiaSelector) + cobro por vehículo (CobroVehiculoTarifas). Al guardar
 * arma el payload, lo valida contra `crearZonaSchema` (mismo schema que la
 * action) y llama a `crearZona` o `actualizarZona` según el modo. Notifica con
 * toast el éxito/error y avisa al padre con `onSaved` para refrescar la lista.
 */
export function CrearZonaForm({
  mode,
  provincias,
  vehiculos,
  zonas,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "crear" | "editar";
  provincias: ProvinciaArbolDTO[];
  vehiculos: VehiculoDTO[];
  /** Zonas existentes, para verificar si ya hay una marcada como central. */
  zonas: ZonaDTO[];
  initial?: ZonaFormInitial;
  /** Se invoca tras crear/actualizar con éxito (el padre refresca y cierra). */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const esEditar = mode === "editar";

  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [distritoIds, setDistritoIds] = useState<string[]>(
    initial?.distritoIds ?? [],
  );
  const [cobro, setCobro] = useState<CobroVehiculoValue>(
    initial?.cobro ?? cobroVacio(),
  );
  const [esCentral, setEsCentral] = useState<boolean>(initial?.esCentral ?? false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);
  // Zona central en conflicto (ya marcada); si !== null, se muestra el modal de
  // confirmación antes de reestablecer la marca a esta zona.
  const [centralConflicto, setCentralConflicto] = useState<ZonaDTO | null>(null);

  /** Arma el candidato y lo valida contra el mismo schema que la action. */
  function validar() {
    const candidate = {
      nombre,
      cobroVehiculo: cobro.cobroVehiculo,
      esCentral,
      distritoIds,
      tarifas: cobro.tarifas,
    };
    return crearZonaSchema.safeParse(candidate);
  }

  /** Envía el payload (crear/actualizar) y maneja resultado/errores. */
  async function enviar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }

    setErrors({});
    setGuardando(true);
    try {
      const res =
        esEditar && initial?.zonaId
          ? await actualizarZona(initial.zonaId, parsed.data)
          : await crearZona(parsed.data);

      if (res.status === "ok") {
        toast.success(esEditar ? "Zona actualizada" : "Zona creada");
        onSaved();
        return;
      }

      // Error: validación por campo inline; el resto como toast.
      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      }
      toast.error(mensajeDeError(res));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setErrors({});

    // Si se marca como central, verifica que ninguna otra zona ya lo esté. Si la hay,
    // se pide confirmación (reestablecerá la marca a esta zona).
    if (esCentral) {
      const conflicto = zonas.find(
        (z) => z.esCentral && z.id !== initial?.zonaId,
      );
      if (conflicto) {
        setCentralConflicto(conflicto);
        return;
      }
    }

    await enviar();
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">
        {esEditar ? "Editar zona" : "Nueva zona"}
      </h3>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nombre-zona">Nombre de la zona</Label>
        <Input
          id="nombre-zona"
          value={nombre}
          placeholder="Ej: San José centro"
          aria-invalid={errors.nombre ? true : undefined}
          onChange={(e) => setNombre(e.target.value)}
        />
        {errors.nombre?.length ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.nombre.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="es-central-zona"
          checked={esCentral}
          onCheckedChange={(checked) => setEsCentral(checked === true)}
        />
        <Label htmlFor="es-central-zona" className="cursor-pointer">
          Zona Central
        </Label>
      </div>

      <GeografiaSelector
        provincias={provincias}
        initialSelected={initial?.distritoIds}
        onSelectedChange={setDistritoIds}
      />
      {errors.distritoIds?.length ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.distritoIds.join(", ")}
        </p>
      ) : null}

      <CobroVehiculoTarifas
        vehiculos={vehiculos}
        initial={initial?.cobro}
        onChange={setCobro}
      />
      {errors.tarifas?.length ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.tarifas.join(", ")}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={guardar} loading={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={guardando}
        >
          Cancelar
        </Button>
      </div>

      <Modal
        open={centralConflicto !== null}
        onOpenChange={(o) => {
          if (!o) setCentralConflicto(null); // Cancelar cierra y no envía.
        }}
        title="Zona central ya asignada"
        description={
          centralConflicto
            ? `La zona ${centralConflicto.nombre} ya está marcada como Central. Esta acción reestablecerá la zona Central. ¿Desea continuar?`
            : ""
        }
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        onConfirm={async () => {
          setCentralConflicto(null);
          await enviar();
        }}
      />
    </div>
  );
}

/** Mensaje legible para los estados de error de crear/actualizar zona. */
function mensajeDeError(err: ZonaActionError): string {
  switch (err.status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "conflict":
      return "Ya existe una zona con ese nombre o un distrito ya está asignado.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La zona no existe.";
    default:
      return "No se pudo guardar la zona.";
  }
}
