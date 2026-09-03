import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CierreBodegaDetalleCierreRow,
  ICierresBodegaAdminRepository,
  ResolverCierreBodegaInput,
  ResolverCierreBodegaResult,
} from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import {
  BODEGA_RESUMEN_SELECT,
  toBodegaResumenRow,
} from "@/lib/repositories/CierreBodegaRepository";
// Feature 69/T23 (R15): se reusan las MISMAS piezas que compone T18 en `CierresAdminRepository`
// (proyeccion + mapper), no una copia: las dos pantallas de admin muestran el detalle del mismo
// cierre_dia ya creado y tienen que salir del mismo sitio o divergen.
// Feature 230 (T7.1, R26): + las CUATRO piezas de la hoja fundida (proyeccion, snapshot con su
// clave de join, orden y recortes) y su compositor. Mismo motivo llevado al extremo: los DOS
// caminos de la descarga detallada tienen que emitir la MISMA fila desde la MISMA declaracion,
// asi que ninguno de ellos declara nada propio.
import {
  componerGestionesDescarga,
  DETALLE_ADMIN_SELECT,
  DETALLE_DESCARGA_SELECT,
  GESTION_ADMIN_SELECT,
  GESTION_DESCARGA_SELECT,
  ORDEN_GESTIONES_DESCARGA,
  filtrosWhere,
  toPendienteRowDesdeSnapshot,
} from "@/lib/repositories/CierresAdminRepository";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

// Solo el estado que la 40 puede transicionar (R18): la guardia del updateMany.
const ESTADO_SOLICITADO = "solicitado";

// Feature 69/T23: el detalle sale del SNAPSHOT -> el cliente necesita `cierreDetail`.
type CierresBodegaAdminPrismaClient = Pick<
  PrismaClient,
  | "cierreBodega"
  | "cierreDia"
  | "gestionOrden"
  | "cierreDetail"
  // Ficha 362 (R9): la resolucion pasa a `$transaction` y registra su accion en ella.
  | "$transaction"
  | "historialAccion"
  | "usuario"
  | "zona"
>;

// Proyeccion de la cabecera de un cierre_dia incluido en el detalle (mensajero +
// totales snapshot).
const DETALLE_CIERRE_SELECT = {
  id: true,
  mensajeroId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R20: snapshot del pago al mensajero del cierre_dia
  totalIngresoBodegaRechazos: true, // feature 56/R19: snapshot del ingreso de bodega por rechazos del cierre_dia
  mensajero: { select: NOMBRE_USUARIO_SELECT },
} as const;

type DetalleCierreRow = Prisma.CierreDiaGetPayload<{ select: typeof DETALLE_CIERRE_SELECT }>;

function toDetalleCierreRow(r: DetalleCierreRow): CierreBodegaDetalleCierreRow {
  return {
    cierreDiaId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: nombreCompletoUsuario(r.mensajero),
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R20: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R19: snapshot money-safe STRING
  };
}

/**
 * Feature 184 — Tanda E (R16) — el ORDEN de los cierres de bodega del admin, declarado UNA vez.
 *
 * Lo comparten los CINCO caminos que leen esta tabla desde este repositorio: el listado sin
 * paginar, las dos paginas (cola e historico) y los dos CONJUNTOS de los que salen los archivos.
 * Estaba escrito TRES veces —una por metodo— y la tanda E habria sumado dos copias mas.
 *
 * No es simetria: en cuanto un archivo depende de estos conjuntos, si su orden diverge del de la
 * pagina, la fila 26 del archivo deja de ser la primera de la pagina 2 (R5) y no hay ninguna
 * pantalla que lo diga. Una sola declaracion tampoco lo vuelve invisible: los casos de los
 * `*-where.test.ts` fijan el valor ABSOLUTO, asi que cambiar la constante los pone rojos.
 */
