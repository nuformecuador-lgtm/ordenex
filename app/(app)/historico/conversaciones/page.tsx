import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { MensajeroFiltroDTO } from "@/lib/types/filtros-ordenes";
import type { ObtenerCatalogoFiltrosOrdenesResult } from "@/lib/types/filtros-ordenes";

import { HistoricoConversacionesModule } from "./_components/HistoricoConversacionesModule";

/**
 * Feature 321 (R7/R8) — ruta del HISTÓRICO DE CONVERSACIONES.
 *
 * El rol se resuelve SOLO server-side, con el patrón literal de
 * `app/(app)/analitica/page.tsx` (que a su vez copia el de
 * `app/(app)/incidentes/page.tsx`): el ítem de menú de
 * `lib/auth/menu-visibility.ts` sólo decide qué se MUESTRA; ESTA es la defensa real.
 *
 * Entran exactamente los roles de `ROLES_HISTORICO_CONVERSACIONES` — la MISMA constante
 * que consume el `roles` del ítem, de modo que las dos capas no pueden divergir (R8). En
 * este archivo no se escribe NINGÚN literal de rol, y eso lo vigila
 * `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts` sobre el fuente sin
 * comentarios, con contraprueba.
 *
 * ORDEN DE LAS DOS OPERACIONES (R7, «antes de consultar dato alguno»): el `notFound()` va
 * ANTES de la única lectura de la página. No es una preferencia de estilo — quien no pasa
 * el gate no debe provocar ni una consulta, y el test lo afirma con
 * `expect(serviceSpy).not.toHaveBeenCalled()` para cada rol denegado y para la sesión
 * ausente.
 *
 * QUÉ CARGA Y QUÉ NO. La página NO pre-carga hilos ni mensajes: los pide el módulo de
 * cliente por Server Action + SWR, que es el patrón dominante del repo (`OrdenesModule`,
 * `PanelesOperativos`) y lo que sostiene la carga perezosa de R41. Lo único que se
 * pre-carga es el CATÁLOGO DE MENSAJEROS de la barra de filtros
 * (`obtenerCatalogoFiltrosOrdenes`, ya autorizado por su propio service). No se usa
 * `listarMensajerosParaAsignacion`: está acotado a la zona GAM y el histórico quiere a
 * TODOS los mensajeros (design §5.1).
 *
 * INYECCIÓN POR `deps`: el doble del cargador viaja por el SEGUNDO parámetro, que Next
 * nunca pasa (a la página sólo le llega el objeto de props de ruta). Con el valor por
 * defecto la aridad declarada sigue siendo 0, así que la firma no cambia para el
 * framework y el test puede afirmar sobre las llamadas sin mockear el módulo entero.
 *
 * SOLO LECTURA (R24/R25): esta pantalla no escribe en ninguna tabla. Aquí no se importa
 * nada de `lib/actions/chat-whatsapp` salvo tipos.
 */
export interface HistoricoConversacionesPageDeps {
  /** Cargador del catálogo de filtros. Sustituible en test por un doble. */
  obtenerCatalogo?: () => Promise<ObtenerCatalogoFiltrosOrdenesResult>;
  /** Resolución del actor de la sesión. Sustituible en test por un doble. */
  getActor?: typeof resolveActorFromSession;
}

export default async function HistoricoConversacionesPage(
  _props?: Record<string, unknown>,
  deps: HistoricoConversacionesPageDeps = {},
) {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  // `ROLES_HISTORICO_CONVERSACIONES` es una tupla de literales de rol y su `.includes`
  // sólo acepta esos literales, no cualquier `RolValue`. Se ensancha el tipo del ARRAY
  // (no el de `actor.rol`) en este único punto de uso, igual que hace la analítica.
  const rolesConAcceso: readonly RolValue[] = ROLES_HISTORICO_CONVERSACIONES;
  if (!actor || !rolesConAcceso.includes(actor.rol)) {
    notFound();
  }

  const catalogo = await (deps.obtenerCatalogo ?? obtenerCatalogoFiltrosOrdenes)();
  // Pedido humano (2026-08-31): el filtro solo ofrece a los mensajeros ACTIVOS. El catalogo
  // los trae todos —y hace bien: en `/ordenes`, esconder a un mensajero dado de baja volveria
  // inalcanzables las ordenes que todavia tiene en la mano—, pero aqui el filtro no busca
  // ordenes vivas sino conversaciones, y ofrecer a los `inactivo`/`bloqueado`/`pendiente`
  // llena el desplegable de gente que ya no trabaja. El recorte se hace AQUI, en la
  // superficie, y no en el repositorio compartido.
  const mensajeros: MensajeroFiltroDTO[] =
    catalogo.status === "ok"
      ? catalogo.catalogo.mensajeros.filter((m) => m.estado === "activo")
      : [];

  // El módulo de cliente (bloques 5 y 6) recibe SÓLO datos serializables: la lista de
  // mensajeros del filtro. Ni una función ni el actor cruzan la frontera RSC — los hilos y
  // los mensajes los pide él por Server Action + SWR, que es lo que sostiene la carga
  // perezosa de R41.
  // Pedido humano (2026-08-31): el encabezado ESTANDAR del portal, el mismo `AppPage` que usan
  // `/ordenes`, `/incidentes` o `/monitoreo`. Antes esta ruta armaba su propio `<main>` con un
  // `<h1>` suelto y se quedaba sin la barra superior (tema, notificaciones, salir).
  //
  // `contentClassName`: el `Container` por defecto apila con `gap-6` y `p-6`; esta pantalla es
  // de dos paneles que scrollean por dentro, asi que necesita `min-h-0` (sin el, un hijo con
  // `overflow-y-auto` crece en vez de scrollear) y un ritmo mas apretado.
  return (
    <AppPage title="Conversaciones" contentClassName="min-h-0 gap-3 p-3 md:p-6">
      <HistoricoConversacionesModule mensajeros={mensajeros} />
    </AppPage>
  );
}
