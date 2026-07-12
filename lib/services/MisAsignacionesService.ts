import { Prisma } from "@prisma/client";
import { GESTION_MIME_EXTENSION, gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DetalleConflicto,
  EscogerServiceResult,
  GestionarInput,
  GestionarServiceResult,
  IMisAsignacionesService,
  LiberarServiceResult,
  ListarMisAsignacionesServiceResult,
  MiAsignacionDTO,
  RecogerInput,
  RecogerServiceResult,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Estado de origen de "Recoger" (feature 17) y destino tras recoger (feature 36).
const ORIGEN_RECOGER = "en_espera_aceptacion";
const ESTADO_EN_REPARTO = "en_reparto";
// Unico estado de origen valido para gestionar los 4 resultados (R18).
const ORIGEN_GESTION = "en_reparto";

// El `value` de order_status destino coincide 1:1 con el `resultado` de la
// gestion (entregada/reprogramada/devuelta/rechazada).

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Logica de negocio del flujo del mensajero (feature 36). Orquesta el repo de
 * gestion + el catalogo de estados + Storage (evidencias) + firma de URLs. No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class MisAsignacionesService implements IMisAsignacionesService {
  constructor(
    private readonly repo: IGestionOrdenRepository,
    private readonly ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue">,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  async listarMisAsignaciones(actor: Actor): Promise<ListarMisAsignacionesServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const [ordenEnGestionId, rows] = await Promise.all([
      this.repo.getOrdenEnGestion(actor.usuarioId), // R20
      this.repo.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO]), // R9/R13
    ]);

    const porRecoger: MiAsignacionDTO[] = [];
    const porGestionar: MiAsignacionDTO[] = [];
    for (const row of rows) {
      const dto = toDTO(row);
      if (row.estatusValue === ORIGEN_RECOGER) porRecoger.push(dto);
      else if (row.estatusValue === ESTADO_EN_REPARTO) porGestionar.push(dto);
    }
    return { status: "ok", porRecoger, porGestionar, ordenEnGestionId }; // R10
  }

  async recogerAsignaciones(input: RecogerInput, actor: Actor): Promise<RecogerServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", recogidas: [] };

    const rows = await this.repo.findByIdsParaGestion(ordenIds);
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // R17: propiedad/existencia -> forbidden (aborta sin efectos).
    for (const id of ordenIds) {
      const row = rowById.get(id);
      if (!row || row.mensajeroAsignadoId !== actor.usuarioId) {
        return { status: "forbidden" };
      }
    }
    // R17: origen invalido / borrada -> conflict (aborta sin efectos).
    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const row = rowById.get(id) as OrdenGestionRow;
      if (row.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: "orden borrada" });
      } else if (row.estatusValue !== ORIGEN_RECOGER) {
        detalle.push({ ordenId: id, motivo: `estado de origen no permitido: ${row.estatusValue}` });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    const [origenId, destinoId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ORIGEN_RECOGER),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO),
    ]);
    if (origenId === null || destinoId === null) {
      return {
        status: "conflict",
        detalle: [{ ordenId: ordenIds[0], motivo: "catalogo de estados incompleto (seed pendiente)" }],
      };
    }

    await this.repo.recogerLote(ordenIds, actor.usuarioId, origenId, destinoId); // R15/R16
    return { status: "ok", recogidas: ordenIds };
  }

  async escogerParaGestion(ordenId: string, actor: Actor): Promise<EscogerServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const guardia = await this.cargarOrdenGestionable(ordenId, actor);
    if (guardia.status !== "ok") return guardia;

    // R19-R21: fija el puntero de forma idempotente; si ya hay OTRA activa -> conflict.
    const fijada = await this.repo.setOrdenEnGestion(actor.usuarioId, ordenId);
    if (!fijada) {
      return { status: "conflict", motivo: "ya tienes otra orden en gestion" };
    }
    return { status: "ok", ordenId };
  }

  async gestionar(input: GestionarInput, actor: Actor): Promise<GestionarServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const guardia = await this.cargarOrdenGestionable(input.ordenId, actor);
    if (guardia.status !== "ok") return guardia;
    const orden = guardia.orden;

    // R21: no gestionar una orden distinta de la activa (si hay una activa).
    const activa = await this.repo.getOrdenEnGestion(actor.usuarioId);
    if (activa !== null && activa !== input.ordenId) {
      return { status: "conflict", motivo: "tienes otra orden activa en gestion" };
    }

    // R22 (h): ENTREGADA exige monto == montoCobrar EXACTO; si no cuadra, no
    // persiste. Comparacion en Decimal (no float) para evitar falsos negativos
    // por representacion binaria de los montos.
    if (input.resultado === "entregada") {
      const cuadra =
        orden.montoCobrar !== null &&
        new Prisma.Decimal(input.montoRecibido).equals(new Prisma.Decimal(orden.montoCobrar));
      if (!cuadra) {
        return {
          status: "validation_error",
          fieldErrors: {
            montoRecibido: ["el monto recibido debe cuadrar con el monto a cobrar de la orden"],
          },
        };
      }
    }

    const nuevoEstatusId = await this.ordenRepo.findEstatusIdByValue(input.resultado);
    if (nuevoEstatusId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R23/R30: subir evidencia (entrega/rechazo) ANTES de la transaccion.
    let storagePath: string | null = null;
    let contentType: string | null = null;
    if (input.resultado === "entregada" || input.resultado === "rechazada") {
      const ext = GESTION_MIME_EXTENSION[input.evidencia.contentType as GestionMimeType] ?? "bin";
      const path = `${input.ordenId}/${input.resultado}-${Date.now()}.${ext}`;
      storagePath = await this.storage.upload({
        path,
        bytes: input.evidencia.bytes,
        contentType: input.evidencia.contentType,
      });
      contentType = input.evidencia.contentType;
    }

    const gestion = buildGestionData(input, storagePath, contentType);

    try {
      // R23/R26/R28/R30: INSERT gestion + UPDATE estatus + limpiar puntero, atomico.
      await this.repo.crearGestionYTransicionar({
        ordenId: input.ordenId,
        mensajeroId: actor.usuarioId,
        gestion,
        nuevoEstatusId,
      });
    } catch (error) {
      // R23/R30: si la transaccion falla tras subir, limpiar el objeto (best-effort).
      if (storagePath) await this.storage.remove([storagePath]);
      throw error;
    }

    // R8: la evidencia se muestra con URL firmada de TTL acotado, nunca el path crudo.
    let evidenciaUrl: string | undefined;
    if (storagePath) {
      evidenciaUrl = await this.signedUrls.createSignedUrl(
        storagePath,
        gestionConfig.SIGNED_URL_TTL_SECONDS,
      );
    }
    return { status: "ok", ordenId: input.ordenId, estado: input.resultado, evidenciaUrl };
  }

  async liberarGestion(ordenId: string, actor: Actor): Promise<LiberarServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12/R35
    // R35: idempotente y concurrencia-seguro. El repo limpia SOLO si el puntero
    // del propio actor apunta a esa orden; devolvemos ok aunque no hubiera nada.
    await this.repo.liberarOrdenEnGestion(actor.usuarioId, ordenId);
    return { status: "ok" };
  }

  /**
   * Guardia comun (R18/R31): la orden existe, es del actor y su origen es
   * `en_reparto`. Devuelve la fila o un resultado de rechazo.
   */
  private async cargarOrdenGestionable(
    ordenId: string,
    actor: Actor,
  ): Promise<{ status: "ok"; orden: OrdenGestionRow } | { status: "forbidden" } | { status: "conflict"; motivo: string }> {
    const rows = await this.repo.findByIdsParaGestion([ordenId]);
    const orden = rows[0];
    if (!orden || orden.mensajeroAsignadoId !== actor.usuarioId) {
      return { status: "forbidden" }; // R31: orden ajena o inexistente
    }
    if (orden.deletedAt !== null) {
      return { status: "conflict", motivo: "orden borrada" };
    }
    if (orden.estatusValue !== ORIGEN_GESTION) {
      return { status: "conflict", motivo: `solo se gestiona desde ${ORIGEN_GESTION}` }; // R18
    }
    return { status: "ok", orden };
  }
}

function toDTO(row: MiAsignacionRow): MiAsignacionDTO {
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
    notas: row.notas,
    tiendaNombre: row.tiendaNombre,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
  };
}

/** Arma los campos nullable de gestion_orden segun el resultado (R23/R26/R28/R30). */
function buildGestionData(
  input: GestionarInput,
  storagePath: string | null,
  contentType: string | null,
): GestionOrdenData {
  switch (input.resultado) {
    case "entregada":
      return {
        resultado: "entregada",
        montoRecibido: input.montoRecibido,
        metodoPago: input.metodoPago,
        evidenciaStoragePath: storagePath,
        evidenciaContentType: contentType,
      };
    case "reprogramada":
      return {
        resultado: "reprogramada",
        fechaReprogramacion: input.fechaReprogramacion,
        motivo: input.motivo,
      };
    case "devuelta":
      return { resultado: "devuelta", motivo: input.motivo };
    case "rechazada":
      return {
        resultado: "rechazada",
        motivo: input.motivo,
        evidenciaStoragePath: storagePath,
        evidenciaContentType: contentType,
      };
  }
}
