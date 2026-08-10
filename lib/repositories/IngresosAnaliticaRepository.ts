import {
  Prisma,
  type PrismaClient,
  type WalletMovimientoCategoria,
  type WalletMovimientoTipo,
} from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";
import {
  MAX_WAIT_LECTURA_CONSISTENTE_MS,
  TIMEOUT_LECTURA_CONSISTENTE_MS,
} from "@/lib/config/analitica-financiera";
import type {
  AgregadoCategoriaCaja,
  AgregadoCuboCategoriaCaja,
  IIngresosAnaliticaRepository,
} from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Feature 127 (T C.1) — repositorio de la CAJA PRINCIPAL. Sirve las CUATRO metricas que salen
// de `wallet_movimiento`: `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` y `egresos`.
//
// SOLO CONSULTAS (R30). Aqui no se resta, no se decide un signo y no se deriva un saldo: la
// fila sale desglosada por `(categoria, tipo)` y el `neto` con signo lo produce el servicio con
// `derivarBalance`. Tampoco hay `try/catch` (R32): un fallo de consulta se propaga tal cual, y
// eso es deliberado — un cero devuelto por un error de base es la peor mentira posible en
// dinero.
//
// UNA sola tabla (R4): `wallet_movimiento`, que es exactamente lo que las cuatro metricas
// declaran en `fuente.tablas`. Ni un `include`, ni una relacion.
//
// ---------------------------------------------------------------------------
// DESVIACION DECLARADA (feature 180, Q6 — humano, 2026-08-05): AQUI HAY SQL CRUDO
// ---------------------------------------------------------------------------
// QUE cambia: hasta la 180 esta cabecera decia «ni un `$queryRaw`». Ya no es cierto —y de hecho
// contradecia a los guardias, que YA permiten SQL crudo sobre las cinco tablas de `TablaDinero`
// cuando el archivo recibe `ConsultaAnalitica` (`financiera-fuente.guardia.test.ts`,
// `alcance-obligatorio.guardia.test.ts`)—. `sumarPorCuboYCategoria` emite UNA consulta cruda,
// acotada y parametrizada.
//
// POR QUE: agrupar por fecha calendario de Costa Rica no se puede expresar con `groupBy` de
// Prisma. `fecha_movimiento` es un INSTANTE (`DateTime`, no `@db.Date`) y no existe columna de
// fecha que agrupar; `groupBy` solo agrupa por columnas, no por expresiones. Y la alternativa
// —una columna generada `fecha_cr date`— no es declarable en el datamodel de Prisma: si se
// declara, el cliente la mete en los `INSERT` y ROMPE toda escritura de los tres libros de
// dinero; si no se declara, `groupBy` no la ve (`design.md` §5.2, alternativa 1).
//
// CON QUE LIMITES, que son los que hacen que esto no sea una puerta abierta:
//   1. UNA sola tabla, la misma de siempre: `wallet_movimiento`. Ni un join, ni una tabla mas.
//   2. Las FRONTERAS SE CALCULAN EN TYPESCRIPT (`lib/analytics/cubo-temporal.ts`, que las deriva
//      de `lib/utils/fecha-cr.ts`) y viajan como PARAMETROS ⟨D4⟩.
//   3. CERO zonas horarias en el SQL: no hay `AT TIME ZONE`, ni `America/Costa_Rica`, ni
//      `date_trunc` con zona, ni `interval '6 hours'`. Cualquiera de esas seria una SEGUNDA
//      definicion del dia operativo fuera del alcance de `fecha-cr.ts` — el off-by-one de seis
//      horas del que avisa `lib/analytics/ranges.ts`.
//   4. Parametrizado con `Prisma.sql` / `Prisma.join`. Nunca `$queryRawUnsafe`, nunca
//      interpolacion de strings.
//
// LAS CATEGORIAS LAS MANDA EL CATALOGO (R17). No hay ni un array de categorias escrito a mano
// en este archivo: la lista sale de `consulta.metrica.definicion.categorias`. Lo unico que se
// nombra aqui es el UNIVERSO del enum (`WALLET_MOVIMIENTO_CATEGORIA_SEED`, la fuente unica de
// la 42), y se usa para VALIDAR, no para filtrar: si la metrica declarase una categoria que la
// caja no tiene, la consulta no puede cumplirse y se lanza. Filtrarla en silencio serviria una
// cifra corta sin que nada fallara.
//
// LA VENTANA LA MANDA `resolverRango` (R26): `[rango.desde, rango.hasta)` sobre
// `fecha_movimiento`, semiabierta. Ninguna fecha se construye aqui — un `new Date(fecha)` en
// este archivo reintroduciria el off-by-one de seis horas de la frontera de dia CR.
//
// NO se usa `consulta.alcance` (R9): con el catalogo vigente toda financiera concedida tiene
// alcance global, asi que un `where` de recorte seria codigo muerto que anuncia una privacidad
// que nadie diseño.
//
// ---------------------------------------------------------------------------
// FEATURE 187 — AQUI SE ABRE UNA TRANSACCION, Y SIGUE SIENDO SOLO CONSULTAS
// ---------------------------------------------------------------------------
// `enLecturaConsistente` es el UNICO metodo que no consulta: abre una transaccion de solo lectura
// con aislamiento `repeatable read` y ejecuta dentro las consultas que le den. Abrir un snapshot
// es acceso a datos, no logica de negocio (`CHECKPOINTS.md`), y por eso vive aqui y no en el
// servicio — que ademas no puede conocer Prisma (R6). Lo que NO cambia: el total lo sigue
// produciendo `sumarPorCategoria` y las filas `sumarPorCuboYCategoria`, dos consultas y dos
// caminos, porque la invariante de la 180 solo vale algo mientras lleguen por separado.

