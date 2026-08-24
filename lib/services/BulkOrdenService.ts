// Feature 15 — Orquesta la carga masiva de ordenes: autorizacion, resolucion
// geografica/mensajero por fila, deduplicacion y persistencia batch. Logica de
// negocio pura (sin HTTP, sin Prisma directo, sin parseo de archivo).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolverDestinoCreacion } from "@/lib/services/destino-creacion";
import {
  emitirBestEffort,
  notificadorNoOp,
  type CargaMasivaNotificador,
} from "@/lib/notificaciones/notificadores";
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
  CargaViaApiOrden,
  CargaViaApiResult,
  CargaViaApiRow,
  CargaViaApiSummary,
  IBulkOrdenService,
} from "@/lib/interfaces/services/IBulkOrdenService";
import type { ITarifaVigentePorTiendaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import {
  distinct,
  geoInputDesdeColumnasSeparadas,
  indexBy,
  normalize,
  resolveGeo,
  type GeoInput,
  type GeoInputExtractor,
  type GeoResult,
} from "@/lib/services/geo-resolucion";
import { parseCantonDistrito } from "@/lib/utils/canton-distrito";
import { costoEnvioDeTarifa } from "@/lib/utils/ingreso-ordenex";

// FEATURE 155/R19/R22: la constante `ESTATUS_INICIAL_API` (= `en_ruta_bodega_central`) se
// RETIRO. Era la tercera regla de nacimiento del sistema y la peor: declaraba que una orden
// recien creada por el integrador ya estaba VIAJANDO hacia la bodega central, sin que nadie la
// hubiera recolectado. Las tres vias comparten ahora el mismo punto de decision
// (`resolverDestinoCreacion`), aplicado sobre el dueño de la orden.

// Feature 276/R22-R26: via sesion, plantilla v3. La provincia llega en su propia
// columna y el par canton/distrito sale de parsear `canton_distrito`; cada fallo es
// un fieldError bajo LA CLAVE DE SU COLUMNA, para que el usuario sepa que celda
// corregir (fila a error, sin llegar a resolveGeo).
//
// NO se unifica con `geoInputDesdeColumnasSeparadas` pese a lo parecidos que quedaron
// (la unica diferencia es `canton_distrito` partido vs `canton`/`distrito` sueltos):
// aquel es el contrato PUBLICO de la feature 88 y fundirlos volveria a dar un solo
// dueño a dos contratos que ya divergieron una vez —la 142 los separo por eso mismo—
// y que pueden volver a divergir. Son dos vias, dos extractores.
function geoInputDesdeCantonDistrito(raw: RawRow): GeoInput {
  const provincia = (raw.provincia ?? "").trim();
  if (provincia === "") {
    return { ok: false, fieldErrors: { provincia: ["provincia es obligatoria"] } };
  }
  const parsed = parseCantonDistrito(raw.canton_distrito ?? "");
  if (!parsed.ok) {
    return { ok: false, fieldErrors: { canton_distrito: [parsed.mensaje] } };
  }
  return {
    ok: true,
    provincia,
    canton: parsed.partes.canton,
    distrito: parsed.partes.distrito,
    direccion: (raw.direccion ?? "").trim(),
  };
}

interface PreloadedContext {
  existingMap: Map<string, string>;
  provinciaIndex: Map<string, ProvinciaRow[]>;
  cantonIndex: Map<string, CantonRow[]>;
  distritoIndex: Map<string, DistritoRow[]>;
  estatusId: string | null;
  // Feature 27/R18/R19 + 155/R4/R16: `value` del estatus inicial resuelto UNA sola vez por
  // LOTE (nunca por fila), reportado por fila creada y en el dedup.
  estatusInicialValue: string;
}

export class BulkOrdenService implements IBulkOrdenService {
  // Feature 98/§6: `tarifaRepo` es dependencia de la via API (tarifar cada orden creada con
  // FLETE + IVA). `cargarMasiva` (via sesion) NO la usa (R9). Requerida en el constructor para
  // que una omision del wiring sea un error de compilacion (money-safe: nunca costoEnvio mudo).
  constructor(
    private readonly repo: IOrdenRepository,
    private readonly tarifaRepo: ITarifaVigentePorTiendaRepository,
    /**
     * Feature 146 (R22/R25): notificador de "carga masiva terminada". El DEFAULT es NO-OP: el
     * composition root (`app/api/ordenes/api-key/carga/route.ts`) inyecta el real. Solo lo usa
     * `cargarViaApi`, que SI tiene fin de lote real (una peticion = un lote); la carga por UI
     * la trocea el cliente y se cierra con la Server Action `notificarCargaMasivaTerminada`
     * (F1.4-4). BEST-EFFORT: una notificacion perdida no puede invalidar una carga de cientos
     * de ordenes ya persistidas.
     */
    private readonly notificarCarga: CargaMasivaNotificador = notificadorNoOp,
  ) {}

  async cargarMasiva(
    rows: RawRow[],
    actor: Actor,
    options: { dryRun?: boolean; cargaId?: string; name?: string; totalFiles?: number } = {},
  ): Promise<BulkOrdenResult> {
    // R11: SOLO adminTienda, sin tocar datos ni pre-cargar nada para otros roles.
    if (actor.rol !== "adminTienda") return { status: "forbidden" };

    const tiendaId = actor.usuarioId; // R24: siempre la tienda del actor

    // Feature 27/R15-R18 + 155/R1/R4/R6/R16: UNA sola lectura del flag `fulfillment` por
    // LOTE (no por fila) y UNA sola llamada al punto de decision compartido. El adminTienda
    // solo puede cargar para si mismo, asi que el dueño de las ordenes es el actor.
    const destino = resolverDestinoCreacion(await this.repo.findUsuarioFulfillment(tiendaId));

    const ctx = await this.precargar(rows, destino.estatus);

    if (ctx.estatusId === null) {
      // R7/R20: sin el value del catalogo NO se crea ninguna orden y el error NOMBRA el
      // value que falta (guarda defensiva, patron `OrdenService.crear`).
      const filas: RowResult[] = rows.map((raw, idx) => ({
        fila: idx + 1,
        numRemision: (raw.num_remision ?? "").trim(),
        resultado: "error",
        errores: {
          estatus: [`estatus inicial "${destino.estatus}" no disponible (seed pendiente)`],
        },
      }));
      // Feature 141/R28: ninguna orden persistida -> ningun lote (`cargaId` null).
      return { status: "ok", summary: this.buildSummary(rows.length, filas, null) };
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
      // Feature 276: la via sesion deriva la geografia de `provincia` +
      // `canton_distrito` (plantilla v3, corte duro: no hay camino desde la columna
      // unica de la v2 ni desde las columnas de la v1).
      const result = this.resolveFila(raw, ctx, seen, geoInputDesdeCantonDistrito);
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

    // Dry-run / validación previa (R17): se omite TODA la persistencia; el summary ya lleva
    // la clasificación completa (creadas/duplicadas/error) para el preview, con el estado
    // inicial que correspondería. Al salir antes de tocar el repositorio, el dry-run no
    // consume NINGÚN `num_guia` ni deja historial, tampoco en la rama (b).
    // Feature 141 (R27/R28): sin persistencia no hay lote — ni en dry-run ni cuando el chunk
    // no aporta ninguna orden nueva.
    let cargaId: string | null = null;
    if (!options.dryRun && toCreate.length > 0) {
      // R27 + feature 49/#1 (R9/R21/R23): el actor de la carga masiva es la tienda que
      // carga (el adminTienda autenticado); cada orden creada deja su primera fila de
      // historial (origen null -> estado inicial, origenTipo carga_masiva) en la MISMA tx.
      const historial = { actorUsuarioId: tiendaId, origenTipo: "carga_masiva" } as const;
      // Feature 141 (R15/R16/R17/R26/R29): contexto del LOTE, IDENTICO en las dos ramas de
      // la bifurcación de la 155 — el lote es del canal de carga, no del destino físico de
      // las órdenes, así que una tienda con bodega propia y una sin ella cuelgan sus órdenes
      // del mismo tipo de fila de `carga`.
      const lote = {
        // Token de lote EMITIDO POR EL SERVIDOR en el primer chunk y reenviado por el
        // cliente en los siguientes. `null` = esta petición crea el lote (el repo genera el
        // id); el cliente nunca lo propone.
        cargaId: options.cargaId ?? null,
        usuarioCargaId: tiendaId, // R2: el adminTienda autenticado realiza la carga
        // R29: total de la SESIÓN declarado por el cliente. El fallback `rows.length` solo
        // aplica si el cliente no lo declara: degrada al tamaño del chunk, nunca a 0.
        totalFiles: options.totalFiles ?? rows.length,
        name: options.name ?? null, // R21/R22: solo lo persiste la creación del lote
      };
      // Feature 155/R3/R8/R11: la rama que numera usa la ruta de lote CON guia (misma
      // secuencia atomica, guarda `num_guia IS NULL`); la otra, la de siempre. Las dos
      // encolan geocodificacion por orden efectivamente insertada.
      if (destino.conGuia) {
        const persistido = await this.repo.createManyOrdenesConGuia(
          toCreate,
          cargaMasivaConfig.BATCH_SIZE,
          historial,
          lote,
        );
        cargaId = persistido.cargaId;
      } else {
        const persistido = await this.repo.createManyOrdenes(
          toCreate,
          cargaMasivaConfig.BATCH_SIZE,
          historial,
          lote,
        );
        cargaId = persistido.cargaId;
      }
    }

    return { status: "ok", summary: this.buildSummary(rows.length, filas, cargaId) };
  }

  async cargarViaApi(
    rows: RawRow[],
    actor: Actor,
    options: { name?: string } = {},
  ): Promise<CargaViaApiResult> {
    // R15: SOLO el rol `apiKey` (el usuario dedicado de la key). La vía sesión sigue
    // exigiendo `adminTienda` en `cargarMasiva` (intacta, R14). Sin tocar datos para otros
    // roles: defensa en profundidad sobre la autenticación por key del borde.
    if (actor.rol !== "apiKey") return { status: "forbidden" };

    const tiendaId = actor.usuarioId; // D4: el usuario dedicado de la key es el dueño.

    // Feature 155/R19: MISMA llamada que la via sesion, sobre el dueño de la key. El canal
    // por el que entra un dato no dice nada sobre donde esta fisicamente el paquete, asi que
    // deja de haber un estado inicial fijo para la API.
    const destino = resolverDestinoCreacion(await this.repo.findUsuarioFulfillment(tiendaId));

    const ctx = await this.precargar(rows, destino.estatus);

    if (ctx.estatusId === null) {
      // R7: sin el value del catalogo, ninguna fila puede crearse y el error NOMBRA el value
      // que falta (guarda defensiva, patrón `cargarMasiva`).
      const filas: CargaViaApiRow[] = rows.map((raw, idx) => ({
        fila: idx + 1,
        numRemision: (raw.num_remision ?? "").trim(),
        resultado: "error",
        errores: {
          estatus: [`estatus inicial "${destino.estatus}" no disponible (seed pendiente)`],
        },
      }));
      // Feature 141/R33: sin ordenes creadas no hay lote.
      return {
        status: "ok",
        summary: this.buildViaApiSummary(rows.length, filas, [], null),
        destino,
      };
    }
    const estatusId = ctx.estatusId;

    const filas: CargaViaApiRow[] = [];
    const toCreate: CreateOrdenData[] = [];
    const seen = new Map<string, string>();
    // Feature 98/R2: `esCentral` de cada fila creada, cruzado luego por `numRemision` (igual que
    // `numGuia`) para tarifar SIN N+1. Solo las creadas se tarifan (R4).
    const esCentralPorRemision = new Map<string, boolean>();

    rows.forEach((raw, idx) => {
      const fila = idx + 1;
      // R7: mismas reglas que la carga masiva, pero con la geografia en columnas
      // separadas (feature 142/R38: el contrato publico de la 88 no cambia).
      const result = this.resolveFila(raw, ctx, seen, geoInputDesdeColumnasSeparadas);
      if (result.status === "error") {
        filas.push({ fila, numRemision: result.numRemision, resultado: "error", errores: result.errores });
        return;
      }
      if (result.status === "duplicada") {
        filas.push({ fila, numRemision: result.numRemision, resultado: "duplicada", estatus: result.estatus });
        return;
      }
      toCreate.push({ ...result.createData, estatusId, tiendaId });
      esCentralPorRemision.set(result.createData.numRemision, result.esCentral); // R2
      filas.push({
        fila,
        numRemision: result.createData.numRemision,
        resultado: "creada",
        estatus: ctx.estatusInicialValue,
      });
    });

    // Feature 98/R1/R3: tarifa vigente de la tienda resuelta UNA sola vez por lote (todo el lote
    // es de una tienda, `actor.usuarioId`), sin N+1. `null` si la tienda no tiene tarifa (gap
    // D1/R8 -> costoEnvio "0.00"). No se consulta si no hay ninguna orden creada (nada que tarifar).
    const tarifaLote =
      toCreate.length > 0 ? await this.tarifaRepo.resolveTarifaPorTienda(tiendaId) : null;

    // R9/R10: persistencia con `num_guia` inmediato (misma tx que la creación). El actor del
    // historial es el usuario dedicado de la key; origenTipo `carga_api` (D7).
    //
    // Feature 155/R21: la rama `conGuia: false` es DEFENSIVA y hoy inalcanzable — el switch de
    // fulfillment solo se acepta para el rol `adminTienda` y el dueño de una key es un usuario
    // de rol `apiKey`, asi que estructuralmente cae siempre en la rama (b) (decision del gate
    // del 2026-07-29, pregunta 3). Se escribe igual: el dia que un integrador con bodega
    // propia pueda marcarse, sus ordenes nacen en `en_preparacion` y su `numGuia` viaja como
    // `null` — nunca un numero fabricado.
    //
    // Feature 141 (R30/R31/R32/R33): UNA fila de `carga` por peticion, con `usuario_carga` =
    // usuario dedicado de la key y `total_files` = cantidad de objetos del array recibido
    // (`rows.length`, incluyendo duplicadas y filas con error), NUNCA el tamaño de los batches
    // internos. El id lo genera SIEMPRE el servidor dentro de la tx (`cargaId: null`, R15) y
    // se reutiliza entre batches. `name` es el nombre opcional del lote (R20/R21/R22).
    const persistido =
      toCreate.length > 0
        ? await this.repo.createManyOrdenesConGuia(
            toCreate,
            cargaMasivaConfig.BATCH_SIZE,
            { actorUsuarioId: tiendaId, origenTipo: "carga_api" },
            {
              cargaId: null,
              usuarioCargaId: tiendaId,
              totalFiles: rows.length,
              name: options.name ?? null,
            },
            { conGuia: destino.conGuia },
          )
        : { creadas: [], cargaId: null };
    const creadas = persistido.creadas;

    // R10: mapea el `num_guia` (por num_remision) a las filas creadas y arma el bloque plano.
    const guiaPorRemision = new Map(creadas.map((c) => [c.numRemision, c]));
    const ordenes: CargaViaApiOrden[] = [];
    for (const f of filas) {
      if (f.resultado !== "creada") continue;
      const creada = guiaPorRemision.get(f.numRemision);
      if (!creada) continue; // defensivo: una creada sin fila persistida (no debería ocurrir).
      f.numGuia = creada.numGuia;
      f.estatus = creada.estatusValue;
      ordenes.push({
        id: creada.ordenId,
        numRemision: creada.numRemision,
        numGuia: creada.numGuia,
        estado: creada.estatusValue,
        // Feature 98/R5/R7: FLETE + IVA del flete de la tarifa del lote, segun `esCentral` de la
        // zona de esta orden (cruzado por numRemision). Gap de tarifa -> "0.00" (D1/R8).
        costoEnvio: costoEnvioDeTarifa(tarifaLote, esCentralPorRemision.get(creada.numRemision) ?? false),
      });
    }

    // Feature 141/R39: el `cargaId` del lote de ESTA peticion viaja dentro del summary.
    const summary = this.buildViaApiSummary(rows.length, filas, ordenes, persistido.cargaId);

    // Feature 146/R22/R25: aviso `box` al usuario ejecutor (el dueño de la API key), server-side
    // porque esta via SI conoce el fin del lote. Va DESPUES de la persistencia y absorbe su
    // propio fallo: la carga ya esta hecha y su respuesta no puede depender del aviso.
    await emitirBestEffort("carga_masiva_terminada", () =>
      this.notificarCarga({
        usuarioId: tiendaId,
        creadas: summary.creadas,
        total: summary.total,
        loteId: randomUUID(),
      }),
    );

    // Feature 155/R24: `destino` viaja en el RESULTADO DEL SERVICE, no en el summary JSON. El
    // borde (route handler) lo necesita para saber si este lote emite manifiesto, y esa es una
    // decision interna: el contrato publico solo gana el bloque `manifiesto` cuando lo hay.
    return { status: "ok", summary, destino };
  }

  private buildViaApiSummary(
    total: number,
    filas: CargaViaApiRow[],
    ordenes: CargaViaApiOrden[],
    cargaId: string | null, // feature 141/R39
  ): CargaViaApiSummary {
    return {
      total,
      creadas: filas.filter((f) => f.resultado === "creada").length,
      duplicadas: filas.filter((f) => f.resultado === "duplicada").length,
      conError: filas.filter((f) => f.resultado === "error").length,
      filas,
      ordenes,
      cargaId,
    };
  }

  private buildSummary(
    total: number,
    filas: RowResult[],
    cargaId: string | null, // feature 141/R38
  ): BulkSummary {
    return {
      total,
      creadas: filas.filter((f) => f.resultado === "creada").length,
      duplicadas: filas.filter((f) => f.resultado === "duplicada").length,
      conError: filas.filter((f) => f.resultado === "error").length,
      filas,
      cargaId,
    };
  }

  // Resuelve una fila cruda contra el contexto pre-cargado: validacion de
  // campos (R18/R22/R23), geografia (R19/R20/R21), dedup intra-archivo (R26) y
  // contra DB (R25). No persiste nada; solo decide el destino de la fila.
  private resolveFila(
    raw: RawRow,
    ctx: PreloadedContext,
    seen: Map<string, string>,
    // Feature 142 (design.md §4): la via decide de donde sale la geografia.
    geoInputOf: GeoInputExtractor,
  ):
    | { status: "error"; numRemision: string; errores: Record<string, string[]> }
    | { status: "duplicada"; numRemision: string; estatus: string }
    // Feature 98/R2: la creada expone tambien `esCentral` (zona) para tarifar la carga por API
    // sin N+1; la via sesion (cargarMasiva) lo ignora.
    | { status: "creada"; createData: CreateOrdenData; esCentral: boolean } {
    const numRemisionRaw = (raw.num_remision ?? "").trim();

    const parsed = filaCargaSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      return { status: "error", numRemision: numRemisionRaw, errores: fieldErrors };
    }
    const data = parsed.data;

    // Feature 142/R29 (276/R26): si el extractor de la via falla (p. ej. formato
    // invalido de `canton_distrito`), la fila va a error con SU clave, sin llegar a
    // resolveGeo. Si tiene exito, resolveGeo recibe exactamente los mismos 3
    // nombres de siempre (R33-R36, mensajes intactos).
    const geoInput = geoInputOf(raw);
    const geoResult: GeoResult = geoInput.ok
      ? resolveGeo(geoInput, ctx.provinciaIndex, ctx.cantonIndex, ctx.distritoIndex)
      : { ok: false, fieldErrors: geoInput.fieldErrors };

    const fieldErrors: Record<string, string[]> = {};
    if (!geoResult.ok) Object.assign(fieldErrors, geoResult.fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "error", numRemision: data.num_remision, errores: fieldErrors };
    }
    // Invariante: fieldErrors vacio implica que geoResult resolvio "ok" (su rama
    // !ok es la unica que agrega claves a fieldErrors). Y un geoResult ok implica
    // un geoInput ok (es su unica fuente).
    const geo = (geoResult as Extract<GeoResult, { ok: true }>).geo;
    const direccionLiteral = (geoInput as Extract<GeoInput, { ok: true }>).direccion;

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
      esCentral: geo.esCentral, // feature 98/R2
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
        // R37: la direccion literal se persiste en el mismo campo de siempre;
        // vacia -> null (igual que la columna `direccion` vacia de hoy, R26).
        direccion: direccionLiteral === "" ? null : direccionLiteral,
        montoCobrar: data.monto_cobrar,
      },
    };
  }

  private async precargar(
    rows: RawRow[],
    estatusInicialValue: string,
  ): Promise<PreloadedContext> {
    const numRemisiones = distinct(rows.map((r) => (r.num_remision ?? "").trim()).filter(Boolean));

    const [existingMap, provincias, estatusId] = await Promise.all([
      this.repo.findExistingRemisiones(numRemisiones), // R25
      // R19/R21: TODAS las provincias; el match por nombre se hace abajo normalizando
      // ambos lados (insensible a acentos), no en la query.
      this.repo.findAllProvincias(),
      this.repo.findEstatusIdByValue(estatusInicialValue), // R7/R20: estatus inicial del lote
    ]);
    const provinciaIndex = indexBy(provincias, (p) => normalize(p.nombre));

    const provinciaIds = distinct(provincias.map((p) => p.id));
    const cantones = await this.repo.findCantonesByProvinciaIds(provinciaIds); // R19
    const cantonIndex = indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`);

    const cantonIds = distinct(cantones.map((c) => c.id));
    const distritos = await this.repo.findDistritosByCantonIds(cantonIds); // R19
    const distritoIndex = indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`);

    return {
      existingMap,
      provinciaIndex,
      cantonIndex,
      distritoIndex,
      estatusId,
      estatusInicialValue,
    };
  }
}
