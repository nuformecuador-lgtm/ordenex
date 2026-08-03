import { NumRemisionDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  IOrdenRepository,
  ListOrdenesResult,
  ListOrdenesWhere,
  UpdateOrdenData,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  Actor,
  ActualizarOrdenServiceResult,
  BorrarOrdenServiceResult,
  CrearOrdenServiceResult,
  IOrdenService,
  ListarOrdenesCompletoServiceResult,
  ListarOrdenesServiceResult,
  ObtenerOrdenServiceResult,
} from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  ActualizarOrdenInput,
  CreatedPreset,
  CrearOrdenInput,
  ListarOrdenesCompletoInput,
  ListarOrdenesInput,
  OrdenFilterInput,
  SortDir,
  SortField,
} from "@/lib/types/orden";
import {
  normalizarTerminoBusqueda,
  soloDigitosSiPareceNumero,
} from "@/lib/utils/busqueda-orden";
import { resolverDestinoCreacion } from "@/lib/services/destino-creacion";
// Feature 151: el limite de filas de `listarCompleto`. `ordenesConfig` salio de este archivo
// al integrar la 155: su unico consumidor aqui era el default `DEFAULT_ESTATUS_VALUE` del alta
// manual, que la bifurcacion por bodega sustituyo por `resolverDestinoCreacion`.
import { descargaConfig } from "@/lib/config/descarga";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
  inicioDeUltimosNDiasCREnUtc,
} from "@/lib/utils/fecha-cr";

// Roles reconocidos por el CRUD (los demas -> forbidden, R24). maestro/admin
// tienen acceso total (R20); adminTienda/mensajero con restriccion (R21/R23).
const KNOWN_ROLES = new Set<string>(["maestro", "admin", "adminTienda", "mensajero"]);

// Feature 63/B2 (R8): mapa EXPLICITO clave-publica-del-filtro -> columna Prisma.
// Es el UNICO punto que conoce el nombre interno de la FK de estado (`estatusId`,
// columna `estatus_id`); la clave publica `status_id` nunca se usa como nombre de
// columna. El schema `.strict()` (lib/types/orden.ts) ya garantiza que solo llegan
// claves de esta whitelist, asi que ninguna columna arbitraria alcanza el `where`.
// Feature 144/B1 (R30/R43): el mapa crece a los cinco catalogos. Las TRES claves
// temporales (`created_preset`/`created_desde`/`created_hasta`) NO estan aqui a
// proposito: no son columnas, se traducen a un rango `createdAt: { gte, lt }`
// calculado server-side (ver `rangoCreacion`).
const FILTER_TO_COLUMN = {
  status_id: "estatusId",
  zona_id: "zonaId",
  tienda_id: "tiendaId",
  provincia_id: "provinciaId",
  canton_id: "cantonId",
  distrito_id: "distritoId",
} as const;

// Dias de cada atajo de antiguedad (R41). El dominio ya lo cierra `CREATED_PRESETS`
// en el schema; este mapa solo traduce el valor a un numero de dias.
const PRESET_DIAS: Record<CreatedPreset, number> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "90d": 90,
};

/**
 * Feature 144 (R41/R42/R43) — bordes temporales del filtro de creacion, calculados
 * SERVER-SIDE en horario de Costa Rica (UTC-6 fijo). Nunca se aceptan instantes del
 * reloj del cliente: solo fechas calendario o un atajo de dominio cerrado.
 *
 *   - atajo "Nd"  -> `gte` = 00:00 CR de hace N-1 dias (N dias calendario incl. hoy).
 *   - `desde: D`  -> `gte` = 00:00 CR de D.
 *   - `hasta: H`  -> `lt`  = 00:00 CR del dia SIGUIENTE a H  => H es INCLUSIVO.
 *   - un solo extremo -> rango abierto por el otro lado.
 *
 * Atajo y rango no pueden coexistir: `ordenFilterSchema` lo rechaza antes (R40).
 * Devuelve `undefined` si no hay ninguna clave temporal (sin filtro, R45).
 */
function rangoCreacion(
  filter: OrdenFilterInput | undefined,
  ahora: Date,
): { gte?: Date; lt?: Date } | undefined {
  if (!filter) return undefined;
  if (filter.created_preset) {
    return { gte: inicioDeUltimosNDiasCREnUtc(PRESET_DIAS[filter.created_preset], ahora) };
  }
  const rango: { gte?: Date; lt?: Date } = {};
  if (filter.created_desde) rango.gte = inicioDelDiaCREnUtc(filter.created_desde);
  if (filter.created_hasta) rango.lt = inicioDelDiaSiguienteCREnUtc(filter.created_hasta);
  return rango.gte || rango.lt ? rango : undefined;
}

/**
 * Feature 169 (design §5) — mayor valor representable por `num_guia`, que es `int4`. Un
 * termino numerico por encima de esto NO se intenta como guia (el cast reventaria en la
 * base): va directo a la coincidencia parcial (R12).
 */
