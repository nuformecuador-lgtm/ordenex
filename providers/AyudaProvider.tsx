"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * ⭑ FICHA 433 — el mapa RUTA→DOCUMENTO que hace posible el botón «?» del `PageHeader`.
 *
 * POR QUÉ UN CONTEXTO Y NO UNA PROP. El «?» vive en `PageHeader`, que se monta desde
 * `AppPage` en las 29 pantallas del portal. Pasarle el mapa por props obligaría a tocar esos
 * 29 archivos y a que cada página futura se acordara de reenviarlo — o sea, a que la ayuda
 * contextual desapareciera en silencio en la primera pantalla que alguien olvidara. El
 * contexto lo pone UNA vez el layout del portal y vale para todas. Mismo patrón, y mismas
 * razones, que `TemaProvider`.
 *
 * ⚠️ EL MAPA LLEGA YA ACOTADO POR ROL. Lo calcula `app/(app)/layout.tsx`, que es quien
 * resuelve la sesión, con `mapaRutaDocumento(resúmenes, actor.rol)`. Lo que cruza al cliente
 * son SÓLO las rutas cuyo documento esta persona puede leer: un mensajero no recibe ni el
 * slug de la ayuda de Wallet. El acotamiento no es una decisión del botón.
 */

/** `{"/mis-asignaciones/reparto": "mensajero/reparto", …}`. Vacío = ningún «?» se monta. */
export type MapaAyuda = Readonly<Record<string, string>>;

const VACIO: MapaAyuda = {};

const Contexto = createContext<MapaAyuda | null>(null);

export function AyudaProvider({
  mapa,
  children,
}: Readonly<{ mapa: MapaAyuda; children: ReactNode }>) {
  return <Contexto.Provider value={mapa}>{children}</Contexto.Provider>;
}

/**
 * El mapa, o uno VACÍO si no hay proveedor.
 *
 * No lanza, a propósito y por el mismo motivo escrito en `useTema`: `PageHeader` es
 * presentación pura y se monta suelto en una veintena de archivos de test, así que exigir el
 * proveedor convertiría un detalle de presentación en un requisito de todos ellos. Y el
 * fallo es SEGURO en la dirección correcta: sin mapa no hay ruta con documento, así que no
 * se pinta ningún «?» — nunca uno que lleve a un vacío.
 */
export function useMapaAyuda(): MapaAyuda {
  return useContext(Contexto) ?? VACIO;
}
