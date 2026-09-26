import type { MetodoPagoValue } from "@prisma/client";

// El metodo de pago en palabras. Nacio en `app/(app)/cierres-admin/_components/cierre-labels.ts`,
// que lo sigue re-exportando (mismo objeto: mutarlo en un test cambia lo pintado), y se muda aqui en
// la 458-A (revision m2) porque tambien lo lee `OrigenLegibleService` en el servidor, y un servicio
// de `lib/` no importa de `app/**/_components`.
export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};
