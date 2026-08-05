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
import {
  DETALLE_ADMIN_SELECT,
  GESTION_ADMIN_SELECT,
  toPendienteRowDesdeSnapshot,
} from "@/lib/repositories/CierresAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Solo el estado que la 40 puede transicionar (R18): la guardia del updateMany.
const ESTADO_SOLICITADO = "solicitado";

// Feature 69/T23: el detalle sale del SNAPSHOT -> el cliente necesita `cierreDetail`.
type CierresBodegaAdminPrismaClient = Pick<
  PrismaClient,
  "cierreBodega" | "cierreDia" | "gestionOrden" | "cierreDetail"
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
  mensajero: { select: { nombre: true } },
} as const;

type DetalleCierreRow = Prisma.CierreDiaGetPayload<{ select: typeof DETALLE_CIERRE_SELECT }>;

function toDetalleCierreRow(r: DetalleCierreRow): CierreBodegaDetalleCierreRow {
  return {
    cierreDiaId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: r.mensajero.nombre,
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
function historicoBodegaWhere(): Prisma.CierreBodegaWhereInput {
  return { estado: { notIn: [...ESTADOS_COLA_SOLICITADO] } };
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
function colaBodegaWhere(): Prisma.CierreBodegaWhereInput {
  return { estado: { in: [...ESTADOS_COLA_SOLICITADO] } };
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
  async findHistoricoCompleto(): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: historicoBodegaWhere(),
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
  async findColaCompleta(): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: colaBodegaWhere(),
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
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // Feature 184/R16: el criterio sale de `historicoBodegaWhere`, la MISMA declaracion que usa
    // el conjunto completo del que sale el archivo. Estaba escrito aqui y habria que haberlo
    // escrito otra vez alli. R44 sigue siendo el motivo del `notIn`: con un
    // `in: ["aprobado","rechazado"]`, un estado nuevo del enum desapareceria de las dos listas.
    const where = historicoBodegaWhere();
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
  async findColaPaginada(rango: RangoPagina): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // Feature 184/R16: mismo criterio compartido que el conjunto completo de esta cola.
    const where = colaBodegaWhere();
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

  /** R16-R22: transicion atomica guardada; un solo UPDATE, no toca otras tablas. */
  async resolverCierreBodega(
    input: ResolverCierreBodegaInput,
  ): Promise<ResolverCierreBodegaResult> {
    const { id, nuevoEstado, resueltoPor, motivoRechazo } = input;

    // R18: aplica SOLO si sigue `solicitado` (guardia de estado en el WHERE).
    const res = await this.prisma.cierreBodega.updateMany({
      where: { id, estado: ESTADO_SOLICITADO },
      data: {
        estado: nuevoEstado,
        resueltoPor, // R20
        resueltoAt: new Date(), // R20
        motivoRechazo,
      },
    });
    if (res.count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe) de "no existe".
    const existe = await this.prisma.cierreBodega.count({ where: { id } });
    return existe > 0 ? "conflict" : "fuera_de_alcance"; // R18 vs R19
  }
}
