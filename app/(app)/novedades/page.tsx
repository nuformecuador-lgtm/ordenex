import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarNovedadesAction } from "@/lib/actions/novedades";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";

import { NovedadesTabs } from "./_components/NovedadesTabs";

// Feature 87 (T13, design §3.1) + Feature 102 (T12, design §6.2) — pagina `/novedades` de la
// tienda. Server Component role-aware (molde `mi-wallet/page.tsx`): el rol se resuelve SOLO
// server-side. Cualquier rol distinto de `adminTienda` (o sin sesion) NO ve la pagina (`notFound`,
// R18). Pre-fetch server-side de la pagina 1 de DOS superficies acotadas a la tienda del actor:
// las ordenes en devolucion (87) y las rechazadas por SLA (102/R12). Los datos (con telefono PII)
// se pasan YA serializados por props al modulo cliente privado, que los presenta en pestañas
// (Q3 default: sin item de menu nuevo). Si el listado de novedades no responde `ok` -> `notFound`
// (R19). La superficie de rechazos SLA es secundaria: si no responde `ok` cae a vacio (defensa en
// profundidad, no tumba la pagina).
export default async function NovedadesPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminTienda") {
    notFound(); // R18: rol no autorizado / sin sesion -> sin exponer datos
  }

  const [novedadesResult, rechazosSlaResult] = await Promise.all([
    listarNovedadesAction({ page: 1 }),
    listarRechazosSlaTiendaAction({ page: 1 }),
  ]);

  if (novedadesResult.status !== "ok") {
    notFound(); // R19: cualquier status != ok en la superficie principal -> notFound
  }

  // R12/R14: la superficie de rechazos SLA ya viene acotada a la tienda del actor por el service.
  // Fallback a vacio si no responde `ok` (transitorio): la pestaña muestra su estado vacio.
  const rechazosSla =
    rechazosSlaResult.status === "ok"
      ? {
          items: rechazosSlaResult.items,
          total: rechazosSlaResult.total,
          page: rechazosSlaResult.page,
          pageSize: rechazosSlaResult.pageSize,
        }
      : { items: [], total: 0, page: 1, pageSize: 10 };

  return (
    <AppPage
      title="Novedades"
      description="Tus órdenes en devolución y las que llegaron a rechazo por vencimiento de SLA"
    >
      <NovedadesTabs
        novedades={{
          items: novedadesResult.items,
          total: novedadesResult.total,
          page: novedadesResult.page,
          pageSize: novedadesResult.pageSize,
        }}
        rechazosSla={rechazosSla}
      />
    </AppPage>
  );
}
