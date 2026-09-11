import { notFound } from "next/navigation";
import { z } from "zod";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarAyudaTiendaAction,
  listarNovedadesAction,
} from "@/lib/actions/novedades";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";

import { GRUPOS_NOVEDAD, type GrupoNovedad } from "@/lib/types/novedad-grupo";

import { NovedadesTabs } from "./_components/NovedadesTabs";
import { SUBTITULO_NOVEDADES } from "./_components/novedad-grupo-textos";

// ⚠️ FICHA 409 (T6.5 — R6/R7/R66) — LA PANTALLA LEE LA SUPERFICIE QUE LE PIDE LA URL.
//
// El aviso «N novedades esperan tu decisión» declara su atajo a `/novedades?superficie=devolucion`
// (`lib/notificaciones/catalogo-avisos.ts`), y R6 prohibe emitir un parametro que el destino
// IGNORE: sin esta lectura, el boton dejaria a la tienda en «Ayuda solicitada» hablandole de la
// pestaña de al lado, y el aviso quedaria desacreditado el primer dia.
//
// LISTA BLANCA CONTRA `GRUPOS_NOVEDAD`, NUNCA UN `as`: un valor arbitrario de la URL que llegara
// hasta `TabsGroup` activaria una pestaña que no existe, base-ui desmontaria su panel y la
// pantalla quedaria EN BLANCO con un 200. Con el `enum` de zod, lo desconocido cae al defecto y la
// pagina responde 200 con su pestaña de siempre (R66).
//
// NO es un filtro por URL: es FIJAR LA PESTAÑA, el minimo que R7 exige. El filtro completo de
// `/ordenes` y `/novedades` esta declarado FUERA de alcance en el spec (§12).
const PARAM_SUPERFICIE = "superficie";
const superficieSchema = z.enum(GRUPOS_NOVEDAD);

/** El grupo que pide la URL, o `undefined` si no lo pide o pide uno que no existe (R66). */
function superficieSolicitada(
  valor: string | string[] | undefined,
): GrupoNovedad | undefined {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  const parsed = superficieSchema.safeParse(crudo);
  return parsed.success ? parsed.data : undefined;
}

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
export default async function NovedadesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminTienda") {
    notFound(); // R18: rol no autorizado / sin sesion -> sin exponer datos
  }

  const query = (await props.searchParams) ?? {};
  const superficieInicial = superficieSolicitada(query[PARAM_SUPERFICIE]);

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
        superficieInicial={superficieInicial}
      />
    </AppPage>
  );
}
