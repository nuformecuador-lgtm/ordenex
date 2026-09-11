import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { conPushWeb } from "@/lib/notificaciones/notificacion-repo-con-push";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { EnqueueOpts, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import type { IPushNotificacionReader } from "@/lib/interfaces/repositories/IPushNotificacionReader";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestEnEsquema,
  etiquetasDeEnum,
} from "./_postgres-real";

// FICHA 410 (T1.5, R7) — EL CUPO DEL DIA SOBREVIVE A DOS EMISIONES SIMULTANEAS.
//
// ---------------------------------------------------------------------------------------------
// POR QUE ESTE ARCHIVO ES APARTE, Y POR QUE NO PUEDE CORRER DENTRO DE UNA TRANSACCION
// ---------------------------------------------------------------------------------------------
// Es la propiedad que justifica el diseno entero: la regla «uno al dia por tipo» NO es una rama de
// codigo, es un INDICE UNICO. Y una carrera solo se puede medir con DOS CONEXIONES DE VERDAD que
// commitean: dentro de una sola transaccion revertida no hay carrera que medir, porque las dos
// «emisiones» verian la misma instantanea.
//
// ⚠️ COMO SE EVITA ENSUCIAR LA BASE COMPARTIDA. Se crea un ESQUEMA DESECHABLE con un clon
// estructural de `push_envio_dia` (`CREATE TABLE ... LIKE ... INCLUDING ALL`, que copia el indice
// unico) y los dos clientes se apuntan a el con `PrismaPgOptions.schema`. El `CREATE TABLE LIKE` NO
// copia las claves ajenas, asi que no hace falta sembrar usuarios reales. Al terminar,
// `DROP SCHEMA ... CASCADE`. Tecnica tomada de `job-repository-claim-concurrente.int.test.ts`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PREFIJO = "t410_cupo_";
const ESQUEMA = `${PREFIJO}${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;

const AHORA = new Date("2026-09-12T18:00:00.000Z"); // 12:00 CR del 2026-09-12
const USUARIO = "u-mensajero-carrera";

const ENTRADA: CrearNotificacionInput = {
  tipo: "alert",
  evento: "cierre_dia_vencido",
  descripcion: "Tu cierre venció.",
  anexo: null,
  entidadTipo: "cierre_dia",
  entidadId: "c-1",
  destinatario: { tipo: "usuario", usuarioId: USUARIO },
};

/** Repositorio base que NO toca la base: lo que se mide aqui es el CUPO, no el aviso. */
function repoBase(id: string): INotificacionRepository {
  return {
    crear: async () => id,
    existeNoLeidaPara: async () => false,
    listarParaUsuario: async () => [],
    verificarVisible: async () => "visible",
    marcarTodasLeidas: async () => 0,
    descartar: async () => undefined,
  };
}

/** Lector que devuelve SIEMPRE el mismo destinatario: el mensajero de la carrera. */
const lector: IPushNotificacionReader = {
  leerAviso: async () => null,
  destinatariosPendientes: async () => [{ usuarioId: USUARIO, rol: "mensajero", zonaId: null }],
};

/** Un lector con OTRO destinatario: cada caso de este archivo necesita su propio cupo. */
function lectorDe(usuarioId: string): IPushNotificacionReader {
  return {
    leerAviso: async () => null,
    destinatariosPendientes: async () => [{ usuarioId, rol: "mensajero", zonaId: null }],
  };
}

// ---------------------------------------------------------------------------------------------
// LA BARRERA, Y POR QUE VA DENTRO DEL CAMINO REAL
// ---------------------------------------------------------------------------------------------
// El caso `Promise.all` de mas abajo afirma «un cupo, un encolado», y eso se cumple TAMBIEN si las
// dos llamadas se serializan solas — que es lo que pasa en esta maquina, medido 5 de 5. O sea que
// por si solo NO mide la ventana. Y el caso de la mutacion a pelo mide una propiedad del MOTOR y
// del INDICE, no del codigo de produccion: es indiferente a lo que haga `tomarCupoDelDia`.
//
// Lo que falta, y es lo que hay aqui: forzar la ventana DENTRO del camino real. `PushSuscripcionRepository`
// recibe un `Pick<PrismaClient, "pushSuscripcion" | "pushEnvioDia">`, asi que hay costura para
// envolver el cliente sin tocar una linea de produccion.
//
// ⚠️ LA BARRERA VA EN `create` Y NO EN `findFirst`, A PROPOSITO. `create` lo llaman las DOS
// versiones —la buena y la de comprobar-antes—, asi que el caso no puede quedarse colgado contra la
// implementacion buena. Una barrera en `findFirst` no la ejecutaria nadie con el codigo bueno y el
// caso moriria por timeout en vez de por su asercion.

/** El cliente minimo que `PushSuscripcionRepository` consume, leido de SU constructor. */
type ClienteDelCanal = ConstructorParameters<typeof PushSuscripcionRepository>[0];

interface Barrera {
  /** Se bloquea hasta que han llegado `cuantos`. */
  esperar(): Promise<void>;
  /** `true` SOLO si la abrieron las llegadas; `false` si la abrio el tope de seguridad. */
  readonly abiertaPorLlegadas: boolean;
  readonly llegadas: number;
}

/**
 * Compuerta de N llegadas. Nadie pasa hasta que han llegado todos.
 *
 * El tope de seguridad NO es decoracion: si una implementacion futura dejara de llamar a `create`
 * en uno de los dos caminos, sin el tope este archivo se colgaria hasta el timeout de vitest y el
 * rojo no diria por que. Con el, la compuerta se abre, `abiertaPorLlegadas` queda en `false` y el
 * caso falla NOMBRANDO la causa.
 */
function crearBarrera(cuantos: number, topeMs = 15_000): Barrera {
  let llegadas = 0;
  let porLlegadas = false;
  let abrir: () => void = () => {};
  const compuerta = new Promise<void>((r) => {
    abrir = r;
  });
  const tope = setTimeout(() => abrir(), topeMs);
  tope.unref?.();
  return {
    get abiertaPorLlegadas() {
      return porLlegadas;
    },
    get llegadas() {
      return llegadas;
    },
    async esperar(): Promise<void> {
      llegadas += 1;
      if (llegadas >= cuantos) {
        porLlegadas = true;
        clearTimeout(tope);
        abrir();
      }
      await compuerta;
    },
  };
}

/**
 * El cliente REAL, con `pushEnvioDia.create` retenido en la barrera y TODO lo demas intacto.
 *
 * El `bind` es necesario: las funciones del cliente de Prisma necesitan su `this`, y devolverlas
 * desatadas del proxy las rompe en silencio (misma tecnica que `clienteConSavepoint`).
 */
function clienteConBarreraEnCreate(cliente: PrismaClient, barrera: Barrera): ClienteDelCanal {
  const envioDia = new Proxy(cliente.pushEnvioDia as object, {
    get(objetivo, prop) {
      if (prop === "create") {
        return async (args: unknown) => {
          await barrera.esperar();
          const crear = Reflect.get(objetivo, prop) as (a: unknown) => Promise<unknown>;
          return crear.call(objetivo, args);
        };
      }
      const valor = Reflect.get(objetivo, prop) as unknown;
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
  return {
    pushSuscripcion: cliente.pushSuscripcion,
    pushEnvioDia: envioDia as PrismaClient["pushEnvioDia"],
  };
}

/** Cola compartida por las dos emisiones, con la idempotencia real del `enqueue`. */
class ColaCompartida {
  readonly encolados: { tipo: JobTipo; payload: Record<string, unknown> }[] = [];
  private readonly claves = new Set<string>();
  async enqueue(
    tipo: JobTipo,
    payload: Record<string, unknown>,
    opts?: EnqueueOpts,
  ): Promise<JobDTO | null> {
    if (opts?.dedupeKey !== undefined) {
      if (this.claves.has(opts.dedupeKey)) return null;
      this.claves.add(opts.dedupeKey);
    }
    this.encolados.push({ tipo, payload });
    return null;
  }
}

describeSiHayBase("410/R7 — dos emisiones SIMULTANEAS dejan UN cupo y UN encolado", () => {
  let admin: PrismaClient;
  let clienteA: PrismaClient;
  let clienteB: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    // Barrido de esquemas huerfanos de corridas ANTIGUAS (> 1 h). Por edad y no por prefijo a
    // secas: dos archivos de test corren en paralelo y un barrido ciego se llevaria el esquema de
    // una corrida VIVA a mitad de su medicion.
    const previos = await admin.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${PREFIJO}%'`,
    );
    const haceUnaHora = Date.now() - 3_600_000;
    for (const { nspname } of previos) {
      const sello = Number.parseInt(nspname.slice(PREFIJO.length).split("_")[0], 36);
      if (Number.isNaN(sello) || sello >= haceUnaHora) continue;
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }

    await admin.$executeRawUnsafe(`CREATE SCHEMA "${ESQUEMA}"`);
    // Clon ESTRUCTURAL de la tabla real: la clave primaria y el indice unico `push_envio_dia_cupo`
    // viajan con `INCLUDING ALL`. No es una aproximacion escrita a mano — es la restriccion de
    // produccion. (`LIKE` NO copia las claves ajenas, que es justo lo que interesa: asi no hace
    // falta sembrar usuarios reales en la base compartida.)
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA}"."push_envio_dia" (LIKE "public"."push_envio_dia" INCLUDING ALL)`,
    );

    // ⚠️ EL ENUM HAY QUE CLONARLO TAMBIEN, y no es un capricho: el cliente de Prisma CUALIFICA el
    // tipo con el esquema del adaptador, asi que emite `$3::"<esquema>"."notificacion_evento"` y
    // sin ese tipo la insercion muere con «no existe el tipo». Los valores se leen del enum REAL y
    // en su orden: una lista escrita a mano aqui caducaria con la siguiente ficha que anada un
    // evento, y lo haria en silencio.
    // FICHA 421 — y aqui el olvido mordia DOS veces: este archivo es uno de los que CREA un
    // segundo `notificacion_evento` en un esquema temporal. Leyendo sin acotar, se habria clonado
    // a si mismo DUPLICADO y el `CREATE TYPE` de abajo habria muerto con «label already exists».
    const valores = await etiquetasDeEnum(admin, "notificacion_evento");
    expect(valores.length, "el enum `notificacion_evento` no se pudo leer").toBeGreaterThan(10);
    const lista = valores.map((v) => `'${v}'`).join(", ");
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${ESQUEMA}"."notificacion_evento" AS ENUM (${lista})`,
    );
    await admin.$executeRawUnsafe(
      `ALTER TABLE "${ESQUEMA}"."push_envio_dia"
         ALTER COLUMN "evento" TYPE "${ESQUEMA}"."notificacion_evento"
         USING ("evento"::text::"${ESQUEMA}"."notificacion_evento")`,
    );

    clienteA = crearPrismaDeTestEnEsquema(ESQUEMA);
    clienteB = crearPrismaDeTestEnEsquema(ESQUEMA);
  });

  afterAll(async () => {
    await clienteA?.$disconnect();
    await clienteB?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA}" CASCADE`);
    await admin.$disconnect();
  });

  it("autocomprobacion: el clon trae el indice unico del cupo", async () => {
    // Sin el indice, TODO este archivo saldria verde sin haber medido nada: dos inserciones
    // entrarian tan ricamente y el test de abajo se quedaria sin propiedad que comprobar.
    const indices = await admin.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'push_envio_dia'`,
      ESQUEMA,
    );
    const unicos = indices.filter((i) => i.indexdef.includes("UNIQUE"));
    expect(unicos.length).toBeGreaterThanOrEqual(1);
    expect(unicos.map((i) => i.indexdef).join(" ")).toMatch(/usuario_id.*evento.*dia_cr/);
  });

  it("autocomprobacion: el repositorio REAL escribe en el esquema desechable", async () => {
    // Sin esto, un fallo de escritura quedaria ABSORBIDO por `emitirBestEffort` y el caso de la
    // carrera saldria «0 cupos» sin decir por que. Aqui la excepcion, si la hay, se ve.
    const repo = new PushSuscripcionRepository(clienteA);
    const gano = await repo.tomarCupoDelDia({
      usuarioId: "u-autocomprobacion",
      evento: "cierre_dia_vencido",
      diaCr: "2026-09-12",
      notificacionId: "n-auto",
    });
    expect(gano).toBe(true);
    expect(await repo.usuariosConCupoDe("n-auto")).toEqual(["u-autocomprobacion"]);
  });

  it("⭑ `Promise.all` de dos emisiones sobre DOS CONEXIONES: un cupo, un encolado", async () => {
    const cola = new ColaCompartida();
    const decorado = (cliente: PrismaClient, notificacionId: string) =>
      conPushWeb(repoBase(notificacionId), {
        lector,
        canal: new PushSuscripcionRepository(cliente),
        cola,
        hayCanal: () => true,
        now: () => AHORA,
      });

    // Las dos arrancan SIN esperar a la otra: es la carrera, no una secuencia. Cada una lleva su
    // propia conexion y su propio aviso (dos productores creando el primer aviso elegible del dia
    // para la MISMA persona y el MISMO evento).
    const [a, b] = await Promise.all([
      decorado(clienteA, "n-A").crear(ENTRADA),
      decorado(clienteB, "n-B").crear({ ...ENTRADA, entidadId: "c-2" }),
    ]);

    // Los DOS avisos se crean: la campana los tiene los dos, y eso esta bien.
    expect(a).toBe("n-A");
    expect(b).toBe("n-B");

    // Pero el telefono suena UNA vez.
    const cupos = await clienteA.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA}"."push_envio_dia"
        WHERE "usuario_id" = $1 AND "evento" = 'cierre_dia_vencido'
          AND "dia_cr" = '2026-09-12'`,
      USUARIO,
    );
    expect(Number(cupos[0].n), "EXACTAMENTE una fila de cupo").toBe(1);
    expect(cola.encolados, "EXACTAMENTE un encolado").toHaveLength(1);

    // Y el encolado es el del aviso que GANO el cupo, no «uno cualquiera».
    const ganador = await clienteA.$queryRawUnsafe<{ notificacion_id: string }[]>(
      `SELECT "notificacion_id" FROM "${ESQUEMA}"."push_envio_dia" WHERE "usuario_id" = $1`,
      USUARIO,
    );
    expect(cola.encolados[0].payload).toEqual({ notificacionId: ganador[0].notificacion_id });
  });

  it("⭑⭑ R7: con las DOS conexiones retenidas en `create`, sale UN cupo y UN encolado", async () => {
    // ESTE es el control del caso de arriba, y el unico de este archivo que pone a prueba
    // `tomarCupoDelDia` EN LA VENTANA. La barrera esta DENTRO del camino real —el repositorio de
    // produccion, el decorador de produccion, el indice unico de produccion—: lo unico envuelto es
    // el cliente de Prisma, por la costura que el propio constructor declara.
    //
    // QUE MIDE, Y QUE PASA SI EL CODIGO CAMBIA:
    //
    //   codigo bueno (INSERTAR y traducir P2002)   -> los dos `create` corren A LA VEZ, uno se
    //                                                 lleva el P2002 -> 1 cupo, 1 encolado. VERDE.
    //   comprobar-antes (SELECT y luego INSERT)    -> los dos leyeron cero ANTES de la barrera y
    //                                                 los dos devuelven `true` -> 1 cupo (lo impide
    //                                                 el indice) pero DOS ENCOLADOS. ROJO.
    //
    // O sea: lo que separa las dos implementaciones NO es el numero de filas —el indice salva a las
    // dos— sino el numero de ENCOLADOS, que es lo que el telefono nota. Por eso la asercion que
    // manda aqui es `toHaveLength(1)` sobre la cola.
    const usuario = "u-mensajero-barrera";
    const barrera = crearBarrera(2);
    const cola = new ColaCompartida();

    const entrada: CrearNotificacionInput = {
      ...ENTRADA,
      destinatario: { tipo: "usuario", usuarioId: usuario },
    };

    const decorado = (cliente: PrismaClient, notificacionId: string) =>
      conPushWeb(repoBase(notificacionId), {
        lector: lectorDe(usuario),
        // El repositorio REAL, con el cliente REAL; lo unico interpuesto es la espera.
        canal: new PushSuscripcionRepository(clienteConBarreraEnCreate(cliente, barrera)),
        cola,
        hayCanal: () => true,
        now: () => AHORA,
      });

    const [a, b] = await Promise.all([
      decorado(clienteA, "n-barrera-A").crear({ ...entrada, entidadId: "c-3" }),
      decorado(clienteB, "n-barrera-B").crear({ ...entrada, entidadId: "c-4" }),
    ]);

    // AUTOCOMPROBACION, y es la que impide que este caso se convierta en el de arriba: las DOS
    // conexiones llegaron a `create` ANTES de que ninguna ejecutara. Si se hubieran serializado
    // —o si una de las dos no hubiese llegado a `create`— la compuerta la habria abierto el tope
    // de seguridad y esto seria `false`: el caso falla diciendo QUE no midio, en vez de pasar en
    // verde sin haber medido nada.
    expect(
      barrera.abiertaPorLlegadas,
      "la compuerta la abrio el TOPE, no las llegadas: las dos conexiones no coincidieron en " +
        "`create` y este caso no ha medido la ventana",
    ).toBe(true);
    expect(barrera.llegadas, "las dos emisiones tienen que haber llamado a `create`").toBe(2);

    // Los dos avisos existen: la campana los tiene los dos, igual que en el caso de arriba.
    expect(a).toBe("n-barrera-A");
    expect(b).toBe("n-barrera-B");

    // Una fila de cupo: la exclusion la hace el indice, no una rama de codigo.
    const cupos = await clienteA.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA}"."push_envio_dia"
        WHERE "usuario_id" = $1 AND "evento" = 'cierre_dia_vencido'
          AND "dia_cr" = '2026-09-12'`,
      usuario,
    );
    expect(Number(cupos[0].n), "EXACTAMENTE una fila de cupo").toBe(1);

    // ⭑ LA ASERCION QUE MATA LA MUTACION. Con comprobar-antes salen DOS.
    expect(
      cola.encolados,
      "EXACTAMENTE un encolado: si `tomarCupoDelDia` decidiera con un `SELECT` previo, las dos " +
        "emisiones se creerian ganadoras y el telefono sonaria dos veces",
    ).toHaveLength(1);

    // Y el encolado es el del aviso que GANO el cupo, no «uno cualquiera».
    const ganador = await clienteA.$queryRawUnsafe<{ notificacion_id: string }[]>(
      `SELECT "notificacion_id" FROM "${ESQUEMA}"."push_envio_dia" WHERE "usuario_id" = $1`,
      usuario,
    );
    expect(cola.encolados[0].payload).toEqual({ notificacionId: ganador[0].notificacion_id });
  });

  it("⭑ MUTACION: `SELECT`-y-luego-`INSERT` deja pasar a los dos", async () => {
    // La mutacion obligatoria de T1.5, reproducida A PELO contra el MISMO motor y el MISMO indice:
    // se sustituye la toma por la version «comprobar antes», con las dos conexiones abriendo su
    // transaccion a la vez. Entre el `SELECT` y el `INSERT` cabe la otra transaccion entera.
    //
    // Lo que este caso demuestra NO es que el codigo este mal: demuestra que la carrera EXISTE de
    // verdad en esta base y que por tanto el caso de arriba esta midiendo algo. Sin esto, un
    // «exactamente uno» podria deberse a que las dos llamadas se serializaron solas.
    const usuario = "u-mutacion-select-primero";
    /** Lo que cada conexion LEYO antes de escribir. Es donde se ve la ventana. */
    const leyeronCero: boolean[] = [];

    // BARRERA: las dos conexiones hacen su `SELECT` y NINGUNA escribe hasta que las dos han leido.
    // No es una trampa para ganar el caso: es la reproduccion fiel de lo que pasa en produccion,
    // donde las dos peticiones llegan a la vez y las dos leen antes de que ninguna haya escrito.
    // Sin la barrera, el resultado depende de cuanto tarde en abrirse la segunda conexion, que es
    // ruido de la maquina y no una propiedad del sistema.
    let listas = 0;
    let abrirCompuerta: () => void = () => {};
    const compuerta = new Promise<void>((r) => {
      abrirCompuerta = r;
    });
    const esperarALaOtra = async () => {
      listas += 1;
      if (listas === 2) abrirCompuerta();
      await compuerta;
    };

    const comprobarYLuegoInsertar = async (cliente: PrismaClient, notificacionId: string) => {
      const previos = await cliente.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA}"."push_envio_dia"
          WHERE "usuario_id" = $1 AND "evento" = 'cierre_dia_vencido'
            AND "dia_cr" = '2026-09-12'`,
        usuario,
      );
      const cero = Number(previos[0].n) === 0;
      leyeronCero.push(cero);
      await esperarALaOtra();
      if (!cero) return "no-lo-intento";
      try {
        await cliente.$executeRawUnsafe(
          `INSERT INTO "${ESQUEMA}"."push_envio_dia"
             ("id","usuario_id","evento","dia_cr","notificacion_id","created_at")
           VALUES ($1,$2,'cierre_dia_vencido','2026-09-12',$3,CURRENT_TIMESTAMP)`,
          randomUUID(),
          usuario,
          notificacionId,
        );
        return "inserto";
      } catch {
        // El indice unico REAL sigue ahi y ataja el segundo `INSERT`: ese es exactamente el
        // trabajo que la mutacion le delega sin saberlo, y por eso la version buena no consulta.
        return "rebotado-por-el-indice";
      }
    };

    const desenlaces = await Promise.all([
      comprobarYLuegoInsertar(clienteA, "n-mut-A"),
      comprobarYLuegoInsertar(clienteB, "n-mut-B"),
    ]);

    // ⚠️ LO QUE ESTE CASO DEMUESTRA, Y ES LO QUE LE DA SENTIDO AL DE ARRIBA: las DOS conexiones
    // leyeron CERO. O sea, la comprobacion previa NO EXCLUYE A NADIE — las dos se creyeron con
    // derecho a empujar. Si el cupo dependiera de ese `SELECT`, el telefono habria sonado dos
    // veces; lo unico que lo impide es el indice.
    expect(leyeronCero, "las dos conexiones tienen que haber leido cero").toEqual([true, true]);
    expect(desenlaces.sort()).toEqual(["inserto", "rebotado-por-el-indice"]);

    const cupos = await clienteA.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA}"."push_envio_dia" WHERE "usuario_id" = $1`,
      usuario,
    );
    expect(Number(cupos[0].n)).toBe(1);
  });
});