/**
 * Pedido humano del 2026-08-16 — el WHERE de los FILTROS de estos listados (fecha + zona),
 * declarado UNA vez para los cuatro caminos: las dos paginas y los dos conjuntos del archivo.
 *
 * SIN MENSAJERO, y no es un recorte de alcance sino de datos: un cierre de bodega consolida los
 * cierres del dia de VARIOS mensajeros, asi que «el mensajero de este cierre» no es una pregunta
 * con respuesta. La columna no existe.
 *
 * Las fechas son de CALENDARIO DE COSTA RICA: `solicitadoAt` es un instante, y «del 1 al 3»
 * significa desde el inicio del 1 en CR hasta el inicio del 4 en CR. Por eso el limite superior
 * es `lt` del dia SIGUIENTE y no `lte` del mismo dia — con `lte` se perderian los cierres
 * solicitados entre las 00:00 y las 23:59:59.999 del ultimo dia del rango, que es justo el dia
 * que el usuario acaba de pedir. Es el MISMO criterio que `CierresAdminRepository.filtrosWhere`,
 * escrito aparte porque la tabla y sus columnas son otras.
 */
function filtrosBodegaWhere(
  filtros: FiltrosCierresBodega | undefined,
): Prisma.CierreBodegaWhereInput[] {
  if (!filtros) return [];
  const condiciones: Prisma.CierreBodegaWhereInput[] = [];
  if (filtros.desde !== undefined || filtros.hasta !== undefined) {
    condiciones.push({
      solicitadoAt: {
        ...(filtros.desde !== undefined ? { gte: inicioDelDiaCREnUtc(filtros.desde) } : {}),
        ...(filtros.hasta !== undefined
          ? { lt: inicioDelDiaSiguienteCREnUtc(filtros.hasta) }
          : {}),
      },
    });
  }
  if (filtros.destinoZonaIds !== undefined) {
    condiciones.push({ zonaId: { in: [...filtros.destinoZonaIds] } });
  }
  return condiciones;
}

const ORDEN_CIERRES_BODEGA_ADMIN = {
  solicitadoAt: "desc",
} as const satisfies Prisma.CierreBodegaOrderByWithRelationInput;

/**
 * Feature 184 — Tanda E (R16) — el criterio del HISTORICO (cierres de bodega ya RESUELTOS),
 * declarado UNA vez para su pagina y para su conjunto.
 *
 * R44 de la 170 sigue vigente y es el motivo del `notIn`: es el espejo EXACTO del `else` con que
 * el servicio manda al historico todo lo que no esta en la cola. Con un `in: ["aprobado"]` un
 * cierre de bodega RECHAZADO —o cualquier estado nuevo del enum— desapareceria de las dos listas
 * en vez de caer en el historico.
 */
function historicoBodegaWhere(
  filtros?: FiltrosCierresBodega,
): Prisma.CierreBodegaWhereInput {
  const recortes = filtrosBodegaWhere(filtros);
  return {
    estado: { notIn: [...ESTADOS_COLA_SOLICITADO] },
    // Sin filtros no se escribe `AND`: el criterio queda IDENTICO al de antes del 2026-08-16,
    // y los `*-where.test.ts` que fijan su valor absoluto siguen valiendo sin tocarlos.
    ...(recortes.length > 0 ? { AND: recortes } : {}),
  };
}

/**
 * Feature 184 — Tanda E (R16) — el criterio de la COLA de pendientes, declarado UNA vez para su
 * pagina y para su conjunto.
 *
 * COMPLEMENTO EXACTO del de arriba: la MISMA constante de estados, aqui con `in` (el espejo del
 * `if` del servicio) y alli con `notIn`. Que las dos mitades lean la misma constante es lo que
 * garantiza que ninguna fila quede en las dos listas ni se caiga de las dos — y aqui «caerse»
 * significa que un cierre de bodega deja de verse para aprobarlo, con el dinero agregado de una
 * zona entera parado hasta que alguien lo note.
 */
function colaBodegaWhere(filtros?: FiltrosCierresBodega): Prisma.CierreBodegaWhereInput {
  const recortes = filtrosBodegaWhere(filtros);
  return {
    estado: { in: [...ESTADOS_COLA_SOLICITADO] },
    ...(recortes.length > 0 ? { AND: recortes } : {}),
  };
}

/**
 * Feature 40 — repositorio de "Cierres de bodega" del maestro. SOLO queries Prisma. El
 * maestro NO se acota por zona (todo va a la central). Reusa BODEGA_RESUMEN_SELECT /
 * toBodegaResumenRow (cabecera). `resolverCierreBodega` es un unico UPDATE guardado por
 * estado; NO toca cierre_dia ni otra tabla (R21/R22).
 *
 * Feature 69/T23 (R15): el detalle de las gestiones ya NO reusa WITH_DETALLE / toPendienteRow
 * de la 37 (que leen la orden VIVA y siguen siendo correctos para la vista EN VIVO de
 * gestiones sin cierre); sale del SNAPSHOT `cierre_detail` con las mismas piezas que T18.
 */
