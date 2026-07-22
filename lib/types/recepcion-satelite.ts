import { z } from "zod";
import type {
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { MensajeroLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 33 — validacion de borde (zod) de la recepcion por QR y tipos de
// resultado expuestos por las Server Actions. El schema se usa en la action; los
// resultados de dominio (forbidden/sin_zona/zona_ajena/…) los devuelve el service
// sin excepcion, la action solo agrega `unauthenticated`.

// R16: el QR codifica la URL `/paquete/<numGuia>`; el escaner extrae el `num_guia`
// (Int UNIQUE de `orden`, secuencia `orden_num_guia_seq`) y lo manda aqui. Se exige
// entero positivo; un valor ilegible/no numerico (el escaner ya lo resuelve a null)
// -> ZodError -> validation_error "codigo invalido" ANTES del service, sin tocar datos.
export const recibirSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type RecibirActionInput = z.infer<typeof recibirSchema>;

// Feature 63 — borde de la recepcion EN LOTE ("Aceptar/Recibir todas"): lista NO vacia
// de ids de orden (mismo formato que `recibir`, texto no vacio). Un input invalido ->
// ZodError -> validation_error ANTES del service, sin tocar datos.
export const recibirLoteSchema = z.object({
  ordenIds: z.array(z.string().trim().min(1)).min(1),
});
export type RecibirLoteActionInput = z.infer<typeof recibirLoteSchema>;

// --- Resultados expuestos por las Server Actions (agregan `unauthenticated`) ---

export type ListarRecepcionSateliteResult =
  | {
      status: "ok";
      porRecibir: RecepcionSateliteDTO[];
      recibidas: RecepcionSateliteDTO[];
      // Feature 48/T9/R14: ordenes `rechazada` de la zona del adminSatelite,
      // elegibles para "Devolver a la tienda". El campo viaja tal cual desde el
      // service result (la action solo reenvia); acotado server-side por zona.
      porDevolver: RecepcionSateliteDTO[];
      // Feature 100/T4.1/R12: ordenes `devuelta` de la zona del adminSatelite,
      // elegibles para "Recuperar a bodega". Viaja tal cual desde el service result
      // (la action solo reenvia); acotado server-side por zona.
      devueltas: RecepcionSateliteDTO[];
      zonaNombre: string | null;
      sinZona: boolean;
    }
  | { status: "forbidden" } // R3
  | { status: "unauthenticated" }; // R3

export type RecibirResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_satelite" }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "zona_ajena" }
  | { status: "estado_invalido"; estado: string }
  | { status: "ya_recibida" }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "unauthenticated" }; // R16 / R3 (borde)

// Feature 63 — resultado expuesto por `recibirLote` (agrega `unauthenticated` del
// borde; el resto son resultados de dominio del service). Espejo de
// `RecibirLoteServiceResult`.
export type RecibirLoteResult =
  | { status: "ok"; recibidas: number }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// --- Feature 34: asignacion satelite a mensajeros de la zona ---

// R15/R19: borde de la asignacion. `ordenIds` no vacio de uuids, `mensajeroId`
// uuid; un input invalido -> ZodError -> validation_error ANTES del service, sin
// tocar datos. El `orden.id` es un uuid (ver Orden.id en schema.prisma).
export const asignarSateliteSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroId: z.string().uuid(),
});
export type AsignarSateliteActionInput = z.infer<typeof asignarSateliteSchema>;

// R7/R19: resultado expuesto por `asignarDesdeSatelite` (agrega `unauthenticated`
// del borde; el resto son resultados de dominio del service). Espejo de
// `AsignarSateliteServiceResult`.
export type AsignarSateliteResult =
  | { status: "ok"; resultados: { ordenId: string; estado: "en_espera_aceptacion" }[] }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  // Feature 41/R18: bodega bloqueada (regla estricta R17). La causa (porMensajeros /
  // porCierreBodega) permite al frontend mostrar el mensaje accionable diferenciado (R22).
  | { status: "bodega_bloqueada"; causa: { porMensajeros: boolean; porCierreBodega: boolean } }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] }
  | { status: "unauthenticated" };

// R2/R5/R6: resultado del loader de mensajeros de la zona del actor para el modal.
// `forbidden` si el rol no es adminSatelite; sin zona -> lista vacia (R6).
export type ListarMensajerosSateliteResult =
  | { status: "ok"; mensajeros: MensajeroLiteRow[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
