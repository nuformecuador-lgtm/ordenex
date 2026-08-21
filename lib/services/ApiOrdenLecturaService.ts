import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IOrdenRepository,
  ApiOrdenRow,
  ApiOrdenDetalleRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  ApiOrdenListarParams,
  IApiOrdenLecturaService,
} from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type {
  ApiOrdenDetalleDTO,
  ApiOrdenListItemDTO,
  ApiOrdenListadoDTO,
} from "@/lib/types/api-orden";
import { gestionConfig } from "@/lib/config/gestion";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";

// Subconjunto del repo que este service consume (DI ligera para tests, sin construir toda la
// superficie de IOrdenRepository).
type LecturaRepo = Pick<
  IOrdenRepository,
  | "listByOwner"
  | "findDetalleByNumGuiaForOwner"
  | "findDetalleByOrdenIdForOwner"
  | "findEstatusIdByValue"
>;

/** Fila publica del repo -> DTO publico (renombra `estatusValue` a `estado`). */
function toListItemDTO(row: ApiOrdenRow): ApiOrdenListItemDTO {
  return {
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estado: row.estatusValue,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    producto: row.producto,
    direccion: row.direccion,
    montoCobrar: row.montoCobrar,
    createdAt: row.createdAt,
  };
}

/**
 * Feature 106 (design §2/§3) — LECTURA del canal integrador. Fuerza el owner = `actor.usuarioId`
 * (R4), resuelve evidencias como URLs firmadas de 5 min (R15/R17) y mapea a DTO publico SIN
 * `storage_path` crudo, sin bucket, sin PII del mensajero (R16).
 */
export class ApiOrdenLecturaService implements IApiOrdenLecturaService {
  constructor(
    private readonly repo: LecturaRepo,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  async listar(actor: Actor, params: ApiOrdenListarParams): Promise<ApiOrdenListadoDTO> {
    const { limit, offset, estado, desde, hasta, numGuia, numRemision } = params;
    let estatusId: string | undefined;
    if (estado) {
      // R8: el filtro solo acota; no puede ampliar el scope (el owner ya va forzado en el repo).
      const id = await this.repo.findEstatusIdByValue(estado);
      // Estado valido pero sin filas posibles (catalogo sin ese value en esta DB) -> pagina vacia.
      if (!id) return { items: [], pagination: { limit, offset, total: 0 } };
      estatusId = id;
    }
    // Feature 257 (R5/R6/R7): la decision de negocio "el dia operativo es el dia natural de Costa
    // Rica" vive AQUI; el repo solo habla de instantes. `inicioDelDiaCREnUtc` deja ambos bordes en
    // `...T06:00:00.000Z` y `inicioDelDiaSiguienteCREnUtc` hace `hasta` INCLUSIVO con una cota
    // superior EXCLUSIVA. OJO con la trampa del repo: el helper de medianoche UTC de la
    // convencion `@db.Date` (feature 46) NO sirve aqui —`created_at` es `timestamp`— y devolveria
    // la ventana 18:00-18:00 hora CR, que es el off-by-one de la ficha 166.
    const createdAtDesde = desde ? inicioDelDiaCREnUtc(desde) : undefined;
    const createdAtHasta = hasta ? inicioDelDiaSiguienteCREnUtc(hasta) : undefined;
    const { items, total } = await this.repo.listByOwner({
      ownerId: actor.usuarioId, // R4/R6/R7 (106) + R20 (257): owner = actor, forzado en el repo
      estatusId,
      createdAtDesde,
      createdAtHasta,
      numGuia,
      numRemision,
      skip: offset,
      take: limit,
    });
    return { items: items.map(toListItemDTO), pagination: { limit, offset, total } };
  }

  async detalle(actor: Actor, numGuia: number): Promise<ApiOrdenDetalleDTO | null> {
    // R4/R14: owner = actor.usuarioId; el repo devuelve null si la orden no es del owner.
    const row = await this.repo.findDetalleByNumGuiaForOwner(numGuia, actor.usuarioId);
    return this.toDetalleDTO(row);
  }

  /**
   * Feature 177 (R16/R17) — MISMO detalle publico, pero por `orden.id` (la resolucion de `{id}`
   * entrega un id, y `num_guia` puede ser NULL). Es una ADICION: `detalle(actor, numGuia)` no
   * cambia de firma ni de comportamiento. El mapeo y el firmado de evidencias son literalmente
   * los mismos (`toDetalleDTO`), y el owner se sigue forzando a `actor.usuarioId` (R4/R7).
   */
  async detallePorOrdenId(actor: Actor, ordenId: string): Promise<ApiOrdenDetalleDTO | null> {
    const row = await this.repo.findDetalleByOrdenIdForOwner(ordenId, actor.usuarioId);
    return this.toDetalleDTO(row);
  }

  /** Cuerpo comun de `detalle`/`detallePorOrdenId`: fila del repo -> DTO con evidencias firmadas. */
  private async toDetalleDTO(row: ApiOrdenDetalleRow | null): Promise<ApiOrdenDetalleDTO | null> {
    if (!row) return null; // R13/R14: 404 uniforme (no se filtra existencia ajena)

    const ttl = gestionConfig.SIGNED_URL_TTL_SECONDS; // R17: 5 min
    const paths = row.evidencias.map((e) => e.storagePath);
    // R16/R17: firma con la credencial de servidor; si no hay evidencias no toca Storage (R18).
    const urlByPath = paths.length > 0 ? await this.signedUrls.createSignedUrls(paths, ttl) : {};

    const evidencias = row.evidencias.map((e) => ({
      resultado: e.resultado,
      contentType: e.contentType,
      url: urlByPath[e.storagePath], // R16: solo URL firmada, NUNCA el storage_path crudo/bucket
      expiraEnSegundos: ttl,
    }));

    return { ...toListItemDTO(row), evidencias };
  }
}
