import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { obtenerRankingAction } from "@/lib/actions/ranking";

import { RankingModule } from "./_components/RankingModule";
import { RankingPodio } from "./_components/RankingPodio";

/** Cuántos mensajeros ve el propio mensajero en el podio rediseñado, PODIO INCLUIDO. */
const LIMITE_RANKING_MENSAJERO = 10;

/**
 * Feature 76 (T8, R12/R16/R17/R18) — página `/ranking`: ranking DIARIO de mensajeros +
 * tabla de premios del podio. Server Component role-aware. El rol se resuelve SOLO
 * server-side vía `resolveActorFromSession` (patrón /wallet, /cierres-admin): se permite
 * a los roles de acceso total `maestro`/`admin` (ven y editan, R16 — feature 94 paridad
 * adm↔maestro) y `mensajero` (ve en solo-lectura, R17); cualquier otro rol o sin sesión →
 * `notFound` (R18: acceso denegado sin exponer datos).
 *
 * Los datos se pre-obtienen server-side con `obtenerRankingAction()` y se pasan YA
 * serializados (montos y porcentajes como STRING, R12) + `esEditable` por props al módulo
 * cliente: el cliente NUNCA recibe Prisma.Decimal. Si la action no responde `ok`
 * (forbidden/unauthenticated) → `notFound` (defensa en profundidad, patrón /wallet).
 */
export default async function RankingPage() {
  const actor = await resolveActorFromSession();
  // Feature 94 (paridad adm↔maestro): roles de ACCESO TOTAL (`maestro`/`admin`) ven y
  // editan; `mensajero` ve en solo-lectura; cualquier otro rol (o sin sesión) → notFound.
  if (!actor || (!esAccesoTotal(actor.rol) && actor.rol !== "mensajero")) {
    notFound(); // R18: rol no autorizado / sin sesión → sin exponer datos
  }

  const result = await obtenerRankingAction();
  if (result.status !== "ok") notFound(); // defensa en profundidad (R18)

  return (
    <AppPage
      title="Ranking"
      description="Ranking diario de mensajeros por entregas exitosas y premios del podio"
    >
      <div className="flex flex-col gap-8">
        {/* Rediseño en evaluación: podio visual + lista. Solo-lectura.
            Al mensajero se le recorta al top 10 (podio incluido) y, si quedó fuera, su
            fila real se ancla al final. Maestro/admin ven la lista completa: la necesitan
            para operar, y no tienen fila propia que anclar. */}
        <RankingPodio
          ranking={result.data.ranking}
          mensajeroPropioId={actor.rol === "mensajero" ? actor.usuarioId : null}
          limite={actor.rol === "mensajero" ? LIMITE_RANKING_MENSAJERO : null}
        />

        {/* Versión anterior, debajo para comparar. Sigue siendo la que EDITA los premios. */}
        <RankingModule
          ranking={result.data.ranking}
          premios={result.data.premios}
          esEditable={result.data.esEditable}
        />
      </div>
    </AppPage>
  );
}
