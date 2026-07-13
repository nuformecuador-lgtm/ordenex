"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { zonasConfig } from "@/lib/config/zonas";
import { listarZonas, obtenerZona } from "@/lib/actions/zonas";
import type { ZonaDTO } from "@/lib/types/zona";

import { buildZonasColumns } from "./zonas-columns";
import {
  ZonaForm,
  type CentralActual,
  type ZonaFormHandle,
} from "./ZonaForm";

// Opciones acotadas por MAX_PAGE_SIZE del backend (R24).
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= zonasConfig.MAX_PAGE_SIZE,
);

export interface ZonasPageData {
  items: ZonaDTO[];
  total: number;
  pageSize: number;
}

export interface ZonasModuleProps {
  /** Listado pre-cargado en el servidor (R30); alimenta el fallback de SWR. */
  initialData: ZonasPageData;
}

async function zonasFetcher(
  page: number,
  pageSize: number,
): Promise<ZonasPageData> {
  const res = await listarZonas({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

type FormMode = "crear" | "editar";

/**
 * Módulo cliente de gestión de zonas: DataTable + Pagination con datos
 * pre-cargados por props (R30), botón Crear + Modal async con `ZonaForm`, y
 * feedback vía `useToast` refrescando el listado en éxito (R32). Cablea las
 * Server Actions de zonas; no hace `fetch` a rutas de API.
 */
export function ZonasModule({ initialData }: ZonasModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("crear");
  const [editZona, setEditZona] = useState<ZonaDTO | null>(null);
  const formRef = useRef<ZonaFormHandle>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["zonas:list", page, pageSize],
    () => zonasFetcher(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize ? initialData : undefined,
    },
  );

  function abrirCrear() {
    setFormMode("crear");
    setEditZona(null);
    setFormOpen(true);
  }

  async function abrirEditar(row: ZonaDTO) {
    const res = await obtenerZona(row.id);
    if (res.status !== "ok") {
      toast.error(mensajeError(res.status));
      return;
    }
    setFormMode("editar");
    setEditZona(res.zona);
    setFormOpen(true);
  }

  async function onConfirmForm() {
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      toast.success(formMode === "crear" ? "Zona creada" : "Zona actualizada");
      setFormOpen(false);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  const columns = buildZonasColumns({
    onEditar: (row) => {
      void abrirEditar(row);
    },
  });

  // R6-UI: la central actual, derivada del listado cargado, para advertir de la
  // reasignación al marcar otra zona como central. Limitación conocida: sólo es
  // fiable si la central está en la página cargada; el backend garantiza la
  // invariante igualmente.
  const centralActual: CentralActual | null = (() => {
    const c = (data?.items ?? []).find((z) => z.esCentral);
    return c ? { id: c.id, nombre: c.nombre } : null;
  })();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={abrirCrear}>
          <Plus /> Crear zona
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Zonas"
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las zonas" : null}
        emptyMessage="No hay zonas"
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
        open={formOpen}
        onOpenChange={setFormOpen}
        title={formMode === "crear" ? "Crear zona" : "Editar zona"}
        confirmLabel="Guardar"
        cancelLabel="Cerrar"
        closeOnConfirm={false}
        onConfirm={onConfirmForm}
        className="max-w-lg"
      >
        <ZonaForm
          key={`${formMode}:${editZona?.id ?? "nueva"}`}
          ref={formRef}
          mode={formMode}
          zona={editZona}
          centralActual={centralActual}
        />
      </Modal>
    </section>
  );
}

/**
 * Traduce el `status` del `ActionError` del backend a un mensaje de UI (R32). El
 * detalle por campo (validación/conflicto) lo muestra el formulario; aquí solo
 * se da el feedback de toast.
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La zona no existe.";
    case "conflict":
      return "Revisa el nombre o los distritos: hay un conflicto.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}
