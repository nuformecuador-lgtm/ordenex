// Feature 15 — Orquesta la carga masiva de ordenes: autorizacion, resolucion
// geografica/mensajero por fila, deduplicacion y persistencia batch. Logica de
// negocio pura (sin HTTP, sin Prisma directo, sin parseo de archivo).
import { z } from "zod";
import { ordenesConfig } from "@/lib/config/ordenes";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { filaCargaSchema, type BulkSummary, type RowResult } from "@/lib/types/carga-masiva";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type {
  CantonRow,
  CreateOrdenData,
  DistritoRow,
  IOrdenRepository,
  ProvinciaRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BulkOrdenResult,
  IBulkOrdenService,
} from "@/lib/interfaces/services/IBulkOrdenService";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

// R19/R20: indice ambiguo-aware, clave normalizada -> filas candidatas.
// length 0 = no existe; length 1 = resuelto; length > 1 = ambiguo dentro del padre.
function indexBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

type LookupResult<T> =
  | { status: "found"; row: T }
  | { status: "missing" }
  | { status: "ambiguous" };

function lookup<T>(index: Map<string, T[]>, key: string): LookupResult<T> {
  const bucket = index.get(key);
  if (!bucket || bucket.length === 0) return { status: "missing" };
  if (bucket.length > 1) return { status: "ambiguous" };
  return { status: "found", row: bucket[0] };
}

interface ResolvedGeo {
  provinciaId: string;
  zonaId: string;
  cantonId: string;
  distritoId: string | null;
}

type GeoResult =
  | { ok: true; geo: ResolvedGeo }
  | { ok: false; fieldErrors: Record<string, string[]> };

// R19/R20/R21: resuelve provincia -> canton (dentro de la provincia) -> distrito
// (dentro del canton, opcional) por nombre, y deriva zonaId de la provincia.
function resolveGeo(
  raw: { provincia: string; canton: string; distrito: string },
  provinciaIndex: Map<string, ProvinciaRow[]>,
  cantonIndex: Map<string, CantonRow[]>,
  distritoIndex: Map<string, DistritoRow[]>,
): GeoResult {
  const provinciaResult = lookup(provinciaIndex, normalize(raw.provincia));
  if (provinciaResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        provincia: [
          provinciaResult.status === "ambiguous"
            ? "provincia ambigua"
            : "provincia no encontrada",
        ],
      },
    };
  }
  const provincia = provinciaResult.row;

  const cantonResult = lookup(cantonIndex, `${provincia.id}::${normalize(raw.canton)}`);
  if (cantonResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        canton: [
          cantonResult.status === "ambiguous"
            ? "canton ambiguo en la provincia"
            : "canton no encontrado en la provincia",
        ],
      },
    };
  }
  const canton = cantonResult.row;

  // Feature 24/R4 (parcial): `provincia.zona_id` es nullable. La orden exige una
  // zona (NOT NULL); una provincia sin zona -> fila con error hasta que la
  // derivacion de zona en carga masiva migre al modelo por-distrito.
  if (provincia.zonaId === null) {
    return { ok: false, fieldErrors: { provincia: ["la provincia no tiene zona asignada"] } };
  }
  const zonaId = provincia.zonaId;

  if (raw.distrito.trim() === "") {
    return {
      ok: true,
      geo: { provinciaId: provincia.id, zonaId, cantonId: canton.id, distritoId: null },
    };
  }

  const distritoResult = lookup(distritoIndex, `${canton.id}::${normalize(raw.distrito)}`);
  if (distritoResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        distrito: [
          distritoResult.status === "ambiguous"
            ? "distrito ambiguo en el canton"
            : "distrito no encontrado en el canton",
        ],
      },
    };
  }

  return {
    ok: true,
    geo: {
      provinciaId: provincia.id,
      zonaId,
      cantonId: canton.id,
      distritoId: distritoResult.row.id,
    },
  };
}

type MensajeroResult =
  | { ok: true; id: string | null }
  | { ok: false; fieldErrors: Record<string, string[]> };

// R22: vacio -> null; provisto -> debe existir con rol mensajero.
function resolveMensajero(mensajeroSugeridoId: string | null, validos: Set<string>): MensajeroResult {
  if (mensajeroSugeridoId === null) return { ok: true, id: null };
  if (!validos.has(mensajeroSugeridoId)) {
    return {
      ok: false,
      fieldErrors: { mensajero_sugerido_id: ["mensajero_sugerido_id no valido"] },
    };
  }
  return { ok: true, id: mensajeroSugeridoId };
}

