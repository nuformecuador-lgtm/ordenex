import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AnulacionLeida,
  FilaDeLibroRow,
  IEstadoCuentaRepository,
  MovimientoDeMensajeroRow,
  MovimientoDelPeriodoRow,
  PagoDeDocumento,
  PaginaDeLibro,
  ParDeChip,
  TipoDeDocumentoDeLibro,
  TipoDeDocumentoDePago,
  VentanaDeLibro,
} from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import type { DesgloseTiendaAgregadoRow } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ParDeGuia } from "@/lib/types/busqueda-por-guia";
import type {
  IMovimientosMensajeroEnLoteRepository,
  MovimientoDeMensajeroEnLoteRow,
} from "@/lib/interfaces/repositories/IMovimientosMensajeroEnLoteRepository";
import { estadoCuentaConfig } from "@/lib/config/estado-cuenta";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";
import { escaparComodinesLike } from "@/lib/utils/escapar-like";

type Cliente = Pick<
  PrismaClient,
  | "$queryRaw"
  | "usuario"
  | "zona"
  | "walletTiendaMovimiento"
  | "pagoMensajeroMovimiento"
  | "cierreBodega"
  | "liquidacionAnulacion"
  | "cobroTiendaAnulacion"
  | "pagoPorCuentaTiendaAnulacion"
  | "abonoTiendaAnulacion"
  | "walletComprobante"
  | "pagoPorCuentaTienda"
  | "abonoTienda"
  | "cierreDia"
  | "liquidacionPago"
> & {
  /**
   * FICHA 458-B (revision M2) — OPCIONAL por el mismo motivo que en el repositorio de ingresos de la analitica (feature 187):
   * dentro de la lectura consistente la instancia se construye con el cliente TRANSACCIONAL, que no
   * tiene `$transaction` (las transacciones no se anidan).
   */
  readonly $transaction?: PrismaClient["$transaction"];
};

/** Lo que devuelve la ventana, tal como sale de la base (montos ya en texto). */
interface FilaCruda {
  id: string;
  tipo: string;
  categoria: string;
  origen_tipo: string;
  origen_id: string | null;
  descripcion: string | null;
  registrado_por: string | null;
  registrado_por_nombre: string | null;
  fecha_movimiento: Date;
  monto: string;
  saldo_corrido: string;
  premio_dia: Date | null;
}

const NOMBRE_SQL = Prisma.sql`NULLIF(trim(concat_ws(' ', u.nombre, u.primer_apellido, u.segundo_apellido)), '')`;

function aFila(r: FilaCruda): FilaDeLibroRow {
  return {
    id: r.id,
    tipo: r.tipo,
    categoria: r.categoria,
    origenTipo: r.origen_tipo,
    origenId: r.origen_id,
    descripcion: r.descripcion,
    registradoPor: r.registrado_por,
    registradoPorNombre: r.registrado_por_nombre,
    fechaMovimiento: r.fecha_movimiento,
    monto: new Prisma.Decimal(r.monto).toFixed(2),
    saldoCorrido: new Prisma.Decimal(r.saldo_corrido).toFixed(2),
    premioDia: r.premio_dia,
  };
}

/** El filtro del chip: la lista CERRADA de pares que el servicio calculo con el diccionario total. */
function filtroDeChip(pares: ParDeChip[] | null, conPremio: boolean): Prisma.Sql {
  if (pares === null) return Prisma.empty;
  if (pares.length === 0) return Prisma.sql` AND FALSE`;
  const unaCondicion = (p: ParDeChip) =>
    conPremio && p.esPremio !== undefined
      ? Prisma.sql`(l.categoria = ${p.categoria} AND l.origen_tipo = ${p.origen} AND (l.premio_dia IS NOT NULL) = ${p.esPremio})`
      : Prisma.sql`(l.categoria = ${p.categoria} AND l.origen_tipo = ${p.origen})`;
  return Prisma.sql` AND (${Prisma.join(pares.map(unaCondicion), " OR ")})`;
}

