import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarNovedadesAction } from "@/lib/actions/novedades";

import { NovedadesModule } from "./_components/NovedadesModule";

// Feature 87 (T13, design §3.1) — pagina `/novedades`: lista de las ordenes en estatus
// `devuelta` de la tienda del adminTienda, con su causa y botones de contacto. Server
// Component role-aware (molde `mi-wallet/page.tsx`): el rol se resuelve SOLO server-side.
// Cualquier rol distinto de `adminTienda` (o sin sesion) NO ve la lista (`notFound`, R18).
// Pre-fetch server-side de la pagina 1; si la action no responde `ok` -> `notFound` (R19,
// defensa en profundidad, sin exponer datos parciales). Los datos (con telefono PII) se
// pasan YA serializados por props al modulo cliente privado.
export default async function NovedadesPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminTienda") {
    notFound(); // R18: rol no autorizado / sin sesion -> sin exponer datos
  }

  const result = await listarNovedadesAction({ page: 1 });
  if (result.status !== "ok") {
    notFound(); // R19: cualquier status != ok -> notFound
  }

  return (
    <section className="flex flex-1 flex-col gap-8 p-6">
      <PageHeader
        title="Novedades"
        description="Tus órdenes en devolución: la causa de cada una y el contacto del cliente para gestionarla"
      />

      <NovedadesModule
        items={result.items}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
      />
    </section>
  );
}
