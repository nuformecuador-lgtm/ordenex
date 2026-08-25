import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  RecepcionSateliteFiltro,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  IRecepcionSateliteService,
  ListarIdsVigentesBodegaInput,
  ListarIdsVigentesBodegaServiceResult,
  ListarOrdenesBodegaCompletoInput,
  ListarOrdenesBodegaCompletoServiceResult,
  ListarOrdenesBodegaPaginadoInput,
  ListarOrdenesBodegaPaginadoServiceResult,
  ListarRecepcionSateliteServiceResult,
  RecepcionSateliteDTO,
  RecibirServiceResult,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import { descargaConfig } from "@/lib/config/descarga";
import { estadosDelListado } from "@/lib/utils/estados-bodega-satelite";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
// Pedido humano (2026-08-19): la barra de este listado es la de `/ordenes`, asi que sus dos
// traducciones no triviales —el atajo de antiguedad a instantes de Costa Rica y el termino
// tecleado a las formas que casan con la columna generada— salen del MISMO util que usa
// `OrdenService`. Escritas dos veces divergirian sin que nada fallara.
import {
  rangoCreacion,
  terminoDeBusqueda,
} from "@/lib/utils/filtros-listado-ordenes";

// Estado de ORIGEN de la recepcion (feature 30) y destino tras recibir (esta
// feature). Un solo estado de destino; el nombre de zona se deriva de orden.zonaId
// para el display (R9/R20).
const ORIGEN_RECEPCION = "en_ruta_bodega_satelite";
const ESTADO_RECIBIDA = "en_bodega_satelite";
// Feature 139/T2.5/R21: estado de las ordenes elegibles para "Enviar a central" (primer tramo del
// retorno satelite). REEMPLAZA a `rechazada` (feature 48): con la 139 una rechazada sale de ese
// estado SOLO al aprobar el cierre, que la deja en `por_devolver`; la accion satelite opera ahora
// sobre `por_devolver` (accionable por lote). Se listan acotadas a la zona del adminSatelite.
const ESTADO_POR_DEVOLVER = "por_devolver";
// Feature 139/T2.5/R21: estado INFORMATIVO de las ordenes ya enviadas a central y en transito
// (`devolviendo_a_bodega_central`). Se listan acotadas a la zona; no accionables desde satelite
// (la recepcion la hace la central por QR).
const ESTADO_EN_TRANSITO_CENTRAL = "devolviendo_a_bodega_central";
// Feature 100/T4.1/R12: estado de las ordenes `devuelta` (novedad que reposa bajo la
// feature 99) elegibles para "Recuperar a bodega" (nuevo intento). Mismo patron que
// `porDevolver` (48): SIEMPRE acotadas a la zona del adminSatelite. La transicion la
// ejecuta RecuperacionBodegaService (autz rol + zona); aqui SOLO listado por zona.
const ESTADO_DEVUELTA = "devuelta";
// Feature 149/T6.3/R35: estado de las ordenes de la zona YA ASIGNADAS a un mensajero que aun no
// las recogio (`por_recoger`), elegibles para la accion por lote "Deshacer asignacion". Mismo
// patron que `porDevolver` (139) y `devueltas` (100): SIEMPRE acotadas a la zona del
// adminSatelite por `findRecepcionSateliteByZona(zonaId, ...)`; aqui SOLO listado — la autz de
// ejecutar la reversion (rol + zona + destino derivado) la impone `DeshacerAsignacionService`.
// El caso (b) (`en_ruta_bodega_satelite`) NO entra en este bucket (R36): sigue en "Por recibir".
const ESTADO_ASIGNADA = "por_recoger";

// Solo el rol autorizado en el modulo (R3/R17): el adminSatelite, SIEMPRE acotado
// a su propia zona (R4/R12).
const ROL_AUTORIZADO = "adminSatelite";

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP.
type RecepcionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findRecepcionSateliteByZona"
  // Feature 170 — FASE 2 (T K.1/T K.2): la pagina del listado y el catalogo de sus filtros.
  | "findRecepcionSatelitePaginada"
  // Feature 184 — Tanda A (T A.1/T A.2): el conjunto entero para el archivo y la vigencia de
  // los identificadores marcados, los dos con el MISMO criterio que la pagina.
  | "findRecepcionSateliteCompleta"
  | "findIdsVigentesEnBodega"
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
>;

