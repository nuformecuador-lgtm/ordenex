import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarSaldosTiendasAction } from "@/lib/actions/wallet-tienda";

import { SaldosTiendasTable } from "./_components/SaldosTiendasTable";

/**
 * Feature 43 (T16, R20/R21) — pagina `/wallet/tiendas`: el saldo a favor de TODAS las
 * tiendas, para que el `maestro` liquide (seccion bajo el modulo wallet del maestro, A1).
 * Server Component role-aware: el rol se resuelve SOLO server-side via
 * `resolveActorFromSession`; cualquier rol distinto de `maestro` (o sin sesion) NO ve los
 * saldos (`notFound`, R20 — forbidden sin exponer datos). El `maestro` NO queda acotado a
 * una sola tienda. Los saldos (datos sensibles) se pre-obtienen server-side y se pasan YA
 * serializados (STRING) por props (R21): el cliente nunca recibe `Prisma.Decimal`. Si la
 * action no responde `ok` → `notFound` (defensa en profundidad).
 */
export default async function WalletTiendasPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "maestro") {
    notFound(); // R20: rol no autorizado / sin sesion → sin exponer datos
  }

  const tiendasResult = await listarSaldosTiendasAction();

  // Defensa en profundidad: si el service niega, no renderizamos la tabla.
  if (tiendasResult.status !== "ok") {
    notFound();
  }

  return (
    <section className="flex flex-1 flex-col gap-8 p-6">
      <PageHeader
        title="Saldos por tienda"
        description="Saldo a favor de cada tienda para efectos de liquidación"
      />

      <section aria-label="Saldos por tienda" className="flex flex-col gap-4">
        <SaldosTiendasTable tiendas={tiendasResult.tiendas} />
      </section>
    </section>
  );
}
