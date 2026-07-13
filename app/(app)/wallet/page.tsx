import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMovimientosAction, verBalanceAction } from "@/lib/actions/wallet";

import { WalletModule } from "./_components/WalletModule";

/**
 * Feature 42 (T11, R18/R19/R21) — página `/wallet`: la caja principal de Ordenex.
 * Server Component role-aware. El rol se resuelve SOLO server-side vía
 * `resolveActorFromSession` (patrón cierres-admin): cualquier rol distinto de `maestro`
 * (o sin sesión) NO ve la wallet (`notFound`, R19 — forbidden sin exponer datos). Los
 * datos sensibles (libro + balance) se pre-obtienen server-side y se pasan YA
 * serializados (STRING) por props al módulo cliente (R21): el cliente nunca recibe
 * `Prisma.Decimal`. Si una action no responde `ok` → `notFound` (defensa en profundidad).
 */
export default async function WalletPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "maestro") {
    notFound(); // R19: rol no autorizado / sin sesión → sin exponer datos
  }

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros).
  const [movimientosResult, balanceResult] = await Promise.all([
    listarMovimientosAction({}),
    verBalanceAction({}),
  ]);

  // Defensa en profundidad: si el service niega (forbidden/unauthenticated) o valida
  // mal, no renderizamos el módulo (no expone nada).
  if (movimientosResult.status !== "ok" || balanceResult.status !== "ok") {
    notFound();
  }

  return (
    <section className="flex flex-1 flex-col gap-8 p-6">
      <PageHeader
        title="Wallet"
        description="Caja principal de Ordenex: libro de movimientos y balance general"
      />

      <WalletModule
        movimientos={movimientosResult.data.movimientos}
        total={movimientosResult.data.total}
        page={movimientosResult.data.page}
        pageSize={movimientosResult.data.pageSize}
        balance={balanceResult.balance}
      />
    </section>
  );
}
