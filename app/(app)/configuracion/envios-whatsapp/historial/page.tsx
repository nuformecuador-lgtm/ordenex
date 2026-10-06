import Link from "next/link";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarEjecuciones, listarEnvios } from "@/lib/actions/envios-whatsapp";

import { HistorialEnvios } from "../_components/HistorialEnvios";

const PAGE_SIZE = 20;

/**
 * Ficha 474 (T10.3, R1, R42–R44) — historial de ejecuciones, de todos los envíos o de uno
 * (`?envio=<id>`). Solo `maestro`. Pre-carga la primera página en el servidor.
 */
export default async function HistorialEnviosWhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ envio?: string | string[] }>;
}) {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Historial de envíos">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }
  const sp = await searchParams;
  const crudo = Array.isArray(sp.envio) ? sp.envio[0] : sp.envio;
  const envioId = crudo && crudo.trim() !== "" ? crudo : null;

  const [lista, pagina] = await Promise.all([
    listarEnvios(),
    listarEjecuciones({ ...(envioId ? { envioId } : {}), page: 1, pageSize: PAGE_SIZE }),
  ]);
  const envios = lista.status === "ok" ? lista.items.map((e) => ({ id: e.id, nombre: e.nombre })) : [];
  const actual = envioId ? envios.find((e) => e.id === envioId) : undefined;

  return (
    <AppPage
      title="Historial"
      description={
        actual
          ? `Envíos automáticos › ${actual.nombre}. Lo más reciente arriba, en hora de Costa Rica.`
          : "Envíos automáticos. Lo más reciente arriba, en hora de Costa Rica."
      }
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/configuracion/envios-whatsapp"
          className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline"
        >
          ← Volver a envíos automáticos
        </Link>
        {actual ? (
          <Link
            href={`/configuracion/envios-whatsapp/${actual.id}`}
            className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline"
          >
            Editar envío
          </Link>
        ) : null}
      </div>
      <HistorialEnvios
        inicial={
          pagina.status === "ok"
            ? { items: pagina.items, total: pagina.total, page: pagina.page, pageSize: pagina.pageSize }
            : { items: [], total: 0, page: 1, pageSize: PAGE_SIZE }
        }
        envios={envios}
        envioId={envioId}
      />
    </AppPage>
  );
}
