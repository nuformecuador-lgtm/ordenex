import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarCuentasPorPagarPaginadoAction } from "@/lib/actions/wallet-mensajero";
import { fechaObjetivo } from "@/lib/ranking/snapshot-dia";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { WalletMensajerosTabs } from "./_components/WalletMensajerosTabs";

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

  // Feature 170 — FASE 2 (T L.2, R40): PÁGINA 1 de las cuentas por pagar, no el conjunto
  // entero. El input va vacío: los defaults de `page`/`pageSize` los pone el schema del
  // dominio `wallet-mensajero`, y sin `busqueda` el listado sale completo, como hasta hoy.
  const cuentasResult = await listarCuentasPorPagarPaginadoAction({});

  // Defensa en profundidad: si el service niega, no renderizamos la tabla.
  if (cuentasResult.status !== "ok") {
    notFound();
  }

  // Feature 293 (T5.3, design §9) — los dos días que el panel de premios necesita, resueltos en
  // el SERVIDOR: el que muestra al abrirse (el último que el ranking congeló, `fechaObjetivo` =
  // ayer en CR — la misma función que usa el cron) y la cota superior del selector (hoy en CR,
  // R8). No se calculan en el cliente porque el reloj del navegador no es el de Costa Rica y
  // porque el render del servidor y el de la hidratación tienen que dar el mismo día.
  const ahora = new Date();
  const fechaInicialPremios = fechaObjetivo(ahora);
  const fechaMaximaPremios = fechaCalendarioCR(ahora);

  return (
    <AppPage
      title="Cuentas por pagar a mensajeros"
      description="Lo devengado, lo ya pagado del efectivo y lo pendiente por mensajero"
    >
      <section aria-label="Cuentas por pagar a mensajeros" className="flex flex-col gap-4">
        {/*
          Feature 293 (T5.3, R1) — el panel de PREMIOS DEL RANKING sigue viviendo AQUÍ y en
          ningún otro sitio: es la única puerta desde la que se registra el premio del podio. El
          rol NO se vuelve a decidir dentro —arriba ya hubo `notFound()` para todo lo que no es
          acceso total—, y el servicio responde `forbidden` con el mismo predicado.

          FICHA 298 (2026-08-27) — lo que cambia es DÓNDE, no QUÉ. Hasta hoy el panel iba apilado
          encima de la tabla, en esta misma sección, y la pantalla quedó desordenada. Ahora cada
          bloque tiene su PESTAÑA (`WalletMensajerosTabs`), con las cuentas por pagar de entrada
          porque es a lo que se entra aquí. Los datos siguen resolviéndose en el SERVIDOR y
          bajando ya serializados por props (R21): el envoltorio de pestañas es cliente, pero no
          lee nada por su cuenta.
        */}
        <WalletMensajerosTabs
          cuentas={{
            initialData: {
              items: cuentasResult.items,
              total: cuentasResult.total,
              pageSize: cuentasResult.pageSize,
            },
          }}
          premios={{
            fechaInicial: fechaInicialPremios,
            fechaMaxima: fechaMaximaPremios,
          }}
        />
      </section>
    </AppPage>
  );
}