/**
 * Cliente Prisma MINIMO (patron `WalletMovimientoRepository`): una sola tabla, mas `$queryRaw`
 * para la particion por cubo (feature 180, Q6). `$queryRawUnsafe` NO esta y no puede estar: el
 * tipo del cliente es la primera barrera contra la interpolacion de strings.
 *
 * FEATURE 187 — gana `$transaction`, y OPCIONAL. Precedente del repo para el metodo:
 * `AnaliticaRollupPrismaClient` (`lib/repositories/AnaliticaRollupRepository.ts`), que tambien lo
 * incluye en su `Pick`. Lo que aqui es distinto es la opcionalidad, y no es una laxitud sino el
 * unico modelado honesto del hecho: dentro de una lectura consistente, la instancia de este
 * repositorio se construye con el cliente TRANSACCIONAL que Prisma entrega
 * (`Prisma.TransactionClient`), y ese cliente NO tiene `$transaction` porque las transacciones no
 * se anidan. Declararlo obligatorio obligaria a un cast que afirmaria lo contrario; declararlo
 * opcional deja que el tipo diga la verdad y que anidar falle con un mensaje que se entiende.
 */
type IngresosPrismaClient = Pick<PrismaClient, "walletMovimiento" | "$queryRaw"> & {
  readonly $transaction?: PrismaClient["$transaction"];
};

/** El universo del enum de la caja, para validar lo que el catalogo declara. */
const CATEGORIAS_DE_CAJA: ReadonlySet<string> = new Set(WALLET_MOVIMIENTO_CATEGORIA_SEED);

/**
 * Las categorias que la metrica declara, comprobadas contra el enum de la caja.
 *
 * Lanza en los dos casos en que la consulta no puede significar lo que la metrica promete:
 * sin categorias (agregaria el libro entero bajo el nombre de una metrica concreta) y con una
 * categoria ajena a `wallet_movimiento` (devolveria menos dinero del declarado). Las dos son
 * incoherencias del catalogo, no errores del usuario, y por eso se hacen ruidosas (R32).
 */
