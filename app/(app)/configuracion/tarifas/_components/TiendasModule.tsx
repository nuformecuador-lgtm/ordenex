"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/useToast";
import { listarTarifas, borrarTarifa } from "@/lib/actions/tarifas";
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

/**
 * Una tienda (o API key) con TODAS sus tarifas. El listado enseña esto, no
 * filas de `tarifas`: desde la cascada por el par (tienda, zona) una misma
 * tienda tiene una fila por zona, y listar la tabla en crudo la repetía tantas
 * veces como zonas tarifadas tuviera. El detalle por zona sigue estando donde
 * ya funcionaba: el panel derecho del formulario.
 */
interface TiendaGrupo {
  tiendaId: string;
  nombre: string;
  /** Todas las tarifas de esa tienda (la de por defecto y las de zona). */
  tarifas: TarifaDTO[];
  /** La fila con `zonaId` NULL: la que aplica cuando ninguna zona calza. */
  porDefecto?: TarifaDTO;
  /** Nombres de las zonas con tarifa propia, en el orden del catálogo. */
  zonas: string[];
}

/** Deriva los valores del formulario (strings) a partir de una fila de tarifa. */
function valoresDesde(row: TarifaDTO): TiendaValores {
  const valores = tiendaValoresVacios();
  for (const campo of TIENDA_CAMPOS) {
    const v = row[campo.key];
    valores[campo.key] = v == null ? "" : String(v);
  }
  return valores;
}

/**
 * Nombre del dueño de una tarifa. Busca en los dos orígenes tarifables; si
 * apunta a una API key, se etiqueta como tal para que el listado conserve el
 * mismo diferenciador que el select del formulario.
 */
function nombreTienda(
  tiendaId: string,
  adminTiendas: UsuarioPorRolDTO[],
  apiKeys: UsuarioPorRolDTO[],
): string {
  const admin = adminTiendas.find((u) => u.id === tiendaId);
  if (admin) return admin.nombre;
  const key = apiKeys.find((u) => u.id === tiendaId);
  if (key) return `${key.nombre} (${GRUPO_TARIFABLE.apiKey})`;
  return "(sin asignar)";
}

/**
 * Agrupa las filas de `tarifas` por dueño. Descarta las que no tienen tienda
 * (`tiendaId` NULL): ésas son los costos de la zona y se editan en "Costos por
 * zona" —aquí sólo aparecían como "(sin asignar)", sin nada que asignar—.
 */
