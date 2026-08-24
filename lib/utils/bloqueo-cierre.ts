// Feature 271 (§2.1, R1-R12) — LA REGLA DEL BLOQUEO POR CIERRES, dictada por el humano el
// 2026-08-23, escrita UNA sola vez y leida por el servidor y por la pantalla.
//
//   Con N = cierres del mensajero SIN APROBAR (`solicitado` + `vencido` + `rechazado`)
//   y  V = cuantos de esos N son RE-SOLICITABLES (`vencido` o `rechazado`):
//
//        LIBRE si N <= 1 Y V = 0.  En cualquier otro caso, BLOQUEADO.
//
// Y BLOQUEADO ALCANZA TODO: ni gestionar, ni cobrar, ni RECIBIR TRABAJO NUEVO —sea reparto o
// recoleccion—. Un solo predicado, todas las superficies, sin excepciones (Q1 resuelta por el
// humano el 2026-08-23).
//
// ⚠️ ESTO REVIERTE EN PARTE LA REGLA FIRMADA EL 2026-08-20 (feature 241), cuya regla 2 declaraba
// la asignacion EXENTA de todo bloqueo. Lo que SOBREVIVE de aquella regla: un cierre `solicitado` a
// secas NO bloquea (el mensajero ya hizo lo suyo y espera al admin; mediana 8,2 h, p90 22,1 h
// medidas contra produccion). Lo que se REVIERTE: acumular DOS cierres, o tener uno re-solicitable,
// bloquea TAMBIEN recibir trabajo nuevo, reparto Y recoleccion.
//
// Helper PURO —sin Prisma, sin borde—, patron `lib/utils/colas-cierre.ts`: la regla se afirma en
// tests de tabla (las 7 filas de la tabla de verdad de `requirements.md`) sin base de datos, y la
// consultan las dos capas sin que la segunda tenga que re-derivarla (R10).

import type { CierreEstado } from "@/lib/types/cierre";

/**
 * Los TRES estados de un cierre que cuentan para N. `aprobado` es el UNICO terminal (dinero
 * conciliado). `rechazado` dejo de ser terminal en la feature 109: sigue abierto y es
 * RE-SOLICITABLE, igual que `vencido`.
 */
export const CIERRE_ESTADOS_ABIERTOS = [
  "solicitado",
  "vencido",
  "rechazado",
] as const satisfies readonly CierreEstado[];

/**
 * Los que suman a V: el mensajero puede volver a enviarlos a aprobacion POR SU CUENTA, asi que la
 * pelota esta en SU tejado. Confirmado por el humano el 2026-08-23 (S1): `rechazado` cuenta igual
 * que `vencido`.
 */
export const CIERRE_ESTADOS_RESOLICITABLES = [
  "vencido",
  "rechazado",
] as const satisfies readonly CierreEstado[];

/** `true` si ese estado cuenta para N (cierre ABIERTO del mensajero). */
export function esCierreAbierto(estado: CierreEstado): boolean {
  return (CIERRE_ESTADOS_ABIERTOS as readonly CierreEstado[]).includes(estado);
}

/** `true` si ese estado suma a V (el mensajero puede re-solicitarlo por su cuenta). */
export function esCierreResolicitable(estado: CierreEstado): boolean {
  return (CIERRE_ESTADOS_RESOLICITABLES as readonly CierreEstado[]).includes(estado);
}

export interface ConteoCierresAbiertos {
  /** N — cierres del mensajero sin aprobar. */
  n: number;
  /** V — cuantos de esos N son RE-SOLICITABLES (`vencido` o `rechazado`). Subconjunto de N. */
  v: number;
}

/** El conteo de un mensajero que no tiene ninguna fila de `cierre_dia` abierta. */
export const SIN_CIERRES_ABIERTOS: ConteoCierresAbiertos = { n: 0, v: 0 };

/**
 * LA REGLA (feature 271, dictada el 2026-08-23): LIBRE si `N <= 1` y `V = 0`.
 *
 * N y V son DOS numeros, no uno, y por eso no vale un tope a secas (`n > 1`): con `N=1, V=1`
 * —el mensajero dejo vencer su unico cierre— el tope diria «libre» y el humano dicto «bloqueado
 * AL INSTANTE» (R7). Ver §12/A3 del diseño.
 */
export function estaBloqueadoPorCierres(c: ConteoCierresAbiertos): boolean {
  return c.n >= 2 || c.v >= 1;
}

