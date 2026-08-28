"use client";

import { TabsGroup } from "@/components/shared/TabsGroup";

import {
  CuentasPorPagarTable,
  type CuentasPorPagarTableProps,
} from "./CuentasPorPagarTable";
import {
  PremiosRankingPanel,
  type PremiosRankingPanelProps,
} from "./PremiosRankingPanel";
import { PESTANAS_MENSAJEROS } from "./wallet-mensajeros-labels";

// FICHA 298 (2026-08-27, pedido del humano: «al meter ese nuevo apartado en mensajeros creó
// desorden, sepáralo por tabs por lo menos») — LAS DOS PESTAÑAS DE `/wallet/mensajeros`.
//
// Es DISPOSICIÓN y nada más: ninguna regla de negocio cambia, el registro del premio no se toca
// y cada bloque enseña por dentro exactamente lo que enseñaba. Lo único que cambia es que dejan
// de estar apilados uno encima del otro.
//
// **Molde: `NovedadesTabs` (236) y las dos pestañas de «Por recoger» (277).** Se reusa
// `TabsGroup`, que envuelve la primitiva `components/ui/tabs` (base-ui). Acá no se escribe un
// tabs propio ni se toca la primitiva.
//
// **CUÁL ABRE, y por qué.** La primera —«Cuentas por pagar»—, que es la que `TabsGroup`
// selecciona al no pedirle otra. A esta pantalla se entra a PAGAR lo que se debe; registrar el
// premio del podio es lo excepcional (un acto humano al día, y sólo si hubo podio). Abrir en
// premios pondría lo raro delante de lo de siempre.
//
// **LA PESTAÑA NO VIAJA EN LA URL, y es deliberado.** Los otros dos sitios del repo con pestañas
// tampoco lo hacen: `NovedadesTabs` no lo hace y `RecogerModule` lo dice por escrito («nadie
// enlaza una pestaña, y un `?tab=` obligaría a decidir qué pasa con un valor inválido»). Ser el
// único `?tab=` de la app sería inventar un contrato de URL para dos pestañas de una pantalla
// que ya está detrás de un rol de acceso total: quien comparte el enlace comparte
// `/wallet/mensajeros`, y ahí lo que hay que ver es lo que se debe.
//
// ⚠️ **`keepMounted` — ACÁ NO ES COMODIDAD, ES EL REFRESCO CRUZADO (293, design §9).**
//
// Registrar o anular un premio CAMBIA lo que se le debe a ese mensajero, y por eso
// `PremiosRankingPanel` refresca por prefijo cuatro claves de SWR: las suyas, las de
// `wallet-mensajeros:cuentas`, las del desglose y la previsualización del reparto. Ese refresco
// es un `mutate(filtro)` global: **le llega a quien esté SUSCRITO a la clave**. Si al meter
// pestañas la tabla se desmontara al pasar a premios, nadie estaría suscrito a
// `wallet-mensajeros:cuentas` en el momento de escribir, y volver a la pestaña la remontaría con
// su `fallbackData` — la página 1 que resolvió el Server Component ANTES del premio— y con su
// búsqueda y su página en blanco. Un saldo viejo justo después de registrar un premio es peor
// que el desorden que esta ficha viene a arreglar.
//
// No es una precaución teórica: MEDIDO el 2026-08-27 quitando este `keepMounted` y dejando todo
// lo demás igual, la lectura de `wallet-mensajeros:cuentas` se queda en UNA —no hay segunda— tras
// registrar el premio, y el caso «registrar un premio deja la cuenta por pagar de la OTRA pestaña
// al día» se pone rojo con `expected 1 to be greater than 1`.
//
// Con los dos paneles montados (el inactivo va `hidden` + `inert`, fuera del árbol de
// accesibilidad) el refresco sigue funcionando EXACTAMENTE igual que cuando los bloques estaban
// apilados, y además la tabla conserva su página y su búsqueda al ir y volver. Lo mide
// `tests/components/WalletMensajerosTabs.test.tsx`.

export interface WalletMensajerosTabsProps {
  /** Props de la tabla de cuentas por pagar, tal cual las resolvió el Server Component. */
  cuentas: CuentasPorPagarTableProps;
  /** Props del panel de premios del ranking (los dos días, resueltos en el servidor). */
  premios: PremiosRankingPanelProps;
}

export function WalletMensajerosTabs({
  cuentas,
  premios,
}: Readonly<WalletMensajerosTabsProps>) {
  return (
    <TabsGroup
      ariaLabel={PESTANAS_MENSAJEROS.grupo}
      keepMounted
      items={[
        {
          value: "cuentas",
          label: PESTANAS_MENSAJEROS.cuentas,
          content: <CuentasPorPagarTable {...cuentas} />,
        },
        {
          value: "premios",
          label: PESTANAS_MENSAJEROS.premios,
          content: <PremiosRankingPanel {...premios} />,
        },
      ]}
    />
  );
}
