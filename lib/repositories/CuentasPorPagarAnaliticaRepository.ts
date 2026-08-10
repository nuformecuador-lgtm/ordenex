import { Prisma, type PrismaClient, type PagoMensajeroMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";
import {
  MAX_WAIT_LECTURA_CONSISTENTE_MS,
  TIMEOUT_LECTURA_CONSISTENTE_MS,
} from "@/lib/config/analitica-financiera";
import type {
  AgregadoCuboTipo,
  CuentaMensajeroAlCorte,
  ICuentasPorPagarAnaliticaRepository,
  SaldoTiendaAlCorte,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";

// Feature 127 (T C.3) — repositorio de las DOS CUENTAS POR PAGAR.
//
// ⟨D3(a)⟩ / R21 — ESTO ES UN SALDO AL CORTE, NO UN FLUJO DEL PERIODO. Los dos metodos agregan
// con `fecha_movimiento < rango.hasta` y **SIN COTA INFERIOR**: `rango.desde` se ignora, y esa
// omision es la funcionalidad. El nombre lo fija el catalogo y dice "cuenta por pagar": un
// devengo de hace tres meses que nadie ha pagado SIGUE debiendose hoy. Añadir
// `fecha_movimiento >= rango.desde` mutila el saldo con todo lo anterior a la ventana y produce
// una cifra que parece razonable y por la que alguien paga de menos. El DTO lo declara ademas
// con `esAcumulado: true` (R43) para que la 132 no lo grafique como serie.
//
// SIN FILTRO DE CATEGORIA, y esto es una decision declarada (S12 en `progress/impl_127_C.md`):
// el saldo de una cuenta por pagar es el LIBRO ENTERO hasta el corte, que es exactamente lo que
// `derivarSaldoTienda` y `derivarCuentaPorPagar` calculan para `/mi-wallet`. Las dos metricas
// declaran en el catalogo TODAS las categorias de su enum, asi que un `categoria IN (...)` seria
// hoy un no-op — y el dia que el enum gane un valor antes que el catalogo, dejaria de serlo en
// silencio y descuadraria esta cifra respecto de la que la tienda ve. Dos cifras del mismo
// dinero es el bug caro de esta feature (R20).
//
// R14 — NINGUN identificador de mensajero sale de aqui. `cuenta_por_pagar_mensajero` no declara
// grano `mensajero`, asi que se agrega por `tipo` y punto: no hay `mensajeroId` en el resultado
// y no puede haberlo. La proteccion no es seudonimizar el id, es que el id no exista.
//
// SOLO CONSULTAS (R30): la resta con signo la hacen `derivarSaldoTienda` y
// `derivarCuentaPorPagar` en el servicio. Aqui no hay ni un `.sub(`. Sin `try/catch` (R32).
// No se usa `consulta.alcance` (R9).
//
// ---------------------------------------------------------------------------
// DESVIACION DECLARADA (feature 180, Q6 — humano, 2026-08-05): AQUI HAY SQL CRUDO
// ---------------------------------------------------------------------------
// Esta cabecera no prometia «ni un `$queryRaw`» —esa frase estaba en
// `IngresosAnaliticaRepository`— pero sus dos metodos originales eran `groupBy` de Prisma y el
// archivo se leia como si eso fuera la regla. Se declara el cambio igual, por el mismo motivo.
//
// QUE cambia: `cuentaPorPagarMensajerosPorCubo` emite UNA consulta cruda, acotada y
// parametrizada, sobre la MISMA tabla de siempre. `cuentaPorPagarMensajerosAntesDe` NO la
// necesita: es un `groupBy` normal, calcado del metodo `...AlCorte` con el corte movido.
//
// POR QUE: agrupar por fecha calendario de Costa Rica no se puede expresar con `groupBy` de
// Prisma. `fecha_movimiento` es un INSTANTE y no existe columna de fecha que agrupar; una columna
// generada no es declarable en el datamodel de Prisma y romperia los `INSERT` de los tres libros
// de dinero (`design.md` §5.2, alternativa 1).
//
// CON QUE LIMITES: una sola tabla (`pago_mensajero_movimiento`), fronteras calculadas en
// TypeScript por `lib/analytics/cubo-temporal.ts` y pasadas como PARAMETROS ⟨D4⟩, CERO zonas
// horarias en el SQL (ni `AT TIME ZONE`, ni `date_trunc` con zona, ni `interval '6 hours'`) y
// `Prisma.sql`/`Prisma.join` en vez de `$queryRawUnsafe`.
//
// ---------------------------------------------------------------------------
// FEATURE 187 — AQUI SE ABRE UNA TRANSACCION, Y SIGUE SIENDO SOLO CONSULTAS
// ---------------------------------------------------------------------------
// `enLecturaConsistente` es el UNICO metodo que no consulta: abre una transaccion de solo lectura
// con aislamiento `repeatable read` para que las TRES consultas de `cuenta_por_pagar_mensajero`
// vean el mismo snapshot. Abrir un snapshot es acceso a datos, no logica de negocio; el servicio
// no puede conocer Prisma (R6), asi que vive aqui. Lo que NO cambia: siguen siendo tres consultas
// por tres caminos, porque de eso vive la invariante R13 de la 180.

/**
 * Cliente Prisma MINIMO: los dos ledgers que las dos metricas declaran, mas `$queryRaw`.
 *
 * FEATURE 187 — gana `$transaction`, y OPCIONAL. Gemelo exacto del de
 * `IngresosAnaliticaRepository`, con el mismo motivo escrito alli: dentro de una lectura
 * consistente este repositorio se construye con el cliente TRANSACCIONAL de Prisma, que no ofrece
 * `$transaction` porque las transacciones no se anidan. Obligarlo exigiria un cast que mentiria;
 * opcional, el tipo dice la verdad y anidar falla con un mensaje que se entiende.
 */
type CuentasPorPagarPrismaClient = Pick<
  PrismaClient,
  "walletTiendaMovimiento" | "pagoMensajeroMovimiento" | "$queryRaw"
> & {
  readonly $transaction?: PrismaClient["$transaction"];
};

/** `Decimal | null` -> STRING escala 2 (S1/R27). Nunca pasa por `number`. */
function importe(valor: Prisma.Decimal | null): string {
  return (valor ?? new Prisma.Decimal(0)).toFixed(2);
}

/**
 * Feature 180 ⟨D4⟩ — los limites de particion, como ARRAY parametrizado de `timestamp`.
 *
 * Gemelo exacto del de `IngresosAnaliticaRepository`, y a proposito: el detalle que decide si la
 * frontera del dia CR se respeta o se desplaza seis horas es EL CAST, y tiene que estar escrito
 * dentro de cada archivo que el guardia de texto censa (un guardia de repositorios no ve lo que
 * pasa en un helper compartido que vive fuera de su lista). Un test comprueba que los dos emiten
 * el MISMO cast, para que arreglar uno y olvidar el otro se ponga rojo.
 *
 * `::timestamp` y NO `::timestamptz`, medido contra Postgres y no supuesto
 * (`tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`):
 * `fecha_movimiento` es `timestamp(3)` SIN zona y guarda el reloj de pared en UTC; el driver
 * serializa un `Date` de JavaScript con ese mismo reloj de pared UTC, asi que `::timestamp` lo lee
 * tal cual. Con `::timestamptz`, Postgres interpretaria el texto en el huso de la SESION (el del
 * proceso de Node) y correria toda frontera varias horas sin que nada fallara. El cast hace falta
 * ademas porque dentro de un `ARRAY[...]` el parametro no tiene contexto de tipo y Postgres
 * responde `42P18`.
 */
function limitesDeCubo(cubos: readonly CuboTemporal[]): Prisma.Sql {
  return Prisma.join(cubos.map((cubo) => Prisma.sql`${cubo.desde}::timestamp`));
}

/**
 * La fila cruda tal y como `$queryRaw` la entrega: `width_bucket` es `int4` (`number`) y
 * `SUM(monto)` es `numeric` (`Prisma.Decimal`). `$queryRaw<T>` no valida nada, asi que este tipo
 * es el unico sitio donde consta que `suma` NO es un numero.
 */
interface FilaCrudaCuboMensajero {
  readonly indiceCubo: number;
  readonly tipo: PagoMensajeroMovimientoTipo;
  readonly suma: Prisma.Decimal | null;
}

export class CuentasPorPagarAnaliticaRepository implements ICuentasPorPagarAnaliticaRepository {
  constructor(private readonly prisma: CuentasPorPagarPrismaClient) {}

  /**
   * Feature 187 (T2.4, R1/R2/R6/R10) — EL ALCANCE DE LECTURA CONSISTENTE. Gemelo exacto del de
   * `IngresosAnaliticaRepository`, con el mismo criterio con el que los dos `limitesDeCubo` son
   * gemelos: el detalle que decide si la garantia existe —el nivel de aislamiento— tiene que estar
   * escrito dentro de cada archivo que los censos miran, y un test comprueba que los dos abren el
   * alcance con el MISMO nivel, para que arreglar uno y olvidar el otro se ponga rojo.
   *
   * Aqui son TRES las consultas que comparten snapshot (`...AlCorte`, `...AntesDe`,
   * `...PorCubo`), y de esas tres depende R13 de la 180: la ultima fila de la serie acumulada ==
   * el total. Las tres cortan el mismo libro por fronteras distintas, asi que una escritura
   * confirmada en medio entra en unas y no en otras y descuadra la igualdad sin que nada falle.
   *
   * `repeatable read` y no `serializable` (para lecturas no compra nada y arriesga abortos, ver
   * alternativa K de la 172). Sin `READ ONLY` explicito, decision declarada en `design.md` §3.1.
   * Tiempos desde `lib/config/analitica-financiera.ts` (R10): en este archivo no hay ni un numero
   * de milisegundos. Sin `try`/`catch` (R7): el fallo aborta la transaccion y sube tal cual.
   *
   * El `throw` de abajo cubre el unico caso que el tipo ya impide en compilacion: anidar alcances.
   */
  async enLecturaConsistente<T>(
    fn: (repo: ICuentasPorPagarAnaliticaRepository) => Promise<T>,
  ): Promise<T> {
    if (this.prisma.$transaction === undefined) {
      throw new Error(
        "analitica financiera: este repositorio ya esta ligado a una lectura consistente; los alcances no se anidan",
      );
    }
    return this.prisma.$transaction(
      async (tx) => fn(new CuentasPorPagarAnaliticaRepository(tx)),
      {
        isolationLevel: "RepeatableRead",
        timeout: TIMEOUT_LECTURA_CONSISTENTE_MS,
        maxWait: MAX_WAIT_LECTURA_CONSISTENTE_MS,
      },
    );
  }

  /**
   * `groupBy(tienda_id, tipo)` + `_sum(monto)` con la UNICA cota `fecha_movimiento < hasta`.
   *
   * El desglose por `tipo` (`credito` / `debito`) es lo que `derivarSaldoTienda` necesita para
   * producir el saldo con signo; aqui no se resta. `orderBy` por `(tienda_id, tipo)` para que la
   * secuencia de filas no dependa del plan de la base (R28).
   */
  async saldoPorTiendaAlCorte(consulta: ConsultaAnalitica): Promise<readonly SaldoTiendaAlCorte[]> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tiendaId", "tipo"],
      where: { fechaMovimiento: { lt: consulta.rango.hasta } },
      _sum: { monto: true },
      orderBy: [{ tiendaId: "asc" }, { tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tiendaId: g.tiendaId,
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }

  /**
   * `groupBy(tipo)` + `_sum(monto)` con la UNICA cota `fecha_movimiento < hasta`, del libro
   * COMPLETO y sin desglose por persona (R14).
   *
   * El par `devengo` / `pago` es lo que `derivarCuentaPorPagar` convierte en la cuenta con
   * signo. `orderBy` por `tipo` (R28).
   */
  async cuentaPorPagarMensajerosAlCorte(
    consulta: ConsultaAnalitica,
  ): Promise<readonly CuentaMensajeroAlCorte[]> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where: { fechaMovimiento: { lt: consulta.rango.hasta } },
      _sum: { monto: true },
      orderBy: [{ tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }

  /**
   * Feature 180 ⟨D4⟩ — Σ `monto` por `(cubo, tipo)` DENTRO de la ventana `[desde, hasta)`.
   *
   * OJO A LA ASIMETRIA CON LOS DOS METODOS DE ARRIBA, que es intencionada: estos son los
   * MOVIMIENTOS del periodo, no un saldo. El saldo lo compone el servicio ⟨D5⟩ arrancando del
   * arrastre de `cuentaPorPagarMensajerosAntesDe` y acumulando estos componentes cubo a cubo, con
   * `derivarCuentaPorPagar` una vez por cubo. Servir aqui un saldo por cubo obligaria a N
   * consultas o a una ventana movil, y ademas metería la derivacion en el repositorio (R30).
   *
   * SIN FILTRO DE CATEGORIA, por la misma razon declarada arriba para los metodos al corte: la
   * metrica declara TODAS las categorias de su enum, y un `categoria IN (...)` aqui seria hoy un
   * no-op que dejaria de serlo en silencio el dia que el enum gane un valor antes que el catalogo.
   *
   * `width_bucket` con los limites como parametros: devuelve `0` para lo anterior al primer limite
   * y `N` para lo que iguala o supera el ultimo; como el `WHERE` ya acota a
   * `[rango.desde, rango.hasta)` y `cubos[0].desde` ES `rango.desde`, el resultado esta siempre en
   * `1..N` y el `- 1` lo lleva al indice 0-based del contrato. Los dos bordes tienen su caso en el
   * test de integracion.
   *
   * SIN CUBOS NO SE PREGUNTA. `trocear` nunca devuelve lista vacia para un rango valido; con `[]`
   * no hay ninguna coordenada a la que atribuir dinero, asi que `[]` es la respuesta exacta y no
   * un cero inventado — y no se traga ningun error, porque no llega a haber consulta. Con
   * `ARRAY[]` Postgres rechazaria la consulta por un array sin tipo, que es un fallo que no
   * significa nada.
   *
   * `ORDER BY` explicito por `(indiceCubo, tipo)` (R28). Sin `try/catch` (R32/R25).
   */
  async cuentaPorPagarMensajerosPorCubo(
    consulta: ConsultaAnalitica,
    cubos: readonly CuboTemporal[],
  ): Promise<readonly AgregadoCuboTipo[]> {
    if (cubos.length === 0) return [];

    const filas = await this.prisma.$queryRaw<readonly FilaCrudaCuboMensajero[]>(Prisma.sql`
      SELECT width_bucket(fecha_movimiento, ARRAY[${limitesDeCubo(cubos)}]) - 1 AS "indiceCubo",
             tipo::text AS tipo,
             SUM(monto) AS suma
      FROM pago_mensajero_movimiento
      WHERE fecha_movimiento >= ${consulta.rango.desde}::timestamp
        AND fecha_movimiento <  ${consulta.rango.hasta}::timestamp
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    return filas.map((f) => ({
      indiceCubo: f.indiceCubo,
      tipo: f.tipo,
      suma: importe(f.suma),
    }));
  }

  /**
   * Feature 180 ⟨D5⟩ / R14 — EL SALDO DE ARRASTRE: `groupBy(tipo)` + `_sum(monto)` con la UNICA
   * cota `fecha_movimiento < rango.desde`.
   *
   * **SIN COTA INFERIOR, y esa ausencia es la funcionalidad.** Es el mismo principio que
   * `cuentaPorPagarMensajerosAlCorte` con el corte movido de `hasta` a `desde`: lo que se le debia
   * a los mensajeros justo ANTES de que empiece el rango. Sin el, la serie acumulada arrancaria en
   * cero y toda la linea quedaria por debajo de su valor real — una cifra creible, que no rompe
   * nada, y por la que alguien paga de menos. Añadir aqui `gte: rango.desde` deja el metodo
   * devolviendo el flujo del primer cubo bajo el nombre de un saldo.
   *
   * `groupBy` de Prisma normal: agrupar por `tipo` sobre una ventana SIN particionar no necesita
   * SQL crudo, y usarlo aqui seria crudo por simetria, no por necesidad.
   *
   * Sin `mensajeroId` (R14/R24). `orderBy` por `tipo` (R28). Sin `try/catch` (R32/R25).
   */
  async cuentaPorPagarMensajerosAntesDe(
    consulta: ConsultaAnalitica,
  ): Promise<readonly CuentaMensajeroAlCorte[]> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where: { fechaMovimiento: { lt: consulta.rango.desde } },
      _sum: { monto: true },
      orderBy: [{ tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }
}
