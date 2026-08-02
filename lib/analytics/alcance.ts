// Feature 122 (T2.1/T2.2) — RESOLUTOR DE ALCANCE POR ROL.
//
// Esto es una FRONTERA DE SEGURIDAD MULTI-TENANT, no un helper de presentacion. Sin
// policies RLS debajo (Prisma se conecta con credenciales de servicio, `design.md §6`
// alternativa 10), esta capa es la UNICA separacion entre inquilinos en analitica: un
// fallo aqui no da una cifra equivocada, filtra las ordenes de una tienda a otra.
//
// Por eso `resolverAlcance` es TOTAL y falla CERRADO:
//   - no lanza nunca, ni con entrada basura (R1);
//   - no tiene rama `default` que conceda alcance (R12);
//   - todo camino que no sepa decir QUE puede ver el actor devuelve `denegado`.
//
// R1 (modulo puro, heredado de la 135): sin `'use server'`, sin `next/headers`, sin
// `@/lib/db`, sin repositorios ni servicios, sin `process.env`, sin efectos al
// importarse. La UNICA dependencia de runtime fuera de `lib/analytics/` es
// `esAccesoTotal` (`lib/auth/acceso-total.ts`), que D7 de la 135 OBLIGA a reutilizar
// para no declarar una segunda lista de roles totales (R3). Esa reutilizacion arrastra
// `@prisma/client` como valor de forma TRANSITIVA, y por eso D8 amplio el guardia de
// pureza a la clausura de imports con una allowlist nominal de UNA arista
// (`tests/unit/analytics/modulo-puro.guardia.test.ts`, R35/R36).
//
// Lo que este modulo NO hace, a proposito:
//   - no lee la sesion (el actor entra por parametro, R30);
//   - no consulta la base (traduce a `where` en `alcance-columnas.ts`, R23);
//   - no registra nada en ningun log (R34); el rastro del denegado lo emite el BORDE
//     con `describirDenegado` (`auditoria.ts`, R40).

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { getMetrica } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* 1. Entrada: el actor, en forma ESTRUCTURAL (design.md §3.1)                 */
/* -------------------------------------------------------------------------- */

/**
 * Forma MINIMA que el resolutor necesita del actor autenticado.
 *
 * NO importa `Actor` de `lib/interfaces/services/IOrdenService.ts` a proposito: el
 * segmento `services` esta prohibido por el guardia de pureza. La compatibilidad se
 * fija con un test de asignabilidad (`actor.test.ts`, R30), de modo que un cambio de
 * forma en el `Actor` del repo rompe aqui en vez de pasar desapercibido.
 *
 * `rol` se tipa `string` y NO `RolValue`: si se tipara con el enum, TypeScript daria
 * por imposible el caso "rol desconocido" y R12 no tendria rama que probar. El rol
 * viene de la base a traves de una cookie; en una frontera de seguridad se VALIDA.
 */
