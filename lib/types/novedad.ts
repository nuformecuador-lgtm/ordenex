import type { GestionCausaDevolucion } from "@prisma/client";

// Feature 87 (T1, design §2.2) — DTO de una NOVEDAD: una orden en estatus `devuelta`
// de la tienda del adminTienda, con su causa de devolucion derivada. 100% serializable
// (strings + number|null + enum string) para cruzar el borde RSC (Server Action ->
// Server Component -> Client Component por props), sin Prisma.Decimal ni Date.
//
// Identificador visible = `numGuia` (decision F1.4 #1). Es NULLABLE (feature 17: la guia
// se asigna en "Generar guia"); la UI muestra un placeholder legible cuando es `null` (R9).
//
// `causa` = valor `causaDevolucion` de la ultima gestion `devuelta` VIGENTE (R6). Puede
// ser `null` (orden sin gestion vigente, o gestion con causa nula, o devolucion previa a la
// feature 73); la UI lo traduce a "Sin causa registrada" (R7). La traduccion a etiqueta ES
// (`CAUSA_DEVOLUCION_LABEL`) ocurre en el cliente (R11), NO en el DTO.
export interface NovedadDTO {
  id: string;
  numGuia: number | null;
  destinatario: string;
  telefonoDest: string;
  causa: GestionCausaDevolucion | null;
  /**
   * Feature 160 (R11/R14/R16/R26): intentos de entrega VIGENTES de la orden, derivados del
   * historial en el MISMO lote de la pagina (criterio unico de `OrdenHistorialService`,
   * design §1.1: destino `devuelta`, o destino `reprogramada` con familia `gestion`).
   * Opcional (`?`) por el patron aditivo del repo: no rompe fixtures/mocks que construyen el
   * DTO sin el; el servicio SIEMPRE lo envia, `0` incluido (R14).
   */
  intentosEntrega?: number;
}
