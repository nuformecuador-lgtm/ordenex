import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ROLES_MI_WALLET } from "@/lib/auth/menu-visibility";
import {
  listarMisCierresAction,
  listarMisMovimientosAction,
  verMiSaldoAction,
} from "@/lib/actions/wallet-tienda";

import { MiWalletModule } from "./_components/MiWalletModule";
import type { CierresDeLaTienda } from "./_components/mi-wallet-cierres";

/**
 * Feature 43 (T14, R18/R19/R21) — pagina `/mi-wallet`: el saldo a favor de la TIENDA
 * (cuanto le debe entregar Ordenex). Server Component role-aware. El rol se resuelve SOLO
 * server-side via `resolveActorFromSession` (patron `/wallet`): cualquier rol distinto de
 * `adminTienda` (o sin sesion) NO ve la wallet (`notFound`, R19 — forbidden sin exponer
 * datos). El backend acota SIEMPRE a `actor.usuarioId` = tienda_id en el WHERE (R19): la
 * tienda solo ve lo suyo. Los datos sensibles (desglose + saldo) se pre-obtienen
 * server-side y se pasan YA serializados (STRING) por props al modulo cliente (R21): el
 * cliente nunca recibe `Prisma.Decimal`. Si una action no responde `ok` → `notFound`
 * (defensa en profundidad).
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

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros). El backend
  // acota a la tienda del actor; aqui no se pasa tienda_id (nunca en memoria/props, R19).
  const [saldoResult, movimientosResult, cierresResult] = await Promise.all([
    verMiSaldoAction(),
    listarMisMovimientosAction({}),
    // FICHA 335 (B1, R22) — el catalogo de cierres del selector. Se lee UNA vez, en la carga:
    // es el catalogo del libro, no depende de los filtros vigentes, asi que `recargar()` no lo
    // vuelve a pedir. Precio declarado: un cierre que entre con la pantalla abierta no aparece
    // hasta recargar la ruta. La action va SIN argumentos (R5): no hay ninguna clave donde
    // escribir un alcance ajeno.
    listarMisCierresAction(),
  ]);

  // Defensa en profundidad: si el service niega (forbidden/unauthenticated) o valida mal,
  // no renderizamos el modulo (no expone nada).
  if (saldoResult.status !== "ok" || movimientosResult.status !== "ok") {
    notFound();
  }

  // FICHA 335 (B1, R29) — la lectura de cierres se DEGRADA, no tumba la pantalla: NO hay un
  // tercer `notFound()`. El saldo y el libro SON la pantalla; el filtro es una comodidad, y que
  // se caiga una comodidad no puede esconderle a la tienda su dinero. Cuando no responde `ok`,
  // el selector queda vacio y deshabilitado, y lo dice en pantalla.
  const cierres: CierresDeLaTienda =
    cierresResult.status === "ok"
      ? { opciones: cierresResult.cierres, hayMas: cierresResult.hayMas, disponible: true }
      : { opciones: [], hayMas: false, disponible: false };

  return (
    <AppPage
      title="Mi wallet"
      description="Tu saldo a favor: COD recaudado menos los descuentos de Ordenex, con el desglose por cierre y concepto"
    >
      <MiWalletModule
        movimientos={movimientosResult.data.movimientos}
        total={movimientosResult.data.total}
        page={movimientosResult.data.page}
        pageSize={movimientosResult.data.pageSize}
        saldo={saldoResult.saldo}
        /* Feature 172 (T G.2, R55): los tres importes viajan CON el listado, del mismo
           conjunto y con los mismos filtros; el cliente no los recalcula (R14). */
        desglose={movimientosResult.data.desglose}
        /* Ficha 335 (R22): el filtro de cierre deja de pedir un identificador escrito a mano;
           las opciones bajan YA resueltas del servidor. */
        cierres={cierres}
      />
    </AppPage>
  );
}