function categoriasDeclaradas(consulta: ConsultaAnalitica): readonly WalletMovimientoCategoria[] {
  const declaradas = consulta.metrica.definicion.categorias ?? [];
  if (declaradas.length === 0) {
    throw new Error(
      `analitica financiera: la metrica "${consulta.metrica.id}" no declara categorias y la caja principal no se agrega entera`,
    );
  }
  const ajenas = declaradas.filter((c) => !CATEGORIAS_DE_CAJA.has(c));
  if (ajenas.length > 0) {
    throw new Error(
      `analitica financiera: la metrica "${consulta.metrica.id}" declara categorias que la caja principal no tiene: ${ajenas.join(", ")}`,
    );
  }
  return declaradas as readonly WalletMovimientoCategoria[];
}

/**
 * Feature 180 ⟨D4⟩ — los limites de particion, como ARRAY parametrizado de `timestamp`.
 *
 * DOS COSAS QUE NO SE PUEDEN TOCAR SIN ROMPER LA FRONTERA DEL DIA CR:
 *
 * 1. Los instantes vienen de `cubos[].desde`, que `lib/analytics/cubo-temporal.ts` deriva de
 *    `inicioDelDiaCREnUtc`. Aqui no se construye ni se ajusta ninguna fecha.
 *
 * 2. EL CAST ES `::timestamp`, NO `::timestamptz`, y esto se midio contra Postgres, no se supuso
 *    (`tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`).
 *    `fecha_movimiento` es `timestamp(3)` SIN zona y guarda el reloj de pared en UTC. El driver
 *    serializa un `Date` de JavaScript como ese mismo reloj de pared UTC (`2026-03-10 06:00:00`),
 *    asi que `::timestamp` lo lee tal cual y la comparacion es exacta. Con `::timestamptz`,
 *    Postgres interpretaria ese texto en el huso de la SESION —que es el del proceso de Node, y
 *    en esta maquina es `America/Bogota`— y desplazaria toda frontera cinco o seis horas sin que
 *    nada fallara. El cast explicito hace falta ademas por otro motivo: dentro de un `ARRAY[...]`
 *    el parametro no tiene contexto de tipo y Postgres responde `42P18` ("no se pudo determinar
 *    el tipo del parametro").
 *
 * `Prisma.join` mantiene cada limite como SU PROPIO parametro: no hay ni una fecha interpolada
 * en el texto de la consulta.
 */
function limitesDeCubo(cubos: readonly CuboTemporal[]): Prisma.Sql {
  return Prisma.join(cubos.map((cubo) => Prisma.sql`${cubo.desde}::timestamp`));
}

/**
 * La fila cruda tal y como `$queryRaw` la entrega: `width_bucket` es `int4` (llega como `number`)
 * y `SUM(monto)` es `numeric` (llega como `Prisma.Decimal`). Tiparla explicitamente es lo que
 * impide que el dinero se escape a `number` sin que nadie lo note: `$queryRaw<T>` no valida nada,
 * asi que este tipo es el unico sitio donde consta que `suma` NO es un numero.
 */
interface FilaCrudaCuboCaja {
  readonly indiceCubo: number;
  readonly categoria: WalletMovimientoCategoria;
  readonly tipo: WalletMovimientoTipo;
  readonly suma: Prisma.Decimal | null;
}

export class IngresosAnaliticaRepository implements IIngresosAnaliticaRepository {
  constructor(private readonly prisma: IngresosPrismaClient) {}

