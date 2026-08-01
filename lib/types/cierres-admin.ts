import { z } from "zod";
import { Prisma } from "@prisma/client";
import { montoPositivoSchema } from "@/lib/types/wallet";
import { cierreConfig } from "@/lib/config/cierre";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import type {
  ListarCierresAdminServiceResult,
  CierreAdminResumen,
  CierreDetalleAdminServiceResult,
  AprobarCierreServiceResult,
  RechazarCierreServiceResult,
  ForzarSolicitudVencidoServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";

// Feature 38 — schemas zod del borde de las Server Actions "Cierres del dia" del
// admin + los *Result de action (resultado de dominio del service + `unauthenticated`
// que resuelve el borde, patron lib/types/cierre.ts / recepcion-satelite.ts).

// R6/R10/R13: identifica el cierre a ver/aprobar. `uuid` casa el @default(uuid()) de
// cierre_dia (feature 37); un id mal formado -> VALIDATION_ERROR en el borde.
export const cierreIdSchema = z.object({
  cierreId: z.string().uuid(),
});

/**
 * Feature 158 (m5 del review) — TOPE del monto de indemnizacion, DERIVADO DE LA COLUMNA y no
 * elegido a ojo. `gestion_orden.indemnizacion` es `DECIMAL(12,2)`
 * (`db/migrations/20260730120000_incidente_indemnizacion/migration.sql`, y el
 * `@db.Decimal(12, 2)` del modelo): precision 12, escala 2 -> 12 - 2 = **10 digitos enteros**
 * -> el mayor valor representable es `9999999999.99`. Un centimo mas y Postgres responde
 * `numeric field overflow`.
 *
 * Si algun dia la columna cambia de precision, este numero se recalcula de la MISMA cuenta;
 * no es un limite de negocio.
 */
const INDEMNIZACION_DIGITOS_ENTEROS = 10; // = precision(12) - escala(2)
export const INDEMNIZACION_MONTO_MAX = `${"9".repeat(INDEMNIZACION_DIGITOS_ENTEROS)}.99`;

/**
 * Feature 158 (R19/R20/R24) — un monto de indemnizacion por gestion `incidente` del cierre.
 * El monto viaja como STRING de extremo a extremo (`montoPositivoSchema` de la wallet: hasta 2
 * decimales, > 0, comparado con `Prisma.Decimal`) y solo se convierte a Decimal AL ESCRIBIR:
 * nunca `number`, nunca `parseFloat`. Un monto vacio, 0, negativo, con 3 decimales o con coma
 * cae aqui -> ZodError -> `validation_error` por campo.
 *
 * m5 del review: ademas se acota POR ARRIBA. Sin el tope, un monto de 11+ digitos pasaba el
 * borde y la guardia de cobertura, y reventaba DENTRO de la transaccion de aprobacion con un
 * `numeric field overflow` de Postgres: la tx revertia (sin corrupcion) pero el admin veia un
 * error generico y perdia todo lo tecleado. Con el tope, el rechazo ocurre ANTES de abrir la
 * transaccion del dinero y llega como `validation_error`, igual que el resto de errores de
 * este mismo borde.
 *
 * EL TOPE VIVE AQUI, en el borde de la 158, y NO en `montoPositivoSchema`: ese schema lo
 * comparten la wallet (42/45) y sus formularios, que tienen la misma carencia pero cuya
 * columna y cuyo flujo no han pasado por esta puerta. Endurecerlo desde aqui cambiaria el
 * comportamiento de otras features sin decision suya. La correccion global es una feature
 * propia, no un efecto colateral de esta.
 */
export const indemnizacionSchema = z.object({
  gestionId: z.string().uuid(),
  monto: montoPositivoSchema.refine((v) => {
    try {
      return new Prisma.Decimal(v).lte(INDEMNIZACION_MONTO_MAX);
    } catch {
      // Zod v4 corre este refine AUNQUE el regex de `montoPositivoSchema` ya haya fallado
      // (mismo motivo documentado alli). Un valor no numerico no es un problema DE TOPE: se
      // devuelve `true` para no anadir un mensaje enganoso, y el regex + el `> 0` lo rechazan
      // igual con el suyo.
      return true;
    }
  }, `El monto no puede superar ${INDEMNIZACION_MONTO_MAX}.`),
});

// Feature 158 (R19/R36): `aprobarCierre` gana la lista de indemnizaciones. `.default([])` la
// hace RETROCOMPATIBLE con el contrato de la 38: un cierre sin incidentes se aprueba
// exactamente como hoy, sin campos nuevos obligatorios. La cobertura EXACTA (que no falte ni
// sobre ninguna) la valida el SERVICE contra las gestiones reales del cierre, no el borde: el
// borde no sabe que gestiones tiene ese cierre.
export const aprobarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  indemnizaciones: z.array(indemnizacionSchema).default([]),
});

