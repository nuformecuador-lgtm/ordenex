import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarMovimientosAction, verBalanceAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarPlantillasAction } from "@/lib/actions/gasto-fijo-plantilla";

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
  // Feature 94 (paridad adm↔maestro): la wallet la ven los roles de ACCESO TOTAL
  // (`maestro`/`admin`); cualquier otro rol (o sin sesión) → notFound (R19).
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R19: rol no autorizado / sin sesión → sin exponer datos
  }

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros). Feature 45:
  // además del libro + balance, se pre-obtienen el desglose de egresos administrativos y las
  // plantillas de gasto fijo (datos sensibles → props, nunca fetch cliente).
  const [movimientosResult, balanceResult, desgloseResult, plantillasResult] =
    await Promise.all([
      listarMovimientosAction({}),
      verBalanceAction({}),
      verDesgloseEgresosAction({}),
      listarPlantillasAction(),
    ]);

  // Defensa en profundidad: si algún service niega (forbidden/unauthenticated) o valida
  // mal, no renderizamos el módulo (no expone nada).
  if (
    movimientosResult.status !== "ok" ||
    balanceResult.status !== "ok" ||
    desgloseResult.status !== "ok" ||
    plantillasResult.status !== "ok"
  ) {
    notFound();
  }

  return (
    <AppPage
      title="Wallet"
      description="Caja principal de Ordenex: libro de movimientos y balance general"
    >
      <WalletModule
        movimientos={movimientosResult.data.movimientos}
        total={movimientosResult.data.total}
        page={movimientosResult.data.page}
        pageSize={movimientosResult.data.pageSize}
        balance={balanceResult.balance}
        desglose={desgloseResult.desglose}
        plantillas={plantillasResult.plantillas}
      />
    </AppPage>
  );
}