export class CierresBodegaAdminRepository implements ICierresBodegaAdminRepository {
  constructor(private readonly prisma: CierresBodegaAdminPrismaClient) {}

  /** R15: todos los cierres de bodega, mas reciente primero, totales -> STRING. */
  async findCierresBodega(): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      orderBy: ORDEN_CIERRES_BODEGA_ADMIN,
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /**
   * Feature 184 — Tanda E (T E.1, R1/R14/R15/R16) — el HISTORICO ENTERO, sin recorte: el conjunto
   * del que sale el archivo de «Cierres de bodega resueltos» (listado 5).
   *
   * **Por que existe, y por que no bastaba reusar.** Hasta hoy ese archivo se producia releyendo
   * `listarCierresBodegaAdmin()`, que llama a `findCierresBodega`: TODOS los cierres de bodega,
   * cola e historico juntos, para quedarse con una de las dos mitades. `findCierresBodega` NO se
   * puede reusar aqui —a diferencia de lo que pasaba en las tandas B y C, donde el conjunto ya
   * existia— porque no es este conjunto: es su union con el de la cola. Y cada fila de mas no es
   * gratis: `BODEGA_RESUMEN_SELECT` lleva dos joins de nombre y un `_count` de `cierresDia`.
   *
   * Es `findHistoricoPaginado` sin `skip`/`take` y sin el `count`: MISMO `historicoBodegaWhere` y
   * MISMO `ORDEN_CIERRES_BODEGA_ADMIN` (R16), de una sola declaracion cada uno, para que la
   * pagina N sea el segmento N de este conjunto (R5). UNA consulta y ninguna mas (R15): el
   * `count` de la pagina no viaja aqui, porque el total de un conjunto sin recorte es su longitud.
   */
  async findHistoricoCompleto(
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: historicoBodegaWhere(filtros),
      orderBy: ORDEN_CIERRES_BODEGA_ADMIN,
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /**
   * Feature 184 — Tanda E (T E.1, R1/R14/R15/R16) — la COLA ENTERA de pendientes, sin recorte:
   * el conjunto del que sale el archivo de «Cierres de bodega pendientes» (listado 4).
   *
   * Espejo exacto del de arriba, y con el mismo motivo para existir. Aqui se nota mas: la cola
   * son los cierres SIN resolver —una decena— y el historico crece sin tope con los dias, asi que
   * descargar la cola arrastraba todo el historico de la operacion para descartarlo en memoria.
   *
   * La particion sigue viva en los CUATRO caminos: `colaBodegaWhere` e `historicoBodegaWhere`
   * leen la MISMA `ESTADOS_COLA_SOLICITADO`, una con `in` y otra con `notIn`, y las dos paginas y
   * los dos conjuntos salen de esas dos funciones. Ninguna fila puede quedar en las dos listas ni
   * caerse de las dos.
   */
  async findColaCompleta(
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: colaBodegaWhere(filtros),
      orderBy: ORDEN_CIERRES_BODEGA_ADMIN,
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina del HISTORICO + el total.
   *
   * El `where` se construye UNA vez y lo comparten `findMany` y `count`: escribirlo dos veces
   * es como el total acaba contando un conjunto distinto del que se muestra.
   */
  async findHistoricoPaginado(
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // Feature 184/R16: el criterio sale de `historicoBodegaWhere`, la MISMA declaracion que usa
    // el conjunto completo del que sale el archivo. Estaba escrito aqui y habria que haberlo
    // escrito otra vez alli. R44 sigue siendo el motivo del `notIn`: con un
    // `in: ["aprobado","rechazado"]`, un estado nuevo del enum desapareceria de las dos listas.
    const where = historicoBodegaWhere(filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreBodega.findMany({
        where,
        orderBy: ORDEN_CIERRES_BODEGA_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: BODEGA_RESUMEN_SELECT,
      }),
      this.prisma.cierreBodega.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toBodegaResumenRow), total };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): una pagina de la COLA de cierres de
   * bodega pendientes + el total.
   *
   * COMPLEMENTO EXACTO de `findHistoricoPaginado`: la misma constante
   * (`ESTADOS_COLA_SOLICITADO`), aqui con `in` —el espejo del `if` del servicio— y alli con
   * `notIn` —el del `else`—. Leer las dos de la misma lista es lo que impide que un estado
   * nuevo del enum acabe en las dos colas o en ninguna.
   */
  async findColaPaginada(
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // Feature 184/R16: mismo criterio compartido que el conjunto completo de esta cola.
    const where = colaBodegaWhere(filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreBodega.findMany({
        where,
        orderBy: ORDEN_CIERRES_BODEGA_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: BODEGA_RESUMEN_SELECT,
      }),
      this.prisma.cierreBodega.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toBodegaResumenRow), total };
  }

