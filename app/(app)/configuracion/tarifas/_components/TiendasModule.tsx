"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/useToast";
import {
  listarTarifas,
  obtenerTarifa,
  borrarTarifa,
} from "@/lib/actions/tarifas";
import { listarAdminTiendas } from "@/lib/actions/usuarios-por-rol";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

import {
  CrearTiendaForm,
  TIENDA_CAMPOS,
  tiendaValoresVacios,
  type TiendaFormInitial,
  type TiendaValores,
} from "./CrearTiendaForm";

const PAGE_SIZE = 100;

// Contrato objetivo: la tabla `tarifas` llevará `tiendaId` (otra sesión lo está
// actualizando). Se extiende el DTO localmente para ser compatible desde ya.
type TiendaRow = TarifaDTO & { tiendaId?: string };

/** Deriva los valores del formulario (strings) a partir de una fila de tarifa. */
function valoresDesde(row: TiendaRow): TiendaValores {
  const valores = tiendaValoresVacios();
  for (const campo of TIENDA_CAMPOS) {
    const v = row[campo.key];
    valores[campo.key] = v == null ? "" : String(v);
  }
  return valores;
}

/**
 * Módulo de "Tiendas": listado de tarifas por tienda con crear/editar
 * (formulario oculto, se muestra al pulsar) y eliminación lógica (pasa a
 * inactivo). Reusa el CRUD de `tarifas`. Mismo patrón que el módulo de zonas.
 */
export function TiendasModule() {
  const toast = useToast();

  const [tiendas, setTiendas] = useState<TiendaRow[]>([]);
  const [adminTiendas, setAdminTiendas] = useState<UsuarioPorRolDTO[]>([]);
  const [cargaError, setCargaError] = useState(false);

  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"crear" | "editar">("crear");
  const [formInitial, setFormInitial] = useState<TiendaFormInitial | undefined>();
  const [formKey, setFormKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<TiendaRow | null>(null);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial única.
  }, []);

  async function refetch() {
    const [tarifasRes, adminRes] = await Promise.all([
      listarTarifas({ page: 1, pageSize: PAGE_SIZE }),
      listarAdminTiendas(),
    ]);
    if (tarifasRes.status === "ok") {
      setTiendas(tarifasRes.items as TiendaRow[]);
      setCargaError(false);
    } else {
      setCargaError(true);
    }
    if (adminRes.status === "ok") setAdminTiendas(adminRes.usuarios);
  }

  /** Nombre del administrador de tienda asociado a una fila. */
  function nombreTienda(row: TiendaRow): string {
    const found = adminTiendas.find((u) => u.id === row.tiendaId);
    return found?.nombre ?? "(sin asignar)";
  }

  function abrirCrear() {
    setFormMode("crear");
    setFormInitial(undefined);
    setFormKey((k) => k + 1);
    setView("form");
  }

  async function abrirEditar(row: TiendaRow) {
    const res = await obtenerTarifa(row.id);
    if (res.status !== "ok") {
      toast.error("No se pudo cargar la tienda.");
      return;
    }
    const full = res.tarifa as TiendaRow;
    setFormMode("editar");
    setFormInitial({
      tarifaId: full.id,
      tiendaId: full.tiendaId ?? "",
      valores: valoresDesde(full),
    });
    setFormKey((k) => k + 1);
    setView("form");
  }

  function onSaved() {
    setView("list");
    void refetch();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Tiendas</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tarifas por tienda (flete, fulfillment, comisiones e IVA).
          </p>
        </div>
        {view === "list" ? (
          <Button type="button" onClick={abrirCrear}>
            Crear tienda
          </Button>
        ) : null}
      </div>

      {cargaError ? (
        <Alert variant="destructive">
          <AlertDescription>
            No se pudo cargar el listado de tiendas.
          </AlertDescription>
        </Alert>
      ) : null}

      {view === "form" ? (
        <CrearTiendaForm
          key={formKey}
          mode={formMode}
          adminTiendas={adminTiendas}
          initial={formInitial}
          onSaved={onSaved}
          onCancel={() => setView("list")}
        />
      ) : (
        <TiendasList
          tiendas={tiendas}
          nombreTienda={nombreTienda}
          onEditar={abrirEditar}
          onEliminar={setDeleteTarget}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Desactivar tienda"
        description={
          deleteTarget
            ? `¿Marcar como inactiva la tienda "${nombreTienda(deleteTarget)}"? Dejará de estar disponible.`
            : ""
        }
        confirmLabel="Aceptar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await borrarTarifa(deleteTarget.id);
          if (res.status !== "ok") throw res;
          toast.success("Tienda desactivada");
          await refetch();
        }}
        onError={() => {
          toast.error("No se pudo desactivar la tienda.");
        }}
      />
    </section>
  );
}

/** Listado simple de tiendas con acciones Editar/Eliminar (→ inactivo). */
function TiendasList({
  tiendas,
  nombreTienda,
  onEditar,
  onEliminar,
}: {
  tiendas: TiendaRow[];
  nombreTienda: (row: TiendaRow) => string;
  onEditar: (row: TiendaRow) => void;
  onEliminar: (row: TiendaRow) => void;
}) {
  if (tiendas.length === 0) {
    return (
      <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Aún no hay tiendas. Crea la primera con “Crear tienda”.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {tiendas.map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium">{nombreTienda(t)}</span>
            <span className="text-xs text-muted-foreground">
              Flete {t.valorFlete} · Fulfillment {t.fulfillment} · Comisión{" "}
              {t.comisionCod}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEditar(t)}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onEliminar(t)}
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
