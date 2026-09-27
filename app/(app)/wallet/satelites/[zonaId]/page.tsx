import Link from "next/link";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { EstadoCuentaSatelite } from "../_components/EstadoCuentaSatelite";
import { ESTADO_CUENTA_BODEGA_PAGINA } from "../_components/satelites-labels";

/**
 * FICHA 458-D (T D.4, design §5; R17, R31, R81) — `/wallet/satelites/[zonaId]`: el ESTADO DE CUENTA
 * de una bodega satélite. Mismo control de acceso que `/wallet/satelites` (R81): sin acceso total, sin
 * sesión, una zona inexistente, una zona que no es satélite o un segmento que no es un identificador →
 * «no encontrado», sin distinguir.
 */
export default async function EstadoCuentaSatelitePage({ params }: { params: Promise<{ zonaId: string }> }) {
  const actor = await resolveActorFromSession();
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R81
  }

  const { zonaId } = await params;
  const r = await verEstadoCuentaAction({ cuenta: { tipo: "bodega", id: zonaId } });
  if (r.status !== "ok") {
    notFound(); // R81
  }

  const nombre = r.estado.cuenta.nombre;
  return (
    <AppPage title={ESTADO_CUENTA_BODEGA_PAGINA.titulo(nombre)} description={ESTADO_CUENTA_BODEGA_PAGINA.descripcion}>
      <div className="flex flex-col gap-4">
        <Link
          href="/wallet/satelites"
          className="w-fit rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ESTADO_CUENTA_BODEGA_PAGINA.volver}
        </Link>
        <EstadoCuentaSatelite inicial={r.estado} puedeConciliar={esAccesoTotal(actor.rol)} />
      </div>
    </AppPage>
  );
}
