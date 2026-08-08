import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  Alcance,
  CierreAdminResumenRow,
  GestionIncidenteDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ILiquidacionPagoRepository } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  AprobarCierreServiceResult,
  CierreAdminResumen,
  CierreDetalleAdminServiceResult,
  ForzarSolicitudVencidoServiceResult,
  ICierresAdminService,
  IndemnizacionCapturadaInput,
  ListarCierresAdminServiceResult,
  ListarHistoricoCierresAdminCompletoServiceResult,
  ListarHistoricoCierresAdminServiceResult,
  ListarPendientesCierresAdminCompletoServiceResult,
  ListarPendientesCierresAdminServiceResult,
  RechazarCierreServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";
import { descargaConfig } from "@/lib/config/descarga";
import { esColaCierreDia } from "@/lib/utils/colas-cierre";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { excesoIndemnizacion } from "@/lib/utils/tope-indemnizacion";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import {
  gananciaOrdenex,
  pagoTiendaOrdenex,
  totalesIngresoOrdenex,
} from "@/lib/utils/ingreso-ordenex";
import { desglosarIngresoBodegaPorOrigen } from "@/lib/utils/desglose-rechazos-sla";

// Roles autorizados en el modulo (R1): acceso total (maestro/admin -> bodega central) y el
// adminSatelite (su bodega). Cualquier otro -> forbidden.
const ROL_ADMIN_SATELITE = "adminSatelite";

// Mensaje accionable cuando falta el motivo de rechazo (R11).
const MSG_MOTIVO_REQUERIDO = "El motivo de rechazo es obligatorio.";

// Feature 158 (R19/R20/R21) — mensajes accionables de la captura de indemnizaciones. Texto
// fijo i18n-ready y SIN PII: nombran la gestion por su id (que el admin ya tiene en pantalla),
// nunca al mensajero, al destinatario ni al monto.
const MSG_INDEMNIZACION_FALTANTE = "Falta el monto de indemnizacion de este incidente.";
const MSG_INDEMNIZACION_AJENA =
  "Este monto no corresponde a un incidente de este cierre.";
const MSG_INDEMNIZACION_DUPLICADA = "Hay dos montos para el mismo incidente.";

// Feature 109 (T3.1, R16): estados del catalogo que consume la LIBERACION de `sin_gestionar` al
// aprobar (destinos de bodega por zona de la orden).
const ESTADO_SIN_GESTIONAR = "sin_gestionar";
const ESTADO_EN_BODEGA = "en_bodega_central";
const ESTADO_EN_BODEGA_SATELITE = "en_bodega_satelite";

// Feature 139 (T1.2, R5): estados del catalogo que consume el DISPARO de la devolucion de
// RECHAZADAS al aprobar. Origen `rechazada`; destinos por zona de la orden: bodega satelite ->
// `por_devolver`, bodega central -> `por_devolver_a_tienda` (misma regla `resolverDestinoCierre`).
const ESTADO_RECHAZADA = "rechazada";
const ESTADO_POR_DEVOLVER = "por_devolver";
const ESTADO_POR_DEVOLVER_A_TIENDA = "por_devolver_a_tienda";

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 109 (T3.1): + `findEstatusIdByValue` para resolver los estatus destino de la liberacion.
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId" | "findEstatusIdByValue">;
/**
 * Feature 172 (T C.2) — de todo el repositorio de la liquidacion, este servicio consume DOS
 * metodos, y los dos son de LECTURA. El `Pick` no es cosmetico: deja escrito —y hace que el
 * typecheck lo imponga— que la pantalla de cierres puede DERIVAR el pendiente y no puede
 * registrar, anular ni tocar un solo pago. Aprobar y pagar son dos escrituras distintas (§8).
 */
type LiquidacionLecturaRepo = Pick<
  ILiquidacionPagoRepository,
  "sumarVigentesPorCierre" | "obtenerCierreParaPago"
>;

// Resultado interno de resolver el alcance del actor (R2/R3).
type AlcanceResult =
  | { status: "ok"; alcance: Alcance }
  | { status: "sinZona" } // adminSatelite sin zona (R3)
  | { status: "forbidden" }; // rol invalido (R1)

