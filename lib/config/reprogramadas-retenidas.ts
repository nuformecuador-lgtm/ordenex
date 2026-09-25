import type { RolValue } from "@prisma/client";

// FICHA 462 (design DD/DG, decision del leader del 2026-09-25) — LO QUE EL HUMANO PUEDE AJUSTAR DEL
// AVISO «REPROGRAMADAS DE HOY QUE ESPERAN LA APROBACION DE UN CIERRE», EN UN SOLO SITIO.
//
// Dos perillas, y solo dos:
//   · A QUE HORA de Costa Rica se emite el aviso (campana + push). Hoy 07:00 CR: «a primera hora»,
//     antes de que la oficina empiece a asignar, y NO a medianoche —el corte nocturno y el reloj de
//     liberacion corren en el mismo minuto y los cierres `vencido` que el corte crea podrian no
//     existir aun (design DD, alternativa B descartada)—.
//   · QUE ROLES reciben el PUSH. Hoy `admin` y `adminSatelite`, siguiendo la tabla aprobada para los
//     dos avisos hermanos sobre cierres (`cierre_dia_por_aprobar`, `devoluciones_represadas`: «para
//     admin y bodega satelite»). El `maestro` lo ve en su campana y no se le interrumpe.
//
// MODULO PURO: sin Prisma en runtime (solo el `type` del enum de roles), sin React, sin `next/*`,
// sin reloj y sin DB. Lo importan `push-elegibles.ts` (puro) y los tests.
//
// ⚠️ LA HORA NO ES UN RELOJ QUE ESTE MODULO CONSULTE: la emision la dispara el cron `avisos-diarios`
// (`vercel.json`), y `vercel.json` va en UTC. Costa Rica es UTC-6 FIJO, sin horario de verano, asi
// que 07:00 CR = 13:00 UTC = `0 13 * * *`. Esta constante es LA FUENTE y el cron es su COPIA: un
// test (`tests/unit/notificaciones/reprogramadas-retenidas-config.test.ts`) deriva la expresion cron
// de aqui y la compara con la de `vercel.json`, asi que cambiar la hora aqui SIN mover el cron pone
// la suite roja en vez de dejar un aviso que dice «07:00» y sale a otra hora. Cambiar la hora del
// cron mueve TAMBIEN los otros dos avisos agregados que comparten corrida (novedades, represadas):
// esta declarado, y es una decision que se toma con los tres delante.

export interface ReprogramadasRetenidasConfig {
  /**
   * Hora de PARED de Costa Rica a la que sale el aviso, en 24 h. `{ hora: 7, minuto: 0 }` = 07:00 CR.
   * Ver la nota de la cabecera: el cron de `vercel.json` tiene que decir lo mismo, en UTC.
   */
  readonly HORA_EMISION_CR: { readonly hora: number; readonly minuto: number };
  /**
   * Roles cuya fila del aviso MERECE push (R21). Lista de INCLUSION: lo que no esta aqui no se
   * empuja. Quien no haya activado «Avisarme en este dispositivo» no recibe nada igualmente: eso lo
   * decide el canal de la 410, no esta lista.
   */
  readonly ROLES_PUSH: readonly RolValue[];
}

export const reprogramadasRetenidasConfig: ReprogramadasRetenidasConfig = {
  HORA_EMISION_CR: { hora: 7, minuto: 0 },
  ROLES_PUSH: ["admin", "adminSatelite"],
};

/** Costa Rica es UTC-6 fijo (sin horario de verano). */
const DESFASE_CR_HORAS = 6;

/**
 * La expresion cron (UTC, la que entiende `vercel.json`) que corresponde a una hora de pared de
 * Costa Rica. Helper PURO, sin reloj. `{ hora: 7, minuto: 0 }` -> `"0 13 * * *"`.
 *
 * Existe para que el test que ata `HORA_EMISION_CR` a `vercel.json` no repita la aritmetica a mano
 * — y para que quien mueva la hora tenga la conversion delante en vez de calcularla de memoria (el
 * route handler del cron ya documenta que `0 7 * * *` pondria el aviso a la 1:00 de la madrugada CR).
 */
export function cronUtcDeHoraCR(hora: { hora: number; minuto: number }): string {
  const horaUtc = (hora.hora + DESFASE_CR_HORAS) % 24;
  return `${hora.minuto} ${horaUtc} * * *`;
}