export type IndemnizacionInput = z.infer<typeof indemnizacionSchema>;
export type AprobarCierreInput = z.infer<typeof aprobarCierreSchema>;

// Feature 111/R16: la valvula de escape identifica el cierre `vencido` a destrabar por su id
// (mismo shape que aprobar). Un id mal formado -> VALIDATION_ERROR en el borde.
export const forzarSolicitudVencidoSchema = cierreIdSchema;

// R11: el motivo de rechazo es OBLIGATORIO y no vacio. `.trim().min(1)` rechaza el
// string en blanco (defensa de borde; el service lo re-valida).
export const rechazarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  motivo: z.string().trim().min(1),
});

export type CierreIdInput = z.infer<typeof cierreIdSchema>;
export type RechazarCierreInput = z.infer<typeof rechazarCierreSchema>;

/**
 * Feature 170 — FASE 2 (T I.1, R40) — entrada del HISTORICO paginado de cierres del dia.
 *
 * `.strict()`: este listado NO tiene filtros (design §11.3, riesgo BAJO) y su alcance sale
 * del ACTOR, nunca de la peticion. Con `.strict()`, un cliente que intente colar
 * `destinoZonaId` recibe `validation_error` en el BORDE en vez de que la clave viaje hasta
 * un servicio que —hoy— la ignoraria en silencio.
 *
 * El tamano de pagina sale de `cierreConfig` (T H.1) y se recorta a `MAX_PAGE_SIZE` con el
 * mismo `transform` que usa el listado de usuarios: un `pageSize: 100000` no se rechaza, se
 * acota (R40).
 */
export const listarHistoricoCierresAdminSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(cierreConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, cierreConfig.MAX_PAGE_SIZE)),
  })
  .strict();

export type ListarHistoricoCierresAdminInput = z.infer<typeof listarHistoricoCierresAdminSchema>;

/**
 * Errores de BORDE de los listados de este modulo: los de dominio que decide el servicio
 * (`forbidden`) mas los dos que decide la Server Action antes de llamarlo. Se declara aparte
 * para poder pasarlo como parametro al contrato comun (T H.2): unificar la forma del EXITO no
 * puede ensanchar los errores que esta pantalla tiene que manejar.
 */
export type CierresAdminListadoError =
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// Feature 170 (T I.1, R41): el contrato comun de listado paginado, aplicado al historico.
export type ListarHistoricoCierresAdminResult = ListarPaginadoResult<
  CierreAdminResumen,
  CierresAdminListadoError
>;

// Resultados de las Server Actions: resultado de dominio del service +
// `unauthenticated` (sin sesion, lo resuelve el borde).
export type ListarCierresAdminResult =
  | ListarCierresAdminServiceResult
  | { status: "unauthenticated" };
export type VerCierreDetalleResult =
  | CierreDetalleAdminServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type AprobarCierreResult =
  | AprobarCierreServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type RechazarCierreResult =
  | RechazarCierreServiceResult
  | { status: "unauthenticated" };
// Feature 111/R16: resultado de la Server Action de la valvula de escape (dominio del service
// + `validation_error` de zod / `unauthenticated` sin sesion, resueltos en el borde).
export type ForzarSolicitudVencidoResult =
  | ForzarSolicitudVencidoServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
