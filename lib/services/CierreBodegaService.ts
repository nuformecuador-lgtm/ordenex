import { Prisma } from "@prisma/client";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import type { ICierreBodegaRepository } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  ICierreBodegaService,
  ListarCierresBodegaSolicitadosCompletoServiceResult,
  ListarCierresBodegaSolicitadosServiceResult,
  ListarConsolidablesCompletoServiceResult,
  ListarConsolidablesServiceResult,
  ListarConsolidacionServiceResult,
  SolicitarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierreBodegaService";
import { descargaConfig } from "@/lib/config/descarga";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Solo el rol autorizado (R1): el adminSatelite, SIEMPRE acotado a SU zona (el filtro
// por zona vive en el repo, en el WHERE).
const ROL_AUTORIZADO = "adminSatelite";

// Mensajes accionables del gate/precondicion.
const MSG_PENDIENTES =
  "Primero resolve los cierres de tus mensajeros antes de cerrar la bodega."; // R6
const MSG_VACIO = "No hay cierres de mensajero aprobados para consolidar."; // R7
const MSG_DUPLICADO = "Ya tenes un cierre de bodega solicitado pendiente de aprobacion."; // R8
const MSG_SIN_ZONA = "No tenes una zona asignada; contacta a tu administrador."; // R4

// Metodos de repo que consume el service (Pick para dobles de test sin DB/red).
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId">;

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

// R10: suma exacta de los totales snapshot con Prisma.Decimal (sin parseFloat/Number).
// Serializa a STRING escala 2 (money-safe).
function sumTotales(items: { totales: CierreTotales }[]): CierreTotales {
  let efectivo = new Prisma.Decimal(0);
  let simpe = new Prisma.Decimal(0);
  let transferencia = new Prisma.Decimal(0);
  let general = new Prisma.Decimal(0);
  for (const it of items) {
    efectivo = efectivo.plus(it.totales.efectivo);
    simpe = simpe.plus(it.totales.simpe);
    transferencia = transferencia.plus(it.totales.transferencia);
    general = general.plus(it.totales.general);
  }
  return {
    efectivo: efectivo.toFixed(2),
    simpe: simpe.toFixed(2),
    transferencia: transferencia.toFixed(2),
    general: general.toFixed(2),
  };
}

// Feature 39/R18/R19: suma exacta del pago a mensajeros snapshoteado de los consolidables
// (Prisma.Decimal, sin parseFloat/Number). STRING escala 2 (money-safe). Concepto
// INDEPENDIENTE del dinero recibido (no altera sumTotales).
function sumPagoMensajero(items: { totalPagoMensajero: string }[]): string {
  let total = new Prisma.Decimal(0);
  for (const it of items) {
    total = total.plus(it.totalPagoMensajero);
  }
  return total.toFixed(2);
}

// Feature 56/R17/R18: suma exacta del ingreso de bodega por rechazos snapshoteado de los
// consolidables (Prisma.Decimal, sin parseFloat/Number). STRING escala 2 (money-safe).
// ESPEJO de sumPagoMensajero. Concepto INDEPENDIENTE del dinero recibido y del pago a
// mensajeros: no altera sumTotales ni sumPagoMensajero (R20).
function sumIngresoBodega(items: { totalIngresoBodegaRechazos: string }[]): string {
  let total = new Prisma.Decimal(0);
  for (const it of items) {
    total = total.plus(it.totalIngresoBodegaRechazos);
  }
  return total.toFixed(2);
}

/**
 * Reparto del EFECTIVO entre los pagos a mensajeros. Al mensajero se le paga SOLO con el
 * efectivo de la consolidacion (SINPE/transferencia no son plata en mano en la bodega), y el
 * pago es ATOMICO: o se le paga completo o no se le paga (no hay pago parcial). Con el
 * efectivo insuficiente se paga de MENOR a MAYOR monto, para pagarle a la mayor cantidad
 * posible de mensajeros; lo que queda sin pagar lo debe la central.
 *
 * El sobrante de efectivo NO se reasigna: si tras pagar a los que alcanzan quedan 500 y el
 * siguiente cobra 1500, esos 500 se quedan en la bodega (el pago parcial no existe).
 *
 * Devuelve STRING escala 2 (money-safe): la aritmetica es Prisma.Decimal, nunca number.
 */
function repartirEfectivo(
  efectivo: string,
  pagos: string[],
): { pagado: string; centralDebe: string } {
  const disponible = new Prisma.Decimal(efectivo);
  // Copia ordenada ascendente: `sort` muta, y `pagos` viene de los consolidables que el
  // caller sigue usando en el orden de la tabla.
  const ordenados = [...pagos].sort((a, b) =>
    new Prisma.Decimal(a).comparedTo(new Prisma.Decimal(b)),
  );
  let pagado = new Prisma.Decimal(0);
  let debe = new Prisma.Decimal(0);
  for (const p of ordenados) {
    const monto = new Prisma.Decimal(p);
    // `lessThanOrEqualTo` sobre el acumulado, no un `restante` que se va pisando: el que no
    // alcanza NO consume efectivo y el siguiente (mas caro) tampoco va a alcanzar, pero se
    // evalua igual para acumular su deuda.
    if (pagado.plus(monto).lessThanOrEqualTo(disponible)) {
      pagado = pagado.plus(monto);
    } else {
      debe = debe.plus(monto);
    }
  }
  return { pagado: pagado.toFixed(2), centralDebe: debe.toFixed(2) };
}

// Neto agregado: dinero recibido (total general) MENOS lo que EFECTIVAMENTE se pago a los
// mensajeros (no lo que se les debe: lo impago lo cubre la central y vive en `centralDebe`).
// Resta exacta con Prisma.Decimal (sin parseFloat/Number), STRING escala 2 (money-safe).
function netoDe(general: string, pagado: string): string {
  return new Prisma.Decimal(general).minus(pagado).toFixed(2);
}

// `true` si el error es una violacion del indice unico parcial (R8): otra solicitud
// concurrente creo el CierreBodega `solicitado` de la zona antes que esta.
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Feature 40 — logica de negocio del "Cierre de bodega" (lado adminSatelite: consolidar
 * + solicitar). Espejo de CierreDiaService (37), un nivel arriba: agrega los cierre_dia
 * `aprobado` de la zona en un CierreBodega con snapshot de totales AGREGADOS (R10). No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB. El alcance por zona vive en
 * el WHERE del repo (R3).
 */
export class CierreBodegaService implements ICierreBodegaService {
  constructor(
    private readonly repo: ICierreBodegaRepository,
    private readonly ordenRepo: OrdenRepo,
  ) {}

  async listarConsolidacion(actor: Actor): Promise<ListarConsolidacionServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // R3/R4: alcance server-side por la zona del adminSatelite.
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      // R4: sin zona -> modulo vacio con aviso; no se puede solicitar.
      return {
        status: "ok",
        consolidables: [],
        totalesAgregados: ZERO_TOTALES,
        totalPagoMensajeroAgregado: "0.00", // R18: sin zona, nada que agregar
        totalIngresoBodegaRechazosAgregado: "0.00", // feature 56/R17: sin zona, nada que agregar
        totalNetoAgregado: "0.00", // sin zona: 0.00 - 0.00
        totalCentralDebeAgregado: "0.00", // sin zona: nada que pagar, nada que deber
        puedesSolicitar: false,
        motivoBloqueo: MSG_SIN_ZONA,
        cierresBodegaPasados: [],
        sinZona: true,
      };
    }

    // R5/R6 + F1.4-h: SOLO lectura (R23). El filtro por zona/estado vive en el repo.
    const [consolidables, solicitados, cierresBodegaPasados] = await Promise.all([
      this.repo.findCierresDiaConsolidables(zonaId),
      this.repo.contarCierresDiaSolicitados(zonaId),
      this.repo.findCierresBodegaByZona(zonaId),
    ]);

    // R10: totales agregados exactos (suma con Prisma.Decimal de los snapshots).
    //
    // Feature 170 — FASE 2 (T J.1, R49): los cinco agregados de abajo se calculan sobre
    // `consolidables`, que es el conjunto COMPLETO de la zona y sigue siendolo despues de
    // paginar la tabla. `listarConsolidablesPaginado` recorta lo que la tabla PINTA; el dinero
    // no se toca. Calcular cualquiera de estos cinco sobre una pagina no daria un numero
    // aproximado: daria uno FALSO, y sobre el se decide si se cierra la bodega.
    const totalesAgregados = sumTotales(consolidables);
    // R18: total agregado del pago a mensajeros (suma snapshot, separada de totalesAgregados).
    const totalPagoMensajeroAgregado = sumPagoMensajero(consolidables);
    // Feature 56/R17: total agregado del ingreso de bodega por rechazos (suma snapshot,
    // separada de totalesAgregados y del pago a mensajeros).
    const totalIngresoBodegaRechazosAgregado = sumIngresoBodega(consolidables);
    // Reparto del efectivo entre los pagos a mensajeros (atomico, de menor a mayor). El
    // agregado `totalPagoMensajeroAgregado` NO cambia: sigue siendo lo que se les debe en
    // total; esto solo decide cuanto de eso se puede pagar hoy y cuanto queda a la central.
    const { pagado, centralDebe } = repartirEfectivo(
      totalesAgregados.efectivo,
      consolidables.map((c) => c.totalPagoMensajero),
    );
    const totalCentralDebeAgregado = centralDebe;
    // Neto agregado DERIVADO: total general - lo EFECTIVAMENTE pagado.
    const totalNetoAgregado = netoDe(totalesAgregados.general, pagado);

    // R6/R7: gate de "Solicitar cierre de bodega" con motivo accionable.
    let puedesSolicitar = true;
    let motivoBloqueo: string | null = null;
    if (solicitados > 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_PENDIENTES; // R6
    } else if (consolidables.length === 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_VACIO; // R7
    }

    return {
      status: "ok",
      consolidables,
      totalesAgregados,
      totalPagoMensajeroAgregado, // R18
      totalIngresoBodegaRechazosAgregado, // feature 56/R17
      totalNetoAgregado,
      totalCentralDebeAgregado,
      puedesSolicitar,
      motivoBloqueo,
      cierresBodegaPasados,
      sinZona: false,
    };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — los cierres de bodega SOLICITADOS por
   * la zona, paginados en servidor.
   *
   * El alcance se resuelve EXACTAMENTE como en `listarConsolidacion`: mismo guard de rol
   * (R1) y misma resolucion de zona por `findUsuarioZonaId` (R3/R4), que sale del usuario y
   * NUNCA de la peticion. Por eso paginar no puede ampliar lo que ve un adminSatelite: R44 se
   * cumple por construccion.
   *
   * Sin zona -> pagina VACIA, no `forbidden`: el rol tiene acceso al modulo, lo que no tiene
   * es alcance que consultar. Es lo mismo que devuelve hoy `listarConsolidacion`
   * (`cierresBodegaPasados: []`), y ni una consulta al historico llega a ejecutarse.
   *
   * DOS llamadas al repositorio: la zona y la pagina — las mismas dos que el listado sin
   * paginar necesita para producir `cierresBodegaPasados` (R54). El conteo viaja dentro de la
   * segunda.
   */
  async listarCierresBodegaSolicitadosPaginado(
    input: { page: number; pageSize: number; filtros?: FiltrosCierresBodega },
    actor: Actor,
  ): Promise<ListarCierresBodegaSolicitadosServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId); // R3/R4
    if (zonaId === null) {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    // Pedido humano del 2026-08-16: el filtro RECORTA dentro de la zona del actor —se compone
    // con `AND` en el repositorio—, nunca la sustituye. Pedir la zona vecina da vacio.
    const { items, total } = await this.repo.findCierresBodegaByZonaPaginado(
      zonaId,
      rangoDePagina(input),
      input.filtros,
    );

    return {
      status: "ok",
      items, // el repositorio ya devuelve el DTO de dominio (mismo que el listado sin paginar)
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54) — los cierre_dia CONSOLIDABLES de la
   * zona, paginados en servidor.
   *
   * Mismo acotamiento que `listarConsolidacion`: guard de rol (R1) y zona resuelta con
   * `findUsuarioZonaId` desde el USUARIO, jamas desde la peticion (R3/R4). Sin zona -> pagina
   * vacia, no `forbidden`: el rol tiene acceso al modulo, lo que no tiene es alcance.
   *
   * **R49 — por que este metodo NO devuelve totales, que es LA decision de esta tanda.**
   * Esta pantalla muestra cinco numeros de dinero agregados
   * (`totalesAgregados`, `totalPagoMensajeroAgregado`, `totalIngresoBodegaRechazosAgregado`,
   * `totalNetoAgregado`, `totalCentralDebeAgregado`) y los cinco los sigue calculando
   * `listarConsolidacion` sobre el conjunto COMPLETO. Meterlos aqui seria invitar a
   * calcularlos sobre `items`, y eso no es una molestia de UX: es un numero de dinero
   * INCORRECTO en pantalla, sobre el que ademas se decide si se cierra la bodega.
   *
   * Y no es solo cuestion de disciplina: dos de esos cinco NO son una suma.
   * `totalNetoAgregado` y `totalCentralDebeAgregado` salen de repartir el efectivo entre los
   * pagos INDIVIDUALES de todos los mensajeros, ordenados de menor a mayor y pagados de forma
   * atomica. Ese reparto necesita la lista entera: ni una pagina ni un `SUM` de la base pueden
   * producirlo. Por eso el conjunto completo se sigue leyendo donde se calcula el dinero, y lo
   * que se recorta es SOLO lo que la tabla pinta.
   */
  async listarConsolidablesPaginado(
    input: { page: number; pageSize: number; filtros?: FiltrosCierresBodega },
    actor: Actor,
  ): Promise<ListarConsolidablesServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId); // R3/R4
    if (zonaId === null) {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const { items, total } = await this.repo.findCierresDiaConsolidablesPaginado(
      zonaId,
      rangoDePagina(input),
      input.filtros, // recorte DENTRO de la zona (ver la nota del listado de solicitados)
    );

    return {
      status: "ok",
      items, // el repositorio ya devuelve el DTO de dominio (mismo que el listado sin paginar)
      page: input.page,
      pageSize: input.pageSize,
      total, // R41/R42: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda B (R1/R4/R6/R10) — el CONJUNTO de «Cierres de bodega solicitados» de la
   * zona, sin recorte, que es del que sale el archivo.
   *
   * **Lo que cierra.** Hasta hoy ese archivo se producia releyendo `listarConsolidacion()`, que
   * es el listado COMPUESTO de la otra pantalla: cuatro consultas (la zona, los consolidables,
   * el contador de pendientes y este historico), los cinco agregados de dinero y el reparto del
   * efectivo entre todos los pagos individuales ordenados. De todo eso, el archivo usaba UN
   * campo. Aqui son DOS consultas —la zona y el listado— y ni un calculo de dinero (R10).
   *
   * **No lleva `input`, y es deliberado.** Este listado no admite filtros: su schema de pagina
   * solo tenia `page`/`pageSize`, y quitarlos deja una lista blanca de CERO claves. El borde la
   * sigue aplicando —una clave colada, `zonaId` incluida, muere alli con `validation_error`
   * (R17)— pero no hay nada que transportar hasta aqui. El alcance sale del actor, como en la
   * pagina.
   *
   * Sin zona -> conjunto vacio, no `forbidden`: el rol tiene acceso al modulo, lo que no tiene
   * es alcance. Es lo mismo que devuelve hoy `listarConsolidacion` (`cierresBodegaPasados: []`).
   *
   * **Excepcion declarada a R29 de la 170.** R29 —feature `done`, requisito vivo— pide dos cosas
   * y aqui se cumple una: por encima del tope no se transporta ni una fila (van el total y el
   * tope, nada mas), pero el conjunto SI se materializa entero —`findCierresBodegaByZona` es un
   * `findMany` sin `take`— y el tope lo mide este servicio despues. El conjunto es el historico
   * de cierres de bodega de UNA zona: acotado por el alcance, que es lo que lo hace mas llevadero
   * que su gemelo de `CierresBodegaAdminService` —aquel ve todas las zonas—, pero acumulativo,
   * uno por dia operado y sin purga.
   *
   * Se acepta por el coste de la alternativa: pedir `limite + 1` obliga a un `count` aparte para
   * conservar el total exacto del aviso (R6), que es la segunda consulta que R15 de esta feature
   * mide y prohibe. Decision humana del 2026-08-05, anotada en el design §3.1; es una excepcion
   * declarada, no un cumplimiento de R29.
   */
  async listarCierresBodegaSolicitadosCompleto(
    actor: Actor,
    filtros?: FiltrosCierresBodega,
  ): Promise<ListarCierresBodegaSolicitadosCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R4: antes del repo

    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "ok", items: [], total: 0 };

    // El MISMO metodo del que la pagina saca su recorte: mismo where, mismo orden y —lo que en
    // una pantalla de dinero no es estilo— el MISMO mapper de totales.
    // Los MISMOS filtros que la pagina: el archivo es «esto que estoy viendo, entero».
    const conjunto = await this.repo.findCierresBodegaByZona(zonaId, filtros);

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return { status: "ok", items: conjunto, total: conjunto.length };
  }

  /**
   * Feature 184 — Tanda B (R1/R4/R6/R10) — el CONJUNTO de «Cierres del dia a consolidar» de la
   * zona, sin recorte, para el archivo.
   *
   * Comparte con el de arriba la relectura que evita: la pantalla de consolidacion pedia el
   * listado compuesto entero —incluido el historico de cierres de bodega, que este archivo no
   * usa— y con el los cinco agregados y `repartirEfectivo`, que ordena TODOS los pagos
   * individuales de la zona. El archivo no necesita ninguno de esos numeros: la cabecera los
   * sigue recibiendo por `listarConsolidacion` (R49 de la 170), calculados sobre este mismo
   * conjunto. Aqui se leen las filas y se acaba.
   *
   * Los mismos `filtros` que su pagina (pedido humano del 2026-08-16); la ZONA sigue saliendo
   * del actor y nunca de la peticion.
   *
   * **Excepcion declarada a R29 de la 170, y aqui es la de menor riesgo del par.**
   * `findCierresDiaConsolidables` tampoco lleva cota, asi que la materializacion entera vale
   * igual que arriba y de R29 solo se cumple el transporte. Lo que la hace benigna es el
   * conjunto: son los cierres del dia de la zona PENDIENTES de consolidar, o sea una cola de
   * trabajo acotada por los mensajeros de esa zona, que la consolidacion vacia y que no acumula
   * historia. Misma decision del 2026-08-05 y mismo motivo —el `count` extra que R15 de esta
   * feature prohibe— (design §3.1).
   */
  async listarConsolidablesCompleto(
    actor: Actor,
    filtros?: FiltrosCierresBodega,
  ): Promise<ListarConsolidablesCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R4: antes del repo

    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "ok", items: [], total: 0 };

    // El MISMO metodo que alimenta la pagina y los agregados: un conjunto, no dos parecidos.
    const conjunto = await this.repo.findCierresDiaConsolidables(zonaId, filtros); // idem

    const limite = descargaConfig.MAX_FILAS;
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite }; // R6
    }

    return { status: "ok", items: conjunto, total: conjunto.length };
  }

  async solicitarCierreBodega(actor: Actor): Promise<SolicitarCierreBodegaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // R4: sin zona -> no se crea; mensaje accionable.
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      return { status: "validation_error", fieldErrors: { zona: [MSG_SIN_ZONA] } };
    }

    // R6: precondicion — sin cierre_dia de la zona pendientes de resolver.
    if ((await this.repo.contarCierresDiaSolicitados(zonaId)) > 0) {
      return { status: "conflict", motivo: MSG_PENDIENTES };
    }

    // R7: no se cierra una bodega vacia.
    const consolidables = await this.repo.findCierresDiaConsolidables(zonaId);
    if (consolidables.length === 0) return { status: "conflict", motivo: MSG_VACIO };

    // R8: a lo sumo un cierre de bodega `solicitado` por zona a la vez.
    if (await this.repo.existeCierreBodegaSolicitado(zonaId)) {
      return { status: "conflict", motivo: MSG_DUPLICADO };
    }

    // R10: snapshot de totales agregados (mismo calculo que listarConsolidacion).
    const totales = sumTotales(consolidables);
    // R19: snapshot del pago agregado a mensajeros (mismo calculo que listarConsolidacion).
    const totalPagoMensajero = sumPagoMensajero(consolidables);
    // Feature 56/R18: snapshot del ingreso agregado de bodega por rechazos (mismo calculo).
    const totalIngresoBodegaRechazos = sumIngresoBodega(consolidables);

    // R9: transaccion todo-o-nada (INSERT + vincular). Si una solicitud concurrente
    // gano la carrera, el indice unico parcial lanza P2002 -> conflict (R8).
    try {
      const cierreBodegaId = await this.repo.crearCierreBodega({
        zonaId,
        solicitadoPor: actor.usuarioId,
        cierreDiaIds: consolidables.map((c) => c.cierreDiaId),
        totales,
        totalPagoMensajero, // R19: snapshot agregado en la misma tx
        totalIngresoBodegaRechazos, // feature 56/R18: snapshot agregado en la misma tx
      });
      return { status: "ok", cierreBodegaId, totales };
    } catch (e) {
      if (isUniqueViolation(e)) return { status: "conflict", motivo: MSG_DUPLICADO }; // R8
      throw e;
    }
  }
}
