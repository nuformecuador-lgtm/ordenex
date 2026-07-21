import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarCuentasPorPagarAction } from "@/lib/actions/wallet-mensajero";

import { CuentasPorPagarTable } from "./_components/CuentasPorPagarTable";

/**
 * Feature 44 (T14, R18/R19/R21/R22) — pagina `/wallet/mensajeros`: las CUENTAS POR PAGAR a
 * TODOS los mensajeros (devengado / pagado / pendiente), para que el `maestro` liquide.
 * Espejo de `app/(app)/wallet/tiendas/page.tsx`.
 *
 * Server Component role-aware: el rol se resuelve SOLO server-side via
 * `resolveActorFromSession`; cualquier rol distinto de `maestro` (o sin sesion) NO ve las
 * cuentas (`notFound`, R19 — forbidden sin exponer datos). El pago a mensajeros es un egreso
 * de la caja CENTRAL del maestro (F1.4-Qe/A2: adminSatelite NO ve). El `maestro` NO queda
 * acotado a un solo mensajero (R19). Los montos (datos sensibles) se pre-obtienen server-side
 * y se pasan YA serializados (STRING) por props (R21): el cliente nunca recibe
 * `Prisma.Decimal`. Si la action no responde `ok` → `notFound` (defensa en profundidad).
 */
export default async function WalletMensajerosPage() {
  const actor = await resolveActorFromSession();
  // Feature 94 (paridad adm↔maestro): las cuentas por pagar las ven los roles de
  // ACCESO TOTAL (`maestro`/`admin`); cualquier otro rol (o sin sesion) → notFound (R19).
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R19: rol no autorizado / sin sesion → sin exponer datos
  }

  const cuentasResult = await listarCuentasPorPagarAction();

  // Defensa en profundidad: si el service niega, no renderizamos la tabla.
  if (cuentasResult.status !== "ok") {
    notFound();
  }

  return (
    <section className="flex flex-1 flex-col gap-8 p-6">
      <PageHeader
        title="Cuentas por pagar a mensajeros"
        description="Lo devengado, lo ya pagado del efectivo y lo pendiente por mensajero"
      />

      <section aria-label="Cuentas por pagar a mensajeros" className="flex flex-col gap-4">
        <CuentasPorPagarTable mensajeros={cuentasResult.mensajeros} />
      </section>
    </section>
  );
}
