// Feature 302 — QUIEN ES EL DUENO DE LAS ORDENES QUE CREA UNA API KEY.
//
// Hasta la 302 no habia nada que resolver: la respuesta era siempre `api_key.usuario_id`, la
// cuenta dedicada 1:1 de la key (88/[D4]). Desde la 302 una key puede apuntar a una TIENDA REAL
// (`api_key.tienda_destino_id`) y entonces el dueno es esa tienda: es lo que evita que generar
// una key para una tienda ya registrada cree una segunda cuenta con wallet, saldo y tarifas
// propias.
//
// POR QUE ESTO ES UNA FUNCION Y NO UN `??` REPETIDO: la regla se aplica en DOS sitios que no
// pueden discrepar —la autenticacion del canal (`ApiKeyAuthService`, de donde sale el `actor` que
// TODAS las superficies usan como dueno) y la proyeccion publica de la key (`ApiKeyRepository`,
// de donde sale el owner que la pantalla usa para colgar el webhook)—. Dos `??` escritos a mano
// pueden divergir en un refactor y la divergencia no rompe ningun tipo: seria un webhook colgado
// de una cuenta que no recibe ninguna orden, silencioso por definicion.
//
// Modulo PURO: sin Prisma, sin HTTP, sin Next. Se le pasan los dos ids y decide.

/**
 * El `usuario.id` a nombre del cual se registran (y por el cual se filtran) las ordenes del
 * canal por API key.
 *
 * @param usuarioDedicadoId `api_key.usuario_id` — la cuenta portadora de la credencial (rol
 *   `apiKey`). Es el dueno cuando la key no apunta a ninguna tienda.
 * @param tiendaDestinoId `api_key.tienda_destino_id` — la tienda real (rol `adminTienda`) elegida
 *   al generar la key, o `null` si no se eligio ninguna.
 */
export function resolverOwnerApiKey(
  usuarioDedicadoId: string,
  tiendaDestinoId: string | null | undefined,
): string {
  // Una cadena vacia NO es un id: se trata como "sin tienda destino" en vez de producir un owner
  // vacio que casaria con cero filas en unas consultas y con ninguna condicion en otras.
  if (typeof tiendaDestinoId === "string" && tiendaDestinoId.length > 0) return tiendaDestinoId;
  return usuarioDedicadoId;
}
