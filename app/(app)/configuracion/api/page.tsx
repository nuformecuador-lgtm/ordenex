import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarApiKeys } from "@/lib/actions/api-keys";
import { apiKeysConfig } from "@/lib/config/api-keys";

import { ApiKeysModule, type ApiKeysPageData } from "./_components/ApiKeysModule";

/**
 * Página de API keys (Server Component, feature 82). Autoriza server-side igual
 * que `/configuracion`: SOLO el rol `maestro` (R11); cualquier otro rol o sesión
 * ausente NO renderiza el módulo. Pre-carga en el servidor la primera página del
 * listado (R12) y la pasa al módulo cliente como `initialData`; si la pre-carga
 * no es `ok`, cae a un listado vacío en vez de fallar (R13). Alineada al shell
 * `AppPage` de `/configuracion` [D7].
 */
export default async function ApiPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="API">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }

  const res = await listarApiKeys({
    page: 1,
    pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE,
  });

  const data: ApiKeysPageData =
    res.status === "ok"
      ? { items: res.items, total: res.total, pageSize: res.pageSize }
      : { items: [], total: 0, pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE };

  return (
    <AppPage title="API" description="Credenciales e integraciones de API">
      <ApiKeysModule initialData={data} />
    </AppPage>
  );
}