/**
 * Logica de negocio de la bodega satelite (feature 33). Resuelve el alcance por
 * zona del adminSatelite (server-side, R4), lista los dos grupos (R6/R8) y ejecuta
 * la recepcion por QR con guardias/idempotencia (R11-R18). No conoce HTTP ni
 * Prisma; testeable con dobles sin red/DB.
 */
export class RecepcionSateliteService implements IRecepcionSateliteService {
  constructor(
    private readonly repo: RecepcionSateliteRepo,
    // Feature 160 (R11/R12/R25): derivador de intentos EN LOTE, dependencia REQUERIDA.
    // `import type` + `Pick`: sin ciclo de modulos y testeable con dobles.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
    /**
     * Pedido humano (2026-08-19): reloj inyectable, como en `OrdenService`. Lo necesita el
     * atajo de antiguedad del filtro de creacion («ultimos 7 dias» se mide desde AHORA), y
     * inyectarlo es lo que permite fijar ese rango en los tests sin congelar el reloj global.
     */
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /**
   * Pedido humano (2026-08-19) — la entrada publica del listado traducida al criterio del
   * repositorio, en UN solo sitio.
   *
   * Lo comparten los TRES caminos del listado (la pagina, el conjunto de la descarga y la
   * comprobacion de vigencia) porque los tres tienen que mirar el MISMO conjunto: escrita tres
   * veces, la descarga acabaria filtrando distinto que la pantalla sin que nada lo delatara
   * (R16). La zona NO es un parametro publico: llega aparte, siempre desde el actor.
   */
  private filtroDeRepo(
    input: ListarOrdenesBodegaCompletoInput,
    zonaId: string,
  ): RecepcionSateliteFiltro {
    const creacion = rangoCreacion(input, this.ahora());
    const termino = input.q ? terminoDeBusqueda(input.q) : undefined;
    // Las claves ausentes se OMITEN en vez de viajar como `undefined`: lo que el repositorio
    // recibe es exactamente lo que se filtra, y un doble de test puede afirmarlo mirando las
    // claves. `zonaId` y `estatusValues` van siempre — son el alcance, no un filtro.
    return {
      zonaId,
      estatusValues: estadosDelListado(input.estados), // la lista blanca de los cinco (R44)
      ...(input.mensajero_id ? { mensajeroIds: input.mensajero_id } : {}),
      ...(input.provincia_id ? { provinciaIds: input.provincia_id } : {}),
      ...(input.canton_id ? { cantonIds: input.canton_id } : {}),
      ...(input.distrito_id ? { distritoIds: input.distrito_id } : {}),
      ...(creacion?.gte ? { creadaDesde: creacion.gte } : {}),
      ...(creacion?.lt ? { creadaHasta: creacion.lt } : {}),
      ...(termino ? { busqueda: termino.busqueda } : {}),
      ...(termino?.busquedaDigitos ? { busquedaDigitos: termino.busquedaDigitos } : {}),
    };
  }

  async listar(actor: Actor): Promise<ListarRecepcionSateliteServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) {
      // R5: adminSatelite sin zona -> modulo vacio + aviso accionable (sinZona).
      return {
        status: "ok",
        porRecibir: [],
        recibidas: [],
        porDevolver: [], // Feature 139/R21: sin zona -> tampoco hay `por_devolver`
        enTransitoACentral: [], // Feature 139/R21: sin zona -> tampoco hay `devolviendo_a_bodega_central`
        devueltas: [], // Feature 100/T4.1: sin zona -> tampoco hay ordenes por recuperar
        asignadas: [], // Feature 149/T6.3/R35: sin zona -> tampoco hay ordenes por deshacer
        zonaNombre: null,
        sinZona: true,
      };
    }

