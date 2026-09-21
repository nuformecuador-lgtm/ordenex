import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { PRISMA_OMIT } from "@/lib/db/prisma-client";
import { urlDeBaseDeDatos } from "./_postgres-real";

/**
 * FICHA 450 (design §3.1) — CONTADOR DE CONSULTAS EN VUELO **POR CONEXION FISICA**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El defecto que la 450 ataca es que dos consultas salen **a la vez** sobre la conexion de la
 * transaccion que aprueba un cierre. Eso NO lo puede medir un doble: los `buildTx` de
 * `tests/unit/services/wallet-feed-service.test.ts` y de su hermana de tienda son mocks que
 * resuelven al instante, y para ellos «en serie» y «en paralelo» son la misma cosa. Por eso el
 * defecto llevaba meses invisible con las dos suites en verde.
 *
 * Lo unico que distingue las dos formas es la CONEXION: `@prisma/adapter-pg` da una
 * `pg.PoolClient` **dedicada** a cada `$transaction` interactivo y reparte conexiones distintas
 * del pool a las consultas sueltas (design §2.1). Asi que se mide donde vive la diferencia: se
 * envuelve `pool.connect()` y, en cada conexion que salga, se envuelve `client.query()`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * QUE CUENTA, EXACTAMENTE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Una consulta esta EN VUELO desde que alguien llama a `client.query(...)` hasta que su promesa
 * (o su callback) termina. El contador sube al entrar y baja al salir, por conexion. Si en algun
 * instante una misma conexion tiene 2 o mas, queda anotado un SOLAPE con los SQL implicados.
 *
 * Esta es la ASERCION PRINCIPAL de R1/R2, y lo es a proposito: es determinista y repetible. El
 * aviso de `pg` («Calling client.query() when the client is already executing a query») es la
 * secundaria e informativa, porque `util.deprecate` lo emite **una sola vez por proceso** y hace
 * falta que la cola YA tuviera algo al encolar, o sea una TERCERA consulta (design §2.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE NO SE CONSTRUYE AQUI UN `pg.Pool` PROPIO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El design (§3.1) lo describia asi porque `PrismaPg` acepta `pg.Pool | pg.PoolConfig | string`.
 * Pero **`pg` no es una dependencia declarada de este repo** (entra como transitiva de
 * `@prisma/adapter-pg`): importarlo desde un test seria un import no declarado, justo lo que
 * vigila `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts`.
 *
 * Se instrumenta el pool que construye el propio adaptador, que es equivalente y ademas MAS fiel:
 * la configuracion del pool es la que Prisma habria usado, no una copia escrita a mano que podria
 * divergir. Se llega a el por `PrismaPgAdapter.underlyingDriver()`, que es API publica del
 * adaptador (`dist/index.d.ts`).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AUTOCOMPROBACION (obligatoria)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un contador que no cuenta reporta CERO solapes y deja verde para siempre cualquier test que lo
 * use — el modo de fallo exacto del arnes de mutaciones que reporto 9/9 supervivientes sin haber
 * ejecutado un test. Por eso todo archivo que use esta sonda **debe** incluir su control POSITIVO:
 * un `Promise.all` deliberado de dos consultas sobre la misma conexion, que tiene que dar
 * `maximoEnVuelo === 2` y un solape anotado. Si ese caso sale verde con 1, la sonda esta rota y
 * las demas aserciones de ese archivo no valen nada.
 */

/** Una consulta tal y como salio hacia el servidor, con la conexion por la que salio. */
export interface ConsultaVista {
  /** Identificador estable de la conexion fisica (1, 2, 3…), asignado al salir del pool. */
  conexion: number;
  /** El SQL, tal cual. */
  sql: string;
}

/** Dos o mas consultas coincidiendo en el tiempo sobre UNA conexion. Es lo que R3 prohibe. */
export interface SolapeVisto {
  conexion: number;
  /** Cuantas habia en vuelo en el instante del solape (>= 2). */
  enVuelo: number;
  /** Los SQL que coincidian, en orden de llegada. */
  sqls: string[];
  /** El bloque del test que corria cuando se anoto. */
  bloque: string;
  /**
   * Las lineas de `lib/` de la pila en el momento del solape: es lo que permite NOMBRAR el
   * emisor con archivo y linea (R11) en vez de describirlo. Se captura solo cuando hay solape,
   * asi que no cuesta nada en el camino normal.
   */
  pila: string[];
}

