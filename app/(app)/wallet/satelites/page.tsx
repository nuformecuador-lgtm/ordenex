import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarSaldosSatelitesAction,
  obtenerResumenSatelitesAction,
} from "@/lib/actions/conciliacion-satelites";

import { SaldosSatelitesTable } from "./_components/SaldosSatelitesTable";
import { SATELITES_PAGINA } from "./_components/satelites-labels";

/**
 * ⭑ FICHA 431 (T21, R23/R25/R27) — `/wallet/satelites`: DÓNDE ESTÁ EL EFECTIVO QUE YA ES NUESTRO.
 *
 * Cuarta hoja del módulo Wallet, junto a «Caja principal», «Tiendas» y «Mensajeros». Las otras dos
 * cuentan lo que Ordenex DEBE; ésta cuenta lo que le deben: el efectivo que una bodega satélite
 * consolidó y todavía no ha llegado físicamente a la central.
 *
 * ── LAS DOS MITADES DEL CONTROL (R27), y ninguna sirve sola
 *  1. AQUÍ: el rol se resuelve SÓLO server-side con `resolveActorFromSession` y cualquiera que no
 *     tenga acceso total —incluido el `adminSatelite`— recibe `notFound()`. Sin exponer datos, y
 *     sin decirle siquiera que la ruta existe.
 *  2. EN EL SERVICIO: `ConciliacionSatelitesService` responde `forbidden` por su cuenta en las
 *     siete operaciones. Ocultar el botón no es un control por sí solo, y esa mitad es la que de
 *     verdad rechaza a quien llame a la acción a mano.
 *
 * ── EL `adminSatelite` NO ENTRA AQUÍ, Y SÍ VE LO SUYO
 * Esta pantalla enseña el dinero de TODAS las bodegas, que es justo lo que R27 le niega. Lo que le
 * corresponde —el estado de conciliación de SUS consolidaciones, con su monto recibido y lo que
 * falta— lo ve donde ya lo veía: su pestaña de cierres de bodega en `/cierres-admin`, acotada por
 * zona en el `WHERE` (R26). No se le abre ninguna ruta nueva.
 *
 * ── DATOS SENSIBLES POR PROPS, YA SERIALIZADOS
 * La página pre-obtiene la PÁGINA 1 y las tres cifras de cabecera y las baja por props: el cliente
 * nunca recibe un `Prisma.Decimal`, y el primer pintado no espera un viaje al servidor por un dato
 * que ya viajó.
 */
export default async function WalletSatelitesPage() {
  const actor = await resolveActorFromSession();
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R27: rol sin acceso total o sin sesión → sin exponer datos
  }

  // Las dos lecturas son independientes: van en el MISMO `Promise.all` para no sumar su latencia
  // al TTFB. Ninguna de las dos necesita la otra.
  const [saldosResult, resumenResult] = await Promise.all([
    listarSaldosSatelitesAction({}),
    obtenerResumenSatelitesAction(),
  ]);

  // Defensa en profundidad: si el servicio niega la tabla, no se renderiza la pantalla.
  if (saldosResult.status !== "ok") {
    notFound();
  }

  // La cabecera degrada SUAVE y la tabla no: sin las tres cifras las tarjetas enseñan «—» y los
  // saldos siguen a la vista. Una cabecera que no carga no es motivo para esconder el listado que
  // alguien vino a mirar — al revés, tumbar la pantalla por el resumen sería perder el dato
  // principal por el accesorio.
  const resumen = resumenResult.status === "ok" ? resumenResult.resumen : null;

  return (
    <AppPage title={SATELITES_PAGINA.titulo} description={SATELITES_PAGINA.descripcion}>
      <section aria-label={SATELITES_PAGINA.titulo} className="flex flex-col gap-4">
        <SaldosSatelitesTable
          initialData={{
            items: saldosResult.items,
            total: saldosResult.total,
            pageSize: saldosResult.pageSize,
          }}
          resumen={resumen}
          /**
           * R25/R27 — el permiso de conciliar se resuelve SÓLO server-side y con el MISMO
           * predicado (`esAccesoTotal`) que el servicio usa para responder `forbidden`.
           *
           * Hoy esta página ya hace `notFound` para cualquier rol sin acceso total, así que el
           * valor es siempre `true` aquí. Se pasa igualmente y **no se escribe `true` literal**:
           * el día que esta pantalla se abra a un rol que mira pero no concilia, los botones
           * desaparecen solos. Mismo criterio, palabra por palabra, que `/wallet/tiendas`.
           */
          puedeConciliar={esAccesoTotal(actor.rol)}
        />
      </section>
    </AppPage>
  );
}
