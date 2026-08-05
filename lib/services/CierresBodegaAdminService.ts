import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { cierreConfig } from "@/lib/config/cierre";
import { descargaConfig } from "@/lib/config/descarga";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  AprobarCierreBodegaServiceResult,
  CierreBodegaDetalleServiceResult,
  ICierresBodegaAdminService,
  ListarCierresBodegaAdminServiceResult,
  ListarHistoricoCierresBodegaCompletoServiceResult,
  ListarHistoricoCierresBodegaServiceResult,
  ListarPendientesCierresBodegaCompletoServiceResult,
  ListarPendientesCierresBodegaServiceResult,
  RechazarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierresBodegaAdminService";
import { esColaSolicitado } from "@/lib/utils/colas-cierre";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import {
  gananciaOrdenex,
  pagoTiendaOrdenex,
  totalesIngresoOrdenex,
} from "@/lib/utils/ingreso-ordenex";

// Roles autorizados (R2): acceso total (maestro/admin, bodega central). El alcance es
// "todos los cierres de bodega" (van a la central), sin filtro de zona.

// Mensaje accionable cuando falta el motivo de rechazo (R17).
const MSG_MOTIVO_REQUERIDO = "El motivo de rechazo es obligatorio.";

/**
 * Feature 40 — logica de negocio de "Cierres de bodega" del maestro (aprobar /
 * rechazar). Espejo de CierresAdminService (38), aplicado a CierreBodega. Lista la cola
 * + historico, muestra el detalle agregado con evidencias firmadas (R12) y transiciona
 * `solicitado` -> aprobado/rechazado con guardia de estado (R18). No conoce HTTP ni
 * Prisma; testeable con dobles. Totales = snapshot, nunca recomputa (R13).
 */
