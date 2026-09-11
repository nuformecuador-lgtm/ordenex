// El servicio de la COHORTE DE CARGA: cache de 15 min, sello `lastSync` y los derivados.
//
// Octavo gemelo de la vertical de entregas, con las mismas tres responsabilidades y ninguna
// consulta propia. Depende de DOS puertos neutrales (`ICohorteCargaRepository`,
// `IAnaliticaCache`) y de un reloj inyectable, asi que se ejercita entero en unitario: sin
// `DATABASE_URL` y sin runtime de Next.
//
// LO QUE ESTE SERVICIO DERIVA, Y POR QUE LO DERIVA EL: el repositorio devuelve celdas crudas
// —numerador y denominador, JAMAS el promedio— exactamente como `CicloVidaRepository` devuelve
// `CicloCrudo`. Aqui se agrupan en dias, se suman los totales y se calcula el promedio UNA vez,
// al final. Dos recortes se vuelven a agregar sumando numeradores y denominadores; promediar
// promedios da un numero que no corresponde a nada.
//
// LO QUE ESTE SERVICIO NO HACE: reordenar. El orden de salida —dia DESCENDENTE, la cohorte mas
// reciente primero— lo decide el `ORDER BY` del repositorio y se conserva tal cual. Una serie
// con dos criterios de orden acaba pintandose distinto segun quien la toque al final.

import { claveDeCohorteCarga, TAG_COHORTE_CARGA } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type {
  CohorteCuboCrudo,
  ICohorteCargaRepository,
} from "@/lib/interfaces/repositories/ICohorteCargaRepository";
import type {
  CohorteCargaDTO,
  CohorteCubo,
  CohorteDeDia,
  CohorteDesenlace,
} from "@/lib/types/cohorte-carga";

export interface CohorteCargaServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

/**
 * `segundosAcum / n`, o AUSENTE.
 *
 * Dos motivos distintos para que no haya promedio, y los dos dan `null` y nunca `0` (R16/R17):
 *
 *  - `segundosAcum === null` — el cubo `viva` no tiene reloj que parar. Cero segundos seria una
 *    afirmacion («cerraron al instante») y lo que pasa es que no cerraron;
 *  - `n === 0` — no hay denominador. Un promedio sin denominador no es cero: no existe.
 */
export function promedioDeCubo(segundosAcum: number | null, n: number): number | null {
  if (segundosAcum === null || n === 0) return null;
  return segundosAcum / n;
}

