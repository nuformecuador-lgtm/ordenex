import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ROLES_MI_WALLET } from "@/lib/auth/menu-visibility";
import { verMiEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { listarMisCierresAction } from "@/lib/actions/wallet-tienda";

import { MiEstadoCuenta } from "./_components/MiEstadoCuenta";
import { MI_ESTADO_CUENTA_PAGINA } from "./_components/mi-estado-cuenta-labels";
import type { CierresDeLaTienda } from "./_components/mi-wallet-cierres";

/**
 * Feature 43 (T14, R18/R19/R21) — pagina `/mi-wallet`: el dinero de la TIENDA con Ordenex. Server
 * Component role-aware. El rol se resuelve SOLO server-side via `resolveActorFromSession` (patron
 * `/wallet`): cualquier rol distinto de `adminTienda` (o sin sesion) NO ve la wallet (`notFound`,
 * R19 — forbidden sin exponer datos). El backend acota SIEMPRE a la tienda del actor en el WHERE: la
 * tienda solo ve lo suyo. Los datos se pre-obtienen server-side y se pasan YA serializados (STRING)
 * por props al modulo cliente (R21): el cliente nunca recibe `Prisma.Decimal`. Si la lectura no
 * responde `ok` → `notFound` (defensa en profundidad).
 *
 * FICHA 458-D (T D.5, R34–R36) — la pantalla ES el estado de cuenta de la propia tienda, en solo
 * lectura: la MISMA lectura que la oficina (`verMiEstadoCuentaAction`, con la tienda de la SESION y
 * sin ninguna clave de cuenta en la entrada), con su selector de cierre de siempre (335).
 */
export default async function MiWalletPage() {
  const actor = await resolveActorFromSession();
  // Ficha 335 (R33): CERO literales de rol en este archivo. El gate y el item de menu leen la
  // MISMA constante, asi que la puerta que se ve y la puerta que cierra no pueden divergir.
  // `ROLES_MI_WALLET` es una tupla de literales y su `.includes` solo acepta esos literales, no
  // cualquier rol: se ensancha el tipo del ARRAY (no el de `actor.rol`) en este unico punto de
  // uso, igual que hacen la analitica (129) y el historico (321).
  //
  // El ensanchado se escribe como `Actor["rol"]` y NO como `RolValue` importado de
  // `@prisma/client`: la guardia de esta ficha prohibe que un archivo de `/mi-wallet` importe de
  // ahi —es la via por la que `Prisma.Decimal` llegaria al navegador— y ese barrido no
  // distingue un `import type`. Ademas ata el ensanchado al tipo del PROPIO actor que se esta
  // comprobando, que es de lo que se habla.
  const rolesConAcceso: readonly Actor["rol"][] = ROLES_MI_WALLET;
  if (!actor || !rolesConAcceso.includes(actor.rol)) {
    notFound(); // R19/R34: rol no autorizado / sin sesion → sin exponer datos
  }

  // Pre-fetch server-side de la primera pagina, sin filtros. El servidor acota a la tienda del
  // actor; aqui no se pasa ningun id de tienda (nunca en memoria/props, R19/R36).
  const [estadoResult, cierresResult] = await Promise.all([
    verMiEstadoCuentaAction({}),
    // FICHA 335 (B1, R22) — el catalogo de cierres del selector. Se lee UNA vez, en la carga: es el
    // catalogo del libro, no depende de los filtros vigentes. Precio declarado: un cierre que entre
    // con la pantalla abierta no aparece hasta recargar la ruta. La action va SIN argumentos (R5):
    // no hay ninguna clave donde escribir un alcance ajeno.
    listarMisCierresAction(),
  ]);

  // Defensa en profundidad: si el servicio niega (forbidden/unauthenticated) o valida mal, no se
  // renderiza el modulo (no expone nada).
  if (estadoResult.status !== "ok") {
    notFound();
  }

  // FICHA 335 (B1, R29) — la lectura de cierres se DEGRADA, no tumba la pantalla: NO hay un segundo
  // `notFound()`. El estado de cuenta ES la pantalla; el filtro es una comodidad, y que se caiga una
  // comodidad no puede esconderle a la tienda su dinero. Cuando no responde `ok`, el selector queda
  // vacio y deshabilitado, y lo dice en pantalla.
  const cierres: CierresDeLaTienda =
    cierresResult.status === "ok"
      ? { opciones: cierresResult.cierres, hayMas: cierresResult.hayMas, disponible: true }
      : { opciones: [], hayMas: false, disponible: false };

  return (
    <AppPage title={MI_ESTADO_CUENTA_PAGINA.titulo} description={MI_ESTADO_CUENTA_PAGINA.descripcion}>
      <MiEstadoCuenta inicial={estadoResult.estado} cierres={cierres} />
    </AppPage>
  );
}
