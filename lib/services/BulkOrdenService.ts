// Feature 15 — Orquesta la carga masiva de ordenes: autorizacion, resolucion
// geografica/mensajero por fila, deduplicacion y persistencia batch. Logica de
// negocio pura (sin HTTP, sin Prisma directo, sin parseo de archivo).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolverDestinoCreacion, type DestinoCreacion } from "@/lib/services/destino-creacion";
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
  CreateOrdenConGuiaResultRow,
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
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import { MSG_CARGA_SIN_TARIFA, MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import { ConflictError } from "@/lib/errors/app-error";
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
import { desgloseCargaApi, tieneFulfillment } from "@/lib/utils/ingreso-ordenex";

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
    private readonly tarifaRepo: ITarifaVigenteRepository,
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

    const ctx = await this.precargar(rows, destino.estatus, tiendaId);

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

    // FULFILLMENT (2026-08-25) — EL PREDICADO DE ESTA VIA ES LA TARIFA, NO EL FLAG DEL USUARIO.
    //
    // La feature 155 dejo escrito que la rama (a) de esta via era "defensiva y hoy inalcanzable",
    // y tenia razon con el predicado de entonces: `Usuario.fulfillment` solo puede quedar en
    // `true` para el rol `adminTienda` (`UsuarioService.resolverFulfillment`) y el dueño de una
    // key es un usuario de rol `apiKey`, asi que `findUsuarioFulfillment` respondia SIEMPRE
    // `false` y ningun integrador con bodega en nuestras manos podia marcarse. Ese dia llego, y
    // el predicado que lo resuelve es el MONTO de fulfillment de la tarifa que le resuelve a
    // cada orden (`tarifas.fulfillment > 0`, ver `tieneFulfillment`). La contrapartida hay que
    // decirla en voz alta: poner ese monto en `0.00` no solo deja de cobrar el servicio, ademas
    // mueve donde NACEN las ordenes de esa tienda.
    //
    // Y ES POR ORDEN, NO POR LOTE. La tarifa se resuelve por par (tienda, zona) desde la 274, y
    // dos filas del mismo lote pueden caer en zonas distintas. Decidir el estado por lote seria
    // barato, pero abriria la unica incoherencia que no nos podemos permitir aqui: una orden a
    // la que se le COBRA fulfillment y que nace esperando que alguien la recoja en la tienda.
    // Por eso los dos destinos se preparan por adelantado y cada orden elige el suyo.
    const destinoSinFulfillment = resolverDestinoCreacion(false);
    const destinoConFulfillment = resolverDestinoCreacion(true);

    const [ctx, estatusIdConFulfillment] = await Promise.all([
      this.precargar(rows, destinoSinFulfillment.estatus, tiendaId),
      this.repo.findEstatusIdByValue(destinoConFulfillment.estatus),
    ]);

    if (ctx.estatusId === null || estatusIdConFulfillment === null) {
      // R7: sin el value del catalogo, ninguna fila puede crearse y el error NOMBRA el value
      // que falta (guarda defensiva, patrón `cargarMasiva`). Se exigen los DOS values aunque
      // el lote acabe usando uno solo: cual toca no se sabe hasta resolver las tarifas, y un
      // seed a medias tiene que delatarse en la primera peticion, no en la primera orden con
      // fulfillment.
      const faltante =
        ctx.estatusId === null ? destinoSinFulfillment.estatus : destinoConFulfillment.estatus;
      const filas: CargaViaApiRow[] = rows.map((raw, idx) => ({
        fila: idx + 1,
        numRemision: (raw.num_remision ?? "").trim(),
        resultado: "error",
        errores: {
          estatus: [`estatus inicial "${faltante}" no disponible (seed pendiente)`],
        },
      }));
      // Feature 141/R33: sin ordenes creadas no hay lote.
      return {
        status: "ok",
        summary: this.buildViaApiSummary(rows.length, filas, [], null),
        manifiestoOrdenIds: [],
      };
    }
    const estatusId = ctx.estatusId;

    const filas: CargaViaApiRow[] = [];
    const toCreate: CreateOrdenData[] = [];
    const seen = new Map<string, string>();
    // Feature 98/R2: `esCentral` de cada fila creada, cruzado luego por `numRemision` (igual que
    // `numGuia`) para tarifar SIN N+1. Solo las creadas se tarifan (R4).
    const esCentralPorRemision = new Map<string, boolean>();
    // Hermana de la anterior, por el mismo camino y el mismo cruce (2026-08-25): la marca
    // `zona_especial` del distrito de cada fila, que es la que elige el monto pactado.
    const esZonaEspecialPorRemision = new Map<string, boolean>();
    // Feature 274/R25 (design §4.3): la ZONA de cada fila candidata, por el mismo camino y con
    // el mismo cruce que `esCentralPorRemision`. Es lo que convierte "una tarifa por lote" en
    // "una tarifa por par (tienda, zona)". `geo.zonaId` no es nulo: una fila cuyo distrito no
    // tiene zona ya salio antes como error de cobertura (`geo-resolucion.ts`).
    const zonaPorRemision = new Map<string, string>();
    // Feature 274/R25: indice remision -> posicion en `filas`, para degradar en el sitio la
    // fila de una orden que no resuelve tarifa (R28) sin recorrer el array por cada una y sin
    // contarla dos veces en el summary.
    const indicePorRemision = new Map<string, number>();
    // FULFILLMENT: el destino de creacion de cada orden que SI resolvio tarifa. Mismo camino y
    // mismo cruce por `numRemision` que sus hermanos de arriba.
    const destinoPorRemision = new Map<string, DestinoCreacion>();

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
      esZonaEspecialPorRemision.set(result.createData.numRemision, result.esZonaEspecial);
      zonaPorRemision.set(result.createData.numRemision, result.createData.zonaId); // 274/R25
      indicePorRemision.set(result.createData.numRemision, filas.length);
      filas.push({
        fila,
        numRemision: result.createData.numRemision,
        resultado: "creada",
        estatus: ctx.estatusInicialValue,
      });
    });

    // Feature 274 (R25-R30, design §3.6/§4.3) — LA TARIFA SE RESUELVE ANTES DE PERSISTIR.
    //
    // Hasta la 273 el orden era `toCreate -> createManyOrdenesConGuia -> tarifaLote ->
    // costoEnvio`: la tarifa entraba cuando las ordenes YA existian, y por eso una tienda sin
    // tarifa creaba paquetes con `costoEnvio: "0.00"` (un precio inventado que ya se estaba
    // moviendo). Ahora la falta de tarifa decide ANTES: una fila sin tarifa no llega a
    // insertarse (R28) y un lote donde NINGUNA fila resuelve no deja ni una orden ni una fila
    // de `carga` (R29). Ademas cada orden se tarifa con SU par (tienda, zona), no con una
    // unica tarifa de lote (R25), en UNA sola consulta (R26).
    const tarifaPorRemision = new Map<string, TarifaVigenteResuelta>();
    const conTarifa: CreateOrdenData[] = [];
    if (toCreate.length > 0) {
      // El par de una fila: la tienda de la key (todo el lote es suyo, D4) y la zona de SU
      // distrito, cruzada por `numRemision` igual que `esCentral`.
      const parDe = (orden: CreateOrdenData): ParTarifa => ({
        tiendaId,
        zonaId: zonaPorRemision.get(orden.numRemision) ?? null,
      });
      // Pares DISTINTOS (design §4.3): dos filas de la misma zona son un solo par a resolver.
      const paresPorClave = new Map<string, ParTarifa>();
      for (const orden of toCreate) {
        const par = parDe(orden);
        if (!paresPorClave.has(clavePar(par))) paresPorClave.set(clavePar(par), par);
      }
      const resueltas = await this.tarifaRepo.resolveTarifas([...paresPorClave.values()]); // R26

      const sinTarifa: CreateOrdenData[] = [];
      for (const orden of toCreate) {
        const tarifa = resueltas.get(clavePar(parDe(orden))) ?? null;
        if (tarifa === null) {
          sinTarifa.push(orden);
          continue;
        }
        tarifaPorRemision.set(orden.numRemision, tarifa);
        // FULFILLMENT: aqui, y solo aqui, se decide donde nace ESTA orden. El monto de la
        // tarifa que acaba de resolver es el predicado, y el `estatusId` que se persiste sale
        // del mismo sitio: nunca se escribe un estado que no case con lo que se cobro.
        const destino = tieneFulfillment(tarifa) ? destinoConFulfillment : destinoSinFulfillment;
        destinoPorRemision.set(orden.numRemision, destino);
        conTarifa.push({
          ...orden,
          estatusId: destino === destinoConFulfillment ? estatusIdConFulfillment : estatusId,
        });
      }

      // R29: ninguna de las filas que LLEGARON a resolver resolvio -> 409 y CERO persistencia.
      // Se lanza aqui, antes de tocar la base: sin ordenes, sin fila de `carga`, sin historial
      // y sin la notificacion de fin de lote (no hubo carga que terminar). El borde ya traduce
      // `ConflictError` con `appErrorToResponse`, asi que no hace falta un `status` nuevo.
      //
      // El denominador importa (design §3.6): esto solo se evalua con `toCreate` NO vacio. Un
      // lote entero caido por validacion, duplicidad o cobertura geografica no llega hasta aqui
      // y sale 200 con sus errores de siempre (R30) — la tarifa no es el motivo de su fallo.
      if (conTarifa.length === 0) throw new ConflictError(MSG_CARGA_SIN_TARIFA);

      // R28/R38: fila sin tarifa en un lote donde OTRA si resuelve -> se degrada EN EL SITIO a
      // `error` por el canal de errores por fila que ya existe, y queda fuera de la
      // persistencia. No se le emite ningun `costoEnvio` (tampoco "0.00", R31) porque ese
      // bloque solo lleva ordenes efectivamente creadas.
      for (const orden of sinTarifa) {
        const idx = indicePorRemision.get(orden.numRemision);
        if (idx === undefined) continue; // defensivo: no deberia ocurrir
        filas[idx] = {
          fila: filas[idx].fila,
          numRemision: orden.numRemision,
          resultado: "error",
          errores: { tarifa: [MSG_FILA_SIN_TARIFA] },
        };
      }
    }

    // R9/R10: persistencia con `num_guia` inmediato (misma tx que la creación). El actor del
    // historial es el usuario dedicado de la key; origenTipo `carga_api` (D7).
    //
    // Feature 155/R21: la rama `conGuia: false` ESTA VIVA desde el 2026-08-25. La 155 la
    // escribio declarandola inalcanzable —"el dia que un integrador con bodega propia pueda
    // marcarse"— y ese dia es hoy: las ordenes de una tienda con fulfillment nacen en
    // `en_preparacion` y su `numGuia` viaja como `null`, nunca un numero fabricado.
    //
    // Feature 141 (R30/R31/R32/R33): UNA fila de `carga` por peticion, con `usuario_carga` =
    // usuario dedicado de la key y `total_files` = cantidad de objetos del array recibido
    // (`rows.length`, incluyendo duplicadas y filas con error), NUNCA el tamaño de los batches
    // internos. El id lo genera SIEMPRE el servidor dentro de la tx (`cargaId: null`, R15) y
    // se reutiliza entre batches. `name` es el nombre opcional del lote (R20/R21/R22).
    //
    // Feature 274/R28: lo que se persiste es `conTarifa`, NO `toCreate`: las filas sin tarifa
    // ya salieron del lote unas lineas mas arriba.
    //
    // FULFILLMENT (2026-08-25): DOS grupos, porque `conGuia` es una opcion de la LLAMADA y las
    // dos ramas de la bifurcacion no pueden compartirla — la rama (b) numera en el acto y la
    // (a) no numera nada—. Lo que NO se parte es el lote: el `cargaId` del primer grupo que
    // inserta se le pasa al segundo, asi que sigue habiendo UNA fila de `carga` por peticion
    // (feature 141/R30) y `total_files` sigue siendo el tamaño del array recibido. Un lote
    // homogeneo —el caso normal— hace exactamente una llamada, igual que antes.
    const grupos: Array<{ destino: DestinoCreacion; ordenes: CreateOrdenData[] }> = [
      { destino: destinoSinFulfillment, ordenes: [] },
      { destino: destinoConFulfillment, ordenes: [] },
    ];
    for (const orden of conTarifa) {
      const destino = destinoPorRemision.get(orden.numRemision) ?? destinoSinFulfillment;
      const grupo = grupos.find((g) => g.destino === destino);
      if (grupo) grupo.ordenes.push(orden);
    }

    const creadas: CreateOrdenConGuiaResultRow[] = [];
    let cargaId: string | null = null;
    for (const grupo of grupos) {
      if (grupo.ordenes.length === 0) continue;
      const persistido = await this.repo.createManyOrdenesConGuia(
        grupo.ordenes,
        cargaMasivaConfig.BATCH_SIZE,
        { actorUsuarioId: tiendaId, origenTipo: "carga_api" },
        {
          cargaId, // null en el primero; el id ya resuelto en el segundo (R30: un solo lote)
          usuarioCargaId: tiendaId,
          totalFiles: rows.length,
          name: options.name ?? null,
        },
        { conGuia: grupo.destino.conGuia },
      );
      cargaId = persistido.cargaId ?? cargaId;
      creadas.push(...persistido.creadas);
    }

    // R10: mapea el `num_guia` (por num_remision) a las filas creadas y arma el bloque plano.
    const guiaPorRemision = new Map(creadas.map((c) => [c.numRemision, c]));
    const ordenes: CargaViaApiOrden[] = [];
    // Feature 155/R24/R26 + FULFILLMENT: al manifiesto van SOLO las ordenes de la rama (b) —las
    // que esperan en la tienda—. En un lote mixto eso ya no es una propiedad del lote, asi que
    // el borde recibe la LISTA de ids en vez de un booleano.
    const manifiestoOrdenIds: string[] = [];
    for (const f of filas) {
      if (f.resultado !== "creada") continue;
      const creada = guiaPorRemision.get(f.numRemision);
      if (!creada) continue; // defensivo: una creada sin fila persistida (no debería ocurrir).
      f.numGuia = creada.numGuia;
      f.estatus = creada.estatusValue;
      const destinoDeLaOrden =
        destinoPorRemision.get(creada.numRemision) ?? destinoSinFulfillment;
      if (destinoDeLaOrden.emiteManifiesto) manifiestoOrdenIds.push(creada.ordenId);
      // FULFILLMENT: el desglose de lo que paga la tienda por ESTA orden. `costoEnvio` sigue
      // siendo el total —ahora flete + IVA + fulfillment— y el sumando nuevo viaja al lado
      // para que ese total no haya que adivinarlo.
      const desglose = desgloseCargaApi(
        tarifaPorRemision.get(creada.numRemision) ?? null,
        esCentralPorRemision.get(creada.numRemision) ?? false,
        esZonaEspecialPorRemision.get(creada.numRemision) ?? false,
      );
      ordenes.push({
        id: creada.ordenId,
        numRemision: creada.numRemision,
        numGuia: creada.numGuia,
        estado: creada.estatusValue,
        // Feature 98/R5/R7 + 274/R25: FLETE + IVA del flete de LA TARIFA DE ESTA ORDEN —la del
        // par (tienda, zona del distrito), no una unica del lote—, segun `esCentral` de su zona.
        // Las dos cosas se cruzan por `numRemision`, igual que el `numGuia`.
        //
        // 274/R31: aqui ya no puede salir "0.00" por falta de tarifa. Solo llegan ordenes
        // efectivamente creadas, y una orden solo se crea si su par resolvio (R28); el `?? null`
        // es una guarda de tipos, no un camino vivo.
        costoEnvio: desglose.costoEnvio,
        fulfillment: desglose.fulfillment,
      });
    }

    // FULFILLMENT: las duplicadas INTRA-LOTE reportan el estatus de la fila ganadora, que ya no
    // es el del lote sino el que decidio SU tarifa. Las duplicadas contra la base no se tocan:
    // ahi el estatus es el de la orden que ya existia (R25), y ese no lo decide esta carga.
    const estatusPorRemision = new Map(creadas.map((c) => [c.numRemision, c.estatusValue]));
    for (const f of filas) {
      if (f.resultado !== "duplicada") continue;
      const ganadora = estatusPorRemision.get(f.numRemision);
      if (ganadora !== undefined) f.estatus = ganadora;
    }

    // Feature 141/R39: el `cargaId` del lote de ESTA peticion viaja dentro del summary.
    const summary = this.buildViaApiSummary(rows.length, filas, ordenes, cargaId);

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

    // Feature 155/R24: la seleccion del manifiesto viaja en el RESULTADO DEL SERVICE, no en el
    // summary JSON. El borde (route handler) la necesita para saber que ordenes de este lote
    // van al manifiesto, y esa es una decision interna: el contrato publico solo gana el bloque
    // `manifiesto` cuando lo hay.
    return { status: "ok", summary, manifiestoOrdenIds };
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
    | {
        status: "creada";
        createData: CreateOrdenData;
        esCentral: boolean;
        esZonaEspecial: boolean;
      } {
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
      esZonaEspecial: geo.esZonaEspecial, // marca del distrito: elige el pacto especial
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
    tiendaId: string,
  ): Promise<PreloadedContext> {
    const numRemisiones = distinct(rows.map((r) => (r.num_remision ?? "").trim()).filter(Boolean));

    const [existingMap, provincias, estatusId] = await Promise.all([
      this.repo.findExistingRemisiones(numRemisiones, tiendaId), // R25: duplicado = de ESTA tienda
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
