// El contrato del refresco forzado de la analítica (pedido humano 2026-08-19).
//
// Vive fuera de `lib/actions/analitica-refrescar.ts` porque aquel archivo es `"use server"`, y
// un módulo de Server Actions sólo puede exportar funciones `async`: un `interface` o un `type`
// exportado ahí no compila. El componente cliente necesita el tipo, así que el tipo vive aquí.

/**
 * Lo que responde `refrescarCacheAnalitica`.
 *
 * `lastSyncAt` es el instante de la INVALIDACIÓN, no el de una lectura: cuando llega, las
 * cifras aún no se han recomputado —eso pasa cuando cada panel vuelve a pedir la suya y falla
 * en cache—. Es el sello que la pantalla puede pintar mientras tanto, y en la práctica queda a
 * unas décimas del `lastSync` que sellarán los DTO.
 */
export type RefrescoAnaliticaResult =
  | { readonly status: "ok"; readonly lastSyncAt: string }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" };
