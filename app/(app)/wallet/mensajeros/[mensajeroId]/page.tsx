import Link from "next/link";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { EstadoCuentaMensajero } from "../_components/EstadoCuentaMensajero";
import { ESTADO_CUENTA_MENSAJERO_PAGINA } from "../_components/estado-cuenta-mensajero-labels";

/**
 * FICHA 458-D (T D.3, design §5; R17, R29, R70, R81) — `/wallet/mensajeros/[mensajeroId]`: el ESTADO
 * DE CUENTA de un mensajero. Mismo control de acceso que `/wallet/mensajeros` (R81): cualquier rol sin
 * acceso total, sin sesión, un mensajero inexistente, un usuario de otro papel o un segmento que no es
 * un identificador → «no encontrado», sin distinguir.
 */
export default async function EstadoCuentaMensajeroPage({ params }: { params: Promise<{ mensajeroId: string }> }) {
  const actor = await resolveActorFromSession();
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R81
  }

  const { mensajeroId } = await params;
  const r = await verEstadoCuentaAction({ cuenta: { tipo: "mensajero", id: mensajeroId } });
  if (r.status !== "ok") {
    notFound(); // R81
  }

  const nombre = r.estado.cuenta.nombre;
  return (
    <AppPage
      title={ESTADO_CUENTA_MENSAJERO_PAGINA.titulo(nombre)}
      description={ESTADO_CUENTA_MENSAJERO_PAGINA.descripcion}
    >
      <div className="flex flex-col gap-4">
        <Link
          href="/wallet/mensajeros"
          className="w-fit rounded-sm text-sm text-primary-strong underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ESTADO_CUENTA_MENSAJERO_PAGINA.volver}
        </Link>
        <EstadoCuentaMensajero inicial={r.estado} puedeRegistrar={esAccesoTotal(actor.rol)} />
      </div>
    </AppPage>
  );
}
