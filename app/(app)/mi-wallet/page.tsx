import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisMovimientosAction,
  verMiSaldoAction,
} from "@/lib/actions/wallet-tienda";

import { MiWalletModule } from "./_components/MiWalletModule";

/**
 * Feature 43 (T14, R18/R19/R21) — pagina `/mi-wallet`: el saldo a favor de la TIENDA
 * (cuanto le debe entregar Ordenex). Server Component role-aware. El rol se resuelve SOLO
 * server-side via `resolveActorFromSession` (patron `/wallet`): cualquier rol distinto de
 * `adminTienda` (o sin sesion) NO ve la wallet (`notFound`, R19 — forbidden sin exponer
 * datos). El backend acota SIEMPRE a `actor.usuarioId` = tienda_id en el WHERE (R19): la
 * tienda solo ve lo suyo. Los datos sensibles (desglose + saldo) se pre-obtienen
 * server-side y se pasan YA serializados (STRING) por props al modulo cliente (R21): el
 * cliente nunca recibe `Prisma.Decimal`. Si una action no responde `ok` → `notFound`
 * (defensa en profundidad).
 */
export default async function MiWalletPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminTienda") {
    notFound(); // R19: rol no autorizado / sin sesion → sin exponer datos
  }

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros). El backend
  // acota a la tienda del actor; aqui no se pasa tienda_id (nunca en memoria/props, R19).
  const [saldoResult, movimientosResult] = await Promise.all([
    verMiSaldoAction(),
    listarMisMovimientosAction({}),
  ]);

  // Defensa en profundidad: si el service niega (forbidden/unauthenticated) o valida mal,
  // no renderizamos el modulo (no expone nada).
  if (saldoResult.status !== "ok" || movimientosResult.status !== "ok") {
    notFound();
  }

  return (
    <AppPage
      title="Mi wallet"
      description="Tu saldo a favor: COD recaudado menos los descuentos de Ordenex, con el desglose por cierre y concepto"
    >
      <MiWalletModule
        movimientos={movimientosResult.data.movimientos}
        total={movimientosResult.data.total}
        page={movimientosResult.data.page}
        pageSize={movimientosResult.data.pageSize}
        saldo={saldoResult.saldo}
        /* Feature 172 (T G.2, R55): los tres importes viajan CON el listado, del mismo
           conjunto y con los mismos filtros; el cliente no los recalcula (R14). */
        desglose={movimientosResult.data.desglose}
      />
    </AppPage>
  );
}
