import { loadRastreoPublicoConfig, type RastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import type {
  IRastreoPublicoService,
  ResultadoConsultaRastreo,
} from "@/lib/interfaces/services/IRastreoPublicoService";
import { hitoDeEstatus, type HitoPublico, type HitoPublicoEntrada } from "@/lib/types/rastreo-publico";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

// Feature 229 (design §2.1/§3.3/§3.4) — proyeccion publica de un envio.
//
// Toda la logica de la feature vive aqui y se prueba con dobles: sin Prisma, sin
// `next/headers`, sin HTTP (R33). No importa `OrdenHistorialService` ni su DTO (R24).

/**
 * R8 — centinela para el caso "la guia no existe". La comparacion del segundo factor se
 * ejecuta IGUAL contra este valor, de modo que el trabajo y el tiempo no distingan "no
 * existe" de "factor errado". Es la cadena vacia: normalizada da cero digitos, asi que
 * nunca alcanza el minimo exigido y nunca puede coincidir con un factor valido.
 */
const TELEFONO_CENTINELA = "";

/** Los ultimos `n` caracteres (o la cadena entera si es mas corta). */
function ultimos(texto: string, n: number): string {
  return texto.slice(Math.max(0, texto.length - n));
}

/**
 * R19 — dia Y hora (G12) en la zona horaria del NEGOCIO, que llega por configuracion. Este
 * modulo no contiene ningun literal de zona ni de pais, y una guardia lo comprueba.
 *
 * El locale se fija con extensiones (`u-ca-gregory-nu-latn`) y no con un pais: asi el
 * calendario y los digitos son deterministas en cualquier maquina sin nombrar una region.
 * `longOffset` da el desplazamiento real de esa zona en ESE instante, que es lo que hace
 * que la cadena sea ISO-8601 completa y no una hora ambigua.
 */
function formatearEnZona(instante: Date, zonaHoraria: string): string {
  const partes = new Intl.DateTimeFormat("en-u-ca-gregory-nu-latn", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(instante);

  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  const desfase = valor("timeZoneName").replace("GMT", "");
  return `${valor("year")}-${valor("month")}-${valor("day")}T${valor("hour")}:${valor("minute")}${desfase === "" ? "Z" : desfase}`;
}

/**
 * R18 (G9) — colapsa las rachas consecutivas del mismo hito conservando la fecha de la
 * PRIMERA ocurrencia. Con este mapeo una orden real encadena varias transiciones internas
 * bajo el mismo hito (dos paradas de bodega, por ejemplo), y esa granularidad es geografia
 * interna que el destinatario no necesita.
 */
function colapsarRachas(entradas: readonly HitoPublicoEntrada[]): HitoPublicoEntrada[] {
  const linea: HitoPublicoEntrada[] = [];
  for (const entrada of entradas) {
    if (linea[linea.length - 1]?.hito === entrada.hito) continue;
    linea.push(entrada);
  }
  return linea;
}

export class RastreoPublicoService implements IRastreoPublicoService {
  constructor(
    private readonly repo: IRastreoPublicoRepository,
    private readonly config: RastreoPublicoConfig = loadRastreoPublicoConfig(),
  ) {}

  async consultar(numGuia: number, factor: string): Promise<ResultadoConsultaRastreo> {
    const fila = await this.repo.buscarPorGuia(numGuia);

    // R7/R8 — a partir de aqui NO hay retorno temprano por "no existe": los cuatro casos
    // malos recorren exactamente el mismo camino, con el mismo numero de llamadas a datos.
    const digitos = this.config.DIGITOS_SEGUNDO_FACTOR;
    // R11 — se normalizan a digitos LOS DOS lados antes de comparar, con el normalizador
    // ya testeado del repo: separadores, espacios y prefijo internacional no cambian el
    // resultado.
    const almacenado = normalizarTelefonoCR(fila?.telefonoDest ?? TELEFONO_CENTINELA);
    const tecleado = normalizarTelefonoCR(factor);

    // G2 — un telefono de menos de `digitos` digitos deja la orden NO consultable: comparar
    // contra dos digitos seria un factor de 100 combinaciones, es decir ninguno.
    const consultable = almacenado.length >= digitos && tecleado.length >= digitos;
    const coincide = ultimos(almacenado, digitos) === ultimos(tecleado, digitos);
    const vigente = fila !== null && fila.deletedAt === null;

    if (!consultable || !coincide || !vigente || fila === null) {
      return { estado: "no_encontrado" };
    }

    // R21 — UNA sola lectura del historial por consulta.
    const transiciones = await this.repo.listarTransiciones(fila.id);
    const linea = this.proyectarLinea(transiciones);

    // Sin transiciones no hay nada OCURRIDO que contar (G10) y `hitoVigente` no podria
    // derivarse de la misma linea (R20). Se responde como los demas casos sin envio.
    const vigenteDeLaLinea: HitoPublicoEntrada | undefined = linea[linea.length - 1];
    if (vigenteDeLaLinea === undefined) {
      return { estado: "no_encontrado" };
    }

    // R22/R23 — el DTO se construye ENUMERANDO campos, jamas por spread de la fila: asi el
    // dato sensible no puede colarse por herencia. `fila.id` se queda aqui.
    return {
      estado: "ok",
      envio: {
        numGuia: fila.numGuia ?? numGuia,
        hitoVigente: vigenteDeLaLinea.hito,
        actualizadoEn: vigenteDeLaLinea.fecha,
        linea,
      },
    };
  }

  /**
   * R14/R15/R20 — el historial ya ocurrido, traducido a hitos publicos, en orden
   * cronologico ascendente y con las rachas colapsadas. No se sintetiza ninguna entrada
   * futura (G10): el flujo puede desviarse a devolucion y prometer un paso que no llegara
   * es peor que no decir nada.
   */
  private proyectarLinea(transiciones: readonly TransicionRastreoFila[]): HitoPublicoEntrada[] {
    const ascendente = [...transiciones].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const entradas: HitoPublicoEntrada[] = ascendente.map((transicion) => {
      const hito: HitoPublico = hitoDeEstatus(transicion.estatusValue);
      return { hito, fecha: formatearEnZona(transicion.createdAt, this.config.ZONA_HORARIA) };
    });
    return colapsarRachas(entradas);
  }
}
