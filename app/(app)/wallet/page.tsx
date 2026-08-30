import { notFound } from "next/navigation";
import { RolValue } from "@prisma/client";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarMovimientosAction, verResumenCajaAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarPlantillasPaginadoAction } from "@/lib/actions/gasto-fijo-plantilla";
import { listarCobrosPendientesAction } from "@/lib/actions/gasto-fijo-cobro";

import { WalletModule } from "./_components/WalletModule";

/**
 * Feature 42 (T11, R18/R19/R21) — página `/wallet`: la caja principal de Ordenex.
 * Server Component role-aware. El rol se resuelve SOLO server-side vía
 * `resolveActorFromSession` (patrón cierres-admin): cualquier rol distinto de `maestro`
 * (o sin sesión) NO ve la wallet (`notFound`, R19 — forbidden sin exponer datos). Los
 * datos sensibles (libro + cifras de la caja) se pre-obtienen server-side y se pasan YA
 * serializados (STRING) por props al módulo cliente (R21): el cliente nunca recibe
 * `Prisma.Decimal`. Si una action no responde `ok` → `notFound` (defensa en profundidad).
 *
 * Feature 173 (T G.3, R59/R64/R65) — el pre-fetch pasa a `verResumenCajaAction`, que entrega
 * las DOS cifras. El guardia de rol de esta página no se toca: sigue siendo el mismo, y sigue
 * siendo lo que impide que un rol sin acceso total vea ninguna de las dos (R65).
 */
export default async function WalletPage() {
  const actor = await resolveActorFromSession();
  // Feature 94 (paridad adm↔maestro): la wallet la ven los roles de ACCESO TOTAL
  // (`maestro`/`admin`); cualquier otro rol (o sin sesión) → notFound (R19).
  if (!actor || !esAccesoTotal(actor.rol)) {
    notFound(); // R19: rol no autorizado / sin sesión → sin exponer datos
  }

  // Pre-fetch server-side con los filtros por defecto (page 1, sin filtros). Feature 45:
  // además del libro + las cifras, se pre-obtienen el desglose de egresos administrativos y
  // las plantillas de gasto fijo (datos sensibles → props, nunca fetch cliente).
  const [
    movimientosResult,
    resumenResult,
    desgloseResult,
    plantillasResult,
    cobrosResult,
  ] = await Promise.all([
    listarMovimientosAction({}),
    verResumenCajaAction({}),
    verDesgloseEgresosAction({}),
    // Feature 170 — FASE 2 (T I.2, R40): PÁGINA 1 de las plantillas, no el conjunto entero.
    // El input va vacío: los defaults de `page`/`pageSize` los pone el schema del dominio.
    listarPlantillasPaginadoAction({}),
    // Ficha 333 (G3, R44): la COLA de cobros de gasto fijo por aprobar, pre-obtenida AQUÍ. Es
    // dato sensible —dinero por autorizar—, así que baja por props y no se pide desde el
    // navegador sin pasar por el guardia de esta página (docs/architecture.md). La ven los dos
    // roles de acceso total (R25); DECIDIRLA es otra cosa, y la decide el servicio (R24).
    listarCobrosPendientesAction({}),
  ]);

  // Defensa en profundidad: si algún service niega (forbidden/unauthenticated) o valida
  // mal, no renderizamos el módulo (no expone nada).
  if (
    movimientosResult.status !== "ok" ||
    resumenResult.status !== "ok" ||
    desgloseResult.status !== "ok" ||
    plantillasResult.status !== "ok" ||
    cobrosResult.status !== "ok"
  ) {
    notFound();
  }

  // Ficha 333 (G3, R40) — QUIÉN PUEDE DECIDIR, resuelto en el SERVIDOR y bajado por props.
  // Precedente literal: `puedeEliminar` en `app/(app)/ordenes/page.tsx`. Es la PRIMERA excepción
  // deliberada a la paridad `maestro`↔`admin` de la ficha 94: el admin VE la cola (por eso la
  // página no cambia su guardia) pero no la decide. Esto sólo esconde dos botones; lo que impide
  // la decisión es `puedeDecidirCobroGastoFijo` en el servicio (R24).
  const puedeDecidirCobros = actor.rol === RolValue.maestro;

  // Feature 85 (T F.4, R23): el instante del PRÓXIMO COBRO se resuelve AQUÍ, en el servidor, y
  // baja por props hasta la tabla de plantillas. La pantalla no puede leer el reloj del
  // navegador para esa columna: el panel se renderiza también en el servidor, así que un cambio
  // de día entre el render y la hidratación daría dos fechas distintas para la misma fila; y
  // además la fecha quedaría a merced del reloj de la máquina del usuario. Es el mismo criterio
  // con el que `wallet/mensajeros/page.tsx` resuelve la suya.
  const ahoraIso = new Date().toISOString();

  return (
    <AppPage
      title="Wallet"
      // R59: la descripción tampoco puede rotular ninguna cifra con la palabra que mentía.
      // Nombra las DOS que la pantalla enseña, con los mismos nombres que la tarjeta.
      description="Caja principal de Ordenex: libro de movimientos, dinero en caja y ganancia de Ordenex"
    >
      <WalletModule
        movimientos={movimientosResult.data.movimientos}
        total={movimientosResult.data.total}
        page={movimientosResult.data.page}
        pageSize={movimientosResult.data.pageSize}
        resumen={resumenResult.resumen}
        desglose={desgloseResult.desglose}
        composicion={resumenResult.composicion}
        plantillas={{
          items: plantillasResult.items,
          total: plantillasResult.total,
          pageSize: plantillasResult.pageSize,
        }}
        // Ficha 333 (G3, R41/R44): el recorte que se pinta y el `total` REAL del servidor, que
        // es el que enseña la insignia. Nunca `items.length`.
        cobrosPendientes={{ items: cobrosResult.items, total: cobrosResult.total }}
        puedeDecidirCobros={puedeDecidirCobros}
        ahoraIso={ahoraIso}
      />
    </AppPage>
  );
}