/**
 * Feature 38 — logica de negocio de "Cierres del dia" del admin (maestro /
 * adminSatelite). Lista los cierres del alcance (rol+zona), muestra el detalle con
 * evidencias firmadas (R7) y transiciona `solicitado` -> aprobado/rechazado con
 * guardia de estado+alcance (R12/R13). No conoce HTTP ni Prisma; testeable con dobles.
 */
export class CierresAdminService implements ICierresAdminService {
  constructor(
    private readonly repo: ICierresAdminRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly signedUrls: ISignedUrlProvider,
    // Feature 172 (T C.2): SOLO LECTURA de los pagos ya registrados, para derivar el pendiente
    // de cada cierre aprobado (R22/R26/R28). Es una dependencia OBLIGATORIA a proposito: si
    // fuera opcional, olvidar cablearla dejaria todos los pendientes en silencio a `null` —una
    // deuda invisible— en vez de romper el build.
    private readonly liquidacionRepo: LiquidacionLecturaRepo,
  ) {}

  // R1/R2/R3: resuelve el alcance server-side por rol+zona. Acceso total (maestro/admin) ve
  // todos los `bodega_central` (sin filtro de zona); el adminSatelite solo su zona satelite.
  private async resolveAlcance(actor: Actor): Promise<AlcanceResult> {
    if (esAccesoTotal(actor.rol)) {
      return { status: "ok", alcance: { destinoTipo: "bodega_central", destinoZonaId: null } };
    }
    if (actor.rol === ROL_ADMIN_SATELITE) {
      const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
      if (zonaId === null) return { status: "sinZona" }; // R3
      return { status: "ok", alcance: { destinoTipo: "bodega_satelite", destinoZonaId: zonaId } };
    }
    return { status: "forbidden" }; // R1: cualquier otro rol
    // Nota: `zonaRepo.findCentralZonaId()` queda como verificacion defensiva reservada
    // (design §3.1): el destino ya viene resuelto/persistido por la 37; la 38 filtra
    // por destino_tipo/destino_zona_id (columnas indexadas), sin releer la zona central.
  }