/** Un aviso de `pg`, con el bloque que corria al capturarlo. */
export interface AvisoVisto {
  bloque: string;
  mensaje: string;
}

export interface SondaDeConsultas {
  /** Toda consulta emitida, en orden. Sirve de ESPIA para el anti-vacio. */
  readonly consultas: ConsultaVista[];
  /** Los solapes anotados. Vacio = ninguna conexion tuvo dos consultas a la vez. */
  readonly solapes: SolapeVisto[];
  /**
   * Avisos de proceso capturados cuyo texto es el del defecto (asercion SECUNDARIA).
   *
   * ⚠️ `util.deprecate` avisa UNA SOLA VEZ POR PROCESO (design §2.2 y §7 mina 5): si dos bloques
   * del mismo archivo provocan la condicion, solo el PRIMERO lo vera. Por eso cada aviso viaja
   * con el nombre del bloque que corria, y por eso la asercion que decide es el contador.
   */
  readonly avisos: AvisoVisto[];
  /** Etiqueta del bloque en curso; se adjunta a solapes y avisos. */
  bloque: string;
  /** El maximo de consultas simultaneas visto sobre una misma conexion. 0 si no hubo ninguna. */
  maximoEnVuelo(): number;
  /** El maximo visto sobre la conexion por la que salio `sqlParcial` (comparacion por inclusion). */
  maximoEnVueloDeLaConexionDe(sqlParcial: string): number;
  /** Cuantas conexiones fisicas distintas se usaron. */
  conexionesUsadas(): number;
  /** Cuantas consultas emitidas contienen `sqlParcial`. Anti-vacio. */
  cuantasConteniendo(sqlParcial: string): number;
  /** Borra lo acumulado (consultas, solapes, maximos). No toca los avisos ya capturados. */
  limpiar(): void;
}

/**
 * Las lineas de la pila que caen en codigo del repo (`lib/`, `app/`, `tests/`), sin
 * `node_modules`. Sirve para NOMBRAR el emisor de un solape con archivo y linea.
 */
function pilaDeCodigoPropio(): string[] {
  const pila = new Error().stack ?? "";
  return pila
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /[\\/](lib|app|tests)[\\/]/.test(l) && !l.includes("node_modules"))
    .slice(0, 6);
}

interface EstadoDeConexion {
  id: number;
  enVuelo: string[];
  maximo: number;
}

const MARCA_INSTRUMENTADA = Symbol("450/conexion-instrumentada");

/** El texto exacto del aviso de `pg@8.22.0` (`lib/client.js:34-37`). */
export const TEXTO_DEL_AVISO =
  "Calling client.query() when the client is already executing a query";

type ClienteDePg = {
  query: (...args: unknown[]) => unknown;
  [MARCA_INSTRUMENTADA]?: boolean;
};

type PoolDePg = {
  connect: (...args: unknown[]) => unknown;
  [MARCA_INSTRUMENTADA]?: boolean;
};

/** El SQL de lo que `pg` recibe: un string, o un objeto de configuracion con `text`. */
function sqlDe(primerArgumento: unknown): string {
  if (typeof primerArgumento === "string") return primerArgumento;
  if (primerArgumento !== null && typeof primerArgumento === "object") {
    const texto = (primerArgumento as { text?: unknown }).text;
    if (typeof texto === "string") return texto;
  }
  return "(sql no legible)";
}

class Sonda implements SondaDeConsultas {
  readonly consultas: ConsultaVista[] = [];
  readonly solapes: SolapeVisto[] = [];
  readonly avisos: AvisoVisto[] = [];
  bloque = "(sin bloque)";
  private readonly estados = new Map<number, EstadoDeConexion>();
  private siguienteId = 0;

  nuevaConexion(): EstadoDeConexion {
    this.siguienteId += 1;
    const estado: EstadoDeConexion = { id: this.siguienteId, enVuelo: [], maximo: 0 };
    this.estados.set(estado.id, estado);
    return estado;
  }

