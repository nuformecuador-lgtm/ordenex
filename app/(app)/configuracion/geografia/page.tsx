import { AppPage } from "@/components/shared/AppPage";
import { listarArbolGeografico } from "@/lib/actions/geografia";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { GeografiaAdminModule } from "./_components/GeografiaAdminModule";

/**
 * FICHA 374 (design §7.1 · R38) — administracion del catalogo geografico (Server Component).
 *
 * Calcada de `configuracion/vehiculos/page.tsx`: autoriza server-side —SOLO `maestro`, la misma
 * puerta que el resto de `/configuracion`—, pre-carga el arbol y se lo pasa por props al modulo
 * cliente, que hace el alta y la activacion.
 *
 * El rol se niega ANTES de leer nada: sin permiso no se pinta el arbol ni se consulta la base.
 */
export default async function GeografiaPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Geografía">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }

  const res = await listarArbolGeografico();
  const provincias = res.status === "ok" ? res.provincias : [];

  return (
    <AppPage title="Geografía">
      {res.status !== "ok" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el catálogo geográfico.
        </p>
      ) : null}

      <GeografiaAdminModule initialProvincias={provincias} />
    </AppPage>
  );
}
