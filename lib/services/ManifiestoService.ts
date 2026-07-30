// Feature 148 — SERVICIO UNICO del manifiesto (R1): el unico modulo de software que
// arma filas de manifiesto, para los 6 puntos de enganche. Ningun flujo construye las
// columnas por su cuenta y NINGUNO de los 5 servicios de negocio
// (BulkOrdenService, GuiaAsignacionService, AsignacionSateliteService,
// EnvioDevolucionCentralService, DevolucionOrigenService) se toca: el manifiesto es un
// READ derivado posterior a la operacion ya cometida (R27, design.md §1/D4).
//
// Logica de negocio pura: no conoce HTTP ni Prisma (repos inyectados por constructor).
// SOLO LECTURA (R24): las unicas dependencias que usa son metodos `find*`.
import type { IOrdenRepository, ManifiestoOrdenRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  IManifiestoService,
  ManifiestoServiceResult,
} from "@/lib/interfaces/services/IManifiestoService";
import type {
  ManifiestoFilaDTO,
  ManifiestoFlujo,
  ManifiestoInput,
  ManifiestoOmitidaDTO,
} from "@/lib/types/manifiesto";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * Etiqueta de respaldo de la bodega central cuando NO hay zona `esCentral`
 * configurada (design.md §9.2, decision cerrada en el gate F1.4). La descarga NUNCA
 * falla por este dato de catalogo ni deja la celda vacia: tres de los seis flujos
 * (carga masiva, devolucion a central, envio a la tienda) no abortan hoy por falta de
 * zona central, asi que el manifiesto tampoco puede hacerlo.
 */
export const BODEGA_CENTRAL_FALLBACK = "Bodega central";

/**
 * Respaldo de `responsable` cuando el NOMBRE del ejecutor no se puede resolver
 * (`findUsuarioNombre` devuelve `null`: usuario borrado entre la operacion y la
 * descarga). Decision del humano tras el review: se emite un guion largo, NO cadena
 * vacia —para que la celda se lea como "sin dato conocido" y no como un hueco— y NO
 * un texto de rol, que §9.8 prohibe explicitamente.
 */
export const RESPONSABLE_FALLBACK = "—"; // em dash

// Solo los metodos de LECTURA que el manifiesto necesita. Usar `Pick` (patron
// `ZonaRepo` de CorteDiarioService/CierreDiaService) documenta en el tipo que este
// servicio no puede escribir: `create`, `update`, `generarGuiaLote`... ni siquiera
// son alcanzables desde aqui (R24).
type OrdenRepo = Pick<
  IOrdenRepository,
  "findManifiestoByIds" | "findManifiestoByRemisiones" | "findUsuarioNombre"
>;
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId" | "findById">;

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * R29 — ¿puede este actor ver esta orden en el manifiesto? Mismo criterio que
 * `EtiquetaGuiaService.esVisiblePara`: el rol `apiKey` (canal de integracion) SOLO ve
 * las ordenes de su propia tienda (`actor.usuarioId` es el `tienda_id` con el que se
 * crean sus ordenes). Los roles de sesion mantienen el acceso completo: el manifiesto
 * es un READ derivado del lote que el propio usuario acaba de operar, y la sesion ya
 * se exige en el borde (R28).
 */
function esVisiblePara(row: ManifiestoOrdenRow, actor: Actor): boolean {
  if (actor.rol !== "apiKey") return true;
  return row.tiendaId === actor.usuarioId;
}

// Contexto de las tres etiquetas "de sistema" que la tabla de design.md §4 usa por
// encima de los datos de la propia orden.
interface UbicacionCtx {
  central: string; // zona `esCentral` (o el respaldo) — design.md §9.2
  actor: string; // nombre del usuario que ejecuto la operacion — design.md §9.8
}

/**
 * R8/R9 — tabla `origen`/`destino`/`responsable` de design.md §4, en UN solo lugar.
 * `origen`/`destino` son la ubicacion FISICA de salida y de llegada del movimiento de
 * ESA operacion, no la tienda/zona de la orden en abstracto.
 *
 * `responsable` (design.md §9.8): manda el MENSAJERO cuando el flujo dejo uno
 * asignado; si no hay mensajero, el nombre del usuario que ejecuto. Sin textos de rol.
 * La distincion GAM/no-GAM de `generacion_guia` se deriva de datos YA persistidos
 * (`zonaEsCentral` + `mensajeroAsignadoNombre`), no de un parametro extra: el
 * manifiesto se pide DESPUES de la escritura.
 */
