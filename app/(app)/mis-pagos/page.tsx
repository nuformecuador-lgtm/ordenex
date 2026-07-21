import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisPagosAction,
  verMiCuentaPorPagarAction,
} from "@/lib/actions/wallet-mensajero";

import { MisPagosModule } from "./_components/MisPagosModule";

/**
 * Feature 44 (T15, R20/R21) — pagina `/mis-pagos`: la CUENTA POR PAGAR del mensajero (lo que
 * Ordenex le debe pagar) + el desglose de sus pagos. Espejo de `app/(app)/mi-wallet/page.tsx`.
 *
 * Server Component role-aware: el rol se resuelve SOLO server-side via
 * `resolveActorFromSession`; cualquier rol distinto de `mensajero` (o sin sesion) NO ve la
 * vista (`notFound`, R20 — forbidden sin exponer datos). El backend acota SIEMPRE a
 * `actor.usuarioId` = mensajero_id en el WHERE (R20): el mensajero solo ve lo suyo, nunca los
 * pagos de otro. Los datos sensibles (cuenta + desglose) se pre-obtienen server-side y se
 * pasan YA serializados (STRING) por props al modulo cliente (R21): el cliente nunca recibe
 * `Prisma.Decimal`. Si una action no responde `ok` → `notFound` (defensa en profundidad).
 */
export default async function MisPagosPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "mensajero") {
    notFound(); // R20: rol no autorizado / sin sesion → sin exponer datos
  }

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros). El backend acota
  // al mensajero del actor; aqui no se pasa mensajero_id (nunca en memoria/props, R20).
  const [cuentaResult, pagosResult] = await Promise.all([
    verMiCuentaPorPagarAction(),
    listarMisPagosAction({}),
  ]);

  // Defensa en profundidad: si el service niega (forbidden/unauthenticated) o valida mal, no
  // renderizamos el modulo (no expone nada).
  if (cuentaResult.status !== "ok" || pagosResult.status !== "ok") {
    notFound();
  }

  return (
    <AppPage
      title="Mis pagos"
      description="Lo que Ordenex te debe: lo devengado por tus entregas menos lo ya pagado del efectivo, con el desglose por cierre"
    >
      <MisPagosModule
        movimientos={pagosResult.data.movimientos}
        total={pagosResult.data.total}
        page={pagosResult.data.page}
        pageSize={pagosResult.data.pageSize}
        cuenta={cuentaResult.cuenta}
      />
    </AppPage>
  );
}