  /**
   * Feature 187 (T2.3, R1/R2/R6/R10) — EL ALCANCE DE LECTURA CONSISTENTE.
   *
   * Abre una transaccion `repeatable read` y ejecuta `fn` sobre una instancia de esta misma clase
   * ligada al cliente transaccional. En Postgres, `repeatable read` fija el snapshot en la PRIMERA
   * sentencia y lo mantiene hasta el final: por eso el total y el desglose, que salen de dos
   * consultas distintas, dejan de poder ver dos fotos distintas del ledger.
   *
   * POR QUE UNA TRANSACCION INTERACTIVA y no la forma de array (`$transaction([p1, p2])`): la
   * forma de array exigiria exponer las `PrismaPromise` sin `await`, o sea cambiar la firma de los
   * metodos de lectura. Este metodo no cambia ni una.
   *
   * POR QUE `RepeatableRead` y no `Serializable`: para lecturas, `repeatable read` ya da snapshot
   * estable, y `serializable` traeria el riesgo de aborto que la feature 172 documento en su
   * alternativa K. Un tablero que a veces falla es peor que uno que a veces muestra centimos de
   * mas — y esto ademas los deja de mostrar.
   *
   * SIN `READ ONLY` explicito, decision declarada (`design.md` §3.1): exigirlo obligaria a meter
   * `$executeRaw` en el tipo del cliente, es decir a abrir la puerta de la escritura para prometer
   * que no se escribe. R3 lo sostienen las consultas que hay dentro y el censo que las mira.
   *
   * LOS TIEMPOS SALEN DE LA CONFIGURACION (R10): en este archivo no hay ni un numero de
   * milisegundos, igual que no hay ni un numero de dinero.
   *
   * SIN `try`/`catch` (R7): un fallo dentro del alcance aborta la transaccion y sube tal cual.
   *
   * El `throw` de abajo NO es un caso de error de la base: es la unica forma de anidar alcances, y
   * anidar no se puede porque el cliente transaccional no ofrece `$transaction`. Falla ruidoso en
   * vez de silenciosamente reusar el snapshot de fuera.
   */
  async enLecturaConsistente<T>(
    fn: (repo: IIngresosAnaliticaRepository) => Promise<T>,
  ): Promise<T> {
    if (this.prisma.$transaction === undefined) {
      throw new Error(
        "analitica financiera: este repositorio ya esta ligado a una lectura consistente; los alcances no se anidan",
      );
    }
    return this.prisma.$transaction(
      async (tx) => fn(new IngresosAnaliticaRepository(tx)),
      {
        isolationLevel: "RepeatableRead",
        timeout: TIMEOUT_LECTURA_CONSISTENTE_MS,
        maxWait: MAX_WAIT_LECTURA_CONSISTENTE_MS,
      },
    );
  }

  /**
   * Σ `monto` agrupada por `(categoria, tipo)` sobre las categorias del catalogo y la ventana
   * `[desde, hasta)` de `fecha_movimiento`.
   *
   * El desglose por `tipo` NO es un capricho: de ahi sale el `neto` con signo `ingreso − egreso`
   * de ⟨D1⟩/R37, y quien lo aplica es el servicio. Desde ⟨D12⟩ (2026-08-04, feature 183) ese
   * neto lo publican `egresos` y las dos metricas de tesoreria de la 173, no las tres `ingreso_*`
   * —cuya lista es homogenea de prefijo, luego `Σ egreso = 0` siempre—; el desglose se sigue
   * devolviendo igual porque esta consulta no sabe —ni tiene por que saber— quien la pide.
   * El `orderBy` tampoco es defensivo (R28): sin el, el orden de los grupos lo decide el plan de
   * la base y el DTO dejaria de ser reproducible sin que nada fallara.
   *
   * `_sum.monto` viene `null` solo cuando el grupo no existe —y un grupo nace de sus filas—,
   * asi que el `?? 0` de abajo es inalcanzable por la via normal; se deja porque el tipo de
   * Prisma lo admite y porque un `!` seria peor. No es un cero de error: los errores se
   * propagan.
   */
  async sumarPorCategoria(consulta: ConsultaAnalitica): Promise<readonly AgregadoCategoriaCaja[]> {
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where: {
        categoria: { in: [...categoriasDeclaradas(consulta)] },
        fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      _sum: { monto: true },
      orderBy: [{ categoria: "asc" }, { tipo: "asc" }],
    });

