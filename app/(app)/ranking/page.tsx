import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerRankingAction } from "@/lib/actions/ranking";

import { RankingModule } from "./_components/RankingModule";

/**
 * Feature 76 (T8, R12/R16/R17/R18) — página `/ranking`: ranking DIARIO de mensajeros +
 * tabla de premios del podio. Server Component role-aware. El rol se resuelve SOLO
 * server-side vía `resolveActorFromSession` (patrón /wallet, /cierres-admin): se permite
 * `maestro` (ve y edita, R16) y `mensajero` (ve en solo-lectura, R17); cualquier otro rol
 * o sin sesión → `notFound` (R18: acceso denegado sin exponer datos).
 *
 * Los datos se pre-obtienen server-side con `obtenerRankingAction()` y se pasan YA
 * serializados (montos y porcentajes como STRING, R12) + `esEditable` por props al módulo
 * cliente: el cliente NUNCA recibe Prisma.Decimal. Si la action no responde `ok`
 * (forbidden/unauthenticated) → `notFound` (defensa en profundidad, patrón /wallet).
 */
export default async function RankingPage() {
  const actor = await resolveActorFromSession();
  if (!actor || (actor.rol !== "maestro" && actor.rol !== "mensajero")) {
    notFound(); // R18: rol no autorizado / sin sesión → sin exponer datos
  }

  const result = await obtenerRankingAction();
  if (result.status !== "ok") notFound(); // defensa en profundidad (R18)

  return (
    <section className="flex flex-1 flex-col gap-8 p-6">
      <PageHeader
        title="Ranking"
        description="Ranking diario de mensajeros por entregas exitosas y premios del podio"
      />

      <RankingModule
        ranking={result.data.ranking}
        premios={result.data.premios}
        esEditable={result.data.esEditable}
      />
    </section>
  );
}
