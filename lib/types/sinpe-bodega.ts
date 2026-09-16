import { z } from "zod";

import { sinpeNombreSchema, sinpeNumeroSchema } from "@/lib/utils/sinpe-cr";

/**
 * ⭑ FICHA 429 — LOS CONTRATOS DE LA SUPERFICIE NUEVA: dos campos por bodega, y nada mas.
 *
 * ⚠️ ARCHIVO PROPIO Y NO `lib/types/zona.ts`. Aquel describe el CRUD de zonas, que es
 * `maestro`-only de arriba abajo y cuyo `actualizarZona` es un REEMPLAZO COMPLETO que arrastra
 * distritos, tarifas del mensajero y la marca de zona central. Esta ficha abre UNA superficie
 * nueva y estrecha —dos campos— con OTRO modelo de permisos (`maestro`, `admin` y el
 * `adminSatelite` de ESA bodega). Mezclarlas invita a que la siguiente edicion ensanche la
 * equivocada: bastaria un `adminSatelite` colado en el gate de `actualizarZona` para darle la
 * reescritura de `tarifa_zona_mensajero` de su zona.
 */

/** Lo que la pantalla ve de una bodega. `editable` lo decide el SERVIDOR, nunca la pantalla. */
export interface SinpeBodegaDTO {
  zonaId: string;
  zonaNombre: string;
  esCentral: boolean;
  numero: string;
  nombre: string;
  /**
   * ISO-8601, o `null` = NADIE lo ha mirado dentro de la aplicacion. R5: la ausencia de revision
   * no puede confundirse con una revision, asi que viaja como `null` y no como una fecha inventada.
   */
  revisadoAt: string | null;
  /**
   * `true` = ESTE actor puede guardar ESTA bodega. Se decide en el servidor con la zona que la
   * base le asigna a esa persona (R20): un `editable` calculado en el navegador seria un permiso
   * viajando por el cliente.
   */
  editable: boolean;
}

/**
 * EL BORDE. `.strict()` — un campo desconocido es `validation_error`, no un descarte mudo: en una
 * superficie de dinero, «te ignoré un campo» es la forma educada de perder un dato.
 *
 * Los dos esquemas salen de `lib/utils/sinpe-cr.ts`, que es la MISMA fuente que usa el `CHECK` de
 * Postgres por escrito. El numero se NORMALIZA aqui (R9): lo que llega con espacios, guiones o
 * `+506` se guarda como los ocho digitos.
 */
export const guardarSinpeBodegaSchema = z
  .object({
    numero: sinpeNumeroSchema,
    nombre: sinpeNombreSchema,
  })
  .strict();

export type GuardarSinpeBodegaInput = z.infer<typeof guardarSinpeBodegaSchema>;

/** Los desenlaces de error, calcados de `ZonaActionError` menos el `conflict`, que aqui no existe. */
export type SinpeBodegaActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarSinpeBodegasResult =
  | { status: "ok"; items: SinpeBodegaDTO[] }
  | SinpeBodegaActionError;

export type GuardarSinpeBodegaResult =
  | { status: "ok"; bodega: SinpeBodegaDTO }
  | SinpeBodegaActionError;

export type ConfirmarSinpeBodegaResult = { status: "ok" } | SinpeBodegaActionError;

/**
 * ⭑ R19 — QUIEN PUEDE EDITAR EL SINPE DE UNA BODEGA.
 *
 * UNA sola constante, y la consumen el servicio, el gate de la pantalla y (cuando llegue) el item
 * de menu. El precedente es la ficha 335: dos listas de roles escritas a mano divergen sin que
 * nada se ponga rojo, y entonces hay un menu que ofrece una pantalla que devuelve 403 — o peor, al
 * reves.
 *
 * `admin` esta EN LAS OCHO y no solo en la central (Q2, cerrada por el leader el 2026-09-15). El
 * motivo: `admin` no esta acotado por zona en ningun otro sitio del repo —quien lo esta es
 * `adminSatelite`—, y acotarlo solo aqui seria la primera excepcion de ese patron. Y el hueco que
 * se abriria es el de siempre: con el `adminSatelite` de una bodega de baja y su numero mal, la
 * correccion volveria a depender del `maestro`, que es la dependencia que esta ficha viene a quitar.
 * La rendicion de cuentas no se pierde: cada cambio deja fila con actor congelado.
 */
export const ROLES_QUE_EDITAN_SINPE = ["maestro", "admin", "adminSatelite"] as const;

export type RolQueEditaSinpe = (typeof ROLES_QUE_EDITAN_SINPE)[number];

/** `true` si el rol puede editar ALGUNA bodega. No dice cual: eso lo decide el servicio. */
export function puedeEditarAlgunSinpe(rol: string): rol is RolQueEditaSinpe {
  return (ROLES_QUE_EDITAN_SINPE as readonly string[]).includes(rol);
}
