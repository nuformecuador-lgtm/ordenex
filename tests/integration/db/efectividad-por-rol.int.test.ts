import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { evaluarMadurezDeCohorte } from "@/lib/analytics/madurez-cohorte";
import { ConteoPorStatusRepository } from "@/lib/repositories/ConteoPorStatusRepository";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearGestion, crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import { consultaDe, D, D_MAS_1, describeSiHayBase, rangoDe } from "./_cohorte-carga";
import type { TxDeTest } from "./_semilla-rollup";

/**
 * ⭑⭑ FICHA 443 — EL HEROE DE LA EFECTIVIDAD, CON EL ALCANCE DE CADA ROL, CONTRA POSTGRES.
 *
 * ─── QUE MIDE ESTE ARCHIVO Y POR QUE NO LO MEDIA NINGUNO ────────────────────────────────
 *
 * El heroe de la 441 (`EfectividadHeroe`) se alimenta de UNA lectura:
 * `ConteoPorStatusRepository.contarPorStatus`. La 443 pregunta si esa lectura le entrega a la
 * TIENDA lo suyo y al SATELITE lo de su zona. Medido el 2026-09-17 con sesion real de los tres
 * roles: SI (maestro 69 ordenes, tienda 68, satelite 8). Este archivo es lo que impide que deje
 * de ser cierto sin que nada se ponga rojo.
 *
 * ⚠ LO QUE YA HABIA, y por que no basta —se comprobo archivo por archivo antes de escribir este:
 *
 *   - `tests/unit/analytics/conteo-entregas-contrato.test.ts` afirma que
 *     `resolverAlcanceConteoEntregas` devuelve `{tipo:"tienda"}` / `{tipo:"zona"}`. Eso mide el
 *     RESOLUTOR, no el `WHERE`: una consulta que ignorase el alcance concedido lo pasa en verde.
 *   - `tests/unit/analytics/conteo-por-status-sql.test.ts` mira el texto del `Prisma.Sql` que
 *     produce la funcion pura. Mata una mutacion escrita a mano, pero **no mide nada de lo que
 *     Postgres hace** con el `LEFT JOIN LATERAL` que sigue estando en esa consulta.
 *   - `tests/integration/db/cohorte-carga-alcance.int.test.ts` SI va contra el motor, pero de
 *     OTRA consulta (`CohorteCargaRepository`, que arma su `where` con `condicionesSinFecha` de
 *     `ConteoCargadasPorDiaRepository`) y afirmando sobre CONTEOS. Una mutacion que borrara
 *     `condicionDeAlcance(alcance)` de la lista de `ConteoPorStatusRepository.condicionesDeConsulta`
 *     —sin tocar `condicionDeAlcance`— deja aquel archivo verde: no comparten la lista.
 *   - `tests/integration/db/conteo-por-status-cohorte.int.test.ts` (441) SI ejercita esta
 *     consulta, pero siembra **una sola tienda y una sola zona**: no hay fila ajena que se pueda
 *     colar, asi que ensanchar el alcance no cambia ni un bucket.
 *
 * Aqui hay filas AJENAS en la base y las aserciones son **sobre esas ordenes**, no sobre un
 * total: cada poblacion ajena tiene un desenlace que NINGUNA propia produce, de modo que
 * «el bucket `entregada` no existe» es literalmente «no entro ninguna de las seis de la otra
 * zona». Un conteo no distingue «se colo una ajena y se perdio una propia».
 *
 * ⚠ SIN POLICIES RLS DEBAJO (Prisma se conecta con credenciales de servicio) esa condicion del
 * `WHERE` **es** la separacion entre inquilinos: un fallo no da una cifra equivocada, filtra las
 * ordenes de una tienda a otra. Eso se prueba contra el motor o no se prueba.
 *
 * El alcance NO se forja: cada consulta pasa por `prepararConteoEntregas` (`consultaDe`), que es
 * el unico sitio donde se gana el tipo opaco. Un test que lo construyera a mano mediria su propio
 * `as unknown as`, no la frontera.
 */

/** «Puntarenas», con las cifras reales del 2026-09-17: 27 cargadas en ~4 dias y ninguna cerrada. */
const PUNTARENAS_CARGADAS = 27;
/** «GAM», la bodega vecina: seis que SI cerraron, todas entregadas. Otra zona, la MISMA tienda. */
const GAM_ENTREGADAS = 6;
/** Ordenes propias del segundo escenario, el de la confusion de zonas (D9). */
const PROPIAS_SIN_GESTION = 3;

