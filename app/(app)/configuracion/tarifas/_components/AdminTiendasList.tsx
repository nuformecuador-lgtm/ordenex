"use client";

import { useEffect, useState } from "react";
import { Store } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { listarAdminTiendas } from "@/lib/actions/usuarios-por-rol";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: UsuarioPorRolDTO[] }
  | { status: "error" };

/**
 * Listado de los usuarios con rol `adminTienda` (id/nombre). Carga la lista por
 * la Server Action `listarAdminTiendas` al montar. Presentación de solo lectura.
 */
export function AdminTiendasList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listarAdminTiendas()
      .then((res) => {
        if (cancelled) return;
        setState(
          res.status === "ok"
            ? { status: "ok", data: res.usuarios }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Store className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold">Administradores de tienda</h2>
        {state.status === "ok" ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {state.data.length}
          </span>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>
            No se pudo cargar la lista de administradores de tienda.
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "ok" ? (
        state.data.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No hay administradores de tienda.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {state.data.map((u) => (
              <li key={u.id} className="px-3 py-2 text-sm font-medium">
                {u.nombre}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
