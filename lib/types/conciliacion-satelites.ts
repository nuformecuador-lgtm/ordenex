import { z } from "zod";

import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import { montoPositivoSchema } from "@/lib/types/wallet";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 — LA CONCILIACION DE LAS CONSOLIDACIONES DE BODEGA: DTOs Y BORDE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// MODULO PURO: no importa Prisma en runtime, ni React, ni `lib/services`. Lo consumen el borde
// (zod), el servicio, el repositorio y —cuando llegue— la pantalla.
//
// MONEY-SAFE, Y SIN EXCEPCIONES: todo importe cruza como STRING de escala 2 en las DOS
// direcciones. Ningun `number` de dinero, ningun `Prisma.Decimal` fuera del repositorio, y ninguna
// resta en la pantalla (R20): `saldoSinConciliar` y `faltaPorRecibir` llegan YA CUADRADOS.
//
// ⚠️ EL SALDO MIDE EFECTIVO, NO `total_general`. Es la decision del humano sobre Q2 (2026-09-16) y
// va CONTRA el diseño original, asi que se escribe donde vive el contrato. Medido en produccion el
// 2026-09-15 sobre las 32 consolidaciones existentes:
//
//     total_general        ₡ 4.196.897   100 %
//     total_efectivo       ₡ 3.091.107    73,7 %   <- lo que VIAJA en el bulto
//     total_simpe          ₡ 1.105.790    26,3 %   <- entra directo a una cuenta
//     total_transferencia  ₡         0     0 %
//
// Una cuarta parte del consolidado NO viaja en el bulto: el SINPE llega a una cuenta. Con el saldo
// derivado de `total_general`, la pantalla ensenaria ₡1,1 M de deuda fantasma que nadie va a
// entregar en mano jamas. `total_general` se sigue mostrando como CONTEXTO —es lo que la bodega
// recaudo— pero no es lo que esta pendiente de llegar.
//
// ⚠️ LIMITE DECLARADO, y NO lo resuelve esta ficha: cuando la 429 se despliegue y cada bodega ponga
// su propio SINPE, el SINPE que recaude una satelite dejara de llegar a la central —entrara a la
// cuenta de la bodega—. Eso crea un pendiente nuevo que este diseño no cubre, porque ni viaja en el
// bulto ni esta en `total_efectivo`. Si el negocio lo quiere conciliar tambien, es otra ficha.

/**
 * Una bodega satelite en la tabla de saldos (R17/R21/R23).
 *
 * `diasDeLaMasAntigua` es `null` cuando no queda ninguna consolidacion sin conciliar: `null` es
 * «no hay cola», que NO es lo mismo que `0` («la mas vieja es de hoy»). Confundirlos ensenaria
 * «0 dias» en una bodega que no debe nada.
 */
export interface SaldoSateliteDTO {
  zonaId: string;
  zonaNombre: string;
  /** R17/R18 — Σ(`total_efectivo` − COALESCE(`monto_recibido`, 0)) sobre las no rechazadas. */
  saldoSinConciliar: string;
  /** Σ `total_efectivo`: la base del saldo, para que la resta sea auditable desde la pantalla. */
  totalEfectivo: string;
  /** Σ `total_general`: CONTEXTO (lo que la bodega recaudo), NO lo pendiente. Ver la cabecera. */
  totalConsolidado: string;
  /** Σ `monto_recibido` (los NULL no suman, que es justo lo que la formula quiere). */
  totalRecibido: string;
  /** R21 — cuantas consolidaciones siguen sin conciliar. */
  consolidacionesSinConciliar: number;
  /** R21 — dias naturales (calendario CR) de la mas antigua sin conciliar. `null` si no hay. */
  diasDeLaMasAntigua: number | null;
  /** ISO del `solicitado_at` de esa mas antigua. `null` si no hay ninguna pendiente. */
  fechaDeLaMasAntigua: string | null;
}

/**
 * Una consolidacion en el desglose de su bodega (R22/R24).
 *
 * `conciliado` es `conciliadoAt !== null` ya derivado: la pantalla NO decide el estado comparando
 * campos. El vocabulario aprobado lo pone la capa de presentacion (R28): sin conciliar →
 * «Pendiente de conciliar»; conciliada y sin diferencia → «Recibido»; conciliada con
 * `faltaPorRecibir` distinto de cero → «Recibido incompleto».
 */