  entra(estado: EstadoDeConexion, sql: string): void {
    estado.enVuelo.push(sql);
    this.consultas.push({ conexion: estado.id, sql });
    if (estado.enVuelo.length > estado.maximo) estado.maximo = estado.enVuelo.length;
    if (estado.enVuelo.length >= 2) {
      this.solapes.push({
        conexion: estado.id,
        enVuelo: estado.enVuelo.length,
        sqls: [...estado.enVuelo],
        bloque: this.bloque,
        pila: pilaDeCodigoPropio(),
      });
    }
  }

  sale(estado: EstadoDeConexion, sql: string): void {
    const i = estado.enVuelo.indexOf(sql);
    if (i >= 0) estado.enVuelo.splice(i, 1);
  }

  maximoEnVuelo(): number {
    let max = 0;
    for (const e of this.estados.values()) if (e.maximo > max) max = e.maximo;
    return max;
  }

  maximoEnVueloDeLaConexionDe(sqlParcial: string): number {
    const vista = this.consultas.find((c) => c.sql.includes(sqlParcial));
    if (vista === undefined) return 0;
    return this.estados.get(vista.conexion)?.maximo ?? 0;
  }

  conexionesUsadas(): number {
    let usadas = 0;
    for (const e of this.estados.values()) if (e.maximo > 0) usadas += 1;
    return usadas;
  }

  cuantasConteniendo(sqlParcial: string): number {
    return this.consultas.filter((c) => c.sql.includes(sqlParcial)).length;
  }

  limpiar(): void {
    this.consultas.length = 0;
    this.solapes.length = 0;
    for (const e of this.estados.values()) {
      e.enVuelo.length = 0;
      e.maximo = 0;
    }
  }
}

/**
 * Envuelve `client.query` de UNA conexion fisica. Soporta las dos formas de `pg`: la de promesa
 * (la que usa `PgQueryable.performIO`) y la de callback (la que usa `pool.query`, que llama a
 * `client.query(text, values, cb)`). Si solo se cubriera la de promesa, las consultas del cliente
 * AGRUPADO —justo las del control negativo R2— no se contarian y el test saldria verde vacio.
 */
function instrumentarConexion(cliente: ClienteDePg, sonda: Sonda): void {
  if (cliente[MARCA_INSTRUMENTADA] === true) return;
  cliente[MARCA_INSTRUMENTADA] = true;

  const estado = sonda.nuevaConexion();
  const original = cliente.query.bind(cliente) as (...args: unknown[]) => unknown;

  cliente.query = (...args: unknown[]): unknown => {
    const sql = sqlDe(args[0]);
    const posicionCallback = args.findIndex((a) => typeof a === "function");
    sonda.entra(estado, sql);

    if (posicionCallback >= 0) {
      const callback = args[posicionCallback] as (...r: unknown[]) => unknown;
      const conSalida = (...r: unknown[]): unknown => {
        sonda.sale(estado, sql);
        return callback(...r);
      };
      const copia = [...args];
      copia[posicionCallback] = conSalida;
      return original(...copia);
    }

    let salida: unknown;
    try {
      salida = original(...args);
    } catch (error) {
      sonda.sale(estado, sql);
      throw error;
    }
    if (salida !== null && typeof salida === "object" && "then" in salida) {
      return (salida as Promise<unknown>).then(
        (valor) => {
          sonda.sale(estado, sql);
          return valor;
        },
        (error: unknown) => {
          sonda.sale(estado, sql);
          throw error;
        },
      );
    }
    // Forma «submittable» (`client.query(new Query(...))`): no la usa ni Prisma ni `pool.query`,
    // pero si apareciera, contarla como instantanea es mejor que dejar el contador colgado en alto
    // y fabricar solapes que no existen.
    sonda.sale(estado, sql);
    return salida;
  };
}

/** Envuelve `pool.connect` para alcanzar cada conexion fisica antes de su primera consulta. */
function instrumentarPool(pool: PoolDePg, sonda: Sonda): void {
  if (pool[MARCA_INSTRUMENTADA] === true) return;
  pool[MARCA_INSTRUMENTADA] = true;
  const original = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  pool.connect = (...args: unknown[]): unknown => {
    const posicionCallback = args.findIndex((a) => typeof a === "function");
    if (posicionCallback >= 0) {
      const callback = args[posicionCallback] as (...r: unknown[]) => unknown;
      const copia = [...args];
      copia[posicionCallback] = (error: unknown, cliente: unknown, soltar: unknown): unknown => {
        if (error === undefined || error === null) {
          instrumentarConexion(cliente as ClienteDePg, sonda);
        }
        return callback(error, cliente, soltar);
      };
      return original(...copia);
    }
    return (original(...args) as Promise<unknown>).then((cliente) => {
      instrumentarConexion(cliente as ClienteDePg, sonda);
      return cliente;
    });
  };
}

