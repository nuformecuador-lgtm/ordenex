import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  INovedadesService,
  ListarNovedadesCompletoInput,
  ListarNovedadesCompletoServiceResult,
  ListarNovedadesInput,
  ListarNovedadesServiceResult,
} from "@/lib/interfaces/services/INovedadesService";
import { descargaConfig } from "@/lib/config/descarga";
import type { GrupoNovedad } from "@/lib/types/novedad-grupo";
import type { NovedadDTO } from "@/lib/types/novedad";

// R11: unico rol autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de
// test sin DB/HTTP (patron `RecepcionSateliteRepo`).
type NovedadesRepo = Pick<
  IOrdenRepository,
  | "countNovedadesByTienda"
  | "findNovedadesByTienda"
  | "findCausasDevueltaVigentes"
  | "findFechaSolicitudAyuda"
>;

/**
 * Feature 87/89/99 (design §3.5) — logica de negocio del listado de NOVEDADES de la tienda del
 * `adminTienda`. Solo lectura. No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 *
 * FEATURE 236 (T2.4/T2.5, design §3) — gana el GRUPO y NO se parte en dos. Lo que el grupo decide
 * esta enumerado en `INovedadesService`; lo que NO decide es igual de importante: el rol sigue
 * siendo la primera guarda (R11), el alcance sigue saliendo del actor y nunca del input (R10), y la
 * proyeccion a `NovedadDTO` sigue siendo UNA, compartida por la pagina y por el archivo.
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
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11, antes del repo

    const { page, pageSize, grupo } = input;

    // R4/R10: total de la superficie, con el MISMO predicado que la pagina (lo aplica el repo:
    // igualdad de estado del grupo + tienda del actor + no borrada).
    const total = await this.repo.countNovedadesByTienda(actor.usuarioId, grupo);

    // R10: el alcance sale de `actor.usuarioId`, NUNCA del input. `skip` derivado de la pagina
    // (1-based).
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findNovedadesByTienda(actor.usuarioId, grupo, {
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      // El estado vacio lo pinta el front (R16 — y con la medicion del 2026-08-19 delante, es el
      // PRIMER estado que la tienda va a conocer). Aqui solo se evita la consulta agregada.
      return { status: "ok", items: [], total, page, pageSize };
    }

    return {
      status: "ok",
      items: await this.proyectar(rows, grupo),
      total,
      page,
      pageSize,
    };
  }

  /**
   * El listado ENTERO para el archivo de la descarga. Reusa el conteo, la lectura, el orden y la
   * proyeccion de `listar`: lo unico que cambia es que no hay recorte por pagina (R37).
   *
   * El tope se evalua con el CONTEO, antes de leer ninguna fila (R40): asi superarlo cuesta una
   * sola consulta y el aviso conserva el total EXACTO que publica (nunca un dataset truncado).
   *
   * Feature 236 (T3.1, R38): al pedir el grupo, el archivo de DEVOLUCIONES deja de traer las
   * ordenes en ayuda — sale gratis, sin tocar su archivo de columnas, porque el predicado ya no
   * las incluye. Hasta hoy salian ahi con la columna «Causa de devolucion» diciendo «Sin causa
   * registrada» sobre una orden que nunca se devolvio: mentir con formato de dato.
   */
  async listarCompleto(
    input: ListarNovedadesCompletoInput,
    actor: Actor,
  ): Promise<ListarNovedadesCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11, antes del repo

    const { grupo } = input;
    const total = await this.repo.countNovedadesByTienda(actor.usuarioId, grupo); // mismo predicado

    const limite = descargaConfig.MAX_FILAS;
    if (total > limite) return { status: "limite_excedido", total, limite };
    if (total === 0) return { status: "ok", items: [], total: 0 };

    const rows = await this.repo.findNovedadesByTienda(actor.usuarioId, grupo, {
      skip: 0,
      take: total,
    });

    return { status: "ok", items: await this.proyectar(rows, grupo), total: rows.length };
  }

  /**
   * Filas del repo -> `NovedadDTO[]`, ordenadas segun el grupo. UNICA proyeccion del listado: la
   * pagina y el archivo salen de aqui, para que no puedan divergir.
   */
  private async proyectar(
    rows: NovedadOrdenRow[],
    grupo: GrupoNovedad,
  ): Promise<NovedadDTO[]> {
    const ids = rows.map((r) => r.id);

    // R26 — LA CAUSA SOLO SE RESUELVE PARA LA DEVOLUCION, y la consulta NO se hace para la ayuda.
    // Sobre una orden en `ayuda_tienda`, `findCausasDevueltaVigentes` devolveria la causa de una
    // devolucion ANTERIOR YA DESHECHA: un dato cierto que NO describe por que esa orden esta en la
    // pantalla. Ademas es una lectura menos por pagina.
    const causas =
      grupo === "devolucion"
        ? await this.repo.findCausasDevueltaVigentes(ids) // R8: UNA consulta para toda la pagina
        : new Map<string, CausaDevueltaVigente>();

    // D7/R17 — el orden de la pestaña de ayuda sale de la fecha de la SOLICITUD, resuelta con UNA
    // consulta agregada por pagina (molde de `findCausasDevueltaVigentes`), nunca una por fila.
    const solicitudes =
      grupo === "ayuda" ? await this.repo.findFechaSolicitudAyuda(ids) : new Map<string, Date>();

    // Feature 160 (R12/R15): UNA sola consulta al historial para toda la pagina, sobre las
    // ordenes YA acotadas a la tienda del actor (`findNovedadesByTienda(actor.usuarioId, ...)`).
    const intentos = await this.historial.contarIntentosEnLote(ids);

    // El ORDEN, que es lo unico que las dos superficies hacen distinto, y por una razon de negocio:
    //
    //  - `devolucion` (R12, sin cambios): la mas RECIENTE primero, por la fecha de la ultima
    //    gestion `devuelta` vigente —ya traida por `findCausasDevueltaVigentes`, sin query extra—
    //    y `Orden.createdAt` como fallback.
    //  - `ayuda` (D7/R17): la que lleva MAS TIEMPO ESPERANDO primero, o sea ASCENDENTE por la
    //    fecha de la solicitud. La pregunta de la tienda al abrir esa pestaña es cual lleva mas
    //    tiempo esperandola, y ninguna otra fecha la responde: la de creacion de la orden no tiene
    //    nada que ver con cuando se pidio ayuda. Fallback documentado: `Orden.createdAt` (una orden
    //    en `ayuda_tienda` sin transicion de solicitud no deberia existir; si existiera, entra por
    //    su fecha de creacion en vez de romper el orden).
    //
    // Copia antes de ordenar para no mutar el arreglo del repo.
    const ordered =
      grupo === "ayuda"
        ? [...rows].sort(
            (a, b) =>
              fechaDeEspera(a, solicitudes).getTime() - fechaDeEspera(b, solicitudes).getTime(),
          )
        : [...rows].sort(
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
    // para ordenar y muere aqui. Un `Date` no cruza el borde RSC.
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
      // Feature 235 (T6.1, R40): aqui se emitia `ayuda: row.ayuda`. Se retira con la columna, y el
      // motivo por el que existia deja de valer: la pantalla SI puede derivar del estatus por que
      // esta la fila, porque una orden ya no puede estar `devuelta` Y con ayuda pedida a la vez —
      // son dos estados y son excluyentes. `estatusValue` ya viaja unas lineas mas arriba.
      // Pedido humano 2026-08-18: SIEMPRE se emite, el `0` incluido. Es un valor CONOCIDO
      // («nadie lo ha intentado todavia»), no un dato ausente.
      intentosContacto: row.intentosContacto,
      // Feature 236 (R26): para el grupo de ayuda el mapa esta vacio A PROPOSITO y esto sale
      // `null`. La pantalla no debe pintar causa ninguna sobre esas filas, ni anunciar su ausencia.
      causa: causas.get(row.id)?.causa ?? null,
      // Feature 160 (R14/R19): `?? 0` — el `0` SIEMPRE se expone.
      intentosEntrega: intentos.get(row.id) ?? 0,
    }));
  }
}

// R12: fecha de recencia de una DEVOLUCION = fecha de su ultima gestion `devuelta` vigente si
// existe; si no (R7), `Orden.createdAt` como fallback documentado.
function fechaEfectiva(
  row: NovedadOrdenRow,
  causas: Map<string, CausaDevueltaVigente>,
): Date {
  return causas.get(row.id)?.fecha ?? row.createdAt;
}

// D7/R17: instante en que empezo la ESPERA de una orden en ayuda = la fecha de su solicitud viva;
// si no la hay, `Orden.createdAt` como fallback documentado.
function fechaDeEspera(row: NovedadOrdenRow, solicitudes: Map<string, Date>): Date {
  return solicitudes.get(row.id) ?? row.createdAt;
}
