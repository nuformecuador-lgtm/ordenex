import type {
  IOrdenRepository,
  ListOrdenesResult,
  ListOrdenesWhere,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  Actor,
  IOrdenService,
  ListarOrdenesCompletoServiceResult,
  ListarOrdenesServiceResult,
} from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  ListarOrdenesCompletoInput,
  ListarOrdenesInput,
  OrdenListItemDTO,
  SortDir,
  SortField,
} from "@/lib/types/orden";
// Pedido humano (2026-08-27): la segunda mitad del predicado de `sinGestion`. Se lee de la
// fuente unica de los estados de nacimiento, no se re-declara.
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import { soloDigitosSiPareceNumero } from "@/lib/utils/busqueda-orden";
// Pedido humano (2026-08-19): el rango de creacion y el termino de busqueda los traduce el
// util COMPARTIDO, porque la barra de este listado se aplica tambien a la bodega satelite y
// las dos superficies tienen que entender lo mismo por «ultimos 7 dias» y por un termino con
// separadores. Aqui se queda solo lo que es propio de `/ordenes`: la ruta rapida por guia.
import {
  rangoCreacion,
  terminoDeBusqueda,
} from "@/lib/utils/filtros-listado-ordenes";
// Feature 151: el limite de filas de `listarCompleto`. `ordenesConfig` salio de este archivo
// al integrar la 155, y `resolverDestinoCreacion` salio el 2026-08-07 con el alta manual: los
// dos eran del camino de CREACION, que este servicio ya no tiene. Quien los usa hoy es
// `BulkOrdenService`, que es por donde se crean las ordenes de verdad.
import { descargaConfig } from "@/lib/config/descarga";

// Roles reconocidos por las lecturas (los demas -> forbidden, R24). maestro/admin ven todo
// (R20); adminTienda/mensajero con acotamiento (R21/R23). Se llamaba "del CRUD" cuando este
// servicio tambien escribia; desde el 2026-08-07 solo lee.
const KNOWN_ROLES = new Set<string>(["maestro", "admin", "adminTienda", "mensajero"]);

// Feature 63/B2 (R8): mapa EXPLICITO clave-publica-del-filtro -> columna Prisma.
// Es el UNICO punto que conoce el nombre interno de la FK de estado (`estatusId`,
// columna `estatus_id`); la clave publica `status_id` nunca se usa como nombre de
// columna. El schema `.strict()` (lib/types/orden.ts) ya garantiza que solo llegan
// claves de esta whitelist, asi que ninguna columna arbitraria alcanza el `where`.
// Feature 144/B1 (R30/R43): el mapa crece a los cinco catalogos. Las TRES claves
// temporales (`created_preset`/`created_desde`/`created_hasta`) NO estan aqui a
// proposito: no son columnas, se traducen a un rango `createdAt: { gte, lt }`
// calculado server-side (`rangoCreacion`, en `lib/utils/filtros-listado-ordenes`).
const FILTER_TO_COLUMN = {
  status_id: "estatusId",
  zona_id: "zonaId",
  tienda_id: "tiendaId",
  provincia_id: "provinciaId",
  canton_id: "cantonId",
  distrito_id: "distritoId",
  // Pedido humano (2026-08-25): el filtro por MENSAJERO asignado. La clave publica es
  // `mensajero_id`; la columna real (`mensajeroAsignadoId`) sigue siendo un nombre que
  // solo vive en este mapa. Se escribe con el resto de filtros —ANTES del acotamiento
  // por rol— para que el mensajero que alcance este listado siga viendo solo las suyas:
  // su `mensajeroAsignadoId` escalar PISA la lista que hubiera puesto el filtro (R36).
  mensajero_id: "mensajeroAsignadoId",
} as const;

/**
 * Feature 169 (design §5) — mayor valor representable por `num_guia`, que es `int4`. Un
 * termino numerico por encima de esto NO se intenta como guia (el cast reventaria en la
 * base): va directo a la coincidencia parcial (R12).
 */