/**
 * §2.4 — EL DETALLE DEL BLOQUEO DE UN MENSAJERO. Alimenta a la vez el aviso de la campana, el
 * motivo del `conflict` del servidor y lo que pinta la pantalla: una sola forma para las tres, para
 * que no puedan decir cosas distintas (R43).
 *
 * Vive en este modulo PURO —y no junto al repositorio— porque lo importan el formateador de textos
 * (`lib/constants/bloqueo-mensajero.ts`, que la UI consume) y la interfaz del repositorio. Si
 * viviera en la interfaz, un componente tendria que importar la capa de datos para leer un texto.
 */
export interface BloqueoDetalle {
  /** El veredicto de `estaBloqueadoPorCierres` sobre este mensajero. */
  bloqueado: boolean;
  /** N — cierres abiertos. */
  cierresAbiertos: number;
  /** V — los que el mensajero puede reenviar por su cuenta. */
  cierresPorReenviar: number;
  /** El cierre MAS VIEJO (R11), o `null` si `N = 0`. */
  aResolverPrimero: CierreAResolver | null;
  /**
   * El cierre RE-SOLICITABLE (`vencido` o `rechazado`) MAS VIEJO, o `null` si `V = 0`.
   *
   * POR QUE NO BASTA `aResolverPrimero`, con el caso delante. Es el CASO 6 de la tabla de verdad
   * —«solicito el primero y dejo vencer el segundo», `N=2, V=1`—, que el humano dicto el
   * 2026-08-23. Ahi el abierto mas viejo es el `solicitado`, y ese lo resuelve LA BODEGA: derivar
   * de el lo que el mensajero puede hacer le dice «espera a la administracion» y le esconde el
   * boton de reenviar el otro, AUNQUE `solicitarCierre` si se lo permite (R16/R18). El dato de
   * «que debe hacer para solucionar su bloqueo» es ESTE campo, no aquel.
   *
   * ES OTRA PREGUNTA, y por eso es otro campo y no un `aResolverPrimero` mas listo:
   *   · `aResolverPrimero` responde QUE SE RESUELVE PRIMERO (el orden de la cola, R11).
   *   · `aReenviarPrimero` responde QUE PUEDE TOCAR EL, y cual de los suyos toca antes.
   * Fundirlas mentiria en el caso 6 por un lado o por el otro.
   *
   * ES EL MAS VIEJO **DE LOS RE-SOLICITABLES** (R18), no el mas nuevo: el humano fijo que se
   * resuelve siempre del mas viejo al mas nuevo, y ademas ES EL QUE `solicitarCierre` MUEVE de
   * verdad (`CierreDiaRepository.findCierreResolicitableMasViejo`, mismo `ORDER BY`). Nombrar uno
   * y mover otro seria el aviso desincronizado que la 271 viene a cerrar.
   *
   * CUANDO EL MAS VIEJO YA ES RE-SOLICITABLE (casos 5 y 7), los dos campos apuntan AL MISMO cierre.
   * No es redundancia accidental: es lo que permite que la pantalla lea SIEMPRE este campo para el
   * boton, sin ramificar por caso.
   *
   * Su `resuelve` es SIEMPRE `"mensajero"` por construccion —re-solicitable implica que la pelota
   * es suya (`quienResuelve`)—, y eso se afirma en test.
   */
  aReenviarPrimero: CierreAResolver | null;
}

export interface CierreAResolver {
  cierreId: string;
  estado: CierreEstado;
  /**
   * `solicitado_at` en ISO-8601. STRING y no `Date` a proposito: este objeto cruza la frontera
   * RSC hasta un componente cliente, y en este repo los DTO no llevan `Date` por esa razon.
   */
  solicitadoAt: string;
  /**
   * La JORNADA que ese cierre cierra, en fecha de Costa Rica (`YYYY-MM-DD`), derivada por
   * `lib/utils/jornada-cierre.ts` (R57-R61). NO es `solicitadoAt` ni `createdAt`: para un
   * `vencido` van UN DIA POR DELANTE. `null` = no hay jornada fiable -> el texto OMITE la fecha
   * (R60), nunca inventa una.
   */
  jornadaCR: string | null;
  /** Quien tiene la pelota: el mensajero si es re-solicitable, la administracion si es `solicitado`. */
  resuelve: "mensajero" | "administracion";
}

/** Quien resuelve ESE cierre: el mensajero si puede reenviarlo, la administracion si no. */
export function quienResuelve(estado: CierreEstado): "mensajero" | "administracion" {
  return esCierreResolicitable(estado) ? "mensajero" : "administracion";
}

/** El detalle de un mensajero sin ningun cierre abierto. Libre, y nada que resolver. */
export const SIN_BLOQUEO: BloqueoDetalle = {
  bloqueado: false,
  cierresAbiertos: 0,
  cierresPorReenviar: 0,
  aResolverPrimero: null,
  aReenviarPrimero: null,
};
