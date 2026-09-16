import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { EmptyState } from "@/components/shared/EmptyState";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_MI_BODEGA } from "@/lib/auth/menu-visibility";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { listarSinpeBodegas } from "@/lib/actions/sinpe-bodega";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";

import { MiBodegaSinpeModule } from "./_components/MiBodegaSinpeModule";

/**
 * ⭑ FICHA 429 (T21-A) — `/mi-bodega`, LA PANTALLA DEL `adminSatelite`.
 *
 * ⚠️ EL GATE LEE `ROLES_MI_BODEGA`, LA MISMA CONSTANTE QUE EL ITEM DE MENU. El precedente es la
 * ficha 335: dos listas de roles escritas a mano divergen sin que nada se ponga rojo, y entonces
 * hay un menu que ofrece una pantalla que devuelve 404 — o, peor, al reves.
 *
 * ⚠️ ESTE `notFound()` NO ES UN BLOQUEO POR REVISION PENDIENTE (R28): corta el paso por ROL, que
 * es lo que hace cualquier ruta del portal. La revision pendiente no decide acceso en ningun
 * sitio, y la guardia `revision-sinpe-no-bloquea.guardia.test.ts` lo vigila sobre los archivos
 * que NOMBRAN la revision — este no la nombra.
 *
 * LOS DATOS SE RESUELVEN AQUI Y BAJAN POR PROPS. `listarSinpeBodegas()` decide en el SERVIDOR que
 * bodega ve este actor y si puede editarla (R19/R20); para un `adminSatelite` devuelve exactamente
 * una, la suya, o ninguna si la base no le asigna zona — que es un estado representable
 * (`usuario.zona_id` es nullable) y por eso tiene su propio vacio en vez de reventar.
 *
 * LA VISTA PREVIA NECESITA EL CUERPO REAL de la plantilla, y por eso esta pagina lee el
 * repositorio directamente —igual que `app/(app)/layout.tsx` lee `UserRepository`—: la lectura no
 * pasa por `listarPlantillas`, que es `maestro`-only y devolveria `forbidden` justo al rol que
 * esta pantalla sirve.
 */

/**
 * La UNICA de las cuatro plantillas vivas que lleva `{{sinpe}}` y `{{sinpe_nombre}}`. Se nombra
 * aqui, junto a la pantalla que la enseña, porque es un dato de ESTA vista previa y no del
 * catalogo: el envio no busca plantillas por nombre, las recibe.
 *
 * Si no esta sincronizada, `findByNombre` devuelve `null` y la pantalla LO DICE. No se hornea un
 * cuerpo de repuesto: una vista previa que existe para comparar contra el mensaje de verdad y
 * enseña un mensaje inventado es peor que no tener vista previa.
 */
const PLANTILLA_CON_SINPE = "listo_para_entrega_mensajero";

export default async function MiBodegaPage() {
  const actor = await resolveActorFromSession();
  if (actor === null || !(ROLES_MI_BODEGA as readonly string[]).includes(actor.rol)) {
    notFound();
  }

  const [res, plantilla] = await Promise.all([
    listarSinpeBodegas(),
    new PlantillaMensajeRepository(getPrismaClient()).findByNombre(PLANTILLA_CON_SINPE),
  ]);

  const bodega = res.status === "ok" ? (res.items[0] ?? null) : null;

  return (
    <AppPage title="Mi bodega">
      {bodega === null ? (
        <EmptyState
          title="Tu cuenta todavía no está asignada a una bodega"
          description="Sin bodega no hay un SINPE que configurar. Pedile a la oficina que te asigne la tuya y volvé a entrar."
        />
      ) : (
        <MiBodegaSinpeModule
          bodega={bodega}
          cuerpoPlantilla={plantilla?.cuerpo ?? null}
        />
      )}
    </AppPage>
  );
}