const NUM_GUIA_MAX = 2_147_483_647;

/**
 * Pedido humano (2026-08-27) — los estados en los que una orden puede seguir SIN gestionar. Es
 * la fuente unica (`ESTADOS_CREACION`), no una copia: la segunda mitad del predicado de
 * `sinGestion`.
 */
const SET_ESTADOS_CREACION: ReadonlySet<string> = new Set<string>(ESTADOS_CREACION);

// Feature 160 (design §3.5): el derivador de intentos EN LOTE. `Pick` para dobles de test sin
// DB, e `import type` para que la dependencia sea SOLO de tipo (sin ciclo de modulos:
// `OrdenHistorialService` depende de repositorios, nunca de los servicios de lista).
// Pedido humano (2026-08-27): el `Pick` GANA `idsConGestionPosteriorEnLote`, de donde sale el
// `sinGestion` de cada fila (¿se puede ofrecer «Eliminar» sobre ella?). Va por el MISMO servicio
// —y no por un derivado propio de este listado— porque el borrado se autoriza con esa misma
// respuesta: dos derivaciones del mismo hecho es como la barra acaba ofreciendo lo que el
// servidor rechaza.
type IntentosSvc = Pick<
  IOrdenHistorialService,
  "contarIntentosEnLote" | "idsConGestionPosteriorEnLote"
>;

