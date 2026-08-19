import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  INovedadesService,
  ListarNovedadesCompletoServiceResult,
  ListarNovedadesInput,
  ListarNovedadesServiceResult,
} from "@/lib/interfaces/services/INovedadesService";
import { descargaConfig } from "@/lib/config/descarga";
import type { NovedadDTO } from "@/lib/types/novedad";

// R11: unico rol autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de
// test sin DB/HTTP (patron `RecepcionSateliteRepo`).
type NovedadesRepo = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

/**
 * Feature 87/89/99 (design §3.5) — logica de negocio de la lista de NOVEDADES: las devoluciones
 * del mensajero de la tienda del adminTienda (ordenes que REPOSAN en estatus `devuelta` bajo la
 * feature 99), con la causa de la ultima gestion `devuelta` vigente. Solo lectura. No conoce HTTP
 * ni Prisma; testeable con dobles sin red/DB.
 */
export class NovedadesService implements INovedadesService {
  constructor(
    private readonly repo: NovedadesRepo,
    // Feature 160 (R11/R12/R26): derivador de intentos EN LOTE, dependencia REQUERIDA.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
  ) {}

  async listar(
    input: ListarNovedadesInput,
    actor: Actor,
  ): Promise<ListarNovedadesServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11

    const { page, pageSize } = input;

    // R7/R8: total de novedades de la tienda del actor (predicado anclado a `estatus = devuelta`
    // + tienda + no borrada; el repo lo aplica, mismo universo que la pagina, R8).
    const total = await this.repo.countDevueltasByTienda(actor.usuarioId);

    // R7/R8/R9: la pagina de novedades de la tienda, ordenada por Orden.createdAt desc (fallback).
    // `skip` derivado de la pagina (1-based).
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findDevueltasByTienda(actor.usuarioId, {
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      // R10 lo pinta el front; aqui solo se evita la consulta agregada innecesaria (R8).
      return { status: "ok", items: [], total, page, pageSize };
    }

    return { status: "ok", items: await this.proyectar(rows), total, page, pageSize };
  }

  /**
   * El listado ENTERO para el archivo de la descarga. Reusa el conteo, la lectura, el orden y la
   * proyeccion de `listar`: lo unico que cambia es que no hay recorte por pagina.
   *
   * El tope se evalua con el CONTEO, antes de leer ninguna fila: asi superarlo cuesta una sola
   * consulta y el aviso conserva el total EXACTO que publica (nunca un dataset truncado).
   */
  async listarCompleto(actor: Actor): Promise<ListarNovedadesCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11, antes del repo

    const total = await this.repo.countDevueltasByTienda(actor.usuarioId); // mismo predicado (R8)

    const limite = descargaConfig.MAX_FILAS;
    if (total > limite) return { status: "limite_excedido", total, limite };
    if (total === 0) return { status: "ok", items: [], total: 0 };

    const rows = await this.repo.findDevueltasByTienda(actor.usuarioId, {
      skip: 0,
      take: total,
    });

    return { status: "ok", items: await this.proyectar(rows), total: rows.length };
  }

  /**
   * Filas del repo -> `NovedadDTO[]`, ordenadas por recencia (R12). UNICA proyeccion del
   * listado: la pagina y el archivo salen de aqui, para que no puedan divergir.
   */
  private async proyectar(rows: NovedadOrdenRow[]): Promise<NovedadDTO[]> {
    // R8: UNA sola consulta agregada para las causas de TODAS las ordenes de la pagina.
    const causas = await this.repo.findCausasDevueltaVigentes(rows.map((r) => r.id)); // R6/R7
    // Feature 160 (R12/R15): UNA sola consulta al historial para toda la pagina, sobre las
    // ordenes YA acotadas a la tienda del actor (`findDevueltasByTienda(actor.usuarioId, ...)`).
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    // R12 (estricto): reordena la PAGINA por la fecha de la ultima gestion `devuelta` vigente
    // desc, con la fecha ya traida por `findCausasDevueltaVigentes` (sin query extra). Las
    // ordenes sin gestion vigente caen a `Orden.createdAt` (fallback documentado). Copia antes
    // de ordenar para no mutar el arreglo del repo.
    const ordered = [...rows].sort(
      (a, b) => fechaEfectiva(b, causas).getTime() - fechaEfectiva(a, causas).getTime(),
    );

    // R6/R7/R10: mapea a NovedadDTO; causa = ultima gestion vigente, o null ("sin causa").
    // 2026-08-13 (pedido humano): la proyeccion es AHORA la orden completa. `NovedadDTO`
    // extiende `MiAsignacionDTO` (cabecera de `lib/types/novedad.ts`), asi que aqui no hay
    // que elegir que campo merece viajar: viaja la fila entera del repo, que ya llega
    // serializable (los tres decimales convertidos con `.toNumber()`, los catalogos con el
    // nombre resuelto). Los ausentes viajan como `null` — nunca como `""` ni `0`.
    //
    // Lo unico que NO se propaga es `row.createdAt`: es de la fila del repo, se usa arriba
    // para ordenar por recencia (R12) y muere aqui. Un `Date` no cruza el borde RSC.
    return ordered.map((row) => ({
      id: row.id,
      numGuia: row.numGuia,
      // El REAL de la orden. La etiqueta «Guia N» del identificador visible (R9) la pone el
      // front en su adaptador; el service entrega el dato, no la presentacion.
      numRemision: row.numRemision,
      estatusValue: row.estatusValue,
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      direccion: row.direccion,
      producto: row.producto,
      peso: row.peso,
      montoCobrar: row.montoCobrar,
      latitud: row.latitud,
      longitud: row.longitud,
      notas: row.notas,
      tiendaNombre: row.tiendaNombre,
      zonaNombre: row.zonaNombre,
      provinciaNombre: row.provinciaNombre,
      cantonNombre: row.cantonNombre,
      distritoNombre: row.distritoNombre,
      // SIEMPRE `null`: una novedad no es parada de ninguna ruta optimizada (feature 92/R28).
      secuenciaRuta: null,
      // Solicitud de ayuda (2026-08-18): SIEMPRE se emite. Es la segunda razon por la que una
      // fila puede estar en este listado, y la pantalla necesita distinguirla de una devolucion
      // — no puede derivarla del estatus, porque una orden devuelta tambien puede tener ayuda
      // pedida de antes.
      ayuda: row.ayuda,
      // Pedido humano 2026-08-18: SIEMPRE se emite, el `0` incluido. Es un valor CONOCIDO
      // («nadie lo ha intentado todavia»), no un dato ausente.
      intentosContacto: row.intentosContacto,
      causa: causas.get(row.id)?.causa ?? null,
      // Feature 160 (R14/R19): `?? 0` — el `0` SIEMPRE se expone.
      intentosEntrega: intentos.get(row.id) ?? 0,
    }));
  }
}

// R12: fecha de recencia de una orden = fecha de su ultima gestion `devuelta` vigente si
// existe; si no (R7), `Orden.createdAt` como fallback documentado.
function fechaEfectiva(
  row: NovedadOrdenRow,
  causas: Map<string, CausaDevueltaVigente>,
): Date {
  return causas.get(row.id)?.fecha ?? row.createdAt;
}
