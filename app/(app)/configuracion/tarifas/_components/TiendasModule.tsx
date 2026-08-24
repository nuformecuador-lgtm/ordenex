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
import { listarAdminTiendas, listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { GRUPO_TARIFABLE, type TarifaDTO } from "@/lib/types/tarifa";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { ZonaDTO } from "@/lib/types/zona";

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
export function TiendasModule({ zonas = [] }: { zonas?: ZonaDTO[] }) {
  const toast = useToast();

  const [tiendas, setTiendas] = useState<TiendaRow[]>([]);
  const [adminTiendas, setAdminTiendas] = useState<UsuarioPorRolDTO[]>([]);
  // Cuentas dedicadas de API key: tarifables igual que una tienda (misma FK
  // `tarifas.tienda_id` -> `usuario`), por eso pueblan el mismo select.
  const [apiKeys, setApiKeys] = useState<UsuarioPorRolDTO[]>([]);
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
    const [tarifasRes, adminRes, apiKeysRes] = await Promise.all([
      listarTarifas({ page: 1, pageSize: PAGE_SIZE }),
      listarAdminTiendas(),
      listarUsuariosPorRol("apiKey"),
    ]);
    if (tarifasRes.status === "ok") {
      setTiendas(tarifasRes.items as TiendaRow[]);
      setCargaError(false);
    } else {
      setCargaError(true);
    }
    if (adminRes.status === "ok") setAdminTiendas(adminRes.usuarios);
    if (apiKeysRes.status === "ok") setApiKeys(apiKeysRes.usuarios);
  }

  /**
   * Nombre del dueño de una fila. Busca en los dos orígenes tarifables; si la
   * fila apunta a una API key, se etiqueta como tal para que el listado
   * conserve el mismo diferenciador que el select del formulario.
   */
  function nombreTienda(row: TiendaRow): string {
    const admin = adminTiendas.find((u) => u.id === row.tiendaId);
    if (admin) return admin.nombre;
    const key = apiKeys.find((u) => u.id === row.tiendaId);
    if (key) return `${key.nombre} (${GRUPO_TARIFABLE.apiKey})`;
    return "(sin asignar)";
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
          <h2 className="text-base font-semibold">Asignar Tarifas</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tarifas por tienda o API key (flete, fulfillment, comisiones e IVA).
          </p>
        </div>
        {view === "list" ? (
          <Button type="button" onClick={abrirCrear}>
            Crear Tarifa
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
          apiKeys={apiKeys}
          zonas={zonas}
          tarifas={tiendas}
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
        title="Eliminar tarifa"
        description={
          deleteTarget
            ? `¿Eliminar la tarifa de "${nombreTienda(deleteTarget)}"? Se borra de forma permanente y no se puede deshacer.`
            : ""
        }
        confirmLabel="Aceptar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await borrarTarifa(deleteTarget.id);
          if (res.status !== "ok") throw res;
          toast.success("Tarifa eliminada");
          await refetch();
        }}
        onError={(error) => {
          // `conflict` tiene causa propia y accionable: la tarifa quedó congelada en
          // un cierre y la FK no deja sacarla. Un "no se pudo" genérico dejaría al
          // maestro reintentando sobre algo que nunca va a funcionar.
          const status = (error as { status?: string } | null)?.status;
          toast.error(
            status === "conflict"
              ? "No se puede eliminar: esta tarifa ya liquidó un cierre."
              : "No se pudo eliminar la tarifa.",
          );
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
