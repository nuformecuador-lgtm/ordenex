import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { obtenerRankingHistoricoAction } from "@/lib/actions/ranking-historico";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { fechaObjetivo } from "@/lib/ranking/snapshot-dia";

import { RankingHistoricoModule } from "./_components/RankingHistoricoModule";
import { RANKING_HISTORICO_LABELS } from "./_components/ranking-historico-labels";

/**
 * Feature 196 (T4.3, design §6) — página `/ranking/historico`: el ranking CONGELADO de una
 * fecha ya cerrada. Server Component role-aware, calcado de `app/(app)/ranking/page.tsx`.
 *
 * El rol se resuelve SOLO server-side con `resolveActorFromSession`: entran los roles de
 * acceso total (`maestro`/`admin`) y `mensajero` —que ve el histórico COMPLETO en solo
 * lectura, sin recorte a sus propias filas (decisión humana 4, R28)—; cualquier otro rol o
 * sin sesión → `notFound` (R27: acceso denegado sin exponer ni una fila). El ítem de menú
 * solo decide qué se MUESTRA; la defensa real es este `notFound`.
 *
 * Los datos se pre-obtienen aquí con `obtenerRankingHistoricoAction` y se pasan al módulo
 * cliente YA SERIALIZADOS (montos y porcentaje como STRING, R31): el cliente nunca recibe
 * `Prisma.Decimal`.
 */

/** Nombre del parámetro de la URL. Un solo literal; el selector del módulo escribe el mismo. */
const PARAM_FECHA = "fecha";

/**
 * La fecha consultada. Sin `?fecha`, el día D−1 en calendario de COSTA RICA, que es el
 * último que el cron pudo congelar (`fechaObjetivo`, design §3).
 *
 * ⛔ Nada de `toISOString()` para esto: emitiría la fecha en UTC y a partir de las 18:00 CR
 * ya devolvería el día siguiente. `fechaObjetivo` es el único camino, y se apoya en
 * `lib/utils/fecha-cr.ts`.
 *
 * Un parámetro repetido (`?fecha=a&fecha=b`) llega como array; se toma el primero en vez de
 * fallar: es una URL malformada, no un ataque, y el borde de la acción sigue validando.
 */
function fechaSolicitada(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? fechaObjetivo(new Date());
  return valor ?? fechaObjetivo(new Date());
}

export default async function RankingHistoricoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await resolveActorFromSession();
  // Paridad exacta con `/ranking` (feature 94, adm↔maestro): acceso total + `mensajero`.
  if (!actor || (!esAccesoTotal(actor.rol) && actor.rol !== "mensajero")) {
    notFound(); // R27: rol no autorizado / sin sesión → sin exponer datos
  }

  const searchParams = await props.searchParams;
  const fecha = fechaSolicitada(searchParams[PARAM_FECHA]);

  const result = await obtenerRankingHistoricoAction({ fecha });

  // `sin_snapshot` NO es un error: es uno de los tres estados que R26 exige distinguir, y se
  // PINTA. Lo que sí es un error —y se trata como tal, sin filtrar nada— es todo lo demás:
  //  - `forbidden`/`unauthenticated`: defensa en profundidad, patrón /wallet y /ranking;
  //  - `invalid`: el `?fecha` de la URL no es una fecha calendario que exista (R30). No hay
  //    página para un día que no existe, y caer al D−1 en silencio enseñaría los datos de una
  //    fecha distinta de la que se pidió, que es peor que un 404.
  if (result.status !== "ok" && result.status !== "sin_snapshot") {
    notFound();
  }

  return (
    <AppPage
      title={RANKING_HISTORICO_LABELS.pageTitulo}
      description={RANKING_HISTORICO_LABELS.pageDescripcion}
    >
      <RankingHistoricoModule
        fecha={fecha}
        snapshot={result.status === "ok" ? result.data : null}
      />
    </AppPage>
  );
}
