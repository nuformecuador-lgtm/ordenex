import { ESTATUS_POR_RESULTADO } from "@/lib/types/gestion-destino";
import { loadRastreoPublicoConfig, type RastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import type {
  IRastreoPublicoService,
  ResultadoConsultaRastreo,
} from "@/lib/interfaces/services/IRastreoPublicoService";
import { nombreDeResultado } from "@/lib/types/gestion-resultado";
import { nombrePublicoDeEstado, type ESTADO_RETIRADO } from "@/lib/types/order-status";
import type { EntradaLineaPublica } from "@/lib/types/rastreo-publico";
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

/**
 * FICHA 455 (recorrido F9) — el estado retirado que, antes de la 454, representaba una gestion aun
 * sin confirmar. Se lee de `ESTADO_RETIRADO` para que un renombre de la clave no lo deje colgado.
 */
const POR_CONFIRMAR_RETIRADO: keyof typeof ESTADO_RETIRADO = "devolucion_por_confirmar";

/**
 * `true` si el texto de la fila es un resultado de gestion. Se lee de las claves de
 * `ESTATUS_POR_RESULTADO` (exhaustivo sobre el enum, sin importar Prisma en runtime: R33).
 */
function esResultadoDeGestion(valor: string): valor is keyof typeof ESTATUS_POR_RESULTADO {
  return Object.hasOwn(ESTATUS_POR_RESULTADO, valor);
}

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
 * R18 (G9) / FICHA 455 (R31) — colapsa las rachas consecutivas del mismo NOMBRE de estado
 * conservando la fecha de la PRIMERA ocurrencia. Antes la racha se medía por hito; con nombres, lo
 * que se funde es un mismo estado repetido y, sobre todo, un estado retirado plegado a su
 * equivalente (R34): el viaje histórico `en_reparto -> ayuda_tienda -> en_reparto` se sigue viendo
 * como UNA sola entrada «En reparto».
 */
function colapsarRachas(entradas: readonly EntradaLineaPublica[]): EntradaLineaPublica[] {
  const linea: EntradaLineaPublica[] = [];
  for (const entrada of entradas) {
    if (linea[linea.length - 1]?.nombre === entrada.nombre) continue;
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
    // FICHA 454 (T1.19, design §12.3; R31): la gestion PENDIENTE de confirmar se ve AL INSTANTE,
    // como ultima entrada, marcada. Sin actor, sin motivo, sin mensajero: solo su resultado y su
    // instante. Al anularse desaparece; al corregirse muestra el corregido (la gestion lleva el
    // resultado sellado); al aprobarse la sustituye la entrada confirmada de la fila de historial.
    //
    // FICHA 455 (2026-09-24, R33): la entrada lleva el NOMBRE del resultado (`nombreDeResultado`,
    // el de su estado homonimo: «Devolución a origen por rechazo»), y la pagina lo pinta como
    // «<Resultado> · pendiente de confirmación». Sustituye al hito + `nombreResultado` de la 454.
    const pendiente = await this.repo.buscarGestionPendiente(fila.id);
    // El resultado llega como texto de la fila; si no es un codigo del catalogo no se publica nada
    // (el mismo descarte que hacia la 454 cuando el resultado no tenia estado destino).
    const entradaPendiente: EntradaLineaPublica | null =
      pendiente !== null && esResultadoDeGestion(pendiente.resultado)
        ? {
            nombre: nombreDeResultado(pendiente.resultado),
            fecha: formatearEnZona(pendiente.createdAt, this.config.ZONA_HORARIA),
            pendiente: true,
          }
        : null;
    const linea = this.proyectarLinea(transiciones, entradaPendiente?.fecha ?? null);
    if (entradaPendiente !== null) linea.push(entradaPendiente);

    // Sin transiciones no hay nada OCURRIDO que contar (G10) y `nombreVigente` no podria
    // derivarse de la misma linea (R20). Se responde como los demas casos sin envio.
    const vigenteDeLaLinea: EntradaLineaPublica | undefined = linea[linea.length - 1];
    if (vigenteDeLaLinea === undefined) {
      return { estado: "no_encontrado" };
    }

    // R22/R23 — el DTO se construye ENUMERANDO campos, jamas por spread de la fila: asi el
    // dato sensible no puede colarse por herencia. `fila.id` se queda aqui.
    return {
      estado: "ok",
      envio: {
        numGuia: fila.numGuia ?? numGuia,
        nombreVigente: vigenteDeLaLinea.nombre,
        actualizadoEn: vigenteDeLaLinea.fecha,
        linea,
      },
    };
  }

  /**
   * R14/R15/R20 — el historial ya ocurrido, traducido a NOMBRES de estado (FICHA 455, R31/R34), en
   * orden cronologico ascendente y con las rachas colapsadas. No se sintetiza ninguna entrada
   * futura (G10): el flujo puede desviarse a devolucion y prometer un paso que no llegara
   * es peor que no decir nada.
   */
  private proyectarLinea(
    transiciones: readonly TransicionRastreoFila[],
    fechaPendiente: string | null,
  ): EntradaLineaPublica[] {
    const ascendente = [...transiciones].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const entradas: EntradaLineaPublica[] = [];
    for (const transicion of ascendente) {
      const fecha = formatearEnZona(transicion.createdAt, this.config.ZONA_HORARIA);
      // FICHA 455 (2026-09-24, recorrido F9): antes de la 454, registrar una gestion movia la orden a
      // `devolucion_por_confirmar`; esa fila es la MISMA gestion que hoy se lee como pendiente, del
      // mismo instante. Plegada a «Novedad» (R34) se publicaba dos veces —una confirmada y otra
      // pendiente—, fuera de orden (la migracion 454 devolvio la orden a `en_reparto` DESPUES) y con
      // la misma clave en la pagina. Mientras esa gestion siga pendiente, la fila vieja no se
      // publica: la entrada pendiente la sustituye, y la racha de «En reparto» se vuelve a fundir.
      if (
        fechaPendiente !== null &&
        transicion.estatusValue === POR_CONFIRMAR_RETIRADO &&
        fecha === fechaPendiente
      ) {
        continue;
      }
      entradas.push({ nombre: nombrePublicoDeEstado(transicion.estatusValue), fecha });
    }
    return colapsarRachas(entradas);
  }
}