const NUM_GUIA_MAX = 2_147_483_647;

// Feature 160 (design §3.5): el derivador de intentos EN LOTE. `Pick` para dobles de test sin
// DB, e `import type` para que la dependencia sea SOLO de tipo (sin ciclo de modulos:
// `OrdenHistorialService` depende de repositorios, nunca de los servicios de lista).
type IntentosSvc = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

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

  async crear(input: CrearOrdenInput, actor: Actor): Promise<CrearOrdenServiceResult> {
    // --- Autorizacion (R19-R24), antes de tocar datos ---
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24
    if (actor.rol === "mensajero") return { status: "forbidden" }; // R23

    let tiendaId: string;
    if (actor.rol === "adminTienda") {
      // R21/R22: adminTienda solo puede crear para si mismo.
      if (input.tiendaId !== undefined && input.tiendaId !== actor.usuarioId) {
        return { status: "forbidden" }; // R22
      }
      tiendaId = actor.usuarioId; // R21: fuerza tienda propia
    } else {
      // maestro/admin: tienda_id debe venir explicito (R11, FK NOT NULL).
      if (input.tiendaId === undefined) {
        return {
          status: "validation_error",
          fieldErrors: { tiendaId: ["tiendaId es obligatorio"] },
        };
      }
      tiendaId = input.tiendaId;
    }

    // --- Validacion de FKs (estatus + geografia), R26/R12/R27 ---
    const fieldErrors: Record<string, string[]> = {};

    // Feature 155 (R1/R5/R6/R13/R14) — BIFURCACION POR BODEGA. El estado inicial NO sale del
    // payload ni de una constante de configuracion: sale del flag `fulfillment` de la tienda
    // DUEÑA (`tiendaId`, ya resuelto arriba: la indicada en la entrada para maestro/admin, la
    // propia para adminTienda). El alta manual dejo de aceptar un `estatusId` explicito (R5):
    // el campo salio de `crearOrdenSchema` y, como el schema no es `.strict()`, una entrada
    // legada que lo traiga se IGNORA en silencio en vez de romper.
    const destino = resolverDestinoCreacion(await this.repo.findUsuarioFulfillment(tiendaId));

    // R7: sin el value del catalogo no se crea NADA. El error nombra el value que falta, para
    // que el operador sepa que sembrar (patron de la guarda previa).
    const estatusIdResuelto = await this.repo.findEstatusIdByValue(destino.estatus);
    if (estatusIdResuelto === null) {
      fieldErrors.estatusId = [
        `estatus inicial "${destino.estatus}" no disponible en el catalogo (seed pendiente)`,
      ];
    }
    const estatusId = estatusIdResuelto ?? "";

    // R14b/R12: zona/provincia/canton NOT NULL y geografia creada vacia; deben
    // existir filas referenciables. distrito opcional.
    const geo = await this.repo.existsGeo({
      zonaId: input.zonaId,
      provinciaId: input.provinciaId,
      cantonId: input.cantonId,
      distritoId: input.distritoId,
    });
    if (!geo.zona) fieldErrors.zonaId = ["zonaId no existe"];
    if (!geo.provincia) fieldErrors.provinciaId = ["provinciaId no existe"];
    if (!geo.canton) fieldErrors.cantonId = ["cantonId no existe"];
    if (!geo.distrito) fieldErrors.distritoId = ["distritoId no existe"];

    if (Object.keys(fieldErrors).length > 0) {
      return { status: "validation_error", fieldErrors }; // R26
    }

    // --- Persistencia ---
    try {
      const orden = await this.repo.create(
        {
          numRemision: input.numRemision,
          estatusId,
          destinatario: input.destinatario,
          telefonoDest: input.telefonoDest,
          tiendaId,
          zonaId: input.zonaId,
          provinciaId: input.provinciaId,
          cantonId: input.cantonId,
          distritoId: input.distritoId ?? null,
          producto: input.producto,
          peso: input.peso,
          notas: input.notas ?? null,
        },
        // Feature 49/#2 (R10/R21/R23): la crea el usuario autenticado; origen null.
        { actorUsuarioId: actor.usuarioId, origenTipo: "creacion_manual" },
        // Feature 155/R3/R8/R9/R12: la rama (b) numera en la MISMA tx; la (a) nace sin guia.
        // El mensajero NO se asigna en ninguna de las dos (`create` nunca lo escribe, R9).
        { conGuia: destino.conGuia },
      );
      return { status: "ok", orden };
    } catch (error) {
      if (error instanceof NumRemisionDuplicadoError) {
        return { status: "conflict" }; // R28
      }
      throw error;
    }
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

    const orden = await this.repo.findById(id); // excluye borradas (R34)
    if (!orden) return { status: "not_found" }; // R29

    // R21: adminTienda solo ve las suyas; ajena en lectura -> not_found.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "not_found" };
    }
    return { status: "ok", orden };
  }

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
    where.busqueda = normalizarTerminoBusqueda(termino);
    // `digitos` ya es solo digitos: normalizarlo seria la identidad. Se compara contra la
    // forma normalizada para no mandar dos veces lo mismo cuando el termino ya venia limpio.
    if (digitos !== null && digitos !== where.busqueda) where.busquedaDigitos = digitos;
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
    // Feature 144/R41/R42/R43: los bordes temporales se calculan AQUI (server-side),
    // no llegan del cliente.
    const createdAt = rangoCreacion(input.filter, this.ahora());
    if (createdAt) where.createdAt = createdAt;
    // REASIGNABLES: predicado compuesto, no columna, asi que no pasa por
    // FILTER_TO_COLUMN; el repositorio lo traduce. Solo acota (nunca amplia), asi que
    // convive sin conflicto con el acotamiento por rol que se escribe debajo.
    if (input.filter?.reasignables) where.reasignables = true;
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

  async listar(
    input: ListarOrdenesInput,
    actor: Actor,
  ): Promise<ListarOrdenesServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

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
    const itemsConIntentos = items.map((o) => ({
      ...o,
      intentosEntrega: intentos.get(o.id) ?? 0,
    }));

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
    const intentos = await this.historial.contarIntentosEnLote(items.map((o) => o.id));
    const itemsConIntentos = items.map((o) => ({
      ...o,
      intentosEntrega: intentos.get(o.id) ?? 0,
    }));

    return { status: "ok", items: itemsConIntentos, total };
  }

  async actualizar(
    id: string,
    input: ActualizarOrdenInput,
    actor: Actor,
  ): Promise<ActualizarOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

    // R23/R41: mensajero solo puede tocar estatusId; cualquier otro campo -> forbidden.
    if (actor.rol === "mensajero") {
      const otrosCampos = Object.keys(input).filter((k) => k !== "estatusId");
      if (otrosCampos.length > 0) return { status: "forbidden" };
    }

    const orden = await this.repo.findById(id); // excluye borradas (R34)
    if (!orden) return { status: "not_found" }; // R36

    // R21: adminTienda solo edita las suyas; mutacion de ajena -> forbidden.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // R38: estatusId nuevo debe existir en el catalogo.
    if (input.estatusId !== undefined) {
      const exists = await this.repo.existsEstatus(input.estatusId);
      if (!exists) {
        return {
          status: "validation_error",
          fieldErrors: { estatusId: ["estatusId no existe en el catalogo"] },
        };
      }
    }

    // R37: aplica solo los campos permitidos por rol; no toca inmutables.
    const data = this.buildUpdateData(input, actor.rol);
    // Feature 49/#11 (R19/R20/R23): si el update cambia `estatus_id`, deja rastro
    // (origenTipo ajuste_estado, actor = usuario autenticado); si no, no registra nada.
    const actualizada = await this.repo.update(id, data, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "ajuste_estado",
    });
    if (!actualizada) return { status: "not_found" }; // carrera: borrada entre medias
    return { status: "ok", orden: actualizada };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24
    if (actor.rol === "mensajero") return { status: "forbidden" }; // R41

    const orden = await this.repo.findById(id); // excluye ya borradas (R40)
    if (!orden) return { status: "not_found" }; // R40

    // R21: adminTienda solo borra las suyas; ajena -> forbidden.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    const ok = await this.repo.softDelete(id); // R39: soft delete
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }

  // R37: para mensajero solo estatusId; para el resto, todos los campos de negocio
  // presentes en el input (id/numGuia/createdAt jamas entran, no estan en el schema).
  private buildUpdateData(
    input: ActualizarOrdenInput,
    rol: Actor["rol"],
  ): UpdateOrdenData {
    if (rol === "mensajero") {
      return input.estatusId !== undefined ? { estatusId: input.estatusId } : {};
    }
    const data: UpdateOrdenData = {};
    if (input.estatusId !== undefined) data.estatusId = input.estatusId;
    if (input.destinatario !== undefined) data.destinatario = input.destinatario;
    if (input.telefonoDest !== undefined) data.telefonoDest = input.telefonoDest;
    if (input.tiendaId !== undefined) data.tiendaId = input.tiendaId;
    if (input.zonaId !== undefined) data.zonaId = input.zonaId;
    if (input.provinciaId !== undefined) data.provinciaId = input.provinciaId;
    if (input.cantonId !== undefined) data.cantonId = input.cantonId;
    if (input.distritoId !== undefined) data.distritoId = input.distritoId;
    if (input.producto !== undefined) data.producto = input.producto;
    if (input.peso !== undefined) data.peso = input.peso;
    if (input.notas !== undefined) data.notas = input.notas;
    return data;
  }
}