function agrupar(
  tarifas: TarifaDTO[],
  nombreDe: (tiendaId: string) => string,
  zonas: ZonaDTO[],
): TiendaGrupo[] {
  const porTienda = new Map<string, TarifaDTO[]>();
  for (const t of tarifas) {
    if (t.tiendaId == null) continue;
    const previas = porTienda.get(t.tiendaId);
    if (previas) previas.push(t);
    else porTienda.set(t.tiendaId, [t]);
  }

  const grupos: TiendaGrupo[] = [];
  for (const [tiendaId, filas] of porTienda) {
    const conZona = new Set(
      filas.map((t) => t.zonaId).filter((id): id is string => id != null),
    );
    const porDefecto = filas.find((t) => t.zonaId == null);
    grupos.push({
      tiendaId,
      nombre: nombreDe(tiendaId),
      tarifas: filas,
      ...(porDefecto ? { porDefecto } : {}),
      zonas: zonas.filter((z) => conZona.has(z.id)).map((z) => z.nombre),
    });
  }
  // Alfabético por nombre: el orden de `tarifas` es el de creación, que en un
  // listado de tiendas no dice nada.
  return grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Módulo de "Tiendas": listado de tarifas AGRUPADO por tienda (una fila por
 * tienda, con sus tarifas dentro) con crear/editar (formulario oculto, se
 * muestra al pulsar) y eliminación. Reusa el CRUD de `tarifas`.
 */
export function TiendasModule({ zonas = [] }: { zonas?: ZonaDTO[] }) {
  const toast = useToast();

  const [tarifas, setTarifas] = useState<TarifaDTO[]>([]);
  const [adminTiendas, setAdminTiendas] = useState<UsuarioPorRolDTO[]>([]);
  // Cuentas dedicadas de API key: tarifables igual que una tienda (misma FK
  // `tarifas.tienda_id` -> `usuario`), por eso pueblan el mismo select.
  const [apiKeys, setApiKeys] = useState<UsuarioPorRolDTO[]>([]);
  const [cargaError, setCargaError] = useState(false);

  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"crear" | "editar">("crear");
  const [formInitial, setFormInitial] = useState<TiendaFormInitial | undefined>();
  const [formKey, setFormKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<TiendaGrupo | null>(null);

  useEffect(() => {
    void refetch();
  }, []);

  async function refetch() {
    const [tarifasRes, adminRes, apiKeysRes] = await Promise.all([
      listarTarifas({ page: 1, pageSize: PAGE_SIZE }),
      listarAdminTiendas(),
      listarUsuariosPorRol("apiKey"),
    ]);
    if (tarifasRes.status === "ok") {
      setTarifas(tarifasRes.items);
      setCargaError(false);
    } else {
      setCargaError(true);
    }
    if (adminRes.status === "ok") setAdminTiendas(adminRes.usuarios);
    if (apiKeysRes.status === "ok") setApiKeys(apiKeysRes.usuarios);
  }

  const grupos = useMemo(
    () =>
      agrupar(
        tarifas,
        (tiendaId) => nombreTienda(tiendaId, adminTiendas, apiKeys),
        zonas,
      ),
    [tarifas, adminTiendas, apiKeys, zonas],
  );

  function abrirCrear() {
    setFormMode("crear");
    setFormInitial(undefined);
    setFormKey((k) => k + 1);
    setView("form");
  }

  /**
   * Abre el formulario de una tienda. Precarga la tarifa "Por defecto" —el
   * destino con que arranca el panel derecho—; si esa tienda todavía no la
   * tiene, entra en blanco y el panel sigue dando acceso a cada zona.
   */
  function abrirEditar(grupo: TiendaGrupo) {
    setFormMode("editar");
    setFormInitial({
      tiendaId: grupo.tiendaId,
      valores: grupo.porDefecto
        ? valoresDesde(grupo.porDefecto)
        : tiendaValoresVacios(),
      ...(grupo.porDefecto ? { tarifaId: grupo.porDefecto.id } : {}),
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
          tarifas={tarifas}
          initial={formInitial}
          onSaved={onSaved}
          onCancel={() => setView("list")}
        />
      ) : (
        <TiendasList
          grupos={grupos}
          onEditar={abrirEditar}
          onEliminar={setDeleteTarget}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Eliminar tarifas"
        description={deleteTarget ? descripcionBorrado(deleteTarget) : ""}
        confirmLabel="Aceptar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          // Secuencial y parando en el primer fallo: si una tarifa quedó
          // congelada en un cierre, seguir borrando las demás dejaría a la
          // tienda a medias sin que nadie lo haya pedido.
          for (const tarifa of deleteTarget.tarifas) {
            const res = await borrarTarifa(tarifa.id);
            if (res.status !== "ok") throw res;
          }
          toast.success(
            deleteTarget.tarifas.length === 1
              ? "Tarifa eliminada"
              : "Tarifas eliminadas",
          );
          await refetch();
        }}
        onError={(error) => {
          // `conflict` tiene causa propia y accionable: la tarifa quedó congelada en
          // un cierre y la FK no deja sacarla. Un "no se pudo" genérico dejaría al
          // maestro reintentando sobre algo que nunca va a funcionar.
          const status = (error as { status?: string } | null)?.status;
          toast.error(
            status === "conflict"
              ? "No se puede eliminar: alguna de estas tarifas ya liquidó un cierre."
              : "No se pudieron eliminar las tarifas.",
          );
          // El borrado pudo avanzar antes de fallar: se recarga para que el
          // listado no siga enseñando lo que ya no está.
          void refetch();
        }}
      />
    </section>
  );
}

/**
 * Texto del modal de borrado. La fila es la TIENDA, así que el borrado se lleva
 * todas sus tarifas: se dice cuántas, porque borrar cinco creyendo que se borra
 * una es justo el error que un listado agrupado puede inducir.
 */
function descripcionBorrado(grupo: TiendaGrupo): string {
  const n = grupo.tarifas.length;
  return n === 1
    ? `¿Eliminar la tarifa de "${grupo.nombre}"? Se borra de forma permanente y no se puede deshacer.`
    : `¿Eliminar las ${n} tarifas de "${grupo.nombre}" (la de por defecto y las de zona)? Se borran de forma permanente y no se puede deshacer.`;
}

/** Listado de tiendas (una fila por tienda) con acciones Editar/Eliminar. */
function TiendasList({
  grupos,
  onEditar,
  onEliminar,
}: {
  grupos: TiendaGrupo[];
  onEditar: (grupo: TiendaGrupo) => void;
  onEliminar: (grupo: TiendaGrupo) => void;
}) {
  if (grupos.length === 0) {
    return (
      <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Aún no hay tiendas con tarifa. Crea la primera con “Crear Tarifa”.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {grupos.map((g) => (
        <li
          key={g.tiendaId}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium">{g.nombre}</span>
            <span className="text-xs text-muted-foreground">
              {g.porDefecto
                ? `Por defecto: Flete ${g.porDefecto.valorFlete} · Fulfillment ${g.porDefecto.fulfillment} · Comisión ${g.porDefecto.comisionCod}%`
                : "Sin tarifa por defecto"}
            </span>
            {g.zonas.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {g.zonas.length} zona{g.zonas.length === 1 ? "" : "s"} con tarifa
                propia: {g.zonas.join(", ")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEditar(g)}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onEliminar(g)}
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
