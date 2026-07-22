"use client";

import { useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { plantillasConfig } from "@/lib/config/plantillas";
import {
  cambiarEstadoPlantilla,
  eliminarPlantilla,
  listarPlantillas,
} from "@/lib/actions/plantillas";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

import { buildPlantillasColumns } from "./plantillas-columns";
import {
  CrearPlantillaForm,
  type CrearPlantillaFormHandle,
} from "./CrearPlantillaForm";
import {
  EditarPlantillaForm,
  type EditarPlantillaFormHandle,
} from "./EditarPlantillaForm";

// Opciones acotadas por MAX_PAGE_SIZE del backend (nunca una consulta sin límite).
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= plantillasConfig.MAX_PAGE_SIZE,
);

export interface PlantillasPageData {
  items: PlantillaListItemDTO[];
  total: number;
  pageSize: number;
}

export interface PlantillasModuleProps {
  /** Listado pre-cargado en el servidor; alimenta el fallback de SWR. */
  initialData: PlantillasPageData;
}

async function plantillasFetcher(
  page: number,
  pageSize: number,
): Promise<PlantillasPageData> {
  const res = await listarPlantillas({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * Módulo cliente de gestión de plantillas (feature 107). Molde de `ApiKeysModule`:
 * `DataTable` + `Pagination`, botón "Nueva plantilla" que abre el formulario de
 * creación (R8), edición por fila (R20) y la ÚNICA acción de estado "Desactivar"
 * (destino `inactivo`, R24). Cablea las Server Actions; SWR con `fallbackData` del
 * servidor.
 */
export function PlantillasModule({ initialData }: PlantillasModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [crearOpen, setCrearOpen] = useState(false);
  const [editar, setEditar] = useState<PlantillaListItemDTO | null>(null);
  const [desactivar, setDesactivar] = useState<PlantillaListItemDTO | null>(
    null,
  );
  const [eliminar, setEliminar] = useState<PlantillaListItemDTO | null>(null);

  const crearRef = useRef<CrearPlantillaFormHandle>(null);
  const editarRef = useRef<EditarPlantillaFormHandle>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["plantillas:list", page, pageSize],
    () => plantillasFetcher(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize
          ? initialData
          : undefined,
    },
  );

  async function onConfirmCrear() {
    const res = await crearRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      setCrearOpen(false);
    } else if (res.status !== "validation_error" && res.status !== "conflict") {
      // forbidden/unauthenticated → toast; validación y conflicto los pinta el form.
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEditar() {
    const res = await editarRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      setEditar(null);
    } else if (res.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      await mutate();
      setEditar(null);
    } else if (res.status !== "validation_error" && res.status !== "conflict") {
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmDesactivar() {
    if (!desactivar) return;
    // R24/R25: el front SOLO emite el destino `inactivo`.
    const res = await cambiarEstadoPlantilla(desactivar.id, {
      estado: "inactivo",
    });
    if (res.status === "ok") {
      await mutate();
      setDesactivar(null);
    } else if (res.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      await mutate();
      setDesactivar(null);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEliminar() {
    if (!eliminar) return;
    // R27: SOFT DELETE; el backend excluye por `deletedAt IS NULL`, así que basta
    // con revalidar el listado para que la fila desaparezca.
    const res = await eliminarPlantilla(eliminar.id);
    if (res.status === "ok") {
      toast.success("Plantilla eliminada.");
      await mutate();
      setEliminar(null);
    } else if (res.status === "not_found") {
      // Ya no existe (borrada por otra sesión): igual sale del listado tras revalidar.
      toast.error("La plantilla ya no existe.");
      await mutate();
      setEliminar(null);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  const columns = buildPlantillasColumns({
    onEditar: (row) => setEditar(row),
    onDesactivar: (row) => setDesactivar(row),
    onEliminar: (row) => setEliminar(row),
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCrearOpen(true)}>
          Nueva plantilla
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Plantillas de mensaje"
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las plantillas" : null}
        emptyState={{
          icon: MessageSquareText,
          title: "No hay plantillas",
          description:
            "Crea una plantilla de mensaje con campos variables para reutilizarla.",
          action: (
            <Button type="button" onClick={() => setCrearOpen(true)}>
              Nueva plantilla
            </Button>
          ),
        }}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />

      <Modal
        open={crearOpen}
        onOpenChange={setCrearOpen}
        title="Nueva plantilla"
        confirmLabel="Crear"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmCrear}
        size="lg"
      >
        <CrearPlantillaForm ref={crearRef} />
      </Modal>

      <Modal
        open={editar !== null}
        onOpenChange={(open) => {
          if (!open) setEditar(null);
        }}
        title="Editar plantilla"
        confirmLabel="Guardar"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmEditar}
        size="lg"
      >
        {editar ? (
          <EditarPlantillaForm ref={editarRef} plantilla={editar} />
        ) : null}
      </Modal>

      <Modal
        open={desactivar !== null}
        onOpenChange={(open) => {
          if (!open) setDesactivar(null);
        }}
        title="Desactivar plantilla"
        description={
          desactivar
            ? `La plantilla "${desactivar.nombre}" pasará a estado inactivo.`
            : undefined
        }
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={onConfirmDesactivar}
      />

      <Modal
        open={eliminar !== null}
        onOpenChange={(open) => {
          if (!open) setEliminar(null);
        }}
        title="Eliminar plantilla"
        description={
          eliminar
            ? `La plantilla "${eliminar.nombre}" se eliminará y dejará de aparecer en el listado.`
            : undefined
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={onConfirmEliminar}
      />
    </section>
  );
}

/** Traduce el `status` de error a un mensaje de UI (solo los que llegan como toast). */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}