/** Una conexion fisica sacada del pool a mano, para el control POSITIVO de la propia sonda. */
export interface ConexionDirecta {
  query: (sql: string) => Promise<unknown>;
  release: () => void;
}

export interface PrismaContado {
  prisma: PrismaClient;
  sonda: SondaDeConsultas;
  /**
   * Una conexion del pool YA instrumentado, sin pasar por Prisma. Es la unica forma de probar
   * que el CONTADOR sabe ver un solape sin que la prueba dependa de lo que Prisma haga por
   * dentro: si esto no da 2, la sonda esta rota y ninguna otra asercion del archivo vale.
   *
   * Requiere que el pool exista: llamar despues de al menos una consulta por `prisma`.
   */
  conexionDirecta: () => Promise<ConexionDirecta>;
  /** Cierra el cliente y desengancha el oyente de avisos. Llamar SIEMPRE en `afterAll`. */
  cerrar: () => Promise<void>;
}

/**
 * Un `PrismaClient` con el mismo `omit` de produccion cuyas consultas quedan contadas por
 * conexion, mas la captura del aviso de `pg`.
 *
 * `max` replica `DB_POOL_MAX` de produccion (`lib/db/prisma-client.ts:21`): con 3 conexiones, dos
 * consultas sueltas concurrentes tienen a donde ir, que es justo lo que hace legitimo el
 * `Promise.all` sobre el cliente agrupado y lo que el control negativo (R2) tiene que poder ver.
 */
export function crearPrismaContado(max = 3): PrismaContado {
  const sonda = new Sonda();
  let pool: PoolDePg | null = null;

  const alAvisar = (aviso: Error): void => {
    if (aviso.message.includes(TEXTO_DEL_AVISO)) {
      sonda.avisos.push({ bloque: sonda.bloque, mensaje: aviso.message });
    }
  };
  process.on("warning", alAvisar);

  const fabricaReal = new PrismaPg({ connectionString: urlDeBaseDeDatos(), max });
  const fabrica = {
    provider: fabricaReal.provider,
    adapterName: fabricaReal.adapterName,
    connect: async () => {
      const adaptador = await fabricaReal.connect();
      pool = adaptador.underlyingDriver() as unknown as PoolDePg;
      instrumentarPool(pool, sonda);
      return adaptador;
    },
    connectToShadowDb: () => fabricaReal.connectToShadowDb(),
  };

  const prisma = new PrismaClient({
    adapter: fabrica as unknown as PrismaPg,
    omit: PRISMA_OMIT,
  }) as unknown as PrismaClient;

  return {
    prisma,
    sonda,
    conexionDirecta: async () => {
      if (pool === null) {
        throw new Error(
          "el pool aun no existe: emite al menos una consulta por `prisma` antes de pedir una " +
            "conexion directa (el adaptador lo construye perezosamente)",
        );
      }
      return (await (pool.connect() as Promise<unknown>)) as ConexionDirecta;
    },
    cerrar: async () => {
      process.off("warning", alAvisar);
      await prisma.$disconnect();
    },
  };
}

/** Lo que una corrida de la sonda deja escrito en el log, para pegarlo en `progress/impl_450.md`. */
export function resumenDeLaSonda(etiqueta: string, sonda: SondaDeConsultas): string {
  return [
    `[450] ${etiqueta}:`,
    `  consultas emitidas ......... ${sonda.consultas.length}`,
    `  conexiones usadas .......... ${sonda.conexionesUsadas()}`,
    `  maximo en vuelo/conexion ... ${sonda.maximoEnVuelo()}`,
    `  solapes anotados ........... ${sonda.solapes.length}`,
    `  avisos de pg capturados .... ${sonda.avisos.length}`,
  ].join("\n");
}
