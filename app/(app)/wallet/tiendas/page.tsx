import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarSaldosTiendasPaginadoAction } from "@/lib/actions/wallet-tienda";

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
  // Feature 94 (paridad adm↔maestro): los saldos por tienda los ven los roles de
  // ACCESO TOTAL (`maestro`/`admin`); cualquier otro rol (o sin sesion) → notFound (R20).
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R20: rol no autorizado / sin sesion → sin exponer datos
  }

  // Feature 170 — FASE 2 (T I.2, R40): PÁGINA 1 de los saldos, no el conjunto entero. El
  // input va vacío: los defaults de `page`/`pageSize` los pone el schema del dominio.
  const tiendasResult = await listarSaldosTiendasPaginadoAction({});

  // Defensa en profundidad: si el service niega, no renderizamos la tabla.
  if (tiendasResult.status !== "ok") {
    notFound();
  }

  return (
    <AppPage
      title="Saldos por tienda"
      description="Saldo a favor de cada tienda para efectos de liquidación"
    >
      <section aria-label="Saldos por tienda" className="flex flex-col gap-4">
        <SaldosTiendasTable
          initialData={{
            items: tiendasResult.items,
            total: tiendasResult.total,
            pageSize: tiendasResult.pageSize,
          }}
          /**
           * Feature 172 (T D.3, R4/R1) — el permiso de pagar se resuelve SOLO server-side y
           * con el MISMO predicado (`esAccesoTotal`) que `LiquidacionService` usa para
           * responder `forbidden`. Son las dos mitades del control de acceso: ocultar el
           * botón no es una de ellas por sí solo, y la acción tampoco lo es sin la otra.
           *
           * Hoy la página ya hace `notFound` para cualquier rol sin acceso total, así que
           * este valor es siempre `true` aquí. Se pasa igualmente y no se escribe `true`
           * literal: el día que esta pantalla se abra a un rol que mira pero no paga, el
           * botón desaparece solo.
           */
          puedeRegistrarPago={esAccesoTotal(actor.rol)}
        />
      </section>
    </AppPage>
  );
}