  async listarCierresAdmin(actor: Actor): Promise<ListarCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", pendientes: [], historico: [], sinZona: true }; // R3
    }

    // R2: el filtro por alcance vive en el repo (WHERE), nunca en memoria.
    const rows = await this.repo.findCierresByAlcance(scope.alcance);

    // R4/R5 + feature 41/E2 (R20): partir por estado. Los estados RESOLUBLES
    // (`solicitado` y `vencido`) van a la cola de pendientes; los resueltos
    // (`aprobado`/`rechazado`) al historico. El `vencido` viaja con su `estado` en el
    // resumen, para que el frontend lo etiquete diferenciado dentro de la cola (R20).
    // Feature 172 (T C.2): UNA sola agregacion para las DOS listas, no una por lista y menos
    // una por fila. Los cierres de la cola no aportan ningun id (no estan aprobados, R28).
    const resumenes = await this.conPendiente(rows);

    const pendientes: CierreAdminResumen[] = [];
    const historico: CierreAdminResumen[] = [];
    for (const resumen of resumenes) {
      // Feature 170 (T I.1): el corte sale de `ESTADOS_COLA_CIERRE_DIA` y ya no de dos
      // literales aqui. Es EL MISMO que el repositorio escribe como WHERE al paginar el
      // historico (R44): dos escrituras del mismo criterio es como una fila se cae de una
      // lista sin que nadie lo note.
      if (esColaCierreDia(resumen.estado)) pendientes.push(resumen);
      else historico.push(resumen);
    }
    return { status: "ok", pendientes, historico, sinZona: false };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — el HISTORICO, paginado en servidor.
   *
   * No reimplementa nada del alcance: reusa `resolveAlcance`, que es el `construirWhere` de
   * este servicio (el rol y la zona se resuelven server-side y NUNCA se aceptan del cliente).
   * Por eso paginar no puede ampliar lo que ve nadie — R44 se cumple por construccion, no por
   * vigilancia.
   *
   * `sinZona` -> pagina VACIA, no `forbidden`: el `adminSatelite` sin zona tiene acceso al
   * modulo, lo que no tiene es alcance que consultar. Es lo mismo que devuelve hoy
   * `listarCierresAdmin` (historico `[]`), asi que la pantalla no cambia de comportamiento.
   * Y ni una consulta se ejecuta en ese caso.
   *
   * UNA sola llamada al repositorio, igual que el listado sin paginar (R54): el conteo que
   * R41 exige viaja DENTRO de ella.
   */
  async listarHistoricoCierresAdminPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 }; // R3
    }

    const { items, total } = await this.repo.findHistoricoPaginado(
      scope.alcance,
      rangoDePagina(input),
    );

    return {
      status: "ok",
      // R8/R9: mismo mapper que el listado sin paginar. Feature 172 (T C.2): + el pendiente,
      // con UNA sola agregacion para toda la pagina (el numero de consultas no crece con
      // `pageSize`, que es la misma propiedad que R54 exige del resto de este listado).
      items: await this.conPendiente(items),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54) — la COLA de pendientes de decision,
   * paginada en servidor.
   *
   * Espejo exacto del metodo del historico: MISMO `resolveAlcance` (el rol y la zona salen del
   * usuario, nunca de la peticion) y MISMO corte, que aqui es el `in` de
   * `ESTADOS_COLA_CIERRE_DIA` donde alli era el `notIn`. R44 se cumple por construccion.
   *
   * R49: NO se agrega dinero aqui. Los montos que la pantalla muestra por esta cola son los
   * SNAPSHOT de cada cierre, que viajan por fila tal cual (`toResumen` no recomputa nada); la
   * pantalla no deriva de este array ningun total. Lo que el `total` de la respuesta alimenta
   * es el CONTADOR de cabecera (R42), que es un conteo de filas, no dinero.
   *
   * `sinZona` -> pagina vacia sin consultar la base, igual que hoy: `listarCierresAdmin`
   * devuelve `pendientes: []` para ese mismo actor.
   */
  async listarPendientesCierresAdminPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 }; // R3
    }

    const { items, total } = await this.repo.findColaPaginada(scope.alcance, rangoDePagina(input));

    return {
      status: "ok",
      // R8/R9: mismo mapper que el listado sin paginar. Feature 172 (T C.2): el campo viaja
      // tambien aqui —siempre `null`, porque la cola son cierres NO aprobados (R28)— para que
      // las tres listas tengan la MISMA forma y la pantalla no tenga dos contratos.
      items: await this.conPendiente(items),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41/R42: el total del CONJUNTO de la cola, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6) — el HISTORICO ENTERO del alcance, sin recorte, que
   * es del que sale el archivo.
   *
   * **Lo que cierra.** Hasta hoy ese archivo se producia releyendo `listarCierresAdmin()`, que
   * trae el alcance ENTERO —cola e historico— y lo parte en memoria para que la pantalla se
   * quede con una de las dos mitades. Aqui se lee SOLO el historico, cortado en la base por el
   * mismo criterio que su pagina (R16).
   *
   * **No lleva `input`, y es deliberado.** Este listado no admite filtros: su schema de pagina
   * solo tenia `page`/`pageSize`, y quitarlos deja una lista blanca de CERO claves. El borde la
   * sigue aplicando entera —un `destinoZonaId` colado muere alli con `validation_error` (R17)—
   * pero no hay nada que transportar hasta aqui. El alcance sale del ACTOR, como en la pagina.
   *
   * `sinZona` -> conjunto vacio sin consultar la base, no `forbidden`: el `adminSatelite` sin
   * zona tiene acceso al modulo, lo que no tiene es alcance. Es lo mismo que devuelven hoy
   * `listarCierresAdmin` (`historico: []`) y la pagina.
   *
   * **Excepcion declarada a R29 de la 170.** R29 —feature `done`, requisito vivo— exige el tope
   * en el SERVIDOR y, superado, no materializar NI transportar mas de `N + 1` filas. Transportar
   * se cumple: por encima del tope no sale ni una fila, y ni siquiera se paga el `conPendiente`
   * de abajo. Materializar NO: `findHistoricoCompleto` es un `findMany` sin `take`, asi que el
   * historico del alcance entra entero en memoria y el tope lo mide esta funcion despues. El
   * conjunto es un cierre por mensajero y dia dentro del alcance —para un maestro, el alcance es
   * la operacion ENTERA—, y los cierres aprobados no se purgan: crece de forma monotona.
   *
   * Se acepta por el coste de lo contrario: para conservar el total EXACTO que el aviso publica
   * (R6) habria que pedir `limite + 1` y ademas un `count`, es decir la segunda consulta que R15
   * de esta feature mide y que esta migracion vino a quitar. Decision humana del 2026-08-05,
   * anotada en el design §3.1. Esto es una excepcion declarada, no un cumplimiento de R29.
   */
  async listarHistoricoCierresAdminCompleto(
    actor: Actor,
  ): Promise<ListarHistoricoCierresAdminCompletoServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R4: antes del repo
    if (scope.status === "sinZona") return { status: "ok", items: [], total: 0 };

    const conjunto = await this.repo.findHistoricoCompleto(scope.alcance);

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    // MISMO enriquecido que la pagina, y por eso las filas del archivo son las de la pagina y no
    // unas parecidas. `conPendiente` es UNA agregacion para todo el conjunto —no una por fila—,
    // asi que su coste no crece con el numero de filas. Se paga aunque el archivo no lleve la
    // columna del pendiente: emitir `null` ahi seria decir «este cierre no esta aprobado»
    // (172/R28) de cierres que SI lo estan, y eso es un dato equivocado en un DTO de dinero.
    return { status: "ok", items: await this.conPendiente(conjunto), total: conjunto.length };
  }

  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6) — la COLA ENTERA de pendientes de decision del
   * alcance, sin recorte, para el archivo.
   *
   * Comparte con el de arriba la relectura que evita, y aqui se nota mas: la cola es la mitad
   * PEQUEÑA del conjunto (los cierres sin resolver), asi que producir su archivo arrastraba
   * todo el historico del alcance —que crece sin tope con los dias— para descartarlo.
   *
   * Sin `input` por el mismo motivo que su hermano: cero filtros, cero claves en la lista
   * blanca, alcance desde el actor.
   *
   * **Excepcion declarada a R29 de la 170**, la misma de arriba con el signo cambiado: se cumple
   * el transporte —superado el tope no va ninguna fila— y no el materializar, porque
   * `findColaCompleta` tampoco lleva cota. El riesgo, en cambio, es el menor de los dos: la cola
   * son los cierres pendientes de DECISION, la mitad que se vacia cada vez que el admin trabaja,
   * y no acumula con los dias como el historico. Misma decision del 2026-08-05 y mismo motivo:
   * acotar en base costaria el `count` extra que R15 de esta feature prohibe (design §3.1).
   */
  async listarPendientesCierresAdminCompleto(
    actor: Actor,
  ): Promise<ListarPendientesCierresAdminCompletoServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R4: antes del repo
    if (scope.status === "sinZona") return { status: "ok", items: [], total: 0 };

    const conjunto = await this.repo.findColaCompleta(scope.alcance);

    const limite = descargaConfig.MAX_FILAS;
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite }; // R6
    }

    return { status: "ok", items: await this.conPendiente(conjunto), total: conjunto.length };
  }

  async verCierreDetalle(
    cierreId: string,
    actor: Actor,
  ): Promise<CierreDetalleAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    // Sin zona no hay alcance valido: cualquier cierre esta, por definicion, fuera de
    // alcance (no se puede consultar sin acotar). R13: no_encontrada, sin filtrar.
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    // R13: la guardia de alcance va en el WHERE del repo; null si no casa (no se
    // distingue "no existe" de "otra bodega/zona").
    const found = await this.repo.findCierreByIdEnAlcance(cierreId, scope.alcance);
    if (found === null) return { status: "no_encontrada" };

    // R7: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = found.gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    // Best-effort DELIBERADO: si el storage no responde (credencial ausente, servicio
    // caido), el detalle se sirve SIN evidencias en vez de no servirse. Las evidencias
    // ilustran la decision; no son la decision. Bloquear el comprobante entero por ellas
    // deja el cierre sin poder aprobarse ni rechazarse, y un cierre atascado bloquea a su
    // mensajero y, por la regla de zona, las asignaciones de toda su zona. El fallo por
    // objeto concreto ya lo absorbe el provider, que omite lo que no puede firmar.
    let urlByPath: Record<string, string> = {};
    if (paths.length > 0) {
      try {
        urlByPath = await this.signedUrls.createSignedUrls(
          paths,
          cierreConfig.SIGNED_URL_TTL_SECONDS,
        );
      } catch {
        urlByPath = {};
      }
    }

    // R6: agrupa por resultado (4 claves siempre presentes) con el mapper reuso 37.
    // Feature 158/R18: 5 claves — el `incidente` es un grupo PROPIO del detalle del admin.
    const grupos: CierreGrupos = {
      entregada: [],
      reprogramada: [],
      devuelta: [],
      rechazada: [],
      incidente: [],
    };
    for (const g of found.gestiones) {
      grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
    }

    // Totales por concepto del cierre: se suman desde el MISMO desglose por orden que ve el
    // admin en las tablas, no por una consulta aparte que podria no cuadrar con ellas.
    const totalesIngreso = totalesIngresoOrdenex(found.gestiones);

    // Ganancia DERIVADA: el ingreso bruto MENOS lo que se le debe al mensajero. El pago sale
    // del snapshot del cierre (no se recomputa, R4); el ingreso, del desglose por orden.
    // Feature 172 (T C.2/R26): el detalle tambien trae el pendiente —R26 lo pide «en el listado
    // de cierres Y en el detalle de ese cierre»—, por el mismo camino y con una sola agregacion.
    const [resumen] = await this.conPendiente([found.cierre]);
    const ganancia = gananciaOrdenex(totalesIngreso.total, resumen.totalPagoMensajero);

    // Pago a la tienda DERIVADO: lo RECIBIDO (total general) menos lo que Ordenex le factura
    // sobre esa plata. Sale de otra resta que la ganancia: parte de lo cobrado, no del bruto.
    const pagoTienda = pagoTiendaOrdenex(
      resumen.totales.general,
      totalesIngreso.fleteConIva,
      totalesIngreso.comisionConIva,
    );

    // Feature 102/R4-R8/R10: desglose SLA/manual del ingreso de bodega por rechazos, particionando
    // los montos por gestion YA snapshoteados por su clasificacion (esRechazoSla). SOLO LECTURA
    // (R6/R16): el `total` se LEE del snapshot del cierre (no se recomputa); la particion asegura
    // `sla + manual === total` (R5). El alcance satelite recibe este mismo desglose (R10).
    const desglose = desglosarIngresoBodegaPorOrigen(found.gestiones);
    const desgloseIngresoBodegaRechazos = {
      sla: desglose.totalSla,
      manual: desglose.totalManual,
      total: resumen.totalIngresoBodegaRechazos, // snapshot leido (R6), no recomputado
    };

    return {
      status: "ok",
      cierre: resumen,
      grupos,
      totalesIngreso,
      desgloseIngresoBodegaRechazos,
      ganancia,
      pagoTienda,
    };
  }

  async aprobarCierre(
    cierreId: string,
    actor: Actor,
    // Feature 158 (R19/R36): default `[]` = el contrato de la 38 intacto. Un cierre SIN
    // incidentes se aprueba exactamente como hoy; uno CON incidentes y lista vacia cae en la
    // guardia de cobertura de abajo, asi que el default no abre ningun agujero.
    indemnizaciones: ReadonlyArray<IndemnizacionCapturadaInput> = [],
  ): Promise<AprobarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // Feature 158 (R19/R20/R21/R25) — COBERTURA EXACTA, ANTES de tocar el repo. El conjunto de
    // `gestionId` recibidos debe ser IGUAL al de gestiones `incidente` del cierre, leidas
    // DENTRO del alcance ya resuelto (R25: fuera de alcance devuelve [], sin revelar nada).
    // Falta alguna -> error por esa gestion (R19/R20); sobra alguna, o no es un incidente de
    // este cierre -> error por esa entrada (R21). En los dos casos el cierre queda
    // `solicitado` y NO se emite ningun movimiento.
    const errorCobertura = await this.validarCoberturaIndemnizaciones(
      cierreId,
      scope.alcance,
      indemnizaciones,
    );
    if (errorCobertura !== null) return errorCobertura;

    // Feature 109 (T3.1, R16): resuelve la config de la LIBERACION de `sin_gestionar` (estatus
    // destino por zona + zona central). Se pasa SOLO al aprobar; el repo la corre DENTRO de la tx,
    // guardada por `estatus_id = sin_gestionar` (no-op si el cierre no tiene ordenes congeladas,
    // R20). Si el catalogo no tiene los estados (seed pendiente) -> undefined (no libera, defensivo).
    // Feature 139 (T1.2, R5): + resuelve la config del DISPARO de la devolucion de `rechazada`
    // (origen `rechazada`; destinos `por_devolver`/`por_devolver_a_tienda` por zona; reusa
    // `centralZonaId`). Se pasa SOLO al aprobar; el repo la corre DENTRO de la misma tx, tras la
    // liberacion `sin_gestionar`, guardada por `estatus_id = rechazada` (no-op si el mensajero no
    // tiene rechazadas, R7). Catalogo incompleto (seed pendiente) -> undefined (no dispara, defensivo).
    const [
      sinGestionarEstatusId,
      enBodegaEstatusId,
      enBodegaSateliteEstatusId,
      rechazadaId,
      porDevolverId,
      porDevolverATiendaId,
      centralZonaId,
    ] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA_SATELITE),
      this.ordenRepo.findEstatusIdByValue(ESTADO_RECHAZADA),
      this.ordenRepo.findEstatusIdByValue(ESTADO_POR_DEVOLVER),
      this.ordenRepo.findEstatusIdByValue(ESTADO_POR_DEVOLVER_A_TIENDA),
      this.zonaRepo.findCentralZonaId(),
    ]);
    const liberacionSinGestionar =
      sinGestionarEstatusId !== null &&
      enBodegaEstatusId !== null &&
      enBodegaSateliteEstatusId !== null
        ? { sinGestionarEstatusId, enBodegaEstatusId, enBodegaSateliteEstatusId, centralZonaId }
        : undefined;
    const devolucionRechazadas =
      rechazadaId !== null && porDevolverId !== null && porDevolverATiendaId !== null
        ? { rechazadaId, porDevolverId, porDevolverATiendaId, centralZonaId }
        : undefined;

    // R10/R12-R15: transicion guardada. Aprobar limpia motivoRechazo (null).
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: null,
      liberacionSinGestionar, // feature 109/R16: libera `sin_gestionar` en la misma tx
      devolucionRechazadas, // feature 139/R5: dispara la devolucion de `rechazada` en la misma tx
      // Feature 158/R22: los montos ya con cobertura EXACTA verificada. El repo los escribe
      // GUARDADOS por `(cierreId, resultado)` y emite el egreso en la MISMA tx.
      indemnizaciones,
    });
    if (res === "updated") {
      // Feature 172 (T C.2, §8/R16): el pendiente se deriva DESPUES de que la aprobacion haya
      // confirmado, nunca dentro de su transaccion. Un fallo aqui no puede revertir la
      // aprobacion —que es justo lo que el humano descarto (decision 3, alternativa A)—.
      return {
        status: "ok",
        cierreId,
        estado: "aprobado",
        pendientePagoMensajero: await this.pendienteTrasAprobar(cierreId),
      };
    }
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  /**
   * Feature 172 (T C.2, §5/R22/R26/R28) — rellena `pendientePagoMensajero` de un conjunto de
   * filas con **UNA sola consulta**, sea la pagina de 1 fila o de 100.
   *
   * Tres propiedades, y las tres son el motivo de que esta funcion exista:
   *
   *  1. **Una llamada por listado, no una por fila.** `sumarVigentesPorCierre` recibe los ids de
   *     la pagina y devuelve un mapa. El numero de consultas NO crece con `pageSize` — la misma
   *     propiedad que la 170 exige (R54) del resto de esta pantalla, y se verifica CONTANDO
   *     llamadas, no leyendo este comentario.
   *  2. **Solo los APROBADOS entran en la consulta** (R28): un cierre en la cola no tiene nada
   *     que pagar y su pendiente es `null`, que no es lo mismo que `"0.00"` (R27).
   *  3. **`toResumen` sigue sin recomputar dinero.** El mapper emite `null` y punto; la
   *     derivacion vive aqui, en `derivarPendienteCierre`, que es la fuente unica de la regla
   *     (§5) y reusa a su vez `calcularSplitPago` de la 44. Los snapshots `P` y `E` se LEEN de
   *     la fila (`totalPagoMensajero`, `totales.efectivo`); no se recalculan.
   */
  private async conPendiente(rows: CierreAdminResumenRow[]): Promise<CierreAdminResumen[]> {
    const resumenes = rows.map(toResumen); // R8/R9: snapshots tal cual, sin recomputar
    const idsAprobados = resumenes
      .filter((r) => r.estado === "aprobado")
      .map((r) => r.cierreId);

    // UNA sola llamada, siempre: tambien con la lista vacia, para que el conteo de consultas de
    // este listado sea el mismo se pinte lo que se pinte.
    const pagados = await this.liquidacionRepo.sumarVigentesPorCierre(idsAprobados);

    return resumenes.map((r) =>
      r.estado === "aprobado"
        ? {
            ...r,
            pendientePagoMensajero: derivarPendienteCierre(
              r.totalPagoMensajero, // P — snapshot de la 39
              r.totales.efectivo, // E — snapshot de la 37
              pagados[r.cierreId] ?? "0.00", // Σ pagos VIGENTES del cierre (R80)
            ),
          }
        : r, // R28: no aprobado -> `null` (lo que ya puso `toResumen`)
    );
  }

  /**
   * Feature 172 (T C.2, §8) — el pendiente del cierre RECIEN aprobado.
   *
   * Va por `obtenerCierreParaPago` y no por `findCierreByIdEnAlcance` porque lo que hace falta
   * son cuatro columnas del cierre (`P`, `E`, estado, id) y aquel arrastra todas las gestiones
   * del cierre con su detalle. Es una lectura, no una escritura: la aprobacion ya confirmo.
   *
   * `"0.00"` si el cierre no se puede releer —imposible en el camino real, porque acabamos de
   * actualizarlo— y es la respuesta segura: no ofrece pagar una cifra que nadie ha derivado. El
   * pendiente real seguira apareciendo en el listado, que lo recalcula cada vez que alguien mira.
   */
  private async pendienteTrasAprobar(cierreId: string): Promise<string> {
    const cierre = await this.liquidacionRepo.obtenerCierreParaPago(cierreId);
    if (cierre === null) return "0.00";
    const pagados = await this.liquidacionRepo.sumarVigentesPorCierre([cierreId]);
    return derivarPendienteCierre(
      cierre.totalPagoMensajero,
      cierre.totalEfectivo,
      pagados[cierreId] ?? "0.00",
    );
  }

  /**
   * Feature 158 (R19/R20/R21) — COBERTURA EXACTA de los montos de indemnizacion. Devuelve
   * `null` si el conjunto de `gestionId` recibidos es IGUAL al de gestiones `incidente` del
   * cierre; si no, un `validation_error` con un error POR GESTION (la UI los pinta por fila).
   *
   * Se resuelve aqui y no en el borde a proposito: el borde (zod) no sabe que gestiones tiene
   * ese cierre. Y va ANTES de llamar al repo para que un envio incompleto NO llegue a abrir la
   * transaccion de aprobacion.
   *
   * Fix «tope de negocio» (2026-08-04): ademas de la cobertura, aqui se acota el IMPORTE contra
   * el valor de la orden (`excesoIndemnizacion`). Vive en el mismo sitio y por el mismo motivo:
   * el borde no sabe cuanto valia el paquete, y la comprobacion tiene que ocurrir ANTES de que
   * se abra la transaccion que mueve el dinero. Este es UNO de los dos emisores; el otro es
   * `IncidenteAdminService.aprobar`, y los dos tienen que aplicarlo o el agujero sigue abierto
   * por el que falte.
   */
  private async validarCoberturaIndemnizaciones(
    cierreId: string,
    alcance: Alcance,
    indemnizaciones: ReadonlyArray<IndemnizacionCapturadaInput>,
  ): Promise<{ status: "validation_error"; fieldErrors: Record<string, string[]> } | null> {
    const delCierre = await this.repo.findGestionesIncidenteDelCierre(cierreId, alcance);
    // R36: sin incidentes y sin montos, el camino de hoy queda INTACTO (ni una consulta mas
    // aguas abajo, ni un campo nuevo obligatorio).
    if (delCierre.length === 0 && indemnizaciones.length === 0) return null;

    // El valor de la ORDEN de cada gestion esperada: es a la vez el conjunto de ids admitidos
    // (cobertura) y el tope de negocio de cada monto. Un solo mapa para las dos cosas, porque
    // salen de la MISMA lectura.
    const esperados = new Map<string, GestionIncidenteDelCierre["ordenMontoCobrar"]>(
      delCierre.map((g) => [g.gestionId, g.ordenMontoCobrar]),
    );
    const fieldErrors: Record<string, string[]> = {};
    const vistos = new Set<string>();

    for (const { gestionId, monto } of indemnizaciones) {
      if (vistos.has(gestionId)) {
        // R21: dos montos para la misma gestion. Sin esto, el ultimo ganaria en silencio.
        fieldErrors[gestionId] = [MSG_INDEMNIZACION_DUPLICADA];
        continue;
      }
      vistos.add(gestionId);
      // R21: una gestion que no pertenece a este cierre, o cuyo resultado no es `incidente`,
      // no esta en `esperados` (el repo filtra por las dos cosas).
      if (!esperados.has(gestionId)) {
        fieldErrors[gestionId] = [MSG_INDEMNIZACION_AJENA];
        continue;
      }
      // TOPE: tecnico + negocio (el valor de la orden). El monto viaja STRING y se compara con
      // `Prisma.Decimal` dentro del helper: nunca `number`, nunca `parseFloat`.
      const exceso = excesoIndemnizacion(monto, esperados.get(gestionId) ?? null);
      if (exceso !== null) fieldErrors[gestionId] = [exceso];
    }
    // R19/R20: falta el monto de alguna gestion `incidente` del cierre.
    for (const { gestionId } of delCierre) {
      if (!vistos.has(gestionId)) fieldErrors[gestionId] = [MSG_INDEMNIZACION_FALTANTE];
    }

    if (Object.keys(fieldErrors).length === 0) return null;
    return { status: "validation_error", fieldErrors };
  }

  async rechazarCierre(
    cierreId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1

    // R11 (defensa): el borde ya valido con zod, pero el service re-exige motivo no
    // vacio antes de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }

    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R11-R15: transicion guardada; persiste el motivo con el cierre.
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: motivoLimpio,
    });
    if (res === "updated") return { status: "ok", cierreId, estado: "rechazado" };
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  async forzarSolicitudVencido(
    cierreId: string,
    actor: Actor,
  ): Promise<ForzarSolicitudVencidoServiceResult> {
    // R16: acotada al alcance del admin (rol+zona destino), MISMO resolver que aprobar/rechazar.
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R16: transicion guardada por estado ('vencido') + alcance en el repo. Money-safe (R21):
    // NO recalcula el snapshot ni toca `resuelto_por`/`resuelto_at`. R18: NO desbloquea; el
    // desbloqueo ocurre al APROBAR el `solicitado` resultante (que registra la auditoria, R17).
    const res = await this.repo.forzarSolicitudVencido(cierreId, scope.alcance);
    if (res === "updated") return { status: "ok", cierreId, estado: "solicitado" };
    if (res === "conflict") return { status: "conflict" }; // ya no es `vencido`
    return { status: "no_encontrada" }; // fuera_de_alcance / inexistente (R13)
  }
}

// Row cruda -> resumen de dominio. La fila ya trae los totales como STRING (R9) y las
// marcas de tiempo en ISO; el service no recomputa nada (R8, snapshot money-critical).
function toResumen(row: CierreAdminResumenRow): CierreAdminResumen {
  return {
    cierreId: row.cierreId,
    mensajeroId: row.mensajeroId,
    mensajeroNombre: row.mensajeroNombre,
    estado: row.estado,
    destinoTipo: row.destinoTipo,
    destinoZonaId: row.destinoZonaId,
    destinoZonaNombre: row.destinoZonaNombre,
    totales: row.totales,
    totalPagoMensajero: row.totalPagoMensajero, // R17: snapshot, sin recomputar
    totalIngresoBodegaRechazos: row.totalIngresoBodegaRechazos, // feature 56/R16: snapshot, sin recomputar
    // Feature 172 (T C.2): el mapper NO deriva dinero. Emite `null` —el valor de un cierre no
    // aprobado (R28)— y el servicio lo rellena en `conPendiente` para los aprobados, con UNA
    // agregacion por pagina. Si la derivacion viviera aqui, seria una consulta por fila.
    pendientePagoMensajero: null,
    solicitadoAt: row.solicitadoAt,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
  };
}
