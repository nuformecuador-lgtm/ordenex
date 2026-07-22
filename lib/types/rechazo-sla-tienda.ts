// Feature 102 (T8, design §4.3) — DTO de un RECHAZO POR SLA de la tienda: una orden que el cron
// SLA (99) escalo de `devuelta` a `rechazada`, visible para el adminTienda dueño en una superficie
// derivada de solo-lectura (dentro de /novedades, Q3 default). 100% serializable (strings +
// number|null) para cruzar el borde RSC (Server Action -> Server Component -> Client Component por
// props), SIN `Prisma.Decimal` ni `Date`. Patron `NovedadDTO`.
//
// Identificador visible = `numGuia` (NULLABLE, feature 17: la guia se asigna en "Generar guia");
// la UI muestra un placeholder legible cuando es `null`. `numRemision` y `destinatario` completan
// la identificacion (R14).
//
// `monto` = el `ingreso_bodega_rechazo` de 56 (Q1 default = "el dinero que la 99 registra"),
// serializado como STRING de dos decimales (money-safe, R14/R18). Es `null` mientras la gestion
// sintetica aun no se snapshotea en un cierre (Q2 default: la UI lo pinta "pendiente de cierre").
export interface RechazoSlaTiendaDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  monto: string | null;
}