    // Feature 139/T2.5/R21: se listan `por_devolver` (accionable: "Enviar a central") y
    // `devolviendo_a_bodega_central` (informativo: en transito a central), SIEMPRE acotadas a la zona
    // del actor. `por_devolver` REEMPLAZA al viejo `rechazada` (feature 48): la rechazada sale de ese
    // estado solo al aprobar el cierre. Feature 100/T4.1/R12: `devuelta` sigue listandose para
    // "Recuperar a bodega".
    const rows = await this.repo.findRecepcionSateliteByZona(zonaId, [
      ORIGEN_RECEPCION,
      ESTADO_RECIBIDA,
      ESTADO_POR_DEVOLVER,
      ESTADO_EN_TRANSITO_CENTRAL,
      ESTADO_DEVUELTA,
      ESTADO_ASIGNADA, // Feature 149/T6.3/R35
    ]); // R6/R8 + Feature 139/R21 + Feature 100/R12 + Feature 149/R35

    // Feature 160 (R12/R13/R15): UN SOLO lote con la union de los ids de los CINCO grupos, ya
    // acotados a la zona del actor por `findRecepcionSateliteByZona`. Cinco llamadas (una por
    // grupo) serian un incumplimiento gratuito de R12. Sin filas -> 0 consultas (R13).
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    const porRecibir: RecepcionSateliteDTO[] = [];
    const recibidas: RecepcionSateliteDTO[] = [];
    const porDevolver: RecepcionSateliteDTO[] = []; // Feature 139/R21: por_devolver (accionable)
    const enTransitoACentral: RecepcionSateliteDTO[] = []; // Feature 139/R21: en transito (informativo)
    const devueltas: RecepcionSateliteDTO[] = []; // Feature 100/T4.1/R12
    const asignadas: RecepcionSateliteDTO[] = []; // Feature 149/T6.3/R35 (por_recoger)
    let zonaNombre: string | null = null;
    for (const row of rows) {
      zonaNombre = row.zonaNombre; // derivado de orden.zonaId (misma zona para todas)
      // Feature 160 (R14/R19): `?? 0` — el `0` SIEMPRE se expone, no se omite.
      const dto = { ...toDTO(row), intentosEntrega: intentos.get(row.id) ?? 0 };
      if (row.estatusValue === ORIGEN_RECEPCION) porRecibir.push(dto);
      else if (row.estatusValue === ESTADO_RECIBIDA) recibidas.push(dto);
      else if (row.estatusValue === ESTADO_POR_DEVOLVER) porDevolver.push(dto);
      else if (row.estatusValue === ESTADO_EN_TRANSITO_CENTRAL) enTransitoACentral.push(dto);
      else if (row.estatusValue === ESTADO_DEVUELTA) devueltas.push(dto);
      else if (row.estatusValue === ESTADO_ASIGNADA) asignadas.push(dto); // feature 149/R35
    }
    return {
      status: "ok",
      porRecibir,
      recibidas,
      porDevolver,
      enTransitoACentral,
      devueltas,
      asignadas,
      zonaNombre,
      sinZona: false,
    };
  }

  /**
   * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51) — la pagina del listado «Órdenes de la
   * bodega», con los TRES filtros resueltos aqui y no en el navegador.
   *
   * **Que cambia de verdad.** Hasta hoy la pantalla recibia el conjunto entero de la zona y
   * cruzaba estado ∧ canton ∧ distrito con `Array.filter`. Bajo paginacion ese filtro solo
   * veria la pagina: el usuario creeria estar filtrando su bodega y estaria filtrando 25
   * filas. Por eso el cruce se muda aqui, DELANTE del recorte, y el `total` que sale es el del
   * conjunto filtrado (R41) — el numero que la pantalla necesita para paginar y contar.
   *
   * **Que NO cambia.** El acotamiento: guard de rol (R3/R17) antes de tocar nada y zona
   * resuelta desde `usuario.zona_id` (R4). Los filtros solo pueden ESTRECHAR ese conjunto:
   * `estadosDelListado` interseca contra la lista blanca de los cinco estados, asi que ni un
   * `estados` inventado ni un canton de otra provincia amplian el alcance (R44). Sin zona no
   * se consulta la base: pagina vacia.
   */
  async listarOrdenesBodegaPaginado(
    input: ListarOrdenesBodegaPaginadoInput,
    actor: Actor,
  ): Promise<ListarOrdenesBodegaPaginadoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) {
      // R5: el rol tiene acceso al modulo, lo que no tiene es alcance. Sin una consulta.
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const { items: rows, total } = await this.repo.findRecepcionSatelitePaginada(
      this.filtroDeRepo(input, zonaId),
      rangoDePagina(input),
    );

    // Feature 160 (R12/R13/R15): UN SOLO lote, ahora con los ids de la PAGINA. Sin filas -> 0
    // consultas. El criterio de intentos es el mismo que el del listado sin paginar.
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    return {
      status: "ok",
      items: rows.map((row) => ({
        ...toDTO(row),
        intentosEntrega: intentos.get(row.id) ?? 0, // R14/R19: el `0` SIEMPRE se expone
      })),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO filtrado, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda A (T A.3, R1/R2/R4/R6/R11) — el CONJUNTO filtrado ENTERO del listado
   * «Órdenes de la bodega», para producir el archivo.
   *
   * **Que cierra.** Hasta hoy la descarga releia `listar()` —los CINCO grupos de la zona
   * entera, sin filtrar— y volvia a cruzar estado ∧ canton ∧ distrito en el navegador. Eso era
   * el criterio escrito dos veces, en dos capas, y el conjunto SIN filtrar cruzando a la
   * pantalla para producir un archivo filtrado. Aqui el conjunto llega ya filtrado por la base
   * con el MISMO `WHERE` y el MISMO `ORDER BY` que la pagina (R11/R16).
   *
   * **Que NO cambia.** El guard de rol va ANTES de tocar nada (R4) y la zona sale del usuario,
   * nunca de la entrada. Sin zona el conjunto es vacio, no `forbidden`: el rol tiene acceso al
   * modulo, lo que no tiene es alcance.
   *
   * **El tope se evalua aqui** (R6): por encima no se entrega ni una fila —ni un conjunto
   * truncado, que es peor— y tampoco se pide el lote de intentos, que no tendria a quien
   * adornar. Es el mismo numero que aplicaba el navegador; lo que cambia es DONDE se aplica.
   *
   * **Excepcion declarada a R29 de la 170, y aqui es la mas cara de las once.** R29 —feature
   * `done`, requisito vivo— pide dos cosas: el tope en el SERVIDOR y, superado, ni materializar
   * ni transportar mas de `N + 1` filas. Lo que se cumple es el transporte: por encima del tope
   * no cruza ni una fila. Lo que NO se cumple es materializar, y en este listado no es solo
   * contar de mas: `findRecepcionSateliteCompleta` ordena los ids del conjunto ENTERO y despues
   * los HIDRATA todos con `WITH_RECEPCION_SATELITE` —la proyeccion completa de la fila y sus
   * relaciones— antes de que esta linea mire el tope. Es el peor caso de los once y conviene
   * decirlo asi: el conjunto son las ordenes vivas de la bodega de una zona, y lo que se trae de
   * mas no es un entero por fila, es el payload entero.
   *
   * Se acepta por lo que costaria cerrarlo: acotar la consulta a `limite + 1` obliga a un `count`
   * aparte para conservar el total EXACTO que el aviso publica (R6), y esa segunda consulta es
   * justo la que R15 de esta feature mide y prohibe, y el coste que esta migracion vino a quitar.
   * Decision humana del 2026-08-05, escrita en el design §3.1. Es una excepcion con motivo, no
   * una forma de cumplir R29; el `N + 1` real queda como ficha aparte y este listado es su primer
   * candidato.
   */
  async listarOrdenesBodegaCompleto(
    input: ListarOrdenesBodegaCompletoInput,
    actor: Actor,
  ): Promise<ListarOrdenesBodegaCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R4: antes del repo

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "ok", items: [], total: 0 };

    // El MISMO criterio que la pagina, del mismo traductor: el archivo no puede filtrar
    // distinto que la pantalla (R16).
    const conjunto = await this.repo.findRecepcionSateliteCompleta(
      this.filtroDeRepo(input, zonaId),
    );

    const limite = descargaConfig.MAX_FILAS;
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    // Feature 160 (R12/R13/R15): UN SOLO lote con los ids del conjunto. La columna «Intentos»
    // del archivo sale de aqui; sin este lote el archivo publicaria un 0 para todas.
    const intentos = await this.historial.contarIntentosEnLote(conjunto.map((r) => r.id));

    return {
      status: "ok",
      // El MISMO mapper que la pagina: dos proyecciones distintas de la misma fila son dos
      // archivos distintos del mismo listado.
      items: conjunto.map((row) => ({
        ...toDTO(row),
        intentosEntrega: intentos.get(row.id) ?? 0, // R14/R19: el `0` SIEMPRE se expone
      })),
      total: conjunto.length,
    };
  }

  /**
   * Feature 184 — Tanda A (T A.3, R19/R21/R23) — cuales de los identificadores marcados siguen
   * perteneciendo al conjunto filtrado. Es la comprobacion con la que la pantalla PODA su
   * seleccion.
   *
   * **Se decide sobre el CONJUNTO, no sobre la pagina** (R19): una orden marcada puede haber
   * salido del listado por una accion de esta pantalla o por la de otro operador, y en los dos
   * casos sigue siendo invisible aqui.
   *
   * **Devuelve los VIGENTES.** El cliente interseca, asi que una respuesta corta no puede
   * leerse como «desmarca todo» (R22).
   *
   * **Sin ids no se consulta NADA** (R23 tambien en el servidor: el borde ya exige `.min(1)`,
   * pero la regla es del dominio y se sostiene sola). Sin zona, `[]` sin tocar el listado: un
   * actor sin alcance no tiene ordenes vigentes.
   */
  async listarIdsVigentesBodega(
    input: ListarIdsVigentesBodegaInput,
    actor: Actor,
  ): Promise<ListarIdsVigentesBodegaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R4: antes del repo
    if (input.ids.length === 0) return { status: "ok", ids: [] }; // R23: ni una consulta

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R21
    if (zonaId === null) return { status: "ok", ids: [] };

    const ids = await this.repo.findIdsVigentesEnBodega(
      this.filtroDeRepo(input, zonaId),
      input.ids,
    );
    return { status: "ok", ids };
  }

  async recibir(numGuia: number, actor: Actor): Promise<RecibirServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "sin_zona" }; // R5

    // El QR codifica `/paquete/<numGuia>`: la orden se resuelve por `num_guia`
    // (UNIQUE); el `id` sale de la fila para la transicion guardada.
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    // R15: inexistente o borrada -> no_encontrada, sin efectos.
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };
    const ordenId = row.id;
    // R12: orden de otra zona -> zona_ajena, sin efectos.
    if (row.zonaId !== zonaId) return { status: "zona_ajena" };
    // R14: ya recibida (misma zona) -> idempotente, sin escribir.
    if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };
    // R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido, sin efectos.
    if (row.estatusValue !== ORIGEN_RECEPCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    const destinoId = await this.repo.findEstatusIdByValue(ESTADO_RECIBIDA);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R11/R18: transicion atomica guardada por estado de origen + zona.
    // Feature 49/#6 (R14): actor = el adminSatelite; destino en_bodega_satelite.
    const ok = await this.repo.recibirEnSatelite(ordenId, zonaId, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "recepcion_satelite",
    });
    if (ok) return { status: "ok", ordenId, estado: ESTADO_RECIBIDA };

    // R18: race — otro escaneo la movio entre la lectura y la escritura. Re-lee y
    // decide: si ahora esta recibida -> ya_recibida (idempotente); si no -> conflict.
    const actual = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (actual && actual.deletedAt === null && actual.estatusValue === ESTADO_RECIBIDA) {
      return { status: "ya_recibida" };
    }
    return { status: "conflict" };
  }

}

function toDTO(row: RecepcionSateliteRow): RecepcionSateliteDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatusValue,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar,
    tiendaNombre: row.tiendaNombre,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
    prioridad: row.prioridad, // feature 101/R9: propaga el flag al DTO (resalte de fila R8)
    fechaRepartoISO: row.fechaRepartoISO, // feature 262/B8 (R16): el dia por orden, ya serializado por el repo
  };
}
