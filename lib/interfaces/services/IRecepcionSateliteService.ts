import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 33 — contrato del servicio de la bodega satelite: listar "Mis
// asignaciones" del adminSatelite (dos grupos: por recibir / recibidas) y recibir
// una orden por escaneo de QR (transicion 1-a-1 guardada por estado+zona). Logica
// de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado. Solo el rol `adminSatelite`, SIEMPRE acotado a su `usuario.zonaId`.

// DTO de una orden del modulo satelite con el detalle para la UI (R6/R8/R9). Los
// nombres ya resueltos (no IDs de catalogo); `montoCobrar` serializado a
// number|null. `estatusValue` distingue "Por recibir" (en_ruta_bodega_satelite)
// de "Recibidas" (en_bodega_satelite).
export interface RecepcionSateliteDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
}

// R3/R4/R5/R6/R8: dos grupos separados (por recibir vs recibidas) + nombre de la
// zona del actor y `sinZona` (adminSatelite sin zona asignada -> listas vacias +
// aviso accionable, R5). `forbidden` si el rol no es adminSatelite (R3/R17).
export type ListarRecepcionSateliteServiceResult =
  | {
      status: "ok";
      porRecibir: RecepcionSateliteDTO[];
      recibidas: RecepcionSateliteDTO[];
      // Feature 48/T9/R14: ordenes en estado `rechazada` de la MISMA zona del
      // adminSatelite, elegibles para la accion "Devolver a la tienda"
      // (transicion rechazada -> devuelta_origen la ejecuta DevolucionOrigenService).
      // Acotado server-side por zona (findRecepcionSateliteByZona(zonaId, ...)); un
      // adminSatelite NO ve rechazadas de otra zona. Solo listado, la autz de
      // ejecutar el retorno la impone DevolucionOrigenService (rol + zona).
      porDevolver: RecepcionSateliteDTO[];
      zonaNombre: string | null;
      sinZona: boolean;
    }
  | { status: "forbidden" };

// R11-R18: maquina de resultados de la recepcion por QR (design §2.3). Todos los
// rechazos son SIN efectos en datos; `ok` transiciona a en_bodega_satelite.
// `estado_invalido` reporta el estado actual (R13). `validation_error` cubre el
// catalogo de estados incompleto (seed pendiente del destino). `conflict` cubre la
// carrera irresoluble (la orden se movio a un estado inesperado entre lectura y
// escritura, R18).
export type RecibirServiceResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_satelite" } // R11
  | { status: "forbidden" } // R17
  | { status: "sin_zona" } // R5
  | { status: "zona_ajena" } // R12
  | { status: "estado_invalido"; estado: string } // R13
  | { status: "ya_recibida" } // R14 (idempotente)
  | { status: "no_encontrada" } // R15 (inexistente o borrada)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // catalogo incompleto
  | { status: "conflict" }; // R18 (race irresoluble)

export interface IRecepcionSateliteService {
  /**
   * R3/R4/R5/R6/R8: lista los dos grupos de la zona del adminSatelite (por
   * recibir = en_ruta_bodega_satelite, recibidas = en_bodega_satelite). Rol !=
   * adminSatelite -> forbidden; sin zona -> listas vacias + sinZona.
   */
  listar(actor: Actor): Promise<ListarRecepcionSateliteServiceResult>;
  /**
   * R11-R18: recibe una orden por su `id` (contenido del QR). Transiciona a
   * en_bodega_satelite solo si sigue en en_ruta_bodega_satelite y es de la zona
   * del actor; idempotente si ya estaba recibida (R14).
   */
  recibir(ordenId: string, actor: Actor): Promise<RecibirServiceResult>;
}
