import { PageHeader } from "@/components/shared/PageHeader";
import { Container } from "@/components/shared/Container";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarUsuarios } from "@/lib/actions/usuarios";
import { usuariosConfig } from "@/lib/config/usuarios";

import { UsuariosModule, type UsuariosPageData } from "./_components/UsuariosModule";

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
      <>
        <PageHeader title="Configuración" />
        <Container>
          <p role="alert" className="text-sm text-muted-foreground">
            No tienes permiso para acceder a esta sección.
          </p>
        </Container>
      </>
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

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Gestión de usuarios y zonas del sistema"
      />

      <Container>
        <section aria-labelledby="config-usuarios-heading" className="flex flex-col gap-4">
          <h2 id="config-usuarios-heading" className="text-lg font-semibold">
            Usuarios
          </h2>
          <UsuariosModule initialData={usuariosData} />
        </section>
      </Container>
    </>
  );
}