  /** R11 (+69/R15): cierre de bodega + cada cierre_dia con sus gestiones desde el SNAPSHOT. */
  async findCierreBodegaConDetalle(id: string): Promise<{
    cierre: CierreBodegaResumenRow;
    cierresDia: {
      resumen: CierreBodegaDetalleCierreRow;
      gestiones: CierreGestionPendienteRow[];
    }[];
  } | null> {
    const cierre = await this.prisma.cierreBodega.findUnique({
      where: { id },
      select: BODEGA_RESUMEN_SELECT,
    });
    if (cierre === null) return null; // R19: no existe

    // Los cierre_dia incluidos (WHERE cierre_bodega_id = id), mas reciente primero.
    const cierresDiaRows = await this.prisma.cierreDia.findMany({
      where: { cierreBodegaId: id },
      orderBy: { solicitadoAt: "desc" },
      select: DETALLE_CIERRE_SELECT,
    });

    // Por cada cierre_dia, sus gestiones (WHERE cierre_id = cierre_dia.id) compuestas con el
    // SNAPSHOT de ese cierre. Feature 69/T23 (R15): un cierre_dia consolidado en un
    // cierre_bodega esta YA CREADO (y normalmente ya aprobado y liquidado), asi que su detalle
    // son los datos CONGELADOS. Antes esto reusaba `WITH_DETALLE`, que navegaba
    // `gestion_orden.orden.*` VIVO: esta pantalla y la de `findCierreByIdEnAlcance` mostraban
    // detalle distinto del MISMO cierre. Mismo DTO que antes -> la UI no cambia.
    const cierresDia = await Promise.all(
      cierresDiaRows.map(async (cd) => {
        const [gestiones, detalle] = await Promise.all([
          this.prisma.gestionOrden.findMany({
            where: { cierreId: cd.id }, // R11: gestiones vinculadas a ESTE cierre_dia
            orderBy: { createdAt: "desc" },
            select: GESTION_ADMIN_SELECT,
          }),
          this.prisma.cierreDetail.findMany({
            where: { cierreId: cd.id }, // el snapshot de ESE cierre_dia
            select: DETALLE_ADMIN_SELECT,
          }),
        ]);
        // Grano: N gestiones de una orden comparten su UNICA fila congelada.
        const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
        return {
          resumen: toDetalleCierreRow(cd),
          // Sin fallback (R14/decision (a)): si falta la fila, error DURO. Igual que T18: un
          // fallback a datos vivos seria el camino de lectura que esta feature vino a matar.
          gestiones: gestiones.map((g) => {
            const d = byOrden.get(g.ordenId);
            if (d === undefined) throw new CierreDetalleFaltanteError(cd.id, g.ordenId);
            return toPendienteRowDesdeSnapshot(g, d);
          }),
        };
      }),
    );

    return { cierre: toBodegaResumenRow(cierre), cierresDia };
  }