export interface ConsolidacionSateliteDTO {
  cierreBodegaId: string;
  /** ISO. Es la fecha por la que se mide la antiguedad de R21. */
  solicitadoAt: string;
  /** R22 — la composicion del total, para que se vea que parte viaja en el bulto. */
  totales: {
    efectivo: string;
    simpe: string;
    transferencia: string;
    general: string;
  };
  /** `null` = sin conciliar. NUNCA `"0.00"` por ausencia: cero recibido es otra cosa. */
  montoRecibido: string | null;
  /**
   * R17/R20 — `total_efectivo` − COALESCE(`monto_recibido`, 0), DERIVADO EN EL SERVIDOR.
   *
   * ⚠️ SOBRE EL EFECTIVO Y NO SOBRE `general`: es el sumando exacto del saldo de su bodega, asi que
   * la suma de esta columna ES `saldoSinConciliar`. Con `general` aqui y efectivo alla, las dos
   * cifras de la misma pantalla no cuadrarian y nadie sabria cual creer.
   *
   * Puede ser NEGATIVO (llego de mas). No se recorta a cero: mismo criterio con el que la ficha 393
   * decidio ensenar «Para la central» en negativo en vez de maquillarlo.
   */
  faltaPorRecibir: string;
  /** Derivado de `conciliadoAt !== null`. */
  conciliado: boolean;
  conciliadoAt: string | null;
  conciliadoPorNombre: string | null;
  /** Texto libre corto. No baja a las descargas ni entra al historial (R5 de la 362). */
  nota: string | null;
  /** Cuantos `cierre_dia` componen esta consolidacion. */
  cantidadCierres: number;
}

// ── Schemas zod de borde ──

/**
 * R23 — la tabla de saldos. Sin filtros: el conjunto es «todas las bodegas satelite» y en
 * produccion son CINCO. `.strict()` mata cualquier clave colada.
 */
export const listarSaldosSatelitesSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(cierreBodegaConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, cierreBodegaConfig.MAX_PAGE_SIZE)),
  })
  .strict();

export type ListarSaldosSatelitesInput = z.infer<typeof listarSaldosSatelitesSchema>;

/**
 * R29 — el mismo conjunto SIN paginar, para la descarga. DERIVADO del de su pagina quitando
 * `page`/`pageSize`, no reescrito: dos declaraciones del mismo alcance divergen a la primera
 * correccion.
 */
export const listarSaldosSatelitesCompletoSchema = listarSaldosSatelitesSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarSaldosSatelitesCompletoInput = z.infer<
  typeof listarSaldosSatelitesCompletoSchema
>;

/** R24 — el desglose de UNA bodega. `zonaId` es obligatorio: sin el no hay desglose que pedir. */
export const listarConsolidacionesSateliteSchema = z
  .object({
    zonaId: z.string().uuid(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(cierreBodegaConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, cierreBodegaConfig.MAX_PAGE_SIZE)),
    /** Recorta a la cola de lo pendiente. Ausente = las dos poblaciones. */
    soloSinConciliar: z.coerce.boolean().optional(),
  })
  .strict();

export type ListarConsolidacionesSateliteInput = z.infer<
  typeof listarConsolidacionesSateliteSchema
>;

export const listarConsolidacionesSateliteCompletoSchema = listarConsolidacionesSateliteSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarConsolidacionesSateliteCompletoInput = z.infer<
  typeof listarConsolidacionesSateliteCompletoSchema
>;

/**
 * R9/R10 — MARCAR RECIBIDA.
 *
 * ⚠️ `montoPositivoSchema` TAL CUAL, que exige **> 0**, y la pieza NO se reescribe relajada aqui.
 * Marcar «recibi ₡0» no es una marca: es no marcar, y para eso ya esta no hacer nada. Reescribir la
 * definicion de «cuanto dinero es valido» en este archivo seria la segunda declaracion que un dia
 * diverge (leccion de la ficha 381). Si el humano quiere admitir `0`, se cambia la pieza
 * compartida y se enteran sus otros seis consumidores, que es el punto.
 *
 * La `nota` es opcional y se recorta: cero caracteres no es una nota, es ausencia.
 */
export const marcarConsolidacionRecibidaSchema = z
  .object({
    cierreBodegaId: z.string().uuid(),
    montoRecibido: montoPositivoSchema, // STRING, > 0, <= 2 decimales (R10)
    nota: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type MarcarConsolidacionRecibidaInput = z.infer<typeof marcarConsolidacionRecibidaSchema>;

/** R12 — REVERTIR. No lleva monto: el que hubiera se BORRA (y queda en el historial). */
export const revertirConciliacionSchema = z
  .object({
    cierreBodegaId: z.string().uuid(),
  })
  .strict();

export type RevertirConciliacionInputBorde = z.infer<typeof revertirConciliacionSchema>;
