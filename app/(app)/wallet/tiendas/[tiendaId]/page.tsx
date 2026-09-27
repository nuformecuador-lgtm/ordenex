import Link from "next/link";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { EstadoCuentaTienda } from "../_components/EstadoCuentaTienda";
import { ESTADO_CUENTA_TIENDA_PAGINA } from "../_components/estado-cuenta-tienda-labels";

/**
 * FICHA 458-D (T D.2, design §5; R17, R81) — `/wallet/tiendas/[tiendaId]`: el ESTADO DE CUENTA de una
 * tienda. Server Component: el rol se resuelve SOLO en el servidor y cualquier rol sin acceso total (o
 * sin sesión) recibe «no encontrado» sin exponer datos (R81). La cuenta inexistente, la de otro papel y
 * un segmento que no tiene forma de identificador responden lo MISMO (`notFound`): la acción los
 * devuelve `no_encontrado` / `validation_error` sin distinguirlos.
 *
 * El identificador vive SOLO en la dirección (D1): la página se titula con el nombre de la tienda.
 * La primera página del extracto se pre-obtiene aquí y baja por props (STRING, sin `Prisma.Decimal`).
 */
export default async function EstadoCuentaTiendaPage({ params }: { params: Promise<{ tiendaId: string }> }) {
  const actor = await resolveActorFromSession();
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R81
  }

  const { tiendaId } = await params;
  const r = await verEstadoCuentaAction({ cuenta: { tipo: "tienda", id: tiendaId } });
  if (r.status !== "ok") {
    notFound(); // R81: inexistente, de otro papel o sin forma de identificador — igual
  }

  const nombre = r.estado.cuenta.nombre;
  return (
    <AppPage title={ESTADO_CUENTA_TIENDA_PAGINA.titulo(nombre)} description={ESTADO_CUENTA_TIENDA_PAGINA.descripcion}>
      <div className="flex flex-col gap-4">
        <Link
          href="/wallet/tiendas"
          className="w-fit rounded-sm text-sm text-primary-strong underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ESTADO_CUENTA_TIENDA_PAGINA.volver}
        </Link>
        <EstadoCuentaTienda inicial={r.estado} puedeRegistrar={esAccesoTotal(actor.rol)} />
      </div>
    </AppPage>
  );
}
