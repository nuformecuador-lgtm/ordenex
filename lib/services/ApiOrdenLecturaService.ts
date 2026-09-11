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
// ⏳ 2026-09-10 (feature 415, T4): la resolucion de la tarifa VIGENTE entra por la MISMA cascada
// y el MISMO metodo batch que ya usan el cierre de dia y la cotizacion (R19/R24). No se escribe
// una segunda regla de resolucion.
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import { costoEstimadoDe, costoRealDe } from "@/lib/utils/api-orden-costo";

// Subconjunto del repo que este service consume (DI ligera para tests, sin construir toda la
// superficie de IOrdenRepository).
type LecturaRepo = Pick<
  IOrdenRepository,
  | "listByOwner"
  | "findDetalleByOrdenIdForOwner"
  | "findEstatusIdByValue"
>;

// ⏳ 2026-09-10 (feature 415, T4): la MISMA DI ligera que `LecturaRepo`, y el mismo subconjunto de
// un solo metodo que ya declara `CotizacionOrdenService`.
type LecturaTarifaRepo = Pick<ITarifaVigenteRepository, "resolveTarifas">;

/**
 * ⏳ 2026-09-10 (feature 415, R24) — los pares (tienda, zona) DISTINTOS de la pagina, en orden de
 * primera aparicion. Copiado del patron que ya existe (`CotizacionOrdenService.paresDistintos`):
 * la consulta de tarifas es UNA sola y una pagina de 100 ordenes de la misma zona no tiene por que
 * pedir 100 veces el mismo par.
 *
 * El `tiendaId` es SIEMPRE el actor resuelto por la autenticacion (R32); nunca llega del input.
 */
function paresDistintos(tiendaId: string, filas: readonly ApiOrdenRow[]): ParTarifa[] {
  const vistos = new Set<string>();
  const pares: ParTarifa[] = [];
  for (const fila of filas) {
    const par: ParTarifa = { tiendaId, zonaId: fila.costeo.zonaId };
    const clave = clavePar(par);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    pares.push(par);
  }
  return pares;
}

/** Fila publica del repo -> DTO publico (renombra `estatusValue` a `estado`). */
function toListItemDTO(
  row: ApiOrdenRow,
  tarifaVigente: TarifaVigenteResuelta | null,
): ApiOrdenListItemDTO {
  const { costeo } = row;
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
    // ⏳ 2026-09-09 (feature 404, R14/R18): se COPIA tal cual lo dio el repo —el repo ya lo resolvio
    // en su propia consulta y ya compuso el nombre con la fuente unica—. Aqui no se recompone, no
    // se filtra por estado y no se decide nada: `toDetalleDTO` hace `...toListItemDTO(row)`, asi
    // que el detalle lo hereda por esta misma linea.
    mensajero: row.mensajero,
    // ⏳ 2026-09-10 (feature 415, R1/R2): igual que `mensajero`, se COPIA lo que dio el repo. Las
    // dos claves y nada mas; y nunca `null`, porque `orden.zona_id` es NOT NULL.
    zona: { id: row.zona.id, nombre: row.zona.nombre },
    // ⏳ 2026-09-10 (feature 415, R19/R20/R22): la tarifa VIGENTE del par (tienda, zona) con las
    // entradas VIVAS de la orden. `null` cuando ninguna tarifa resuelve: es el hueco DECLARADO, no
    // cinco ceros (design §D7). Los importes los deriva el modulo puro; aqui no se calcula nada.
    costoEstimado: costoEstimadoDe(tarifaVigente, tarifaVigente?.fulfillment ?? "0.00", {
      esCentral: costeo.esCentral,
      esZonaEspecial: costeo.esZonaEspecial,
      montoCobrar: costeo.montoCobrar,
      cobraComision: costeo.cobraComision,
    }),
    // ⏳ 2026-09-10 (feature 415, R25/R26/R28): la tarifa y las entradas CONGELADAS de la fila
    // elegible que trajo el repo. Sin fila -> `null` («no ha entrado en ningun cierre aprobado»).
    // Con fila y sin tarifa congelada -> cinco `"0.00"`, que es el cero AFIRMADO de design §D8:
    // ese cierre liquido cero, y ahi el cero es verdad. La asimetria con el estimado es
    // deliberada; vive explicada en `lib/utils/api-orden-costo.ts`.
    costoReal:
      costeo.congelado === null
        ? null
        : costoRealDe(costeo.congelado.tarifa, costeo.congelado.fulfillment, {
            esCentral: costeo.congelado.esCentral,
            esZonaEspecial: costeo.congelado.esZonaEspecial,
            montoCobrar: costeo.congelado.montoCobrar,
            cobraComision: costeo.congelado.cobraComision,
          }),
  };
}

