import { RolValue } from "@prisma/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { OrdenesModule } from "./_components/OrdenesModule";

export default async function OrdenesPage() {
  const actor = await resolveActorFromSession();
  const puedeCargarMasiva = actor?.rol === RolValue.adminTienda;

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Órdenes" description="Listado y gestión de órdenes" />
      <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} />
    </section>
  );
}
