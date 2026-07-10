"use client";

import { useRef, useState } from "react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { usuariosConfig } from "@/lib/config/usuarios";
import {
  cambiarEstadoUsuario,
  obtenerUsuario,
  listarUsuarios,
} from "@/lib/actions/usuarios";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

import { buildUsuariosColumns } from "./usuarios-columns";
import { UsuarioForm, type UsuarioFormHandle } from "./UsuarioForm";

// R13: opciones acotadas por MAX_PAGE_SIZE del backend.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= usuariosConfig.MAX_PAGE_SIZE,
);

export interface UsuariosPageData {
  items: UsuarioListItemDTO[];
  total: number;
  pageSize: number;
}

export interface UsuariosModuleProps {
  /** Listado pre-cargado en el servidor (R13); alimenta el fallback de SWR. */
  initialData: UsuariosPageData;
}

async function usuariosFetcher(
  page: number,
  pageSize: number,
): Promise<UsuariosPageData> {
  const res = await listarUsuarios({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

type FormMode = "crear" | "editar";

/**
 * Módulo cliente de gestión de usuarios: DataTable + Pagination (R26), botón
 * Crear + Modal async con `UsuarioForm` (R27), activar/inactivar por fila
 * (R20/R21) y feedback vía `useToast` (R28). Cablea las Server Actions.
 */
export function UsuariosModule({ initialData }: UsuariosModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("crear");
  const [editUsuario, setEditUsuario] = useState<UsuarioPublico | null>(null);
  const [estadoPendienteId, setEstadoPendienteId] = useState<string | null>(null);
  const formRef = useRef<UsuarioFormHandle>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["usuarios:list", page, pageSize],
    () => usuariosFetcher(page, pageSize),
    { fallbackData: page === 1 && pageSize === initialData.pageSize ? initialData : undefined },
  );

  function abrirCrear() {
    setFormMode("crear");
    setEditUsuario(null);
    setFormOpen(true);
  }

  async function abrirEditar(row: UsuarioListItemDTO) {
    const res = await obtenerUsuario(row.id);
    if (res.status !== "ok") {
      toast.error(mensajeError(res.status));
      return;
    }
    setFormMode("editar");
    setEditUsuario(res.usuario);
    setFormOpen(true);
  }

  async function onConfirmForm() {
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      const conPassword = "generatedPassword" in res && !!res.generatedPassword;
      toast.success(
        formMode === "crear" ? "Usuario creado" : "Usuario actualizado",
      );
      // R33: si hay contraseña generada, el modal permanece abierto para
      // mostrarla una vez; el usuario lo cierra manualmente.
      if (!conPassword) setFormOpen(false);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function cambiarEstado(row: UsuarioListItemDTO) {
    const destino = row.estado === "activo" ? "inactivo" : "activo";
    setEstadoPendienteId(row.id);
    try {
      const res = await cambiarEstadoUsuario(row.id, { estado: destino });
      if (res.status === "ok") {
        await mutate();
        toast.success(
          destino === "inactivo" ? "Usuario inactivado" : "Usuario activado",
        );
      } else {
        toast.error(mensajeError(res.status));
      }
    } finally {
      setEstadoPendienteId(null);
    }
  }

  const columns = buildUsuariosColumns({
    onEditar: (row) => {
      void abrirEditar(row);
    },
    onCambiarEstado: (row) => {
      void cambiarEstado(row);
    },
    estadoPendienteId,
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={abrirCrear}>
          Crear usuario
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Usuarios"
        isLoading={isLoading}
        error={error ? "No se pudieron cargar los usuarios" : null}
        emptyMessage="No hay usuarios"
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
        title={formMode === "crear" ? "Crear usuario" : "Editar usuario"}
        confirmLabel="Guardar"
        cancelLabel="Cerrar"
        closeOnConfirm={false}
        onConfirm={onConfirmForm}
      >
        <UsuarioForm
          key={`${formMode}:${editUsuario?.id ?? "nuevo"}`}
          ref={formRef}
          mode={formMode}
          usuario={editUsuario}
        />
      </Modal>
    </section>
  );
}

/**
 * Traduce el `status` del `ActionError` del backend a un mensaje de UI. No es un
 * switch de mensajes de dominio: el detalle de validación se muestra por campo
 * en el formulario; aquí solo se da el feedback de toast (R28).
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "El usuario no existe.";
    case "conflict":
      return "El email o la cédula ya están en uso.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}
