import { z } from "zod";
import type {
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { MensajeroLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 33 — validacion de borde (zod) de la recepcion por QR y tipos de
// resultado expuestos por las Server Actions. El schema se usa en la action; los
// resultados de dominio (forbidden/sin_zona/zona_ajena/…) los devuelve el service
// sin excepcion, la action solo agrega `unauthenticated`.

// R16: el contenido escaneado del QR es `orden.id` (id estilo CUID/UUID de texto,
// ver Orden.id en schema.prisma). Se exige texto NO vacio (trim + min 1); un valor
// vacio/ilegible -> ZodError -> validation_error "codigo invalido" ANTES del
// service, sin tocar datos.
export const recibirSchema = z.object({
  ordenId: z.string().trim().min(1),
});
export type RecibirActionInput = z.infer<typeof recibirSchema>;

// --- Resultados expuestos por las Server Actions (agregan `unauthenticated`) ---

export type ListarRecepcionSateliteResult =
  | {
      status: "ok";
      porRecibir: RecepcionSateliteDTO[];
      recibidas: RecepcionSateliteDTO[];
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
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] }
  | { status: "unauthenticated" };

// R2/R5/R6: resultado del loader de mensajeros de la zona del actor para el modal.
// `forbidden` si el rol no es adminSatelite; sin zona -> lista vacia (R6).
export type ListarMensajerosSateliteResult =
  | { status: "ok"; mensajeros: MensajeroLiteRow[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
