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
import { esMetricaPublicableApiKey } from "@/lib/analytics/publicacion-api-key";
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
 * Feature 267 (2026-08-23) — SE REVIERTE LA DECISION FIRMADA 122/R11-D9.
 *
 * Lo que decia esta constante hasta hoy, con estas palabras: «hoy solo la cuenta de
 * integracion `apiKey` (`db/schema.prisma:41`), denegada POR DISENO: si algun dia se
 * quiere reporting por API sera ficha propia con su puerta, no una excepcion colada por
 * aqui». Esta es esa ficha, y su puerta fue la aprobacion humana del spec 267 el
 * 2026-08-23. La 122 no se equivocaba: cerraba un canal que no tenia ni consumidor ni
 * contrato. Lo que cambio es el hecho externo (un integrador pide indicadores) y lo que
 * existe ahora (un canal por API key con contrato OpenAPI publicado y una cuenta
 * dedicada 1:1 por key). No se afloja una defensa: se abre una segunda puerta con la
 * MISMA cerradura.
 *
 * Por que el sujeto sigue acotado —y por que esto no es un agujero multi-tenant:
 *   - la cuenta es DEDICADA: `api_key.usuario_id` es `@unique` (81/88, D6/R21), asi que
 *     el integrador es otro `usuario` con su propio id;
 *   - el recorte se hace por `actor.usuarioId` contra `orden.tienda_id` (FK a `usuario`),
 *     exactamente igual que para un `adminTienda`. Como el id es propio, el integrador y
 *     un `adminTienda` NUNCA son el mismo sujeto: no comparten filas, ni `tiendaId`, ni
 *     entrada de cache;
 *   - lo que se publica esta acotado ademas por la lista blanca de ids
 *     (`publicacion-api-key.ts`), atada al catalogo por test (267/R17-R19, R34).
 *
 * Por que NO se creo una quinta variante de `AlcanceDatos` (267/R2): `claveDeAlcance`
 * (`cache-clave.ts:85`) es un `switch` EXHAUSTIVO sin `default`, y su cabecera avisa de
 * que una clave que no distingue el alcance «NO da una cifra equivocada: FILTRA DATOS
 * ENTRE ROLES». Una variante nueva obligaria a tocar esa funcion, `recortarFiltro`,
 * `alcance-columnas.ts` y su guardia, todo para expresar el MISMO recorte que
 * `tipo: "tienda"`. Dos formas de decir lo mismo en una frontera multi-tenant es una de
 * mas.
 *
 * PARTICION TERNARIA de los seis `RolValue`, y ninguno en dos listas (267/R4):
 *   `ROLES_ANALITICA` (5, en `types.ts`) + `ROLES_ANALITICA_INTEGRACION` + `ROLES_SIN_ANALITICA`.
 */
type SinRolesLectores<T extends readonly string[]> = {
  readonly [K in keyof T]: T[K] extends RolAnalitica ? never : T[K];
};

/**
 * 267/R5 — la RESTRICCION DE TIPO de las dos listas del complemento. No es decoracion:
 * escribir aqui un rol que SI es lector (`"maestro"`) no compila, asi que la disyuncion
 * con `ROLES_ANALITICA` la sostiene el compilador y no la disciplina. La disyuncion entre
 * estas dos listas entre si la sostiene el guardia (`alcance-fuente-unica.guardia.test.ts`),
 * porque el compilador no puede saber cual de las dos se escribio antes.
 */
function declararRolesNoLectores<T extends readonly string[]>(roles: T & SinRolesLectores<T>): T {
  return roles;
}

export const ROLES_ANALITICA_INTEGRACION = declararRolesNoLectores(["apiKey"] as const);

