import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarUsuarios } from "@/lib/actions/usuarios";
import { usuariosConfig } from "@/lib/config/usuarios";

import { UsuariosModule, type UsuariosPageData } from "./_components/UsuariosModule";

/**
 * Página de configuración (Server Component). Autoriza server-side: SOLO el rol
 * `maestro` ve el módulo de gestión de usuarios (R1/R3, Decisión 1); cualquier
 * otro rol o sesión ausente NO renderiza el módulo. Pre-carga el listado inicial
 * en el servidor (datos sensibles → server, R13) y lo pasa por props al módulo
 * cliente.
 */
export default async function ConfiguracionPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <section className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader title="Configuración" />
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </section>
    );
  }

  const res = await listarUsuarios({
    page: 1,
    pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
  });

  const initialData: UsuariosPageData =
    res.status === "ok"
      ? { items: res.items, total: res.total, pageSize: res.pageSize }
      : { items: [], total: 0, pageSize: usuariosConfig.DEFAULT_PAGE_SIZE };

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Configuración"
        description="Gestión de usuarios del sistema"
      />
      <UsuariosModule initialData={initialData} />
    </section>
  );
}
