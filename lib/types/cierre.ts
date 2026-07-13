import type { CierreEstado as PrismaCierreEstado, CierreDestinoTipo as PrismaCierreDestinoTipo } from "@prisma/client";
import type {
  ListarCierreDiaServiceResult,
  SolicitarCierreServiceResult,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 37 (R13/R18, decision F1.4-d): fuente unica de verdad de los estados del
// cierre del dia, respaldada por el enum Postgres nativo `cierre_estado` (patron
// METODO_PAGO_SEED). La 37 SOLO produce `solicitado`; `aprobado`/`rechazado` se
// reservan para la feature 38. El `satisfies` rompe el build si el SEED tuviera un
// valor que el enum Prisma NO tiene.
// Feature 41 (R2): AÑADE `vencido` como cuarto estado. Lo crea el corte diario para
// el mensajero que "debia cerrar y no solicito" (fila real con snapshot congelado); es
// bloqueante como `solicitado` y resoluble por la bodega responsable (feature 38 ext).
export const CIERRE_ESTADO_SEED = [
  "solicitado",
  "aprobado",
  "rechazado",
  "vencido", // feature 41
] as const satisfies readonly PrismaCierreEstado[];

export type CierreEstado = (typeof CIERRE_ESTADO_SEED)[number];

// Exhaustividad frente al enum Prisma: si `CierreEstado` gana un valor que no esta
// en CIERRE_ESTADO_SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureEstadoExhaustive = Exclude<PrismaCierreEstado, CierreEstado> extends never ? true : never;
const _estadoExhaustive: _EnsureEstadoExhaustive = true;
void _estadoExhaustive;

// Feature 37 (R15, decision F1.4-e): fuente unica de verdad del tipo de destino del
// cierre, respaldada por el enum Postgres nativo `cierre_destino_tipo`.
export const CIERRE_DESTINO_TIPO_SEED = [
  "bodega_central",
  "bodega_satelite",
] as const satisfies readonly PrismaCierreDestinoTipo[];

export type CierreDestinoTipo = (typeof CIERRE_DESTINO_TIPO_SEED)[number];

type _EnsureDestinoExhaustive = Exclude<PrismaCierreDestinoTipo, CierreDestinoTipo> extends never
  ? true
  : never;
const _destinoExhaustive: _EnsureDestinoExhaustive = true;
void _destinoExhaustive;

// Resultados de las Server Actions (feature 37): el resultado de dominio del
// service + `unauthenticated`, que resuelve el borde (sin sesion). Mismo patron que
// los *Result de recepcion-satelite/mis-asignaciones.
export type ListarCierreDiaResult = ListarCierreDiaServiceResult | { status: "unauthenticated" };
export type SolicitarCierreResult = SolicitarCierreServiceResult | { status: "unauthenticated" };