export class CierresBodegaAdminService implements ICierresBodegaAdminService {
  constructor(
    private readonly repo: ICierresBodegaAdminRepository,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  async listarCierresBodegaAdmin(
    actor: Actor,
  ): Promise<ListarCierresBodegaAdminServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    // R23: SOLO lectura. R15: partir por estado (solicitado vs resuelto).
    const rows = await this.repo.findCierresBodega();
    const pendientes: CierreBodegaResumen[] = [];
    const historico: CierreBodegaResumen[] = [];
    for (const row of rows) {
      const resumen = toResumen(row); // R13: totales snapshot (string) sin recomputar
      // Feature 170 (T I.1): el corte sale de `ESTADOS_COLA_SOLICITADO`, el MISMO que el
      // repositorio escribe como WHERE al paginar el historico (R44).
      if (esColaSolicitado(row.estado)) pendientes.push(resumen);
      else historico.push(resumen);
    }
    return { status: "ok", pendientes, historico };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — el HISTORICO, paginado en servidor.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio: con el guard despues, las
   * cabeceras de todos los cierres de bodega —dinero agregado de toda la operacion— ya
   * habrian salido de la base aunque la respuesta fuera un error.
   *
   * UNA sola llamada al repositorio, igual que el listado sin paginar (R54): el conteo que
   * R41 exige viaja dentro de ella.
   */
  async listarHistoricoCierresBodegaPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoCierresBodegaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    const { items, total } = await this.repo.findHistoricoPaginado(rangoDePagina(input));

    return {
      status: "ok",
      items: items.map(toResumen), // R13: mismo mapper que el listado sin paginar
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54) — la COLA de cierres de bodega
   * PENDIENTES, paginada en servidor.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio, por el mismo motivo que en el
   * historico: la cabecera de un cierre de bodega ES dinero agregado de una zona entera, y con
   * el guard despues ya habria salido de la base aunque la respuesta fuera un error.
   *
   * R49: no se agrega nada aqui. Los montos de esta pantalla son el SNAPSHOT de cada cierre de
   * bodega (`toResumen` no recomputa) y la pantalla no deriva totales del array; el `total` que
   * viaja es el CONTADOR de cabecera (R42), un conteo de filas.
   */
  async listarPendientesCierresBodegaPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesCierresBodegaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    const { items, total } = await this.repo.findColaPaginada(rangoDePagina(input));

    return {
      status: "ok",
      items: items.map(toResumen), // R13: mismo mapper que el listado sin paginar
      page: input.page,
      pageSize: input.pageSize,
      total, // R41/R42: el total del CONJUNTO de la cola, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda E (T E.2, R1/R4/R6) — el HISTORICO ENTERO de cierres de bodega, sin
   * recorte, que es del que sale el archivo de «Cierres de bodega resueltos» (listado 5).
   *
   * **Lo que cierra.** Hasta hoy ese archivo se producia releyendo `listarCierresBodegaAdmin()`,
   * que trae TODOS los cierres de bodega —cola e historico— y los parte en memoria para que la
   * pantalla se quede con una de las dos mitades. Aqui se lee SOLO el historico, cortado en la
   * base por el mismo criterio que su pagina (R16). Las filas salen identicas; lo que cambia es
   * cuantas se leen para producirlas, y de eso hablan los dos `*-where.test.ts` y el contador de
   * filas leidas del test de servicio.
   *
   * **El guard va PRIMERO, antes de tocar el repositorio**, por el mismo motivo que en la
   * pagina: la cabecera de un cierre de bodega ES dinero agregado de una zona entera, y con el
   * guard despues ya habria salido de la base aunque la respuesta fuera un error.
   *
   * **No lleva `input`, y es deliberado.** Este listado no admite filtros: su schema de pagina
   * solo tenia `page`/`pageSize`, y quitarlos deja una lista blanca de CERO claves. El borde la
   * sigue aplicando entera —parsear ES la barrera (R17)— pero no hay nada que transportar hasta
   * aqui. Y tampoco hay zona que resolver: este listado es de acceso total y ve la operacion
   * completa; el alcance es el ROL, y sale del actor.
   *
   * **Mismo mapper que la pagina** (`toResumen`, R13): los totales son SNAPSHOT y ni el conjunto
   * ni la pagina recomputan nada. A diferencia de la tanda D, aqui no hay ningun enriquecido que
   * conservar o saltarse: el camino del archivo no firma URL, no agrega dinero y no consulta
   * ninguna otra tabla.
   */
  async listarHistoricoCierresBodegaCompleto(
    actor: Actor,
  ): Promise<ListarHistoricoCierresBodegaCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R4: antes del repo

    const conjunto = await this.repo.findHistoricoCompleto();

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return { status: "ok", items: conjunto.map(toResumen), total: conjunto.length };
  }

  /**
   * Feature 184 — Tanda E (T E.2, R1/R4/R6) — la COLA ENTERA de cierres de bodega pendientes,
   * sin recorte, para el archivo de «Cierres de bodega pendientes» (listado 4).
   *
   * Comparte con el de arriba la relectura que evita, y aqui se nota mas: la cola es la mitad
   * PEQUEÑA de la tabla (los cierres sin resolver), asi que producir su archivo arrastraba todo
   * el historico de la operacion —que crece sin tope con los dias— para descartarlo en memoria.
   *
   * Sin `input` y sin zona por el mismo motivo que su hermano: cero filtros, cero claves en la
   * lista blanca, alcance por ROL desde el actor.
   */
  async listarPendientesCierresBodegaCompleto(
    actor: Actor,
  ): Promise<ListarPendientesCierresBodegaCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R4: antes del repo

    const conjunto = await this.repo.findColaCompleta();

    const limite = descargaConfig.MAX_FILAS;
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite }; // R6
    }

    return { status: "ok", items: conjunto.map(toResumen), total: conjunto.length };
  }

  async verCierreBodegaDetalle(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<CierreBodegaDetalleServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    const found = await this.repo.findCierreBodegaConDetalle(cierreBodegaId);
    if (found === null) return { status: "no_encontrada" }; // R19

    // R12: firma en LOTE las evidencias de TODAS las gestiones de todos los cierre_dia
    // (path crudo -> URL firmada de TTL acotado). Nunca se expone el storage_path.
    const paths = found.cierresDia
      .flatMap((cd) => cd.gestiones.map((g) => g.evidenciaStoragePath))
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R11: por cada cierre_dia, agrupa sus gestiones por resultado (5 claves siempre desde la
    // feature 158) con el mapper reuso 37. Totales = snapshot del cierre_dia (R13).
    const cierres: CierreBodegaDetalleCierre[] = found.cierresDia.map((cd) => {
      const grupos: CierreGrupos = {
        entregada: [],
        reprogramada: [],
        devuelta: [],
        rechazada: [],
        incidente: [], // feature 158/R18
      };
      for (const g of cd.gestiones) {
        grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
      }
      const totalesIngreso = totalesIngresoOrdenex(cd.gestiones);
      return {
        cierreDiaId: cd.resumen.cierreDiaId,
        mensajeroId: cd.resumen.mensajeroId,
        mensajeroNombre: cd.resumen.mensajeroNombre,
        totales: cd.resumen.totales,
        totalPagoMensajero: cd.resumen.totalPagoMensajero, // R20: snapshot por cierre_dia, sin recomputar
        totalIngresoBodegaRechazos: cd.resumen.totalIngresoBodegaRechazos, // feature 56/R19: snapshot por cierre_dia, sin recomputar
        grupos,
        // Totales por concepto de ESTE cierre_dia, sumados desde el desglose por orden.
        totalesIngreso,
        // Ganancia del dia de ESE mensajero: su ingreso menos SU pago (snapshot, sin recomputar).
        ganancia: gananciaOrdenex(totalesIngreso.total, cd.resumen.totalPagoMensajero),
        // Pago a la tienda de ESTE cierre_dia: lo que recibio menos lo que se le facturo.
        pagoTienda: pagoTiendaOrdenex(
          cd.resumen.totales.general,
          totalesIngreso.fleteConIva,
          totalesIngreso.comisionConIva,
        ),
      };
    });

    // Agregado de toda la bodega: se suma desde las MISMAS gestiones que alimentan el
    // desglose por cierre_dia, no por una consulta aparte que podria no cuadrar con ellas.
    const resumen = toResumen(found.cierre);
    const totalesIngreso = totalesIngresoOrdenex(
      found.cierresDia.flatMap((cd) => cd.gestiones),
    );
    // El pago agregado sale del snapshot del cierre de bodega (R13), no de sumar los cierre_dia.
    const ganancia = gananciaOrdenex(totalesIngreso.total, resumen.totalPagoMensajero);
    // Pago a tiendas agregado: parte del total general recibido, no del bruto facturado.
    const pagoTienda = pagoTiendaOrdenex(
      resumen.totales.general,
      totalesIngreso.fleteConIva,
      totalesIngreso.comisionConIva,
    );

    // R11/R13: cabecera con totales agregados snapshot.
    return { status: "ok", cierre: resumen, cierres, totalesIngreso, ganancia, pagoTienda };
  }

  async aprobarCierreBodega(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<AprobarCierreBodegaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    // R16/R18-R20: transicion guardada. Aprobar limpia motivoRechazo (null).
    const res = await this.repo.resolverCierreBodega({
      id: cierreBodegaId,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId, // R20
      motivoRechazo: null,
    });
    if (res === "updated") return { status: "ok", cierreBodegaId, estado: "aprobado" }; // R16
    if (res === "conflict") return { status: "conflict" }; // R18
    return { status: "no_encontrada" }; // fuera_de_alcance (R19)
  }

  async rechazarCierreBodega(
    cierreBodegaId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreBodegaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2

    // R17 (defensa): el borde ya valido con zod, pero el service re-exige motivo no
    // vacio antes de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }

    // R17-R20: transicion guardada; persiste el motivo con el cierre.
    const res = await this.repo.resolverCierreBodega({
      id: cierreBodegaId,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId, // R20
      motivoRechazo: motivoLimpio,
    });
    if (res === "updated") return { status: "ok", cierreBodegaId, estado: "rechazado" }; // R17
    if (res === "conflict") return { status: "conflict" }; // R18
    return { status: "no_encontrada" }; // fuera_de_alcance (R19)
  }
}

// Row cruda -> resumen de dominio. La fila ya trae los totales como STRING (R13) y las
// marcas de tiempo en ISO; el service no recomputa nada (snapshot money-critical).
function toResumen(row: CierreBodegaResumenRow): CierreBodegaResumen {
  return {
    cierreBodegaId: row.cierreBodegaId,
    zonaId: row.zonaId,
    zonaNombre: row.zonaNombre,
    solicitadoPorId: row.solicitadoPorId,
    solicitadoPorNombre: row.solicitadoPorNombre,
    estado: row.estado,
    totales: row.totales,
    totalPagoMensajero: row.totalPagoMensajero, // R20: snapshot agregado, sin recomputar
    totalIngresoBodegaRechazos: row.totalIngresoBodegaRechazos, // feature 56/R19: snapshot agregado, sin recomputar
    cantidadCierres: row.cantidadCierres,
    solicitadoAt: row.solicitadoAt,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
  };
}