function ubicacionesDe(
  flujo: ManifiestoFlujo,
  row: ManifiestoOrdenRow,
  ctx: UbicacionCtx,
): { origen: string; destino: string; responsable: string } {
  const zona = row.zonaNombre;
  const tienda = row.tiendaNombre;
  const mensajero = row.mensajeroAsignadoNombre;

  switch (flujo) {
    case "carga_masiva":
    // Feature 155/R24: MISMO movimiento fisico que la carga masiva —el paquete sale de la
    // tienda y va a la bodega central— para el lote que nace por la rama (b). Comparten la
    // rama del switch a proposito: si el mapeo tuviera que divergir algun dia, divergiria
    // aqui y en un solo sitio. Lo que NO comparten es el nombre del flujo, que es lo que
    // aparece impreso y debe decir la verdad sobre la operacion que lo genero.
    case "recoleccion_tienda":
      // La orden ENTRA al circuito: sale de la tienda hacia la bodega central.
      return { origen: tienda, destino: ctx.central, responsable: ctx.actor };
    case "generacion_guia":
      // GAM con mensajero -> sale a la zona en manos del mensajero. GAM sin mensajero
      // -> se queda en la central (se genero la guia, no se movio). No-GAM -> se rutea
      // a su zona, todavia sin mensajero (lo asigna la bodega satelite).
      if (row.zonaEsCentral) {
        return mensajero
          ? { origen: ctx.central, destino: zona, responsable: mensajero }
          : { origen: ctx.central, destino: ctx.central, responsable: ctx.actor };
      }
      return { origen: ctx.central, destino: zona, responsable: ctx.actor };
    case "ruteo_satelite":
      return { origen: ctx.central, destino: zona, responsable: ctx.actor };
    case "asignacion_satelite":
      // De la bodega satelite de la zona a la calle de esa misma zona, con mensajero.
      return {
        origen: zona,
        destino: zona,
        responsable: mensajero ?? ctx.actor,
      };
    case "devolucion_central":
      return { origen: zona, destino: ctx.central, responsable: ctx.actor };
    case "envio_tienda":
      return { origen: ctx.central, destino: tienda, responsable: ctx.actor };
  }
}

