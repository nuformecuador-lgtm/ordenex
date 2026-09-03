import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_HISTORIAL_ACCIONES } from "@/lib/auth/menu-visibility";
import { obtenerCatalogoActoresHistorial } from "@/lib/actions/historial-acciones";
import type {
  ActorHistorialDTO,
  CatalogoActoresHistorialResult,
} from "@/lib/types/historial-accion";

import { HistorialAccionesModule } from "./_components/HistorialAccionesModule";

/**
 * FICHA 362 / T5.1 (design §5.1, R18/R19) — ruta del HISTORIAL DE ACCIONES.
 *
 * El rol se resuelve SOLO server-side, con el patrón literal de
 * `app/(app)/historico/conversaciones/page.tsx` (que a su vez copia el de `/analitica` y el
 * de `/incidentes`): el subítem de `lib/auth/menu-visibility.ts` sólo decide qué se MUESTRA;
 * ESTA es la defensa real.
 *
 * Entran exactamente los roles de `ROLES_HISTORIAL_ACCIONES` — la MISMA constante que
 * consume el `roles` del subítem «Acciones» y la misma que compara `HistorialAccionService`,
 * de modo que las tres capas no pueden divergir (R19). En este archivo no se escribe NINGÚN
 * literal de rol, y eso lo vigila
 * `tests/unit/guards/historial-acciones-roles-una-sola-fuente.guardia.test.ts` sobre el
 * fuente sin comentarios, con contrapruebas.
 *
 * ⚠️ SOLO `maestro`, y el motivo importa: este registro guarda las decisiones de dinero que
 * toma el `admin` —aprobar cierres, registrar pagos, decidir cobros— y no puede ser el
 * `admin` quien revise su propio registro. Está escrito con fecha y autor en la constante.
 *
 * ORDEN DE LAS DOS OPERACIONES (R18, «antes de la primera lectura»): el `notFound()` va ANTES
 * de la única lectura de la página. No es preferencia de estilo — quien no pasa el gate no
 * debe provocar ni una consulta, y el test lo afirma con
 * `expect(catalogoSpy).not.toHaveBeenCalled()` para cada rol denegado y para la sesión
 * ausente.
 *
 * QUÉ CARGA Y QUÉ NO. La página NO pre-carga ni una fila del registro: las pide el módulo de
 * cliente por Server Action + SWR, que es el patrón dominante del repo (`OrdenesModule`,
 * `HistoricoConversacionesModule`) y lo que permite paginar y reordenar sin recargar la ruta.
 * Lo único que se pre-carga es el CATÁLOGO DE ACTORES del selector de filtros, que ya viene
 * autorizado por su propio servicio con el mismo gate.
 *
 * ⚠️ EL CATÁLOGO DEVUELVE EL NOMBRE VIVO, no el congelado (declarado por el backend en
 * `progress/impl_362.md §7.5`): el filtro ofrece a la persona con su apellido de hoy y las
 * filas viejas siguen mostrando el de entonces. Es lo correcto —un selector no es una fila de
 * historia— pero es una asimetría visible y por eso queda dicha aquí, que es donde se lee.
 *
 * INYECCIÓN POR `deps`: el doble del cargador viaja por el SEGUNDO parámetro, que Next nunca
 * pasa (a la página sólo le llega el objeto de props de ruta). Con el valor por defecto la
 * aridad declarada sigue siendo 0, así que la firma no cambia para el framework y el test
 * puede afirmar sobre las llamadas sin mockear el módulo entero.
 *
 * SOLO LECTURA (R21): esta pantalla no escribe en ninguna tabla, y no importa ni una Server
 * Action que mute. Lo vigila `tests/unit/guards/historial-acciones-solo-lectura.guardia`.
 */
export interface HistorialAccionesPageDeps {
  /** Cargador del catálogo de actores del filtro. Sustituible en test por un doble. */
  obtenerCatalogo?: () => Promise<CatalogoActoresHistorialResult>;
  /** Resolución del actor de la sesión. Sustituible en test por un doble. */
  getActor?: typeof resolveActorFromSession;
}

export default async function HistorialAccionesPage(
  _props?: Record<string, unknown>,
  deps: HistorialAccionesPageDeps = {},
) {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  // `ROLES_HISTORIAL_ACCIONES` es una tupla de literales de rol y su `.includes` sólo acepta
  // esos literales, no cualquier `RolValue`. Se ensancha el tipo del ARRAY (no el de
  // `actor.rol`) en este único punto de uso, igual que hacen la analítica y el histórico de
  // conversaciones.
  const rolesConAcceso: readonly RolValue[] = ROLES_HISTORIAL_ACCIONES;
  if (!actor || !rolesConAcceso.includes(actor.rol)) {
    notFound();
  }

  const catalogo = await (deps.obtenerCatalogo ?? obtenerCatalogoActoresHistorial)();
  // Un catálogo que no llega deja el filtro de actor SIN opciones, no sin control (R64 de la
  // 144): una barra montada y vacía se lee como «no hay a quién filtrar», mientras que una
  // barra que desaparece se lee como «esta pantalla no filtra».
  const actores: ActorHistorialDTO[] = catalogo.status === "ok" ? catalogo.actores : [];

  // El módulo de cliente recibe SÓLO datos serializables. Ni una función ni el actor cruzan
  // la frontera RSC.
  return (
    <AppPage
      title="Acciones"
      description="Quién hizo qué, sobre qué y cuándo. Solo lectura."
    >
      <HistorialAccionesModule actores={actores} />
    </AppPage>
  );
}