interface PreloadedContext {
  existingMap: Map<string, string>;
  provinciaIndex: Map<string, ProvinciaRow[]>;
  cantonIndex: Map<string, CantonRow[]>;
  distritoIndex: Map<string, DistritoRow[]>;
  mensajerosValidos: Set<string>;
  estatusId: string | null;
  // Feature 27/R18/R19: `value` del estatus inicial resuelto UNA vez por lote
  // (en_fulfillment | en_preparacion), reportado por fila creada y en el dedup.
  estatusInicialValue: string;
}

export class BulkOrdenService implements IBulkOrdenService {
  constructor(private readonly repo: IOrdenRepository) {}

  async cargarMasiva(rows: RawRow[], actor: Actor): Promise<BulkOrdenResult> {
    // R11: SOLO adminTienda, sin tocar datos ni pre-cargar nada para otros roles.
    if (actor.rol !== "adminTienda") return { status: "forbidden" };

    const tiendaId = actor.usuarioId; // R24: siempre la tienda del actor

    // Feature 27/R15/R16/R17/R18: se resuelve UNA sola vez por lote el estatus
    // inicial a partir del flag `fulfillment` de la tienda que carga (el actor).
    const fulfillment = await this.repo.findUsuarioFulfillment(tiendaId);
    const estatusInicialValue = fulfillment
      ? ordenesConfig.FULFILLMENT_ESTATUS_VALUE // "en_fulfillment"
      : ordenesConfig.DEFAULT_ESTATUS_VALUE; // "en_preparacion"

    const ctx = await this.precargar(rows, estatusInicialValue);

    if (ctx.estatusId === null) {
      // Guarda defensiva (patron OrdenService.crear): el seed del estatus inicial
      // requerido no esta disponible. Ninguna fila puede crearse (R20).
      const filas: RowResult[] = rows.map((raw, idx) => ({
        fila: idx + 1,
        numRemision: (raw.num_remision ?? "").trim(),
        resultado: "error",
        errores: {
          estatus: [`estatus inicial "${estatusInicialValue}" no disponible (seed pendiente)`],
        },
      }));
      return { status: "ok", summary: this.buildSummary(rows.length, filas) };
    }
    const estatusId = ctx.estatusId;

    const filas: RowResult[] = [];
    const toCreate: CreateOrdenData[] = [];
    // R25/R26: remision -> estatus a reportar en duplicados subsiguientes (el
    // de la orden existente en DB, o el default si la "ganadora" es una fila
    // nueva de este mismo archivo).
    const seen = new Map<string, string>();

    rows.forEach((raw, idx) => {
      const fila = idx + 1;
      const result = this.resolveFila(raw, ctx, seen);
      if (result.status === "error") {
        filas.push({ fila, numRemision: result.numRemision, resultado: "error", errores: result.errores });
        return;
      }
      if (result.status === "duplicada") {
        filas.push({ fila, numRemision: result.numRemision, resultado: "duplicada", estatus: result.estatus });
        return;
      }

      toCreate.push({ ...result.createData, estatusId, tiendaId });
      filas.push({
        fila,
        numRemision: result.createData.numRemision,
        resultado: "creada",
        estatus: ctx.estatusInicialValue, // R19: estatus resuelto por lote (R16/R17)
      });
    });

    if (toCreate.length > 0) {
      await this.repo.createManyOrdenes(toCreate, cargaMasivaConfig.BATCH_SIZE); // R27
    }

    return { status: "ok", summary: this.buildSummary(rows.length, filas) };
  }

  private buildSummary(total: number, filas: RowResult[]): BulkSummary {
    return {
      total,
      creadas: filas.filter((f) => f.resultado === "creada").length,
      duplicadas: filas.filter((f) => f.resultado === "duplicada").length,
      conError: filas.filter((f) => f.resultado === "error").length,
      filas,
    };
  }

  // Resuelve una fila cruda contra el contexto pre-cargado: validacion de
  // campos (R18/R22/R23), geografia (R19/R20/R21), dedup intra-archivo (R26) y
  // contra DB (R25). No persiste nada; solo decide el destino de la fila.
  private resolveFila(
    raw: RawRow,
    ctx: PreloadedContext,
    seen: Map<string, string>,
  ):
    | { status: "error"; numRemision: string; errores: Record<string, string[]> }
    | { status: "duplicada"; numRemision: string; estatus: string }
    | { status: "creada"; createData: CreateOrdenData } {
    const numRemisionRaw = (raw.num_remision ?? "").trim();

    const parsed = filaCargaSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      return { status: "error", numRemision: numRemisionRaw, errores: fieldErrors };
    }
    const data = parsed.data;