  /**
   * Feature 230 — Tanda 7 (T7.1, R11/R24/R26/R41) — TODAS las gestiones de los cierres del dia
   * YA CONSOLIDADOS en un cierre de bodega que casan los recortes del dialogo.
   *
   * `cierreBodegaId: { not: null }` es la traduccion EXACTA de R24 («las gestiones de los cierres
   * del dia consolidados en un cierre de bodega, y ninguna otra»). No hay alcance por zona que
   * componer: este listado es de ACCESO TOTAL, y el guard de rol lo aplica el servicio antes de
   * llamar aqui (R25).
   *
   * **Esto y el camino de `cierres-admin` cubren conjuntos DISJUNTOS**, no dos vistas de lo mismo
   * (design §2.6): un cierre del dia con destino `bodega_central` —la GAM— nunca se consolida en
   * un cierre de bodega, porque `consolidablesWhere` exige destino satelite. Los dos botones
   * juntos son el total; uno solo deja fuera media operacion.
   *
   * Reusa las cuatro piezas de la hoja fundida sin declarar nada propio (R26), y NO reusa
   * `findCierreBodegaConDetalle` con su bucle por `cierre_dia`: aquel paga una consulta por
   * cierre del dia, y aqui el conjunto es un rango de meses.
   */
  async findGestionesDeCierresBodegaCompleto(
    filtros: FiltrosDescargaGestiones,
  ): Promise<CierreGestionDescargaDTO[]> {
    const gestiones = await this.prisma.gestionOrden.findMany({
      where: {
        cierre: {
          cierreBodegaId: { not: null }, // R24: solo lo ya consolidado en bodega
          // Los recortes se componen con `AND`, la MISMA forma que usan `historicoWhere` y
          // `colaWhere` del otro repositorio, y por el mismo motivo: como claves hermanas, un
          // recorte puede SUSTITUIR al criterio de seleccion en vez de sumarse a el.
          AND: filtrosWhere(filtros),
        },
      },
      orderBy: [...ORDEN_GESTIONES_DESCARGA], // R11/R26: el MISMO orden que el camino A
      select: GESTION_DESCARGA_SELECT, // R41: sin `evidencia_storage_path`
    });
    if (gestiones.length === 0) return [];

    const cierreIds = [...new Set(gestiones.map((g) => g.cierreId).filter((id) => id !== null))];
    const detalle = await this.prisma.cierreDetail.findMany({
      where: { cierreId: { in: cierreIds } },
      select: DETALLE_DESCARGA_SELECT,
    });
    return componerGestionesDescarga(gestiones, detalle);
  }

  /**
   * R16-R22: transicion atomica guardada; un solo UPDATE.
   *
   * FICHA 362 (R6/R9/R11) — `cierre_bodega_aprobado` / `cierre_bodega_rechazado`. El metodo se
   * envuelve en `$transaction` (forma 2 del design §2.3: era un `updateMany` suelto), y el
   * registro va DENTRO del `res.count === 1`: un cierre ya resuelto no deja rastro de una segunda
   * resolucion que no ocurrio.
   *
   * `monto` = `total_general` del cierre (snapshot), `Decimal`. `motivoRechazo` NO se copia (R5).
   */
  async resolverCierreBodega(
    input: ResolverCierreBodegaInput,
  ): Promise<ResolverCierreBodegaResult> {
    const { id, nuevoEstado, resueltoPor, motivoRechazo } = input;

    const resultado = await this.prisma.$transaction(async (tx) => {
      // R18: aplica SOLO si sigue `solicitado` (guardia de estado en el WHERE).
      const res = await tx.cierreBodega.updateMany({
        where: { id, estado: ESTADO_SOLICITADO },
        data: {
          estado: nuevoEstado,
          resueltoPor, // R20
          resueltoAt: new Date(), // R20
          motivoRechazo,
        },
      });
      if (res.count !== 1) return null;

      const cierre = await tx.cierreBodega.findUnique({
        where: { id },
        select: {
          totalGeneral: true,
          solicitadoAt: true,
          zona: { select: { nombre: true } },
        },
      });
      const actor = await resolverActorCongelado(tx, resueltoPor);
      await appendAccion(tx, [
        {
          accion:
            nuevoEstado === "aprobado" ? "cierre_bodega_aprobado" : "cierre_bodega_rechazado",
          entidadTipo: "cierre_bodega",
          entidadId: id,
          entidadEtiqueta: etiquetaDeEntidad("cierre_bodega", {
            zonaNombre: cierre?.zona.nombre ?? null,
            fecha: cierre?.solicitadoAt ?? new Date(),
          }),
          monto: cierre?.totalGeneral ?? null,
          ...actor,
        },
      ]);
      return "updated" as const;
    });
    if (resultado === "updated") return "updated";

    // count 0: distinguir "ya resuelto" (existe) de "no existe".
    const existe = await this.prisma.cierreBodega.count({ where: { id } });
    return existe > 0 ? "conflict" : "fuera_de_alcance"; // R18 vs R19
  }
}