export interface ActorAnalitica {
  readonly usuarioId: string;
  readonly rol: string;
  /** la columna `zona_id` de `usuario` es NULLABLE (`db/schema.prisma:98`): el `null` es real (R13). */
  readonly zonaId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* 2. Salida: estructura NEUTRAL, no `where` de Prisma (design.md §3.2)        */
/* -------------------------------------------------------------------------- */

/**
 * El recorte de FILAS que le toca al actor. Neutral respecto de la tabla: la
 * traduccion a columnas vive en `alcance-columnas.ts` (R23), porque una misma
 * resolucion sirve para `orden`, `gestion_orden` y el rollup.
 */
export type AlcanceDatos =
  | { readonly tipo: "global" }
  | { readonly tipo: "zona"; readonly zonaId: string }
  | { readonly tipo: "tienda"; readonly tiendaId: string }
  | { readonly tipo: "mensajero"; readonly mensajeroId: string };

/**
 * Dominio CERRADO de motivos. Un motivo es un literal, nunca un texto con datos:
 * R34 prohibe que un mensaje de denegacion lleve ids ajenos, PII o la sesion.
 */
export type MotivoDenegacion =
  | "sin_sesion"
  | "rol_desconocido"
  | "rol_sin_analitica"
  | "sin_zona_asignada"
  | "metrica_desconocida"
  | "metrica_prohibida"
  | "filtro_fuera_de_alcance";

export type ResolucionAlcance =
  | { readonly estado: "ok"; readonly alcance: AlcanceDatos }
  | { readonly estado: "denegado"; readonly motivo: MotivoDenegacion };

/* -------------------------------------------------------------------------- */
/* 3. Roles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * R11 / D9 — los `RolValue` del esquema que NO son lectores de analitica. Hoy solo la
 * cuenta de integracion `apiKey` (`db/schema.prisma:41`), denegada POR DISENO: si algun
 * dia se quiere reporting por API sera ficha propia con su puerta, no una excepcion
 * colada por aqui.
 *
 * NO es una segunda tabla de alcance (R8): no dice QUE ve nadie, solo quien no entra.
 * El guardia de R11 (`alcance-fuente-unica.guardia.test.ts`) exige que
 * `ROLES_ANALITICA ∪ ROLES_SIN_ANALITICA` sean EXACTAMENTE los seis `RolValue`, de modo
 * que un rol nuevo en el esquema deje el guardia rojo en vez de caer en un limbo.
 */
export const ROLES_SIN_ANALITICA = ["apiKey"] as const;

/** Predicado de pertenencia a los cinco roles lectores (`lib/analytics/types.ts`). */
export function esRolAnalitica(rol: string): rol is RolAnalitica {
  return (ROLES_ANALITICA as readonly string[]).includes(rol);
}

/**
 * R3 — el conjunto de roles con acceso TOTAL no se declara en analitica: se le pregunta
 * a `esAccesoTotal` (`lib/auth/acceso-total.ts`), fuente unica del repo que D7 de la 135
 * obliga a reutilizar. Se reexporta estrechado a `RolAnalitica` para que el guardia de
 * R3 compare el catalogo contra ESTA funcion y no contra una lista escrita a mano.
 */
export function rolTieneAccesoTotal(rol: RolAnalitica): boolean {
  return esAccesoTotal(rol);
}

/* -------------------------------------------------------------------------- */
/* 4. El resolutor (design.md §3.2)                                            */
/* -------------------------------------------------------------------------- */

function denegado(motivo: MotivoDenegacion): ResolucionAlcance {
  return { estado: "denegado", motivo };
}

function concedido(alcance: AlcanceDatos): ResolucionAlcance {
  return { estado: "ok", alcance };
}

/** Un id util es una cadena no vacia. `null`, `""` y cualquier otra cosa NO lo son. */
function idUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

/**
 * Resuelve QUE FILAS puede ver `actor` de la metrica `metricaId`.
 *
 * Orden de las guardas (R10 → R11 → R12 → R14 → R9 → R13): primero se decide si hay
 * actor, luego si su rol es siquiera lector de analitica, luego si la metrica existe y
 * solo al final que ve de ella. No se invierte: preguntar por la metrica antes que por
 * el rol convertiria el resolutor en un oraculo del catalogo para cualquiera.
 *
 * TOTAL: no lanza con `null`, `undefined`, `{}`, un rol numerico ni un `metricaId` que
 * no sea cadena (R1). La firma acepta `unknown` en el actor porque la sesion cruza una
 * frontera de confianza y en una frontera no se asume la forma, se comprueba.
 */
export function resolverAlcance(
  actor: ActorAnalitica | null | undefined,
  metricaId: string,
): ResolucionAlcance {
  // R10 — sin actor no hay nada que resolver. Se exige `usuarioId` util porque un actor
  // sin id no puede recortarse por tienda ni por mensajero: seria un alcance sin sujeto.
  if (actor === null || typeof actor !== "object") return denegado("sin_sesion");
  const { usuarioId, rol } = actor as { usuarioId?: unknown; rol?: unknown };
  if (!idUtil(usuarioId)) return denegado("sin_sesion");

  // R12 (forma) — un rol que ni siquiera es una cadena no puede compararse con nada.
  if (typeof rol !== "string") return denegado("rol_desconocido");

  // R11 / D9 — `apiKey` NUNCA consume analitica.
  if ((ROLES_SIN_ANALITICA as readonly string[]).includes(rol)) {
    return denegado("rol_sin_analitica");
  }

  // R12 — cualquier otra cosa (un rol inventado, el label `"Admin Tienda"` de la DB, un
  // rol futuro que nadie mapeo) se deniega. NO hay rama `default` que conceda.
  if (!esRolAnalitica(rol)) return denegado("rol_desconocido");

  // R14 — el catalogo es la fuente unica: lo que no esta en el no existe.
  if (typeof metricaId !== "string") return denegado("metrica_desconocida");
  const metrica = getMetrica(metricaId);
  if (!metrica) return denegado("metrica_desconocida");

  // R8 — la regla por rol sale EXCLUSIVAMENTE de `metrica.alcance`
  // (`lib/analytics/metrics.ts`). Este modulo no mantiene una segunda tabla.
  switch (metrica.alcance[rol]) {
    // R9 / R29 — prohibido es prohibido: ni recortado, ni agregado, ni en cero.
    case "prohibido":
      return denegado("metrica_prohibida");
    // R2 — sin recorte de filas.
    case "total":
      return concedido({ tipo: "global" });
    case "acotado":
      return alcanceAcotado(rol, actor);
  }
}

/**
 * Recorte por rol. `switch` EXHAUSTIVO sobre los cinco roles de analitica: TypeScript
 * obliga a cubrirlos todos y no hay `default`, asi que un sexto rol lector no compila
 * en vez de colarse por una rama permisiva.
 */
function alcanceAcotado(rol: RolAnalitica, actor: ActorAnalitica): ResolucionAlcance {
  switch (rol) {
    // R4 / R27 / D9 — la zona del actor, expresada SIEMPRE sobre `orden.zona_id`, jamas
    // sobre la `zona_id` DEL USUARIO mensajero que gestiono la fila.
    case "adminSatelite": {
      // R13 / D2 — la `zona_id` de la fila de `usuario` es nullable y `resolveActorFromSession` lo normaliza
      // a `null`: un `adminSatelite` sin zona es representable. NO se degrada a global,
      // ni a "todas las zonas", ni a `ok` con cero filas. El borde lo traduce a 403 para
      // que un fallo de configuracion se vea como fallo y no como tablero vacio.
      if (!idUtil(actor.zonaId)) return denegado("sin_zona_asignada");
      return concedido({ tipo: "zona", zonaId: actor.zonaId });
    }
    // R6 / R26 — en este esquema el `adminTienda` ES la tienda: `orden.tienda_id` es FK a
    // `usuario` (`db/schema.prisma:468,505`), el mismo criterio que ya usan
    // `lib/notificaciones/emitir.ts:110` y `OrdenService.crear`.
    case "adminTienda":
      return concedido({ tipo: "tienda", tiendaId: actor.usuarioId });
    // R7 / R28 / D3 — "propio" del mensajero es `orden.mensajero_asignado_id`, siempre y
    // para TODA metrica, sin excepcion por `unidadDeConteo`. Consecuencia asumida y
    // probada (`aislamiento.guardia.test.ts` > "orden reasignada de A a B").
    case "mensajero":
      return concedido({ tipo: "mensajero", mensajeroId: actor.usuarioId });
    // Rama INALCANZABLE con el catalogo vigente y verificada como tal: R3 exige que
    // `{rol : alcance[rol]==="total"}` sea exactamente `{rol : esAccesoTotal(rol)}`, y su
    // guardia lo comprueba para las 23 metricas. Si aun asi llegara una metrica `acotado`
    // para un rol de acceso total, no hay dimension por la que recortarlo: se FALLA
    // CERRADO en vez de conceder global "porque total es mas que acotado".
    case "maestro":
    case "admin":
      return denegado("metrica_prohibida");
  }
}