export class ManifiestoService implements IManifiestoService {
  /**
   * `now` inyectable para fijar la fecha de la operacion en los tests (R10). En
   * produccion es el reloj real: el manifiesto se descarga en el mismo dia de la
   * operacion (design.md §9.5).
   */
  constructor(
    private readonly ordenRepo: OrdenRepo,
    private readonly zonaRepo: ZonaRepo,
    // Feature 160 (R11/R12/R28): derivador de intentos EN LOTE, dependencia REQUERIDA (va
    // ANTES de `now`, que tiene default). `import type` + `Pick`: sin ciclo de modulos.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async armar(input: ManifiestoInput, actor: Actor): Promise<ManifiestoServiceResult> {
    // R3: se recorre la SELECCION recibida (no las filas de la query) para producir
    // exactamente una fila por orden valida, EN EL ORDEN EN QUE LLEGARON, y para poder
    // reportar las que no vinieron (R12). Se deduplica preservando el orden.
    const refs =
      "ordenIds" in input ? distinct(input.ordenIds) : distinct(input.numRemisiones);

    const rows =
      "ordenIds" in input
        ? await this.ordenRepo.findManifiestoByIds(refs)
        : // R29: la seleccion por remision se acota SIEMPRE a la tienda del actor, la misma
          // acotacion que hace el resumen del lote (`resumenCargaMasiva`); la carga
          // masiva via sesion es exclusiva del adminTienda y su `tiendaId` ES su
          // `usuarioId`. Un actor de otro rol no alcanza remisiones ajenas: no
          // encuentra ninguna y todas salen omitidas. Vale igual para `recoleccion_tienda`
          // (feature 155), que comparte esa forma de seleccion.
          await this.ordenRepo.findManifiestoByRemisiones(refs, actor.usuarioId);

    const rowByRef = new Map<string, ManifiestoOrdenRow>(
      rows.map((r) => ["ordenIds" in input ? r.id : r.numRemision, r]),
    );

    const ctx: UbicacionCtx = {
      central: await this.resolverBodegaCentral(),
      actor:
        (await this.ordenRepo.findUsuarioNombre(actor.usuarioId)) ??
        RESPONSABLE_FALLBACK,
    };
    const fecha = fechaCalendarioCR(this.now()); // R10: calendario CR, NO toISOString

    // Feature 160 (R12/R13/R15/R28a): UNA sola consulta al historial para TODO el lote, sobre
    // las ordenes que la propia query ya devolvio (y por tanto ya acotadas por el alcance del
    // actor: `findManifiestoByRemisiones` filtra por tienda, y `esVisiblePara` descarta abajo
    // las ajenas de una API key). Lote vacio -> 0 consultas.
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    const filas: ManifiestoFilaDTO[] = [];
    const omitidas: ManifiestoOmitidaDTO[] = [];

    for (const ref of refs) {
      const row = rowByRef.get(ref);
      if (!row || !esVisiblePara(row, actor)) {
        // No existe, esta borrada (el repo la excluyo por deletedAt) o es de otra
        // tienda y el actor es una API key (R29). Los tres se reportan igual:
        // `no_encontrada` no revela la existencia de una orden ajena. R12: NO aborta
        // el manifiesto de las demas.
        omitidas.push({ ref, motivo: "no_encontrada" });
        continue;
      }
      // Feature 160 (R14/R28a): `?? 0` — las ordenes sin intentos no vienen en el Map y la
      // celda debe llevar `0`, nunca quedar vacia (en Excel vacio NO es cero).
      filas.push(this.toFilaDTO(input.flujo, row, ctx, fecha, intentos.get(row.id) ?? 0));
    }

    return { status: "ok", filas, omitidas };
  }

  /**
   * design.md §9.2 — nombre de la zona `esCentral`, o el literal de respaldo si no hay
   * zona central configurada (o si la zona desaparecio entre las dos lecturas). Nunca
   * lanza ni devuelve vacio: la descarga no puede fallar por un dato de catalogo.
   */
  private async resolverBodegaCentral(): Promise<string> {
    const centralId = await this.zonaRepo.findCentralZonaId();
    if (!centralId) return BODEGA_CENTRAL_FALLBACK;
    const zona = await this.zonaRepo.findById(centralId, false);
    return zona?.nombre ?? BODEGA_CENTRAL_FALLBACK;
  }

  /**
   * R4/R5/R6/R7 + feature 160/R28 — arma UNA fila del manifiesto con los datos VIGENTES de la
   * orden (R4). `numGuia`/`monto` null viajan como null y la celda queda vacia (R5/R7), sin
   * texto inventado. `zona` es el NOMBRE (R6). `intentos` es NUMERICO y ya resuelto por el
   * lote (0 incluido, 160/R28a).
   *
   * SIGUE VIGENTE el lado prohibitivo del viejo R11: NO se copia `row.id`, ni `row.tiendaId`,
   * ni ningun otro identificador interno o bandera de borrado. Lo que la feature 160 derogo es
   * el numero CERRADO de columnas, no este filtro (design 160 §6.3).
   */
  private toFilaDTO(
    flujo: ManifiestoFlujo,
    row: ManifiestoOrdenRow,
    ctx: UbicacionCtx,
    fecha: string,
    intentos: number,
  ): ManifiestoFilaDTO {
    const { origen, destino, responsable } = ubicacionesDe(flujo, row, ctx);
    return {
      numGuia: row.numGuia,
      numRemision: row.numRemision,
      destinatario: row.destinatario,
      telefono: row.telefonoDest, // §9.4: telefono del DESTINATARIO
      direccion: row.direccion,
      zona: row.zonaNombre,
      monto: row.montoCobrar, // §9.3: monto_cobrar (COD)
      intentos, // feature 160/R28a: dato propio de la orden
      origen,
      destino,
      responsable,
      fecha,
    };
  }
}