/**
 * Feature 106 (design §2/§3) — LECTURA del canal integrador. Fuerza el owner = `actor.usuarioId`
 * (R4), resuelve evidencias como URLs firmadas de 5 min (R15/R17) y mapea a DTO publico SIN
 * `storage_path` crudo, sin bucket, sin PII del mensajero (R16).
 *
 * ⏳ 2026-09-09 (feature 404, R20/R25) — AQUI DECIA «sin PII del mensajero (R16)» a secas, y esa
 * frase ya no describe lo que hace esta clase. Queda ACOTADA, no derogada:
 *   - el mensajero ASIGNADO (`orden.mensajero_asignado_id`) viaja con `id` y `nombre` —y nada mas—
 *     en el item y en el detalle, hacia el DUENO de la orden y solo sobre sus ordenes: el
 *     `ownerId` forzado de R4 no se toca y esta feature no abre ninguna via nueva a una orden
 *     ajena;
 *   - el mensajero que GESTIONO la orden y su texto libre `gestion_orden.motivo` siguen SIN
 *     salir por aqui (256/R22), igual que el `storage_path` crudo, el bucket, el `tiendaId` y el
 *     resto de la PII del mensajero (telefono, email, cedula, foto, zona, vehiculo).
 * La excepcion la firma el humano el 2026-09-09: la cuenta duena ya ve ese mismo nombre completo en
 * la columna «Mensajero» de `/ordenes` y se lo descarga en el XLSX.
 */
export class ApiOrdenLecturaService implements IApiOrdenLecturaService {
  constructor(
    private readonly repo: LecturaRepo,
    private readonly signedUrls: ISignedUrlProvider,
    // ⏳ 2026-09-10 (feature 415, T4/T5): la tarifa VIGENTE con la que se deriva `costoEstimado`.
    // Los DOS composition roots la construyen y la PASAN; que un modulo la importe no basta.
    private readonly tarifaRepo: LecturaTarifaRepo,
  ) {}

  /**
   * ⏳ 2026-09-10 (feature 415, R24) — UNA sola consulta de tarifas por peticion, con los pares
   * DISTINTOS. Con la pagina vacia no se consulta NADA: no hay ni un par que pedir.
   */
  private async tarifasDe(
    ownerId: string,
    filas: readonly ApiOrdenRow[],
  ): Promise<Map<string, TarifaVigenteResuelta | null>> {
    const pares = paresDistintos(ownerId, filas);
    if (pares.length === 0) return new Map();
    return this.tarifaRepo.resolveTarifas(pares);
  }

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
    // R24: los pares DISTINTOS de ESTA pagina en UNA llamada, despues de tener las filas. El
    // numero de consultas no depende del numero de items ni de cuantas zonas distintas haya.
    const tarifas = await this.tarifasDe(actor.usuarioId, items);
    return {
      items: items.map((row) =>
        toListItemDTO(
          row,
          tarifas.get(clavePar({ tiendaId: actor.usuarioId, zonaId: row.costeo.zonaId })) ?? null,
        ),
      ),
      pagination: { limit, offset, total },
    };
  }

  /**
   * Feature 177 (R16/R17) — detalle publico de UNA orden propia por `orden.id` (la resolucion de
   * `{id}` entrega un id, y `num_guia` puede ser NULL). Owner forzado a `actor.usuarioId`
   * (R4/R7).
   *
   * BAJA (2026-08-31): aqui vivia tambien `detalle(actor, numGuia)`, el hermano por `num_guia`
   * de la 106. Se retiro con su endpoint (`GET /api/ordenes/api-key/{numGuia}`): era el mismo
   * mapeo sobre la misma proyeccion, alcanzando menos ordenes —una nacida en `en_preparacion`
   * no tiene guia—. Ver `docs/api/CHANGELOG.md`.
   */
  async detallePorOrdenId(actor: Actor, ordenId: string): Promise<ApiOrdenDetalleDTO | null> {
    const row = await this.repo.findDetalleByOrdenIdForOwner(ordenId, actor.usuarioId);
    return this.toDetalleDTO(actor, row);
  }

  /** Fila del repo -> DTO publico con las evidencias firmadas. */
  private async toDetalleDTO(
    actor: Actor,
    row: ApiOrdenDetalleRow | null,
  ): Promise<ApiOrdenDetalleDTO | null> {
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

    // ⏳ 2026-09-10 (feature 405, R1/R3/R12) — CAMPO A CAMPO, y no `{ ...g }`. Un spread copiaria
    // cualquier cosa que el repositorio anadiera manana a su fila —el texto libre, el id de la
    // gestion, un monto— sin que nadie lo decidiera, y ESA es la fuga que la guardia de lista
    // blanca busca. Aqui no hay Storage que tocar: las gestiones no llevan URL, asi que el orden
    // de la orden sin evidencias sigue sin firmar nada (R18 de la 106).
    const gestiones = row.gestiones.map((g) => ({
      createdAt: g.createdAt,
      resultado: g.resultado,
      estadoResultante: g.estadoResultante,
      motivo: g.motivo,
      // Las DOS claves del mensajero, tambien copiadas y no reenviadas por referencia: si la fila
      // del repositorio trajera una tercera, no cruzaria. Y si `ApiMensajeroDTO` ganara un campo
      // de verdad, esto deja de compilar (falta una propiedad), que es como se quiere enterar uno.
      mensajero: { id: g.mensajero.id, nombre: g.mensajero.nombre },
    }));

    // ⏳ 2026-09-10 (feature 415, T4): el detalle hereda `zona`, `costoEstimado` y `costoReal` por
    // este MISMO spread, sin declarar nada propio. Una sola fila -> un solo par -> UNA llamada.
    const tarifas = await this.tarifasDe(actor.usuarioId, [row]);
    const tarifa =
      tarifas.get(clavePar({ tiendaId: actor.usuarioId, zonaId: row.costeo.zonaId })) ?? null;

    return { ...toListItemDTO(row, tarifa), evidencias, gestiones };
  }
}