/** Los buckets indexados por status, que es como los lee `calcularEfectividad`. */
function porStatus(filas: readonly ConteoDeStatus[]): Map<string, number> {
  return new Map(filas.map((f) => [f.status, f.conteo]));
}

/** Cuantas ordenes hay en total en el recorte: el denominador que la pantalla escribe. */
function cargadas(filas: readonly ConteoDeStatus[]): number {
  return filas.reduce((suma, f) => suma + f.conteo, 0);
}

/** Lo mismo, sobre los buckets ya indexados. */
function totalDe(buckets: Map<string, number>): number {
  let suma = 0;
  for (const n of buckets.values()) suma += n;
  return suma;
}

/**
 * El `usuarioId` del satelite es DELIBERADAMENTE un id que no es de nadie.
 *
 * Su recorte sale de `zonaId` y de nada mas (`resolverAlcanceConteoEntregas` ->
 * `{tipo:"zona"}`), asi que pasarle el id de un usuario sembrado sugeriria que ese id participa
 * en el `WHERE` — y si algun dia participara, este caso no lo notaria. Con un id que no existe en
 * la base, cualquier condicion que lo usara devolveria cero filas y el archivo se pondria rojo.
 */
const SATELITE_SIN_FILAS_PROPIAS = "satelite-de-prueba-sin-filas";