/**
 * FICHA 463 (design §3.2, R24/R26/R27/R28) — el termino del buscador, en el `WHERE` EXTERIOR (despues de
 * la ventana, como el chip). `ILIKE` sin distinguir mayusculas; `%` y `_` escapados son texto (R28).
 * El nombre de quien registro (`NOMBRE_SQL`, del `LEFT JOIN usuario u`) solo entra en la oficina: en
 * `/mi-wallet` buscar a una persona de Ordenex no reduce ni amplia el resultado (R27). Mutacion «sin la
 * rama del nombre» → roja en `estado-cuenta-busqueda-orden-463` (R26).
 */
function terminoSql(v: Pick<VentanaDeLibro, "termino" | "conNombreRegistrador">): Prisma.Sql {
  if (v.termino === undefined) return Prisma.empty;
  const patron = `%${escaparComodinesLike(v.termino)}%`;
  return v.conNombreRegistrador
    ? Prisma.sql` AND (l.descripcion ILIKE ${patron} OR ${NOMBRE_SQL} ILIKE ${patron})`
    : Prisma.sql` AND l.descripcion ILIKE ${patron}`;
}

/**
 * FICHA 469 (design §3.2, R8–R10, R16/R17) — la busqueda del libro: por GUIA si el servicio resolvio
 * pares, de TEXTO (la de la 463) si no. EXCLUYENTES: con `porGuia` el termino no se escribe (R10). En el
 * `WHERE` EXTERIOR, despues de la ventana (como el chip): el corrido no cambia (R17). Lista vacia ⇒
 * ` AND FALSE` (R22). No decide nada: es el molde de `filtroDeChip`.
 */
function busquedaSql(v: Pick<VentanaDeLibro, "termino" | "conNombreRegistrador" | "porGuia">): Prisma.Sql {
  if (v.porGuia === undefined) return terminoSql(v);
  if (v.porGuia.length === 0) return Prisma.sql` AND FALSE`;
  const una = (p: ParDeGuia) =>
    p.origenTipo === "cierre_dia"
      ? Prisma.sql`(l.origen_tipo = ${p.origenTipo} AND l.origen_id = ${p.origenId} AND l.categoria = ${p.categoria})`
      : Prisma.sql`(l.origen_tipo = ${p.origenTipo} AND l.origen_id = ${p.origenId})`;
  return Prisma.sql` AND (${Prisma.join(v.porGuia.map(una), " OR ")})`;
}

/**
 * FICHA 463 (R33/R36/R37) — el sentido del `ORDER BY` FINAL, el mismo en las tres columnas (orden total
 * en los dos sentidos). La ventana del corrido NO lo usa: sigue cronologica, asi que el corrido de una
 * fila es el mismo en «Mas recientes» y en «Mas antiguas». Mutacion «invertir tambien el `OVER (ORDER
 * BY …)`» → roja en `estado-cuenta-busqueda-orden-463` (R37).
 */
