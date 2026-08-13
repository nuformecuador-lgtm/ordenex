import { redirect, notFound } from "next/navigation";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerEtiquetaPorGuia } from "@/lib/actions/etiquetas-guia";
import { formatMonto } from "@/lib/config/moneda";
import { PAQUETE_BASE_PATH } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";
import { Logo } from "@/components/shared/Logo";

const SIN_DATO = "—";

/** Une los tramos de geografía disponibles; omite los ausentes. */
function ubicacionLegible(e: EtiquetaGuiaDTO): string {
  const partes = [e.zonaNombre, e.provinciaNombre, e.cantonNombre, e.distritoNombre]
    .filter((p): p is string => Boolean(p))
    .join(" / ");
  return partes || SIN_DATO;
}

/** El segmento de ruta es un `num_guia`: entero positivo o nada (404). */
function parseNumGuiaParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Detalle público del paquete al que apunta el QR de la etiqueta
 * (`<origin>/paquete/<numGuia>`). La sesión se exige: el `middleware.ts` ya redirige
 * a `/login?redirect=/paquete/<numGuia>` si falta la cookie; aquí se refuerza el caso
 * de cookie presente pero sesión inválida/expirada (actor null). Los datos se
 * resuelven con la Server Action `obtenerEtiquetaPorGuia` (payload legible ya
 * autorizado para cualquier rol autenticado); si el segmento no es un `num_guia`
 * válido o no hay orden viva con esa guía -> 404.
 */
export default async function PaquetePage({
  params,
}: {
  params: Promise<{ numGuia: string }>;
}) {
  const { numGuia: numGuiaParam } = await params;
  const numGuia = parseNumGuiaParam(numGuiaParam);
  if (numGuia === null) notFound();

  // Defensa server-side: cookie presente pero sesión no válida -> login (returnTo).
  const actor = await resolveActorFromSession();
  if (!actor) redirect(`/login?redirect=${PAQUETE_BASE_PATH}/${numGuia}`);

  const res = await obtenerEtiquetaPorGuia({ numGuia });
  if (res.status === "unauthenticated") {
    redirect(`/login?redirect=${PAQUETE_BASE_PATH}/${numGuia}`);
  }
  // Guía inexistente/orden borrada (o entrada inválida) -> 404.
  if (res.status !== "ok") notFound();

  const orden = res.etiqueta;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-1">
        {/* Feature 208: la página de seguimiento usa tokens de tema (`bg-card`,
            `border-border`, `text-muted-foreground`), así que gira con él; el
            wordmark en `navy` fijo era lo único que se quedaba atrás. */}
        <Logo className="text-lg text-foreground" />
        <div className="h-1 w-10 rounded-full bg-brand" />
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Guía
            </p>
            <p className="text-2xl font-bold leading-tight">{orden.numGuia}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Remisión
            </p>
            <p className="font-medium">{orden.numRemision}</p>
          </div>
        </div>

        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <Campo label="Destinatario" valor={orden.destinatario} />
          <Campo label="Teléfono" valor={orden.telefonoDest} />
          <Campo label="Dirección" valor={orden.direccion ?? SIN_DATO} />
          <Campo label="Ubicación" valor={ubicacionLegible(orden)} />
          <Campo label="Producto" valor={orden.producto} />
          <Campo label="Monto a cobrar" valor={formatMonto(orden.montoCobrar)} />
          <Campo label="Tienda" valor={orden.tiendaNombre} />
        </dl>
      </section>
    </main>
  );
}

/** Par etiqueta/valor de una fila del detalle. */
function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words">{valor}</dd>
    </div>
  );
}
