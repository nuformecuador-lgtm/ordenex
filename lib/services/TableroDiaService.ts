import type { ActorAnalitica, AlcanceDatos } from "@/lib/analytics/alcance";
import { resolverAlcance } from "@/lib/analytics/alcance";
import { claveDeAlcance } from "@/lib/analytics/cache-clave";
import { tableroDiaCacheNula } from "@/lib/cache/tablero-dia-cache-nula";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";
import type {
  EntregasEnHora,
  FilaConteoMensajero,
  FiltroAlcanceTablero,
  ITableroDiaRepository,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
import type { ITableroDiaService } from "@/lib/interfaces/services/ITableroDiaService";
import type {
  FilaTableroDia,
  MotivoTableroDia,
  PuntoRitmoEntregas,
  ResultadoDetalleDia,
  ResultadoTableroDia,
  TableroDia,
} from "@/lib/types/tablero-dia";
import { sumarTotalesTablero } from "@/lib/types/tablero-dia";
import { horaDeParedCR, ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 192 (B3.2/B7.4/B9.4/B9.5, design.md §3 y §5.quater) — EL SERVICIO DEL TABLERO.
//
// Aqui vive la FRONTERA MULTI-TENANT de esta pantalla. No hay policies RLS debajo (Prisma se
// conecta con credenciales de servicio y en `db/migrations/` no hay ni una policy), asi que
// el recorte por rol de este archivo es la UNICA separacion entre inquilinos: un fallo aqui
// no da una cifra equivocada, enseña las ordenes de una zona ajena.
//
// No conoce Next: ni `Request`, ni `Response`, ni `next/headers`, ni `new Date()`. El actor y
// el `now` entran por parametro; el repositorio y la cache, por constructor.

/**
 * R8/§3.2 — la metrica del catalogo cuyo alcance gobierna este tablero, declarada UNA sola
 * vez. **NO se añade una metrica nueva** (alternativa 5): el catalogo es una decision humana
 * fechada y hay guardias que cuentan sus etiquetas.
 *
 * Por que esta y no otra: es la unica metrica operativa que cuenta ORDENES
 * (`unidadDeConteo: "orden"`) con grano `mensajero` y `zona`, atribuyendo por `orden.zona_id`
 * — exactamente la semantica del tablero. Un guardia comprueba que sigue existiendo con esas
 * propiedades: sin el, renombrarla dejaria el tablero denegado para todo el mundo (falla
 * cerrada, pero silenciosa: la pantalla muere).
 */
export const METRICA_ALCANCE_TABLERO = "ordenes_por_estado";

/** Prefijo + version del espacio de nombres de la cache (§5.quater). */
const CLAVE_PREFIJO = "tablero-dia";
const CLAVE_VERSION = "v1";

/**
 * Separador `US` (U+001F), el mismo criterio de `cache-clave.ts:44`: no puede aparecer dentro
 * de un uuid ni de una fecha, asi que dos claves distintas no pueden colapsar en una por
 * concatenacion ambigua.
 */
const SEP = "";

/** El alcance resuelto, ya traducido a filtro, o el motivo por el que no hay nada que ver. */
type Autorizacion =
  | { readonly estado: "ok"; readonly alcance: AlcanceDatos; readonly filtro: FiltroAlcanceTablero }
  | { readonly estado: "denegado"; readonly motivo: MotivoTableroDia };

/**
 * R1/R3/R4/R5/R7/R9 — LA LISTA BLANCA. `switch` EXHAUSTIVO y **sin rama `default`** sobre
 * `AlcanceDatos`: una quinta variante de alcance no compila, en vez de colarse por una rama
 * permisiva.
 *
 * `adminTienda` y `mensajero` SI obtienen `ok` de `resolverAlcance` (tienda / mensajero) —
 * esta lista es la que los deja fuera del tablero (decision humana R1). El `adminSatelite`
 * sin zona ni siquiera llega aqui: `resolverAlcance` ya devuelve `sin_zona_asignada` (R7).
 *
 * `zonaId: null` NO es representable: el filtro es una union de dos variantes, no un
 * `string | null` suelto que un fallo de datos pudiera convertir en "sin recorte".
 */
function autorizar(actor: ActorAnalitica | null): Autorizacion {
  const resolucion = resolverAlcance(actor, METRICA_ALCANCE_TABLERO);
  if (resolucion.estado === "denegado") return { estado: "denegado", motivo: resolucion.motivo };

  const { alcance } = resolucion;
  switch (alcance.tipo) {
    case "global":
      return { estado: "ok", alcance, filtro: { tipo: "global" } };
    case "zona":
      return { estado: "ok", alcance, filtro: { tipo: "zona", zonaId: alcance.zonaId } };
    case "tienda":
    case "mensajero":
      return { estado: "denegado", motivo: "rol_no_autorizado" };
  }
}

/**
 * R67/R68/R70 — LA CLAVE DE LA CACHE. Tres componentes y ninguno decorativo:
 *
 *  1. `claveDeAlcance(alcance)` se REUTILIZA de `lib/analytics/cache-clave.ts` (modulo puro;
 *     consumirlo desde un servicio es la direccion permitida). Es un `switch` exhaustivo y el
 *     id va siempre: `zona:z1` y `zona:z2` no pueden compartir entrada. No se reescribe aqui
 *     porque una segunda codificacion del alcance que divergiera en silencio ES la fuga que
 *     se quiere evitar.
 *  2. `fechaCR`: sin ella, la entrada producida a las 23:59:55 CR seguiria sirviendose
 *     despues de medianoche y el tablero mostraria el dia anterior justo cuando el operador
 *     empieza el nuevo (R70).
 *  3. prefijo + version: espacio de nombres propio, sin colision posible con la cache de
 *     analitica (R38).
 *
 * ⛔ NO lleva `usuarioId` ni rol (R68), y eso es deliberado: dos satelites de la misma zona
 * ven exactamente las mismas filas y deben compartir entrada — si la clave llevara el
 * usuario, con N usuarios habria N escaneos y la cache no serviria para nada. La seguridad la
 * da el ALCANCE, no el usuario; `admin` y `maestro` resuelven ambos a `global` y ven lo mismo.
 */
export function claveDeTablero(alcance: AlcanceDatos, fechaCR: string): string {
  return [CLAVE_PREFIJO, CLAVE_VERSION, `a=${claveDeAlcance(alcance)}`, `d=${fechaCR}`].join(SEP);
}

/** R29 — orden DETERMINISTA: `asignadas` desc y, a igualdad, nombre asc. */
function ordenarFilas(filas: readonly FilaConteoMensajero[]): readonly FilaTableroDia[] {
  return [...filas].sort(
    (a, b) =>
      b.asignadas - a.asignadas ||
      a.mensajeroNombre.localeCompare(b.mensajeroNombre) ||
      a.mensajeroId.localeCompare(b.mensajeroId),
  );
}

// R30 — los totales los suma `sumarTotalesTablero`, que desde la feature 258 (B2.1c) vive en
// `@/lib/types/tablero-dia`. Se MOVIO alli, no se copio: el modulo de cliente que recalcula los
// totales con filtro activo (R43/R65) no puede importar este servicio sin arrastrar
// `lib/analytics/alcance` y el adaptador de cache al navegador. Declararla aqui otra vez serian
// dos identidades de ocho sumandos que pueden divergir en silencio.

/**
 * FEATURE 258 (B4.1, R54) — del HISTOGRAMA que devuelve el repositorio a la SERIE ACUMULADA
 * que publica el tablero. Funcion PURA: sin base, sin Next y sin reloj propio.
 *
 * Rellena `0..horaCorte` SIN HUECOS (el repositorio solo devuelve las horas con entregas) y
 * acumula, asi que la serie es monotona no decreciente POR CONSTRUCCION y no por una
 * comprobacion a posteriori.
 *
 * `horaCorte` es la hora de pared de CR del instante de lectura: la serie no inventa el futuro
 * del dia. Una hora del histograma POR ENCIMA del corte —solo posible por desfase entre el
 * reloj de la aplicacion y el de la base— se pliega dentro del ultimo punto en vez de
 * descartarse: descartarla romperia R52 (el ultimo punto dejaria de ser `totales.entregadas`)
 * y ampliar la serie hasta esa hora romperia R54 (la serie llegaria mas alla de la hora de
 * pared). Plegarla mantiene las dos cosas ciertas.
 */
export function acumularPorHora(
  histograma: readonly EntregasEnHora[],
  horaCorte: number,
): readonly PuntoRitmoEntregas[] {
  const porHora = new Map<number, number>();
  for (const { hora, entregadas } of histograma) {
    const cubo = Math.min(Math.max(hora, 0), horaCorte);
    porHora.set(cubo, (porHora.get(cubo) ?? 0) + entregadas);
  }

  const puntos: PuntoRitmoEntregas[] = [];
  let acumulado = 0;
  for (let hora = 0; hora <= horaCorte; hora += 1) {
    acumulado += porHora.get(hora) ?? 0;
    puntos.push({ hora, acumulado });
  }
  return puntos;
}

export class TableroDiaService implements ITableroDiaService {
  constructor(
    private readonly repositorio: ITableroDiaRepository,
    private readonly cache: ITableroDiaCache = tableroDiaCacheNula(),
  ) {}

  /**
   * EL ORDEN DE LAS OPERACIONES ES EL CONTRATO (§5.quater, R69) y no es intercambiable:
   *
   *   1. `resolverAlcance`      ← autorizacion, SIEMPRE y en CADA peticion
   *   2. lista blanca global|zona ← autorizacion
   *   3. `claveDeTablero`       ← recien ahora existe una clave
   *   4. `cache.envolver`       ← optimizacion
   *
   * La cache vive POR DEBAJO de la autorizacion y nunca por encima: un actor denegado sale en
   * el paso 1 o 2 y no llega a mirarla, exista o no una entrada caliente que cubra su
   * consulta. Dicho de otra forma, la clave se DERIVA del resultado de autorizar, asi que no
   * hay forma de construir una sin haber autorizado antes.
   */
  async obtener(actor: ActorAnalitica | null, now: Date): Promise<ResultadoTableroDia> {
    const auth = autorizar(actor);
    if (auth.estado === "denegado") return auth;

    const ventana = ventanaDelDiaEnCursoCR(now);
    const clave = claveDeTablero(auth.alcance, ventana.fecha);
    const alcance = auth.filtro.tipo;

    const tablero = await this.cache.envolver<TableroDia>(clave, async () => {
      // FEATURE 258 (B4.2) — las dos lecturas son INDEPENDIENTES y solo se ejecutan al fallar
      // la cache: encadenarlas sumaria latencias sin ganar nada. Un actor denegado no llega
      // aqui (R56): la autorizacion esta por encima, y la clave se DERIVA de haber autorizado.
      const [conteos, porHora] = await Promise.all([
        this.repositorio.contarPorMensajero(ventana, auth.filtro),
        this.repositorio.contarEntregasPorHora(ventana, auth.filtro),
      ]);
      const filas = ordenarFilas(conteos);
      return {
        fecha: ventana.fecha,
        // R34 — el instante en que los conteos se LEYERON de la base. Se estampa AQUI
        // DENTRO, es decir dentro de `producir`, y viaja dentro del valor cacheado: al
        // servirse un acierto conserva el de la produccion original. Si se estampara al
        // responder, la pantalla anunciaria "hace 0 s" sobre un dato de hasta ~45 s, y esa
        // mentira es la que hace que un operador decida con un numero viejo creyendolo
        // fresco.
        generadoAt: now.toISOString(),
        alcance,
        filas,
        totales: sumarTotalesTablero(filas),
        // R57 — la serie viaja DENTRO del mismo valor, bajo la MISMA clave y con el MISMO
        // `generadoAt` de arriba. Una lectura del tablero no puede producir dos instantes de
        // generacion distintos: la cabecera diria "hace 4 s" y la linea vendria de otro
        // instante, que es la misma mentira de R34 partida en dos.
        ritmoEntregas: acumularPorHora(porHora, horaDeParedCR(ventana, now)),
      };
    });

    return { estado: "ok", tablero };
  }

  /**
   * R40/R41/R42 — EL DETALLE VUELVE A ATRAVESAR LA FRONTERA ENTERA. Repite `resolverAlcance`
   * y la lista blanca: no recibe el filtro ya resuelto desde el cliente, no se fia de que la
   * tarjeta pulsada viniera recortada y no acepta un `zonaId` del navegador. La redundancia
   * con `obtener` ES el punto: dos puertas a las mismas filas son dos sitios donde hay que
   * aplicar la frontera, y un detalle que se fiara del conteo ya recortado seria un IDOR de
   * manual.
   *
   * R42/R63 — los tres casos malos (mensajero inexistente, fuera del alcance, sin ordenes
   * hoy) recorren EXACTAMENTE el mismo camino y devuelven el mismo detalle vacio: no hay
   * `findUnique` previo que confirme la existencia, ni rama que responda antes, ni mensaje
   * distinto. No se puede filtrar la existencia de un mensajero de otra zona.
   *
   * R73 — NO pasa por la cache. Se abre por clic, no en bucle, y su consulta va por indice:
   * no hay escaneo que amortiguar. Cachearlo multiplicaria las claves —una por mensajero Y
   * por alcance— y con ellas la superficie del riesgo de R67, a cambio de nada.
   */
  async detalle(
    actor: ActorAnalitica | null,
    now: Date,
    mensajeroId: string,
    pagina = 1,
  ): Promise<ResultadoDetalleDia> {
    const auth = autorizar(actor);
    if (auth.estado === "denegado") return auth;

    const ventana = ventanaDelDiaEnCursoCR(now);
    const pageSize = ordenesConfig.DEFAULT_PAGE_SIZE;
    const pagina1 = await this.repositorio.listarOrdenesDelDia(ventana, auth.filtro, mensajeroId, {
      pagina,
      pageSize,
    });

    return {
      estado: "ok",
      detalle: {
        mensajeroId,
        fecha: ventana.fecha,
        ordenes: pagina1.ordenes,
        total: pagina1.total,
        pagina,
        pageSize,
      },
    };
  }
}
