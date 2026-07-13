import type { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";

// Feature 49 (design §1.2, R23) — fuente unica de verdad de los tipos de ORIGEN de una
// transicion de estado, respaldada por el enum Postgres nativo `orden_historial_origen_tipo`
// (patron METODO_PAGO_SEED / WALLET_*_SEED). Son los 11 call-sites de escritura de
// `orden.estatus_id` (design §2), un valor por familia de transicion.
//   - `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` rompe el build si el SEED lista
//     un valor que el enum Prisma NO tiene.
//   - el chequeo `_EnsureExhaustive` rompe el build si el enum gana un valor que el SEED
//     NO lista (conjunto cerrado de los 11 tipos).
export const ORDEN_HISTORIAL_ORIGEN_TIPO_SEED = [
  "carga_masiva", // feature 15/27: estado inicial en createMany
  "creacion_manual", // feature 6: OrdenService.crear (create individual)
  "generacion_guia", // feature 17/30: generarGuiaLote
  "asignacion_bodega", // feature 17: asignarBodegaLote
  "ruteo_satelite", // feature 30: rutearBodegaSateliteLote
  "recepcion_satelite", // feature 33: recibirEnSatelite
  "asignacion_satelite", // feature 34: asignarSateliteLote
  "recoleccion", // feature 36: recogerLote
  "gestion", // feature 36: crearGestionYTransicionar
  "liberacion_reprogramada", // feature 46: liberarOrden (cron)
  "ajuste_estado", // feature 6: OrdenService.actualizar (CRUD generico)
] as const satisfies readonly PrismaOrdenHistorialOrigenTipo[];

export type OrdenHistorialOrigenTipo = (typeof ORDEN_HISTORIAL_ORIGEN_TIPO_SEED)[number];

// Exhaustividad frente al enum Prisma: si `OrdenHistorialOrigenTipo` gana un valor que no
// esta en el SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<
  PrismaOrdenHistorialOrigenTipo,
  OrdenHistorialOrigenTipo
> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

// Feature 49 (design §4.4) — DTO de UNA entrada de la linea de tiempo, ya resuelta a
// valores legibles (no UUIDs internos): `estatusOrigenValue` NULL = creacion (R1/R20);
// `actorNombre` NULL = sistema/cron (R21); `motivo` NULL cuando la transicion no viene de
// una gestion con motivo (R22). Ordenadas cronologicamente por el service (R26).
export interface OrdenHistorialEntradaDTO {
  estatusOrigenValue: string | null;
  estatusDestinoValue: string;
  origenTipo: OrdenHistorialOrigenTipo;
  actorNombre: string | null;
  motivo: string | null;
  createdAt: Date;
}
