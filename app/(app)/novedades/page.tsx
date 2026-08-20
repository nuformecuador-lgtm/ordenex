import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarAyudaTiendaAction,
  listarNovedadesAction,
} from "@/lib/actions/novedades";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";

import { NovedadesTabs } from "./_components/NovedadesTabs";
import { SUBTITULO_NOVEDADES } from "./_components/novedad-grupo-textos";

// Feature 87 (T13, design §3.1) + Feature 102 (T12, design §6.2) + Feature 236 (T4.1, design §5) —
// pagina `/novedades` de la tienda. Server Component role-aware (molde `mi-wallet/page.tsx`): el
// rol se resuelve SOLO server-side. Cualquier rol distinto de `adminTienda` (o sin sesion) NO ve la
// pagina (`notFound`, R18). Pre-fetch server-side de la pagina 1 de TRES superficies acotadas a la
// tienda del actor: las ordenes con AYUDA solicitada (236/R1), las ordenes en devolucion (87) y las
// rechazadas por SLA (102/R12). Los datos (con telefono PII) se pasan YA serializados por props al
// modulo cliente privado, que los presenta en pestañas (Q3 default: sin item de menu nuevo).
//
// LOS TRES MODOS DE FALLO NO SON EL MISMO, y es deliberado (design §5):
//
//  - si el listado de DEVOLUCIONES no responde `ok` -> `notFound` (R19 de la 87). Es la superficie
//    principal e historica de la pantalla;
//  - si el de AYUDA o el de RECHAZOS no responde `ok` -> cae a VACIO y su pestaña muestra su estado
//    vacio. Son superficies secundarias, y tumbar la pantalla entera por una de ellas seria peor
//    que enseñarla vacia. Se escribe aqui para que el fallback no se lea como un olvido — y porque
//    ese estado vacio ya tiene que estar bien escrito por R16.
export default async function NovedadesPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminTienda") {
    notFound(); // R18: rol no autorizado / sin sesion -> sin exponer datos
  }

  const [ayudaResult, novedadesResult, rechazosSlaResult] = await Promise.all([
    listarAyudaTiendaAction({ page: 1 }),
    listarNovedadesAction({ page: 1 }),
    listarRechazosSlaTiendaAction({ page: 1 }),
  ]);

  if (novedadesResult.status !== "ok") {
    notFound(); // R19: cualquier status != ok en la superficie principal -> notFound
  }

  // R16: la pestaña de ayuda es secundaria — un fallo transitorio de su lectura la deja vacia, con
  // su texto propio, en vez de dejar a la tienda sin `/novedades`.
  const ayuda =
    ayudaResult.status === "ok"
      ? {
          items: ayudaResult.items,
          total: ayudaResult.total,
          page: ayudaResult.page,
          pageSize: ayudaResult.pageSize,
        }
      : { items: [], total: 0, page: 1, pageSize: 10 };

  // R12/R14: la superficie de rechazos SLA ya viene acotada a la tienda del actor por el service.
  // Fallback a vacio si no responde `ok` (transitorio): la pestaña muestra su estado vacio.
  const rechazosSla =
    rechazosSlaResult.status === "ok"
      ? {
          items: rechazosSlaResult.items,
          total: rechazosSlaResult.total,
          page: rechazosSlaResult.page,
          pageSize: rechazosSlaResult.pageSize,
        }
      : { items: [], total: 0, page: 1, pageSize: 10 };

  return (
    <AppPage title="Novedades" description={SUBTITULO_NOVEDADES}>
      <NovedadesTabs
        novedades={{
          ayuda,
          devolucion: {
            items: novedadesResult.items,
            total: novedadesResult.total,
            page: novedadesResult.page,
            pageSize: novedadesResult.pageSize,
          },
        }}
        rechazosSla={rechazosSla}
      />
    </AppPage>
  );
}