    const geoResult = resolveGeo(
      { provincia: raw.provincia ?? "", canton: raw.canton ?? "", distrito: raw.distrito ?? "" },
      ctx.provinciaIndex,
      ctx.cantonIndex,
      ctx.distritoIndex,
    );
    const mensajeroResult = resolveMensajero(data.mensajero_sugerido_id, ctx.mensajerosValidos);

    const fieldErrors: Record<string, string[]> = {};
    if (!geoResult.ok) Object.assign(fieldErrors, geoResult.fieldErrors);
    if (!mensajeroResult.ok) Object.assign(fieldErrors, mensajeroResult.fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "error", numRemision: data.num_remision, errores: fieldErrors };
    }
    // Invariante: fieldErrors vacio implica que ambos resolvieron "ok" (los
    // unicos casos que agregan claves a fieldErrors son las ramas !ok).
    const geo = (geoResult as Extract<GeoResult, { ok: true }>).geo;
    const mensajeroSugeridoId = (mensajeroResult as Extract<MensajeroResult, { ok: true }>).id;

    // R26: dedup intra-archivo, primera ocurrencia gana; reporta el mismo
    // estatus que se reporto/reportara para la ganadora.
    const seenEstatus = seen.get(data.num_remision);
    if (seenEstatus !== undefined) {
      return { status: "duplicada", numRemision: data.num_remision, estatus: seenEstatus };
    }
    // R25: dedup contra DB, expone el estatus de la orden existente.
    const existingEstatus = ctx.existingMap.get(data.num_remision);
    if (existingEstatus !== undefined) {
      seen.set(data.num_remision, existingEstatus);
      return { status: "duplicada", numRemision: data.num_remision, estatus: existingEstatus };
    }
    seen.set(data.num_remision, ctx.estatusInicialValue); // R19: estatus resuelto por lote

    return {
      status: "creada",
      createData: {
        numRemision: data.num_remision,
        estatusId: "", // el llamador lo completa (ya resuelto una sola vez, R7)
        destinatario: data.destinatario,
        telefonoDest: data.telefono,
        tiendaId: "", // el llamador lo completa (R24)
        zonaId: geo.zonaId,
        provinciaId: geo.provinciaId,
        cantonId: geo.cantonId,
        distritoId: geo.distritoId,
        producto: data.producto,
        peso: null, // R4: la carga masiva no trae peso
        notas: data.notas === "" ? null : data.notas,
        direccion: data.direccion === "" ? null : data.direccion,
        montoCobrar: data.monto_cobrar,
        mensajeroSugeridoId,
      },
    };
  }

  private async precargar(
    rows: RawRow[],
    estatusInicialValue: string,
  ): Promise<PreloadedContext> {
    const numRemisiones = distinct(rows.map((r) => (r.num_remision ?? "").trim()).filter(Boolean));
    const provinciaNames = distinct(rows.map((r) => (r.provincia ?? "").trim()).filter(Boolean));
    const mensajeroIds = distinct(
      rows.map((r) => (r.mensajero_sugerido_id ?? "").trim()).filter(Boolean),
    );

    const [existingMap, provincias, estatusId] = await Promise.all([
      this.repo.findExistingRemisiones(numRemisiones), // R25
      this.repo.findProvinciasByNombres(provinciaNames), // R19/R21
      this.repo.findEstatusIdByValue(estatusInicialValue), // R7/R20: estatus inicial del lote
    ]);
    const provinciaIndex = indexBy(provincias, (p) => normalize(p.nombre));

    const provinciaIds = distinct(provincias.map((p) => p.id));
    const cantones = await this.repo.findCantonesByProvinciaIds(provinciaIds); // R19
    const cantonIndex = indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`);

    const cantonIds = distinct(cantones.map((c) => c.id));
    const [distritos, mensajerosValidos] = await Promise.all([
      this.repo.findDistritosByCantonIds(cantonIds), // R19
      this.repo.findMensajerosByIds(mensajeroIds), // R22
    ]);
    const distritoIndex = indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`);

    return {
      existingMap,
      provinciaIndex,
      cantonIndex,
      distritoIndex,
      mensajerosValidos,
      estatusId,
      estatusInicialValue,
    };
  }
}
