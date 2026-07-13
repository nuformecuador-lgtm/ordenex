import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarUsuarios } from "@/lib/actions/usuarios";
import { listarZonas } from "@/lib/actions/zonas";
import { usuariosConfig } from "@/lib/config/usuarios";
import { zonasConfig } from "@/lib/config/zonas";

import { UsuariosModule, type UsuariosPageData } from "./_components/UsuariosModule";
import { ZonasModule, type ZonasPageData } from "./_components/ZonasModule";

/**
 * Página de configuración (Server Component). Autoriza server-side: SOLO el rol
 * `maestro` ve los módulos de gestión (usuarios feat 25 · zonas feat 24 R29);
 * cualquier otro rol o sesión ausente NO renderiza ningún módulo. Pre-carga los
 * listados iniciales en el servidor (datos sensibles → server) y los pasa por
 * props a los módulos cliente.
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

  const resUsuarios = await listarUsuarios({
    page: 1,
    pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
  });

  const usuariosData: UsuariosPageData =
    resUsuarios.status === "ok"
      ? {
          items: resUsuarios.items,
          total: resUsuarios.total,
          pageSize: resUsuarios.pageSize,
        }
      : { items: [], total: 0, pageSize: usuariosConfig.DEFAULT_PAGE_SIZE };

  const resZonas = await listarZonas({
    page: 1,
    pageSize: zonasConfig.DEFAULT_PAGE_SIZE,
  });

  const zonasData: ZonasPageData =
    resZonas.status === "ok"
      ? {
          items: resZonas.items,
          total: resZonas.total,
          pageSize: resZonas.pageSize,
        }
      : { items: [], total: 0, pageSize: zonasConfig.DEFAULT_PAGE_SIZE };

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Configuración"
        description="Gestión de usuarios y zonas del sistema"
      />

      <section aria-labelledby="config-usuarios-heading" className="flex flex-col gap-4">
        <h2 id="config-usuarios-heading" className="text-lg font-semibold">
          Usuarios
        </h2>
        <UsuariosModule initialData={usuariosData} />
      </section>

      <section aria-labelledby="config-zonas-heading" className="flex flex-col gap-4">
        <h2 id="config-zonas-heading" className="text-lg font-semibold">
          Zonas
        </h2>
        <ZonasModule initialData={zonasData} />
      </section>
    </section>
  );
}