describeSiHayBase("443 — el heroe cuenta lo de CADA rol, y nada mas (SQL real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** El repositorio REAL sobre la transaccion: nunca una copia del SQL escrita en el test. */
  async function leer(tx: TxDeTest, consulta: ConsultaConteoEntregas): Promise<readonly ConteoDeStatus[]> {
    return new ConteoPorStatusRepository(tx as unknown as PrismaClient).contarPorStatus(consulta);
  }

  /**
   * ESCENARIO 1 — «la cohorte que no se movio, con la vecina que si».
   *
   * | poblacion            | zona  | tienda  |  n | gestion      | que separa a quien la ve            |
   * | -------------------- | ----- | ------- | -- | ------------ | ----------------------------------- |
   * | Puntarenas           | zonaA | tienda1 | 27 | NINGUNA      | —  (es la cohorte del satelite)     |
   * | GAM                  | zonaB | tienda1 |  6 | `entregada`  | SOLO la ZONA (misma tienda)         |
   * | la tienda de al lado | zonaB | tienda2 |  1 | `incidente`  | SOLO la TIENDA (para `tienda1`)     |
   *
   * Las dos poblaciones ajenas tienen un desenlace que la propia NO puede producir —las 27 no
   * estan gestionadas, asi que caen todas en el bucket de su `order_status`—, y ahi esta la
   * gracia: «no existe el bucket `entregada`» ES la afirmacion «ninguna de las seis de GAM entro».
   *
   * ⚠ GAM es de la MISMA tienda a proposito. Si fuera de otra, el satelite podria estar
   * excluyendola por la tienda y el caso no probaria nada sobre la zona.
   */
  async function cohorteQueNoSeMovio() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      const actorMaestro = { usuarioId: base.tienda1, rol: "maestro" };
      const rango = rangoDe(D, D_MAS_1);

      // ⚠ LINEA BASE DEL MAESTRO, medida ANTES de sembrar y con la MISMA consulta. El alcance
      // global no excluye nada, asi que si la base local tuviera datos de 2001 el caso de abajo
      // seria rojo en esa maquina y verde en la mia. Se mide en vez de suponerse.
      const antes = porStatus(await leer(tx, consultaDe(rango, actorMaestro)));

      // Puntarenas: 27 cargadas dentro de la ventana y NINGUNA gestionada.
      for (let i = 0; i < PUNTARENAS_CARGADAS; i++) {
        await crearOrden(tx, base, {
          clave: `puntarenas-${i}`,
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: instanteCR(D, "09:00"),
        });
      }

      // GAM: seis entregadas. Otra ZONA, la MISMA tienda.
      for (let i = 0; i < GAM_ENTREGADAS; i++) {
        const id = await crearOrden(tx, base, {
          clave: `gam-${i}`,
          zonaId: base.zonaB,
          tiendaId: base.tienda1,
          createdAt: instanteCR(D, "09:00"),
        });
        await crearGestion(tx, {
          ordenId: id,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(D, "17:00"),
        });
      }

      // La tienda de al lado: UNA orden, con el unico `incidente` de todo el fixture.
      const ajena = await crearOrden(tx, base, {
        clave: "tienda-vecina",
        zonaId: base.zonaB,
        tiendaId: base.tienda2,
        createdAt: instanteCR(D, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: ajena,
        mensajeroId: base.mensajero1,
        resultado: "incidente",
        at: instanteCR(D, "18:00"),
      });

      const leerCon = async (actor: { usuarioId: string; rol: string; zonaId?: string }) =>
        leer(tx, consultaDe(rango, actor));

      return {
        antes,
        satelite: await leerCon({
          usuarioId: SATELITE_SIN_FILAS_PROPIAS,
          rol: "adminSatelite",
          zonaId: base.zonaA,
        }),
        tienda: await leerCon({ usuarioId: base.tienda1, rol: "adminTienda" }),
        maestro: await leerCon(actorMaestro),
      };
    });
  }

  it("ANTI-VACIO · con alcance GLOBAL las tres poblaciones estan ahi (si no, lo de abajo no prueba nada)", async () => {
    const { antes, maestro } = await cohorteQueNoSeMovio();
    const ahora = porStatus(maestro);
    const delta = (status: string) => (ahora.get(status) ?? 0) - (antes.get(status) ?? 0);

    // Las seis de GAM y la de la tienda vecina EXISTEN en la base y esta consulta las alcanza.
    // Sin esta comprobacion, «el satelite no ve el bucket `entregada`» podria significar
    // simplemente que el fixture no llego a insertarlas: un verde que no mide nada.
    expect(delta("entregada"), "las seis de GAM no estan en la base").toBe(GAM_ENTREGADAS);
    expect(delta("incidente"), "la orden de la tienda vecina no esta en la base").toBe(1);
    expect(totalDe(ahora) - totalDe(antes), "el fixture no sembro las 34 ordenes").toBe(
      PUNTARENAS_CARGADAS + GAM_ENTREGADAS + 1,
    );
  });

  it("el SATELITE no alcanza NINGUNA de las seis ordenes de la otra zona", async () => {
    const { satelite } = await cohorteQueNoSeMovio();
    const buckets = porStatus(satelite);

    // ⭑ LA MUTACION QUE MATA: «el satelite pierde su recorte por zona». Se afirma sobre las
    // ORDENES de GAM —las unicas del fixture con desenlace `entregada`— y no sobre un total: un
    // conteo no distingue «se colo una ajena» de «se perdio una propia».
    expect(
      buckets.get("entregada"),
      "entraron ordenes de OTRA zona (las seis entregadas de GAM)",
    ).toBeUndefined();
    expect(
      buckets.get("incidente"),
      "entro la orden de otra zona y otra tienda (la unica con `incidente`)",
    ).toBeUndefined();
    expect(cargadas(satelite), "el universo del satelite no son sus 27").toBe(PUNTARENAS_CARGADAS);
  });

  it("la TIENDA no alcanza la orden de la tienda vecina, y SI las suyas de la otra zona", async () => {
    const { tienda } = await cohorteQueNoSeMovio();
    const buckets = porStatus(tienda);

    // ⭑ LA MUTACION QUE MATA: «el alcance de la tienda se ensancha a todas las ordenes». Se
    // afirma sobre LA orden de `tienda2`, que es la unica del fixture con desenlace `incidente`.
    expect(
      buckets.get("incidente"),
      "entro la orden de OTRA tienda (la unica con `incidente`)",
    ).toBeUndefined();

    // Y la otra mitad, que es lo que impide que el caso de arriba pase por el motivo equivocado:
    // las seis de GAM son SUYAS aunque esten en otra zona, asi que tienen que entrar. Un recorte
    // que tapara tambien estas estaria recortando por zona, no por tienda.
    expect(buckets.get("entregada"), "se perdieron seis ordenes propias por estar en otra zona").toBe(
      GAM_ENTREGADAS,
    );
    expect(cargadas(tienda)).toBe(PUNTARENAS_CARGADAS + GAM_ENTREGADAS);
  });

  it("EL CASO PUNTARENAS · 27 cargadas y 0 cerradas: el satelite NO recibe un 0 %", async () => {
    const { satelite } = await cohorteQueNoSeMovio();

    // La cadena COMPLETA que alimenta al heroe, con las mismas funciones que corren en la
    // pantalla: buckets crudos -> reparto -> madurez. Nada escrito a mano por el camino.
    const madurez = evaluarMadurezDeCohorte(
      calcularEfectividad(satelite.map((f) => ({ status: f.status, conteo: f.conteo }))),
    );

    expect(madurez.cargadas).toBe(PUNTARENAS_CARGADAS);
    expect(madurez.cerradas, "alguna orden de la cohorte tiene desenlace").toBe(0);
    expect(madurez.vivas).toBe(PUNTARENAS_CARGADAS);
    expect(madurez.enCurso).toBe(true);

    // ⭑ EL MOTIVO DE LA FICHA: «0 de 27» NO es «0,0 % de efectividad». El encargado de la bodega
    // no ha fallado 27 entregas — no ha terminado ninguna, que es otra cosa. Se afirma PRIMERO
    // la cifra sobre CARGADAS (0/27 es una division perfectamente definida, y es justo la que
    // una regla mal puesta dejaria pasar) y despues la de sobre-cerradas.
    expect(madurez.sobreCargadas.valor, "se pinto un 0 % sobre 27 ordenes que nadie ha fallado").toBeNull();
    expect(madurez.sobreCargadas.motivo).toBe("sin_cerradas");
    expect(madurez.sobreCargadas.base, "la base de la cifra no son las 27 cargadas").toBe(
      PUNTARENAS_CARGADAS,
    );
    expect(madurez.sobreCerradas.valor).toBeNull();
    expect(madurez.sobreCerradas.motivo).toBe("sin_cerradas");
  });

  /**
   * ESCENARIO 2 — D9: LA ZONA ES LA DE LA ORDEN, JAMAS LA DEL MENSAJERO QUE LA GESTIONO.
   *
   * `sembrarBase` pone a `mensajero1` en la **zonaB** a proposito. Aqui ese mismo mensajero
   * gestiona UNA orden de la zonaA y UNA de la zonaB, con desenlaces distintos:
   *
   * | orden | zona  | gestionada por      | resultado   | el satelite de zonaA... |
   * | ----- | ----- | ------------------- | ----------- | ----------------------- |
   * | A     | zonaA | mensajero1 (zonaB)  | `rechazada` | SI la ve                |
   * | B     | zonaB | mensajero1 (zonaB)  | `entregada` | NO la ve                |
   *
   * Las dos a la vez son el bicondicional, y hacen falta las dos: con solo la primera, un recorte
   * por `usuario.zona_id` del mensajero estaria verde si el satelite fuera de zonaB; con solo la
   * segunda, lo estaria un recorte que no devolviera nada.
   */
  async function zonaDeLaOrdenNoDelMensajero() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      const propia = await crearOrden(tx, base, {
        clave: "A-zonaA-gestionada-por-mensajero-de-zonaB",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: propia,
        mensajeroId: base.mensajero1,
        resultado: "rechazada",
        at: instanteCR(D, "15:00"),
      });

      const ajena = await crearOrden(tx, base, {
        clave: "B-zonaB-gestionada-por-el-mismo-mensajero",
        zonaId: base.zonaB,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: ajena,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(D, "16:00"),
      });

      // Tres mas sin gestionar en la zona del satelite: el cubo vivo, para que el denominador
      // que el heroe escribe no sea 1 y el caso siga pareciendose a una cohorte de verdad.
      for (let i = 0; i < PROPIAS_SIN_GESTION; i++) {
        await crearOrden(tx, base, {
          clave: `propia-viva-${i}`,
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: instanteCR(D, "09:00"),
        });
      }

      return leer(
        tx,
        consultaDe(rangoDe(D, D_MAS_1), {
          usuarioId: SATELITE_SIN_FILAS_PROPIAS,
          rol: "adminSatelite",
          zonaId: base.zonaA,
        }),
      );
    });
  }

  it("D9 · el satelite SI ve su orden aunque la gestione un mensajero de otra zona", async () => {
    const buckets = porStatus(await zonaDeLaOrdenNoDelMensajero());

    // Mutacion que mata: recortar por la `zona_id` DEL USUARIO mensajero. Esta orden es de zonaA
    // y su unica gestion la hizo alguien de zonaB: con ese recorte, desaparece.
    expect(
      buckets.get("rechazada"),
      "se perdio una orden de SU zona por haberla gestionado un mensajero de otra",
    ).toBe(1);
  });

  it("D9 · y NO ve la de la otra zona, gestionada por ESE MISMO mensajero", async () => {
    const buckets = porStatus(await zonaDeLaOrdenNoDelMensajero());

    // La otra mitad del bicondicional. Con el recorte por la zona del mensajero, esta SI entraria
    // (mensajero1 es de zonaB... y tambien lo seria si el recorte fuera por el mensajero a secas).
    expect(
      buckets.get("entregada"),
      "entro una orden de OTRA zona porque la gestiono el mismo mensajero",
    ).toBeUndefined();

    expect(cargadas(await zonaDeLaOrdenNoDelMensajero()), "el universo del satelite cambio").toBe(
      1 + PROPIAS_SIN_GESTION,
    );
  });
});