    return grupos.map((g) => ({
      categoria: g.categoria,
      tipo: g.tipo,
      suma: (g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }

  /**
   * Feature 180 ⟨D4⟩ — la MISMA Σ de arriba, particionada por CUBO TEMPORAL.
   *
   * Es la unica consulta cruda de este archivo y la desviacion que la Q6 autorizo (ver cabecera).
   * Lo que la hace legitima:
   *
   * - **La ventana la sigue mandando `consulta.rango`**, igual que en `sumarPorCategoria`:
   *   `[desde, hasta)` semiabierta. Los `cubos` NO amplian ni recortan lo que se lee (R22): solo
   *   dicen COMO se reparte. Si alguien pasara cubos de otro rango, esta consulta leeria
   *   exactamente el mismo dinero.
   * - **Las categorias las manda el CATALOGO** (`categoriasDeclaradas`), con la misma validacion
   *   ruidosa que la consulta de siempre. Ni un array de categorias escrito a mano.
   * - **`width_bucket` con los limites como parametros.** Postgres 16 lo tiene desde la 14
   *   (comprobado contra la base de test, no supuesto). Su semantica: `0` para lo anterior al
   *   primer limite y `N` para lo que iguala o supera el ultimo. Como los limites son los `desde`
   *   de los N cubos y el `WHERE` ya acota a `[rango.desde, rango.hasta)` —y `cubos[0].desde` ES
   *   `rango.desde`—, el resultado esta siempre en `1..N`; el `- 1` lo lleva al indice 0-based
   *   del contrato. Los dos bordes que esto decide (un movimiento exactamente en `cubos[0].desde`
   *   y otro en `cubos[i].hasta - 1ms`) tienen su caso en el test de integracion.
   * - **Ni una zona horaria en el SQL.** Ver el punto 3 de la cabecera.
   * - **`ORDER BY` explicito** por las tres coordenadas (R26): el DTO no puede depender del plan.
   *
   * SIN CUBOS NO SE PREGUNTA. `trocear` nunca devuelve una lista vacia para un rango valido (todo
   * rango contiene al menos un dia), asi que esto solo puede ocurrir si alguien llama al metodo
   * con `[]` a proposito. Devolver `[]` no es un cero silencioso: es la imagen exacta de "no hay
   * ninguna coordenada a la que atribuir dinero", no un importe inventado, y ademas no se traga
   * ningun error porque no llega a haber consulta. Consultar con `ARRAY[]` seria peor: un array
   * vacio no tiene tipo y Postgres rechazaria la consulta con un error que no significa nada.
   *
   * `suma` sale de `Prisma.Decimal.toFixed(2)`, sin pasar por `number` (R16). El `?? Decimal(0)`
   * es inalcanzable por la via normal —un grupo nace de sus filas y `monto` es NOT NULL— y esta
   * por el tipo, no como valor por defecto de un error: los errores se propagan (R25).
   */
  async sumarPorCuboYCategoria(
    consulta: ConsultaAnalitica,
    cubos: readonly CuboTemporal[],
  ): Promise<readonly AgregadoCuboCategoriaCaja[]> {
    if (cubos.length === 0) return [];

    const categorias = [...categoriasDeclaradas(consulta)];
    const filas = await this.prisma.$queryRaw<readonly FilaCrudaCuboCaja[]>(Prisma.sql`
      SELECT width_bucket(fecha_movimiento, ARRAY[${limitesDeCubo(cubos)}]) - 1 AS "indiceCubo",
             categoria::text AS categoria,
             tipo::text      AS tipo,
             SUM(monto)      AS suma
      FROM wallet_movimiento
      WHERE fecha_movimiento >= ${consulta.rango.desde}::timestamp
        AND fecha_movimiento <  ${consulta.rango.hasta}::timestamp
        AND categoria = ANY(${categorias}::wallet_movimiento_categoria[])
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `);

    return filas.map((f) => ({
      indiceCubo: f.indiceCubo,
      categoria: f.categoria,
      tipo: f.tipo,
      suma: (f.suma ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }
}