/** Suma dos numeradores conservando la AUSENCIA: `null + null` sigue siendo ausente. */
function sumarNumeradores(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** Acumulador mutable de un cubo mientras se agrega; se congela al salir. */
interface CuboEnCurso {
  n: number;
  segundosAcum: number | null;
}

function cuboDe(desenlace: CohorteDesenlace, acumulado: CuboEnCurso): CohorteCubo {
  return {
    desenlace,
    n: acumulado.n,
    segundosAcum: acumulado.segundosAcum,
    promedioSegundos: promedioDeCubo(acumulado.segundosAcum, acumulado.n),
  };
}

/**
 * Agrupa las celdas crudas en dias, CONSERVANDO el orden en que llegan (descendente).
 *
 * Los cubos con `n = 0` no viajan: un hueco significa cero, y la pantalla —que si conoce los
 * cuatro cubos— los rellena para dibujar sus columnas. El `GROUP BY` de la consulta no puede
 * emitir un grupo vacio, asi que este filtro no tapa ningun caso real: esta para que el
 * contrato del DTO se cumpla venga la fila de donde venga.
 */
function agruparPorDia(filas: readonly CohorteCuboCrudo[]): CohorteDeDia[] {
  const porDia = new Map<string, Map<CohorteDesenlace, CuboEnCurso>>();

  for (const fila of filas) {
    if (fila.n === 0) continue;
    let cubos = porDia.get(fila.fecha);
    if (cubos === undefined) {
      cubos = new Map();
      porDia.set(fila.fecha, cubos);
    }
    const previo = cubos.get(fila.desenlace);
    cubos.set(fila.desenlace, {
      n: (previo?.n ?? 0) + fila.n,
      segundosAcum: sumarNumeradores(previo?.segundosAcum ?? null, fila.segundosAcum),
    });
  }

  return [...porDia.entries()].map(([fecha, cubos]) => ({
    fecha,
    // `cargadas` es la SUMA de los cubos y no una segunda cifra: por construccion los cubos son
    // exhaustivos y excluyentes, asi que esta igualdad es el invariante R11 hecho codigo. Si
    // saliera de otra consulta, una escritura entre las dos dejaria en pantalla un total que no
    // es la suma de lo que hay debajo.
    cargadas: [...cubos.values()].reduce((suma, c) => suma + c.n, 0),
    cubos: [...cubos.entries()].map(([desenlace, acumulado]) => cuboDe(desenlace, acumulado)),
  }));
}

/**
 * El mismo reparto, agregado sobre TODOS los dias. Derivado de las MISMAS filas (R30).
 *
 * Orden alfabetico por desenlace: es una agregacion sin eje temporal, y sin un criterio propio
 * heredaria el del primer dia que aparezca — dos recortes distintos darian los mismos cubos en
 * distinto orden.
 */
function agregarPorDesenlace(dias: readonly CohorteDeDia[]): CohorteCubo[] {
  const totales = new Map<CohorteDesenlace, CuboEnCurso>();

  for (const dia of dias) {
    for (const cubo of dia.cubos) {
      const previo = totales.get(cubo.desenlace);
      totales.set(cubo.desenlace, {
        n: (previo?.n ?? 0) + cubo.n,
        segundosAcum: sumarNumeradores(previo?.segundosAcum ?? null, cubo.segundosAcum),
      });
    }
  }

  return [...totales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([desenlace, acumulado]) => cuboDe(desenlace, acumulado));
}

export class CohorteCargaService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: ICohorteCargaRepository,
    private readonly cache: IAnaliticaCache,
    opts: CohorteCargaServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * La tabla de cohortes de una consulta ya validada, ya recortada y CON RANGO — la misma
   * `ConsultaConteoEntregas` que consumen las otras siete lecturas de la pantalla, de modo que
   * todas respondan al mismo recorte.
   *
   * ⚠ EL ORDEN IMPORTA: **`lastSync` se sella DENTRO del productor**, no fuera. El productor es
   * el unico codigo que corre en un fallo de cache, o sea el unico momento en que se toca la
   * base de verdad. Sellarlo fuera —sobre el valor ya devuelto— escribiria la hora del render en
   * cada ACIERTO, que son todas las peticiones menos la primera de cada ventana de 15 min: la
   * pantalla juraria que la cifra es de este segundo llevando hasta un cuarto de hora de
   * retraso.
   *
   * La clave lleva el ALCANCE y su propio PREFIJO (`claveDeCohorteCarga`), y las dos cosas son
   * seguridad y correccion, no higiene: sin el alcance, la entrada que se cacheo para un admin
   * la serviria un adminTienda; sin el prefijo, esta lectura y las otras siete —que comparten la
   * consulta entera— colisionarian en la MISMA clave con valores de forma distinta.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<CohorteCargaDTO> {
    const clave = claveDeCohorteCarga(consulta);

    return this.cache.envolver<CohorteCargaDTO>(clave, [TAG_COHORTE_CARGA], async () => {
      const filas = await this.repo.contarCohortes(consulta);
      const porDia = agruparPorDia(filas);

      return {
        porDia,
        // Los dos totales se DERIVAN de los mismos dias que viajan, no se piden aparte.
        total: porDia.reduce((suma, dia) => suma + dia.cargadas, 0),
        totalPorDesenlace: agregarPorDesenlace(porDia),
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