const sentidoSql = (sortDir: VentanaDeLibro["sortDir"]) => (sortDir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`);

const desdeSql = (desde?: Date) => (desde === undefined ? Prisma.empty : Prisma.sql` AND l.fecha_movimiento >= ${desde}`);

/**
 * FICHA 458-D (servidor, R10/R12) — el filtro de CIERRE de la TIENDA: las filas que nacen de ese
 * cierre. Se aplica sobre `libro`, que YA esta acotado a la cuenta (`tienda_id` dentro de la ventana):
 * un cierre de otra cuenta no casa ninguna fila. Mutacion M-D1 (quitar la condicion del cierre) →
 * roja en `estado-cuenta-servidor-458d`.
 *
 * En la tienda no hay rama de pagos: ningun documento de pago a una tienda se ata a un cierre
 * (`liquidacion_pago_cierre_check`: `cierre_id` NOT NULL sii el beneficiario es un mensajero; y
 * `abono_tienda`, `pago_por_cuenta_tienda` y `cobro_tienda` no tienen columna de cierre). El desglose
 * retirado de la tienda tambien filtraba solo por `cierre_dia`.
 */
const cierreDeTiendaSql = (cierreId?: string) =>
  cierreId === undefined
    ? Prisma.empty
    : Prisma.sql` AND l.origen_tipo = 'cierre_dia' AND l.origen_id = ${cierreId}`;

/**
 * FICHA 458-D (revision B1, 172 R52) — el filtro de CIERRE del MENSAJERO: lo que nacio del cierre
 * (`cierre_dia`) Y los pagos registrados contra ese cierre con sus anulaciones (`pago_mensajero` cuyo
 * documento `liquidacion_pago` lleva `cierre_id = <cierre>`; el contra-asiento comparte `origen_id`
 * con su pago, asi que la rama lo trae por el documento y no por la categoria). Es la semantica del
 * desglose retirado (`PagoMensajeroMovimientoRepository.buildFiltrosWhere`).
 *
 * La cuenta va SIEMPRE en el WHERE: el `libro` ya esta acotado por `mensajero_id`, y la subconsulta
 * del documento vuelve a exigir el MISMO mensajero, asi que un cierre de otro mensajero no casa nada.
 * Mutacion «sin la rama del pago» → roja en `estado-cuenta-cierre-pagos-172r52`.
 */
const cierreDeMensajeroSql = (mensajeroId: string, cierreId?: string) =>
  cierreId === undefined
    ? Prisma.empty
    : Prisma.sql` AND (
        (l.origen_tipo = 'cierre_dia' AND l.origen_id = ${cierreId})
        OR (l.origen_tipo = 'pago_mensajero' AND l.origen_id IN (
          SELECT lp.id FROM liquidacion_pago lp
          WHERE lp.cierre_id = ${cierreId} AND lp.mensajero_id = ${mensajeroId}
        ))
      )`;

/**
 * FICHA 458-B (design §3.2, R16–R25) — las lecturas del estado de cuenta. SOLO queries.
 *
 * LA VENTANA (R21/R23): `SUM(± monto) OVER (ORDER BY fecha, created_at, id)` sobre la cuenta ENTERA
 * hasta `hastaUtc`; el periodo y el chip filtran DESPUES y se pagina al final. El orden es el mismo
 * dentro y fuera de la ventana, y es TOTAL (`id` cierra los empates), asi que dos lecturas seguidas
 * dan el mismo orden y el mismo corrido, y ninguna pagina repite ni omite filas.
 *
 * Mutacion 1 de design §8.2 (el signo del corrido al reves) y 2 (sin `created_at` en el ORDER BY de
 * la ventana) → rojas en `wallet-caracterizacion-458` y `estado-cuenta-saldo-corrido`.
 */
export class EstadoCuentaRepository implements IEstadoCuentaRepository, IMovimientosMensajeroEnLoteRepository {
  constructor(private readonly prisma: Cliente) {}

  /**
   * FICHA 458-B (revision M2) — UNA transaccion `repeatable read` para todas las lecturas del
   * extracto: Postgres fija el snapshot en la primera sentencia y lo mantiene hasta el final, asi que
   * la pagina, los totales (actual y anterior) y el periodo ven la misma foto aunque un cierre se
   * apruebe en medio. Molde: la lectura consistente del repositorio de ingresos de la analitica (feature 187).
   * Sin `try`/`catch`: un fallo sube tal cual. Anidar falla ruidoso en vez de reusar el snapshot.
   */
  async enLecturaConsistente<T>(fn: (repo: IEstadoCuentaRepository) => Promise<T>): Promise<T> {
    if (this.prisma.$transaction === undefined) {
      throw new Error("estado de cuenta: este repositorio ya esta ligado a una lectura consistente; no se anida");
    }
    return this.prisma.$transaction(async (tx) => fn(new EstadoCuentaRepository(tx)), {
      isolationLevel: "RepeatableRead",
      timeout: estadoCuentaConfig.TIMEOUT_LECTURA_MS,
      maxWait: estadoCuentaConfig.MAX_WAIT_LECTURA_MS,
    });
  }

  async nombreDeCuenta(tipo: "tienda" | "mensajero" | "bodega", id: string): Promise<string | null> {
    if (tipo === "bodega") {
      const zona = await this.prisma.zona.findFirst({ where: { id, esCentral: false }, select: { nombre: true } });
      return zona?.nombre ?? null;
    }
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: { value: tipo === "tienda" ? "adminTienda" : "mensajero" } },
      select: NOMBRE_USUARIO_SELECT,
    });
    return usuario === null ? null : nombreCompletoUsuario(usuario);
  }

  // ── Paginas con saldo corrido ─────────────────────────────────────────────────────────────

  async paginaDeTienda(tiendaId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` AND m.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH libro AS (
        SELECT m.id, m.tipo::text AS tipo, m.categoria::text AS categoria, m.origen_tipo::text AS origen_tipo,
               m.origen_id, m.descripcion, m.registrado_por, m.fecha_movimiento, m.created_at, m.monto,
               NULL::date AS premio_dia,
               SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END)
                 OVER (ORDER BY m.fecha_movimiento, m.created_at, m.id) AS saldo_corrido
        FROM wallet_tienda_movimiento m
        WHERE m.tienda_id = ${tiendaId}${hasta}
      )`;
    return this.paginar(libro, v, false, cierreDeTiendaSql(v.cierreId));
  }

  async paginaDeMensajero(mensajeroId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` AND m.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH libro AS (
        SELECT m.id, m.tipo::text AS tipo, m.categoria::text AS categoria, m.origen_tipo::text AS origen_tipo,
               m.origen_id, m.descripcion, m.registrado_por, m.fecha_movimiento, m.created_at, m.monto,
               m.premio_dia,
               SUM(CASE WHEN m.tipo = 'devengo' THEN m.monto ELSE -m.monto END)
                 OVER (ORDER BY m.fecha_movimiento, m.created_at, m.id) AS saldo_corrido
        FROM pago_mensajero_movimiento m
        WHERE m.mensajero_id = ${mensajeroId}${hasta}
      )`;
    return this.paginar(libro, v, true, cierreDeMensajeroSql(mensajeroId, v.cierreId));
  }

  /**
   * La bodega no tiene libro: se ARMA con una UNION sobre `cierre_bodega` de la zona (design §3.2).
   * «Declarado» = el efectivo de la consolidacion, al solicitarla; «Recibido» = lo que llego, al
   * marcarla. El corrido es el PENDIENTE acumulado (Σ declarado − Σ recibido): la misma resta que
   * `saldoDe` aplica por consolidacion. Las rechazadas no cuentan (como en `/wallet/satelites`).
   */
  async paginaDeBodega(zonaId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` WHERE mv.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH mov AS (
        SELECT cb.id, 'declarado'::text AS tipo, 'declarado'::text AS categoria, 'cierre_bodega'::text AS origen_tipo,
               cb.id AS origen_id, NULL::text AS descripcion, cb.solicitado_por AS registrado_por,
               cb.solicitado_at AS fecha_movimiento, cb.solicitado_at AS created_at, cb.total_efectivo AS monto, 0 AS orden
        FROM cierre_bodega cb
        WHERE cb.zona_id = ${zonaId} AND cb.estado::text <> 'rechazado'
        UNION ALL
        SELECT cb.id, 'recibido'::text, 'recibido'::text, 'cierre_bodega'::text,
               cb.id, NULL::text, cb.conciliado_por,
               cb.conciliado_at, cb.conciliado_at, cb.monto_recibido, 1
        FROM cierre_bodega cb
        WHERE cb.zona_id = ${zonaId} AND cb.estado::text <> 'rechazado' AND cb.conciliado_at IS NOT NULL
      ), libro AS (
        SELECT mv.id, mv.tipo, mv.categoria, mv.origen_tipo, mv.origen_id, mv.descripcion, mv.registrado_por,
               mv.fecha_movimiento, mv.created_at, mv.monto, mv.orden, NULL::date AS premio_dia,
               SUM(CASE WHEN mv.tipo = 'declarado' THEN mv.monto ELSE -mv.monto END)
                 OVER (ORDER BY mv.fecha_movimiento, mv.orden, mv.id) AS saldo_corrido
        FROM mov mv${hasta}
      )`;
    // FICHA 469 (R36): la bodega busca SOLO texto (`terminoSql`, no `busquedaSql`): aunque una ventana
    // trajera `porGuia`, aqui no se aplicaria.
    const where = Prisma.sql`WHERE TRUE${desdeSql(v.desdeUtc)}${filtroDeChip(v.pares, false)}${terminoSql(v)}`;
    const dir = sentidoSql(v.sortDir);
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      ${libro}
      SELECT l.id, l.tipo, l.categoria, l.origen_tipo, l.origen_id, l.descripcion, l.registrado_por,
             ${NOMBRE_SQL} AS registrado_por_nombre, l.fecha_movimiento, l.monto::text AS monto,
             l.saldo_corrido::text AS saldo_corrido, l.premio_dia
      FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por
      ${where}
      ORDER BY l.fecha_movimiento ${dir}, l.orden ${dir}, l.id ${dir}
      LIMIT ${v.take} OFFSET ${v.skip}`;
    // El conteo con el MISMO `FROM` (el termino puede mirar el nombre de `u`); el `LEFT JOIN` por la
    // clave primaria es 0..1 y no multiplica filas.
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      ${libro}
      SELECT count(*)::int AS total FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por ${where}`;
    return { filas: filas.map(aFila), total };
  }

  private async paginar(
    libro: Prisma.Sql,
    v: VentanaDeLibro,
    conPremio: boolean,
    filtroDeCierre: Prisma.Sql,
  ): Promise<PaginaDeLibro> {
    const where = Prisma.sql`WHERE TRUE${desdeSql(v.desdeUtc)}${filtroDeChip(v.pares, conPremio)}${filtroDeCierre}${busquedaSql(v)}`;
    const dir = sentidoSql(v.sortDir);
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      ${libro}
      SELECT l.id, l.tipo, l.categoria, l.origen_tipo, l.origen_id, l.descripcion, l.registrado_por,
             ${NOMBRE_SQL} AS registrado_por_nombre, l.fecha_movimiento, l.monto::text AS monto,
             l.saldo_corrido::text AS saldo_corrido, l.premio_dia
      FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por
      ${where}
      ORDER BY l.fecha_movimiento ${dir}, l.created_at ${dir}, l.id ${dir}
      LIMIT ${v.take} OFFSET ${v.skip}`;
    // Mismo `FROM` que la pagina (el termino puede mirar el nombre de `u`); 0..1, no multiplica filas.
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      ${libro}
      SELECT count(*)::int AS total FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por ${where}`;
    return { filas: filas.map(aFila), total };
  }

  // ── Saldos (sin ventana) ──────────────────────────────────────────────────────────────────

  async totalesDeTienda(tiendaId: string, antesDe?: Date): Promise<{ creditos: string; debitos: string }> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tipo"],
      where: { tiendaId, ...(antesDe === undefined ? {} : { fechaMovimiento: { lt: antesDe } }) },
      _sum: { monto: true },
    });
    return { creditos: sumaDe(grupos, "credito"), debitos: sumaDe(grupos, "debito") };
  }

  async desgloseDeTienda(tiendaId: string): Promise<DesgloseTiendaAgregadoRow[]> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tipo", "categoria"],
      where: { tiendaId }, // la cuenta ENTERA: sin periodo, sin chip, sin cierre
      _sum: { monto: true },
    });
    return grupos.map((g) => ({
      tipo: g.tipo,
      categoria: g.categoria,
      total: new Prisma.Decimal(g._sum.monto ?? 0).toFixed(2), // money-safe
    }));
  }

  async totalesDeMensajero(mensajeroId: string, antesDe?: Date): Promise<{ devengado: string; pagado: string }> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where: { mensajeroId, ...(antesDe === undefined ? {} : { fechaMovimiento: { lt: antesDe } }) },
      _sum: { monto: true },
    });
    return { devengado: sumaDe(grupos, "devengo"), pagado: sumaDe(grupos, "pago") };
  }

  async totalesDeBodega(zonaId: string, antesDe?: Date): Promise<{ efectivo: string; recibido: string }> {
    const noRechazadas = { zonaId, estado: { not: "rechazado" as const } };
    const declarado = await this.prisma.cierreBodega.aggregate({
      where: { ...noRechazadas, ...(antesDe === undefined ? {} : { solicitadoAt: { lt: antesDe } }) },
      _sum: { totalEfectivo: true },
    });
    const recibido = await this.prisma.cierreBodega.aggregate({
      where: {
        ...noRechazadas,
        conciliadoAt: antesDe === undefined ? { not: null } : { not: null, lt: antesDe },
      },
      _sum: { montoRecibido: true },
    });
    return {
      efectivo: new Prisma.Decimal(declarado._sum.totalEfectivo ?? 0).toFixed(2),
      recibido: new Prisma.Decimal(recibido._sum.montoRecibido ?? 0).toFixed(2),
    };
  }

  // ── Periodo (para los totales netos) ──────────────────────────────────────────────────────

  async periodoDeTienda(tiendaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const filas = await this.prisma.walletTiendaMovimiento.findMany({
      where: { tiendaId, fechaMovimiento: rango(desdeUtc, hastaUtc) },
      select: { id: true, tipo: true, categoria: true, origenTipo: true, origenId: true, monto: true },
    });
    return filas.map((f) => ({ ...f, premioDia: null, monto: f.monto.toFixed(2) }));
  }

  async periodoDeMensajero(mensajeroId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const filas = await this.prisma.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId, fechaMovimiento: rango(desdeUtc, hastaUtc) },
      select: { id: true, tipo: true, categoria: true, origenTipo: true, origenId: true, premioDia: true, monto: true },
    });
    return filas.map((f) => ({ ...f, monto: f.monto.toFixed(2) }));
  }

  async periodoDeBodega(zonaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const noRechazadas = { zonaId, estado: { not: "rechazado" as const } };
    const declaradas = await this.prisma.cierreBodega.findMany({
      where: { ...noRechazadas, solicitadoAt: rango(desdeUtc, hastaUtc) },
      select: { id: true, totalEfectivo: true },
    });
    const recibidas = await this.prisma.cierreBodega.findMany({
      where: { ...noRechazadas, conciliadoAt: { not: null, ...rango(desdeUtc, hastaUtc) } },
      select: { id: true, montoRecibido: true },
    });
    return [
      ...declaradas.map((d) => ({
        id: d.id,
        tipo: "declarado",
        categoria: "declarado",
        origenTipo: "cierre_bodega",
        origenId: d.id,
        premioDia: null,
        monto: d.totalEfectivo.toFixed(2),
      })),
      ...recibidas.map((r) => ({
        id: r.id,
        tipo: "recibido",
        categoria: "recibido",
        origenTipo: "cierre_bodega",
        origenId: r.id,
        premioDia: null,
        monto: new Prisma.Decimal(r.montoRecibido ?? 0).toFixed(2),
      })),
    ];
  }

  // ── Anulaciones y comprobantes, en lote ───────────────────────────────────────────────────

  async anulacionesDe(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<AnulacionLeida[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const seleccion = {
      motivo: true,
      createdAt: true,
      anulador: { select: NOMBRE_USUARIO_SELECT },
    } as const;
    const leer = (documentoId: string, f: { motivo: string; createdAt: Date; anulador: Parameters<typeof nombreCompletoUsuario>[0] }) => ({
      documentoId,
      motivo: f.motivo,
      anuladoPorNombre: nombreCompletoUsuario(f.anulador),
      fecha: f.createdAt,
    });
    switch (tipo) {
      case "liquidacion_pago":
        return (
          await this.prisma.liquidacionAnulacion.findMany({ where: { pagoId: { in: lista } }, select: { pagoId: true, ...seleccion } })
        ).map((f) => leer(f.pagoId, f));
      case "cobro_tienda":
        return (
          await this.prisma.cobroTiendaAnulacion.findMany({ where: { cobroId: { in: lista } }, select: { cobroId: true, ...seleccion } })
        ).map((f) => leer(f.cobroId, f));
      case "pago_por_cuenta_tienda":
        return (
          await this.prisma.pagoPorCuentaTiendaAnulacion.findMany({ where: { pagoId: { in: lista } }, select: { pagoId: true, ...seleccion } })
        ).map((f) => leer(f.pagoId, f));
      case "abono_tienda":
        return (
          await this.prisma.abonoTiendaAnulacion.findMany({ where: { abonoId: { in: lista } }, select: { abonoId: true, ...seleccion } })
        ).map((f) => leer(f.abonoId, f));
    }
  }

  async conComprobante(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const lista = [...ids];
    switch (tipo) {
      case "liquidacion_pago":
        return new Set(
          (
            await this.prisma.walletComprobante.findMany({ where: { liquidacionPagoId: { in: lista } }, select: { liquidacionPagoId: true } })
          ).map((c) => c.liquidacionPagoId as string),
        );
      case "cobro_tienda":
        return new Set(
          (
            await this.prisma.walletComprobante.findMany({ where: { tiendaMovimientoId: { in: lista } }, select: { tiendaMovimientoId: true } })
          ).map((c) => c.tiendaMovimientoId as string),
        );
      case "pago_por_cuenta_tienda":
        return new Set(
          (
            await this.prisma.pagoPorCuentaTienda.findMany({ where: { id: { in: lista }, comprobantePath: { not: null } }, select: { id: true } })
          ).map((p) => p.id),
        );
      case "abono_tienda":
        return new Set(
          (
            await this.prisma.abonoTienda.findMany({ where: { id: { in: lista }, comprobantePath: { not: null } }, select: { id: true } })
          ).map((p) => p.id),
        );
    }
  }

  async pagosDe(tipo: TipoDeDocumentoDePago, ids: readonly string[]): Promise<PagoDeDocumento[]> {
    if (ids.length === 0) return [];
    const where = { id: { in: [...ids] } };
    const select = { id: true, metodo: true, referencia: true } as const;
    const filas =
      tipo === "liquidacion_pago"
        ? await this.prisma.liquidacionPago.findMany({ where, select })
        : tipo === "pago_por_cuenta_tienda"
          ? await this.prisma.pagoPorCuentaTienda.findMany({ where, select })
          : await this.prisma.abonoTienda.findMany({ where, select });
    return filas.map((f) => ({ documentoId: f.id, metodo: f.metodo, referencia: f.referencia }));
  }

  async movimientoDeMensajero(movimientoId: string, mensajeroId: string): Promise<MovimientoDeMensajeroRow | null> {
    const fila = await this.prisma.pagoMensajeroMovimiento.findFirst({
      where: { id: movimientoId, mensajeroId }, // `mensajeroId` en el WHERE: la de otro = inexistente
      select: { monto: true, categoria: true, origenTipo: true, origenId: true },
    });
    return fila === null ? null : { ...fila, monto: fila.monto.toFixed(2) };
  }

  /**
   * Ficha 468 (design §4.1, R55) — varias filas del libro de UN mensajero por id, con el mensajero en el
   * `WHERE` (una de otro mensajero no vuelve). Misma proyeccion que `movimientoDeMensajero`.
   */
  async listarPorIdsDeMensajero(ids: readonly string[], mensajeroId: string): Promise<MovimientoDeMensajeroEnLoteRow[]> {
    if (ids.length === 0) return [];
    const filas = await this.prisma.pagoMensajeroMovimiento.findMany({
      where: { id: { in: [...ids] }, mensajeroId }, // `mensajeroId` AL FINAL: nada lo puede pisar
      select: { id: true, monto: true, categoria: true, origenTipo: true, origenId: true },
    });
    return filas.map((f) => ({ ...f, monto: f.monto.toFixed(2) }));
  }

  async reversosDePremio(mensajeroId: string, dias: readonly Date[]): Promise<AnulacionLeida[]> {
    if (dias.length === 0) return [];
    const filas = await this.prisma.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId, categoria: "ajuste_pago", premioDia: { in: [...dias] } },
      select: { premioDia: true, descripcion: true, fechaMovimiento: true, registrador: { select: NOMBRE_USUARIO_SELECT } },
    });
    return filas.map((f) => ({
      documentoId: (f.premioDia as Date).toISOString(),
      motivo: f.descripcion,
      anuladoPorNombre: nombreONulo(f.registrador),
      fecha: f.fechaMovimiento,
    }));
  }

  async quienAproboLosCierres(cierreIds: readonly string[]): Promise<Map<string, string | null>> {
    if (cierreIds.length === 0) return new Map();
    const cierres = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...cierreIds] } },
      select: { id: true, resueltoPorUsuario: { select: NOMBRE_USUARIO_SELECT } },
    });
    return new Map(cierres.map((c) => [c.id, nombreONulo(c.resueltoPorUsuario)]));
  }
}

function nombreONulo(u: Parameters<typeof nombreCompletoUsuario>[0] | null): string | null {
  return u === null ? null : nombreCompletoUsuario(u);
}

function rango(desde?: Date, hasta?: Date): Prisma.DateTimeFilter {
  return {
    ...(desde === undefined ? {} : { gte: desde }),
    ...(hasta === undefined ? {} : { lt: hasta }),
  };
}

/** La Σ de un tipo en el `groupBy` por tipo (`0.00` si no hay filas). STRING escala 2. */
function sumaDe(grupos: { tipo: string; _sum: { monto: Prisma.Decimal | null } }[], tipo: string): string {
  return (grupos.find((g) => g.tipo === tipo)?._sum.monto ?? new Prisma.Decimal(0)).toFixed(2);
}