export class OrdenService implements IOrdenService {
  /**
   * `ahora` inyectable (feature 144): el atajo de antiguedad (`created_preset`) se
   * calcula contra el reloj del SERVIDOR (R43). Se inyecta solo para que los tests
   * puedan fijar el instante; en produccion nadie lo pasa. Va al FINAL por ser el
   * unico parametro opcional: `historial` (160) es requerido y lo precede.
   */
  constructor(
    private readonly repo: IOrdenRepository,
    // Feature 160 (R11/R12): dependencia REQUERIDA a proposito. Una dep opcional dejaria que
    // el wiring de produccion se la olvidara y el dato desapareciera en silencio de las 5
    // superficies que come este listado; requerida, el compilador lo impide.
    private readonly historial: IntentosSvc,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  // BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivian `crear` y
  // `obtener`. Sus Server Actions se borraron en la tanda 1 por nacer sin pantalla, y con ellas
  // desaparecio el ultimo llamador. La CLASE NO muere: `listar` y `listarCompleto` siguen vivas
  // y las instancia `lib/actions/ordenes.ts`.
  //
  // La creacion real de ordenes NO pasaba por aqui: entra por `BulkOrdenService.cargarMasiva`
  // (sesion, solo `adminTienda`) y `cargarMasivaViaApi` (solo `apiKey`).

  /**
   * Feature 144: ORDEN DE ESCRITURA del `where`, y es lo que garantiza R36/R37:
   *   1) `estatusId` escalar heredado,
   *   2) el `filter` traducido por la whitelist,
   *   3) el ACOTAMIENTO POR ROL, escrito AL FINAL para que PISE lo que el filtro
   *      hubiera puesto. Un filtro nunca amplia el alcance de un rol.
   *
   * Feature 151/T5: extraido de `listar` SIN cambio de comportamiento, para que el
   * modo sin paginacion (`listarCompleto`) comparta literalmente este codigo y no
   * pueda divergir del listado en autorizacion ni en acotamiento (design §4.1, D3).
   */
  /**
   * Feature 169 (design §4.2/§5) — traduce el TERMINO de busqueda a claves del `where`.
   *
   * Dos caminos, y el segundo no es opcional:
   *   · Termino de SOLO DIGITOS que cabe en `int4` -> igualdad contra `num_guia` (ruta
   *     rapida, indice unico ya existente). Devuelve esa orden y solo esa (R9).
   *   · Todo lo demas -> coincidencia parcial sobre la columna generada, con el termino TAL
   *     COMO SE ESCRIBIO (normalizado) y, si trae separadores, TAMBIEN con su forma solo
   *     digitos.
   *
   * LAS DOS FORMAS, y por que (M1 del review). Hasta aqui un termino de digitos con
   * separadores viajaba SOLO reducido a digitos, y eso rompia R5 en silencio: la columna
   * indexa el telefono en sus dos formas —de ahi que reducir bastara para R13—, pero la
   * REMISION va tal cual, asi que teclear `2026-0912` buscaba `20260912` y NO encontraba
   * `REM-2026-0912`, que existe. Un falso negativo sin error ni log es lo peor que puede
   * hacer un buscador. Al reves tampoco vale: buscar solo el texto tecleado dejaria de
   * encontrar un telefono guardado como `88880000` al teclearlo `8888-0000` (R13).
   * Se escriben las dos y el repositorio las une; el resultado es siempre un SUPERCONJUNTO
   * del anterior, nunca menos filas. La segunda forma solo aparece cuando DIFIERE de la
   * primera: un termino ya limpio produce el `where` de siempre, con una sola condicion
   * (que es lo que mantiene intacto el plan de la ruta parcial numerica y el del fallback).
   *
   * `sinRutaRapida` es lo que hace posible el fallback de R10: el segundo intento repite
   * la traduccion prohibiendo la ruta rapida, en vez de parchear el `where` ya construido
   * (que dejaria `numGuia` y `busqueda` conviviendo, o sea un AND imposible de satisfacer).
   *
   * NUNCA escribe dentro de un `OR`: la clave es hermana del resto del `where`, de modo que
   * el termino solo puede ESTRECHAR el conjunto (R21).
   */
  private escribirBusqueda(
    where: ListOrdenesWhere,
    termino: string,
    sinRutaRapida: boolean,
  ): void {
    const digitos = soloDigitosSiPareceNumero(termino);
    const esSoloDigitos = digitos !== null && digitos === termino.trim();
    if (!sinRutaRapida && esSoloDigitos) {
      const guia = Number(digitos);
      if (Number.isSafeInteger(guia) && guia > 0 && guia <= NUM_GUIA_MAX) {
        where.numGuia = guia;
        return;
      }
    }
    // Las dos formas del termino salen del util compartido con la bodega satelite: aqui
    // solo queda la decision propia de este listado (la ruta rapida de arriba).
    const { busqueda, busquedaDigitos } = terminoDeBusqueda(termino);
    where.busqueda = busqueda;
    if (busquedaDigitos !== undefined) where.busquedaDigitos = busquedaDigitos;
  }

  private construirWhere(
    input: Pick<ListarOrdenesInput, "estatusId" | "filter">,
    actor: Actor,
    opciones?: { sinRutaRapida?: boolean },
  ): ListOrdenesWhere {
    const where: ListOrdenesWhere = {};
    // R10: el `estatusId` escalar preexistente sigue funcionando (sin regresion).
    if (input.estatusId !== undefined) where.estatusId = input.estatusId;
    // Feature 63/R8/R9: traduce `filter.status_id` a la columna `estatusId` via el
    // mapa explicito. Precedencia (design.md 3.3): si llegan `filter.status_id` y
    // `estatusId` escalar, gana `filter.status_id` (fuente explicita de la feature).
    if (input.filter?.status_id !== undefined) {
      where[FILTER_TO_COLUMN.status_id] = input.filter.status_id;
    }
    // Feature 144/R30/R33/R34: los cinco filtros de catalogo, traducidos por el MISMO
    // mapa explicito. La clave publica nunca se usa como nombre de columna; el schema
    // `.strict()` ya garantiza que solo llegan claves de la whitelist (R31).
    if (input.filter?.zona_id !== undefined) {
      where[FILTER_TO_COLUMN.zona_id] = input.filter.zona_id;
    }
    if (input.filter?.tienda_id !== undefined) {
      where[FILTER_TO_COLUMN.tienda_id] = input.filter.tienda_id;
    }
    if (input.filter?.provincia_id !== undefined) {
      where[FILTER_TO_COLUMN.provincia_id] = input.filter.provincia_id;
    }
    if (input.filter?.canton_id !== undefined) {
      where[FILTER_TO_COLUMN.canton_id] = input.filter.canton_id;
    }
    if (input.filter?.distrito_id !== undefined) {
      where[FILTER_TO_COLUMN.distrito_id] = input.filter.distrito_id;
    }
    if (input.filter?.mensajero_id !== undefined) {
      where[FILTER_TO_COLUMN.mensajero_id] = input.filter.mensajero_id;
    }
    // Feature 144/R41/R42/R43: los bordes temporales se calculan AQUI (server-side),
    // no llegan del cliente.
    const createdAt = rangoCreacion(input.filter, this.ahora());
    if (createdAt) where.createdAt = createdAt;
    // REASIGNABLES: predicado compuesto, no columna, asi que no pasa por
    // FILTER_TO_COLUMN; el repositorio lo traduce. Solo acota (nunca amplia), asi que
    // convive sin conflicto con el acotamiento por rol que se escribe debajo.
    if (input.filter?.reasignables) where.reasignables = true;
    // ELIMINADAS (pedido humano 2026-08-27): la unica clave que no ACOTA sino que SUSTITUYE el
    // universo del listado (`deleted_at IS NOT NULL` en vez de `IS NULL`). Tampoco es una
    // columna, asi que tampoco pasa por FILTER_TO_COLUMN. El acotamiento por rol que se escribe
    // debajo sigue teniendo la ultima palabra —y ademas `listar`/`listarCompleto` ya rechazaron
    // a todo el que no sea `maestro` antes de llegar aqui.
    if (input.filter?.eliminados) where.soloEliminados = true;
    // Feature 169/R2/R14/R21: el TERMINO. Como las claves temporales y `reasignables`, no
    // es una columna y por eso no pasa por FILTER_TO_COLUMN. Se escribe ANTES del
    // acotamiento por rol —igual que todos los filtros— para que el rol siga teniendo la
    // ultima palabra: un adminTienda que teclee el nombre de un destinatario de otra
    // tienda obtiene cero filas y `total: 0`, no la orden ajena.
    if (input.filter?.q !== undefined) {
      this.escribirBusqueda(where, input.filter.q, opciones?.sinRutaRapida === true);
    }
    // R9/R21 + feature 144/R36: adminTienda sigue acotado a SUS ordenes. Se escribe
    // DESPUES del filtro: si el actor inyecto `filter.tienda_id = [otraTienda]`, este
    // escalar lo SOBRESCRIBE. El filtro de tienda nunca amplia su alcance.
    if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId;
    // Seguridad: el mensajero solo puede listar SUS asignadas (mensajeroAsignadoId =
    // su usuario). Sin esto, `/ordenes` filtraba el listado COMPLETO al mensajero. Su
    // experiencia normal es /mis-asignaciones; este acotamiento cierra la fuga por si
    // alcanza el listado plano.
    if (actor.rol === "mensajero") where.mensajeroAsignadoId = actor.usuarioId;

    return where;
  }

  /**
   * Feature 169 (design §5, R10/R11) — la consulta del listado CON el fallback de la ruta
   * rapida numerica.
   *
   * La ruta rapida (`num_guia = N`) no puede ser terminal: el segundo caso de uso mas
   * frecuente —"los ultimos cuatro digitos del telefono"— tambien es un termino de solo
   * digitos. Si la guia exacta no existe dentro del alcance del actor y del resto de
   * filtros, se repite la consulta resolviendo el termino como coincidencia parcial.
   *
   * EL DISPARADOR ES `total`, NUNCA `items.length`, y esta linea es todo el motivo por el
   * que este metodo existe: pidiendo la pagina 3 de una guia exacta, `items` viene VACIO y
   * `total` vale 1. Con `items.length` se caeria al trigram en unas paginas si y en otras
   * no, y el mismo termino mostraria resultados distintos segun por donde se entrase (R11).
   *
   * Coste: UNA consulta extra —de indice unico, sobre cero filas— y solo cuando el termino
   * numerico no es una guia. Lo comparte `listar` y `listarCompleto`, para que la descarga
   * no pueda resolver un termino distinto del que se ve en pantalla (R20).
   */
  private async listarConFallbackDeGuia(
    input: Pick<ListarOrdenesInput, "estatusId" | "filter">,
    actor: Actor,
    pagina: { sortBy: SortField; sortDir: SortDir; skip: number; take: number },
  ): Promise<ListOrdenesResult> {
    const where = this.construirWhere(input, actor);
    const primerIntento = await this.repo.list({ where, ...pagina });
    if (primerIntento.total > 0 || where.numGuia === undefined) return primerIntento;
    return this.repo.list({
      where: this.construirWhere(input, actor, { sinRutaRapida: true }),
      ...pagina,
    });
  }

  /**
   * Pedido humano (2026-08-27) — «solo el maestro ve las eliminadas». `true` = el actor pidio el
   * interruptor y NO puede: el listado responde `forbidden` sin construir el `where`.
   *
   * SE RECHAZA, no se ignora en silencio. Ignorarlo devolveria el listado de las vivas con el
   * interruptor puesto en pantalla, y quien lo pidiera concluiria que no hay ninguna orden
   * eliminada — una respuesta correcta a una pregunta que nadie hizo.
   */
  private eliminadasVedadas(
    filter: { eliminados?: true } | undefined,
    actor: Actor,
  ): boolean {
    return filter?.eliminados === true && actor.rol !== "maestro";
  }

  /**
   * Pedido humano (2026-08-27) — anota `sinGestion` en cada fila: si la orden NO registra
   * gestion posterior a su creacion, y por tanto todavia se puede ELIMINAR.
   *
   * SOLO para el `maestro`, que es el unico que puede borrar. Para el resto ni se consulta (una
   * consulta por pagina que nadie usaria) y el campo viaja `undefined`; la UI exige `=== true`,
   * asi que la ausencia no habilita nada.
   *
   * MISMO predicado de dos partes que aplica `EliminarOrdenService`, y con la misma direccion
   * del error: sin movimiento en el historial Y todavia en un estado de nacimiento. Repetirlo
   * aqui no es duplicar la regla —la fuente del hecho es UNA (`idsConGestionPosteriorEnLote`)—;
   * es aplicarla a la pregunta «¿ofrezco el boton?» ademas de a «¿lo autorizo?».
   */
  private async marcarSinGestion(
    items: OrdenListItemDTO[],
    actor: Actor,
  ): Promise<OrdenListItemDTO[]> {
    if (actor.rol !== "maestro" || items.length === 0) return items;
    const conGestion = await this.historial.idsConGestionPosteriorEnLote(
      items.map((o) => o.id),
    );
    return items.map((o) => ({
      ...o,
      sinGestion:
        !conGestion.has(o.id) &&
        o.estatusValue !== undefined &&
        SET_ESTADOS_CREACION.has(o.estatusValue),
    }));
  }

  async listar(
    input: ListarOrdenesInput,
    actor: Actor,
  ): Promise<ListarOrdenesServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24
    if (this.eliminadasVedadas(input.filter, actor)) return { status: "forbidden" };

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.listarConFallbackDeGuia(input, actor, {
      sortBy: input.sortBy,
      sortDir: input.sortDir,
      skip,
      take: input.pageSize, // ya acotado a MAX_PAGE_SIZE por el schema (R33)
    });

    // Feature 160 (R11/R12/R14/R15): merge del conteo de intentos en UNA sola consulta al
    // historial, sobre los items YA acotados por rol/tienda/mensajero (el alcance del actor lo
    // impuso el `where` de arriba: no se pide el conteo de ninguna orden que el actor no pueda
    // leer). Pagina vacia -> 0 consultas (R13). `?? 0` porque las ordenes sin intentos no
    // vienen en el Map y el `0` SIEMPRE se expone (R14/R19).
    const intentos = await this.historial.contarIntentosEnLote(items.map((o) => o.id));
    const itemsConIntentos = await this.marcarSinGestion(
      items.map((o) => ({ ...o, intentosEntrega: intentos.get(o.id) ?? 0 })),
      actor,
    );

    return {
      status: "ok",
      items: itemsConIntentos,
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  /**
   * Feature 151 (R11/R20/R21/R22, design §4.1) — el MISMO listado, sin recorte por
   * pagina, para la descarga del dataset completo.
   *
   * No reimplementa nada: reusa `construirWhere` (misma autorizacion, mismo
   * acotamiento por rol escrito AL FINAL) y la MISMA consulta `repo.list`. Diferencias
   * con `listar`: `skip = 0`, `take = MAX_FILAS + 1` y el guard de tope.
   */
  async listarCompleto(
    input: ListarOrdenesCompletoInput,
    actor: Actor,
  ): Promise<ListarOrdenesCompletoServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R14/R24
    if (this.eliminadasVedadas(input.filter, actor)) return { status: "forbidden" };

    const limite = descargaConfig.MAX_FILAS;

    // `take: limite + 1` acota la MEMORIA por construccion (R22): aunque el dataset
    // sean 50 000 filas, nunca se materializan mas de N+1. El `total` sigue siendo
    // exacto porque `repo.list` lo obtiene con un `count` independiente del `take`.
    //
    // Feature 169/R20: pasa por el MISMO camino que el listado en pantalla —termino
    // incluido, fallback de guia incluido—, de modo que lo descargado sea exactamente lo
    // listado. Si esto llamara a `repo.list` directamente, un termino numerico que no es
    // guia devolveria filas en pantalla y un archivo vacio.
    const { items, total } = await this.listarConFallbackDeGuia(input, actor, {
      sortBy: input.sortBy, // R17: mismos defaults del schema (created_at/desc)
      sortDir: input.sortDir,
      skip: 0,
      take: limite + 1,
    });

    // R20/R21: por encima del tope no se entrega NADA. Nunca un dataset truncado en
    // silencio: o van todas las filas, o va el error accionable con los conteos.
    if (total > limite) return { status: "limite_excedido", total, limite };

    // Mismo merge de intentos que `listar` (feature 160), para que la columna
    // "intentos" del archivo no diverja de la que se ve en pantalla.
    //
    // `sinGestion` NO se anota aqui, y no es un olvido: es la respuesta a «¿ofrezco el boton
    // Eliminar en esta fila?», y en un archivo descargado no hay boton. Anotarlo costaria una
    // consulta sobre hasta `MAX_FILAS` ordenes para una columna que nadie mira.
    const intentos = await this.historial.contarIntentosEnLote(items.map((o) => o.id));
    const itemsConIntentos = items.map((o) => ({
      ...o,
      intentosEntrega: intentos.get(o.id) ?? 0,
    }));

    return { status: "ok", items: itemsConIntentos, total };
  }

  // BORRADO 2026-08-07 (tanda 2): aqui vivian `actualizar`, `borrar` y el privado
  // `buildUpdateData` que solo usaba `actualizar`. Las ediciones reales de una orden pasan por
  // las acciones de dominio (guia, asignacion, incidencias, devoluciones), no por este update
  // generico. OJO: `TarifaService` y `UsuarioService` tienen su PROPIO `buildUpdateData`
  // privado y homonimo; no son este y siguen vivos.
}