/**
 * Los `RolValue` del esquema a los que se les niega la analitica por ROL, en cualquier
 * canal. Hoy esta VACIA, y eso es deliberado (267/R5): la constante, su restriccion de
 * tipo y su consulta dentro de `resolverAlcance` se CONSERVAN para que el proximo rol
 * denegado tenga donde declararse sin volver a inventar el mecanismo. Mismo patron que
 * la 268 aplico a `ORIGENES_SIN_EVENTO_PUBLICO`.
 *
 * NO es una segunda tabla de alcance (R8 de la 122): no dice QUE ve nadie, solo quien no
 * entra. El guardia (`alcance-fuente-unica.guardia.test.ts`) exige que la union de las
 * TRES listas sea EXACTAMENTE los seis `RolValue` y que sean disjuntas dos a dos, de modo
 * que un rol nuevo en el esquema deje el guardia rojo en vez de caer en un limbo.
 */
export const ROLES_SIN_ANALITICA = declararRolesNoLectores([] as const);

/**
 * 267/R6 — POR QUE EXISTE EL PARAMETRO `canal`, y por que no bastaba conceder por rol.
 *
 * `resolverAlcance` es la MISMA funcion para el canal de sesion (cookie,
 * `lib/actions/analitica-operativa.ts:110`) y para el canal por API key. Si la concesion
 * dependiera solo del rol, un actor `apiKey` que llegase por sesion recibiria `ok`, y
 * R6 exige justo lo contrario. Podria argumentarse que hoy no existe flujo de login por
 * cookie para `rol: "apiKey"`, pero eso es una CIRCUNSTANCIA externa a `lib/analytics/`,
 * no un invariante: R6 pide que el resolutor sea la segunda capa que no depende de esa
 * promesa. Por eso el canal entra por parametro, con default `"interno"` que reproduce
 * byte a byte el comportamiento del unico llamador que existia (267/R43).
 */
export type CanalAnalitica = "interno" | "api_key";

/** Predicado de pertenencia a los roles de INTEGRACION (cuentas de maquina, sin UI). */
export function esRolAnaliticaIntegracion(rol: string): boolean {
  return (ROLES_ANALITICA_INTEGRACION as readonly string[]).includes(rol);
}

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
  canal: CanalAnalitica = "interno",
): ResolucionAlcance {
  // R10 — sin actor no hay nada que resolver. Se exige `usuarioId` util porque un actor
  // sin id no puede recortarse por tienda ni por mensajero: seria un alcance sin sujeto.
  if (actor === null || typeof actor !== "object") return denegado("sin_sesion");
  const { usuarioId, rol } = actor as { usuarioId?: unknown; rol?: unknown };
  if (!idUtil(usuarioId)) return denegado("sin_sesion");

  // R12 (forma) — un rol que ni siquiera es una cadena no puede compararse con nada.
  if (typeof rol !== "string") return denegado("rol_desconocido");

  // R11 de la 122 — el mecanismo de denegacion POR ROL se conserva aunque la lista este
  // hoy vacia (267/R5): el proximo rol denegado se declara ahi y no en una rama nueva.
  if ((ROLES_SIN_ANALITICA as readonly string[]).includes(rol)) {
    return denegado("rol_sin_analitica");
  }

  // 267/R1, R6 — LOS ROLES DE INTEGRACION. La guarda del canal va ANTES que la de la
  // metrica a proposito: conceder-por-metrica-primero dejaria una rendija por la que una
  // metrica publicable colaria por el canal de sesion. El orden es actor -> rol -> canal
  // -> metrica -> alcance, y no se invierte.
  if (esRolAnaliticaIntegracion(rol)) {
    if (canal !== "api_key") return denegado("rol_sin_analitica");
    // La metrica tiene que EXISTIR y estar publicada. Los dos motivos son internos y el
    // borde los traduce al MISMO 403 mudo, asi que desde fuera son indistinguibles (R16).
    if (typeof metricaId !== "string" || !getMetrica(metricaId)) {
      return denegado("metrica_desconocida");
    }
    if (!esMetricaPublicableApiKey(metricaId)) return denegado("metrica_prohibida");
    // R1 / 267/R2 — MISMA variante que el `adminTienda`, otro sujeto: el `usuarioId` de la
    // cuenta dedicada de la key, que es a quien apunta `orden.tienda_id` de sus ordenes.
    // `usuarioId` ya se comprobo util arriba (R11): no se duplica la guarda.
    return concedido({ tipo: "tienda", tiendaId: usuarioId });
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
