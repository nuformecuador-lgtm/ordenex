import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RecepcionSateliteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecepcionSateliteService,
  ListarRecepcionSateliteServiceResult,
  RecepcionSateliteDTO,
  RecibirServiceResult,
} from "@/lib/interfaces/services/IRecepcionSateliteService";

// Estado de ORIGEN de la recepcion (feature 30) y destino tras recibir (esta
// feature). Un solo estado de destino; el nombre de zona se deriva de orden.zonaId
// para el display (R9/R20).
const ORIGEN_RECEPCION = "en_ruta_bodega_satelite";
const ESTADO_RECIBIDA = "en_bodega_satelite";
// Feature 48/T9/R14: estado de las ordenes elegibles para "Devolver a la tienda"
// (retorno a la tienda de origen). Se listan acotadas a la zona del adminSatelite.
const ESTADO_RECHAZADA = "rechazada";

// Solo el rol autorizado en el modulo (R3/R17): el adminSatelite, SIEMPRE acotado
// a su propia zona (R4/R12).
const ROL_AUTORIZADO = "adminSatelite";

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP.
type RecepcionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findRecepcionSateliteByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
>;

/**
 * Logica de negocio de la bodega satelite (feature 33). Resuelve el alcance por
 * zona del adminSatelite (server-side, R4), lista los dos grupos (R6/R8) y ejecuta
 * la recepcion por QR con guardias/idempotencia (R11-R18). No conoce HTTP ni
 * Prisma; testeable con dobles sin red/DB.
 */
export class RecepcionSateliteService implements IRecepcionSateliteService {
  constructor(private readonly repo: RecepcionSateliteRepo) {}

  async listar(actor: Actor): Promise<ListarRecepcionSateliteServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) {
      // R5: adminSatelite sin zona -> modulo vacio + aviso accionable (sinZona).
      // Feature 48/T9/R14: sin zona tampoco hay ordenes por devolver.
      return {
        status: "ok",
        porRecibir: [],
        recibidas: [],
        porDevolver: [],
        zonaNombre: null,
        sinZona: true,
      };
    }

    // Feature 48/T9/R14: se anade el 3er estado `rechazada` para listar las ordenes
    // elegibles para "Devolver a la tienda", SIEMPRE acotadas a la zona del actor.
    const rows = await this.repo.findRecepcionSateliteByZona(zonaId, [
      ORIGEN_RECEPCION,
      ESTADO_RECIBIDA,
      ESTADO_RECHAZADA,
    ]); // R6/R8 + R14

    const porRecibir: RecepcionSateliteDTO[] = [];
    const recibidas: RecepcionSateliteDTO[] = [];
    const porDevolver: RecepcionSateliteDTO[] = []; // Feature 48/T9/R14
    let zonaNombre: string | null = null;
    for (const row of rows) {
      zonaNombre = row.zonaNombre; // derivado de orden.zonaId (misma zona para todas)
      const dto = toDTO(row);
      if (row.estatusValue === ORIGEN_RECEPCION) porRecibir.push(dto);
      else if (row.estatusValue === ESTADO_RECIBIDA) recibidas.push(dto);
      else if (row.estatusValue === ESTADO_RECHAZADA) porDevolver.push(dto);
    }
    return { status: "ok", porRecibir, recibidas, porDevolver, zonaNombre, sinZona: false };
  }

  async recibir(ordenId: string, actor: Actor): Promise<RecibirServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "sin_zona" }; // R5

    const row = (await this.repo.findByIdsForTransicion([ordenId]))[0];
    // R15: inexistente o borrada -> no_encontrada, sin efectos.
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };
    // R12: orden de otra zona -> zona_ajena, sin efectos.
    if (row.zonaId !== zonaId) return { status: "zona_ajena" };
    // R14: ya recibida (misma zona) -> idempotente, sin escribir.
    if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };
    // R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido, sin efectos.
    if (row.estatusValue !== ORIGEN_RECEPCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    const destinoId = await this.repo.findEstatusIdByValue(ESTADO_RECIBIDA);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R11/R18: transicion atomica guardada por estado de origen + zona.
    // Feature 49/#6 (R14): actor = el adminSatelite; destino en_bodega_satelite.
    const ok = await this.repo.recibirEnSatelite(ordenId, zonaId, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "recepcion_satelite",
    });
    if (ok) return { status: "ok", ordenId, estado: ESTADO_RECIBIDA };

    // R18: race — otro escaneo la movio entre la lectura y la escritura. Re-lee y
    // decide: si ahora esta recibida -> ya_recibida (idempotente); si no -> conflict.
    const actual = (await this.repo.findByIdsForTransicion([ordenId]))[0];
    if (actual && actual.deletedAt === null && actual.estatusValue === ESTADO_RECIBIDA) {
      return { status: "ya_recibida" };
    }
    return { status: "conflict" };
  }
}

function toDTO(row: RecepcionSateliteRow): RecepcionSateliteDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatusValue,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar,
    tiendaNombre: row.tiendaNombre,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
  };
}
