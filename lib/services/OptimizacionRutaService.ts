// Feature 92 (design §5) — servicio que recalcula la ruta de UN mensajero. DI por
// INTERFACES (docs/architecture.md §Service): no conoce Next.js, ni Prisma, ni `fetch`.
//
// PRIVACIDAD (R14): las coordenadas de entrega son DATO PERSONAL — identifican el
// domicilio del destinatario, y la ubicacion del mensajero es dato de una persona
// trabajando. Este archivo NUNCA emite coordenadas, direccion ni credencial por el logger
// ni por un mensaje de error, y no usa `console.*`.
//
// ═══ LAS CINCO GUARDAS DE COSTE SON LO IMPORTANTE DE ESTE ARCHIVO ═══
// (decia «CUATRO» y siempre listo CINCO; corregido con el cierre de menores de la 265)
// Cada llamada a `optimizeTours` se FACTURA. El orden de los pasos esta elegido para que
// las guardas mas baratas corten antes que las caras:
//
//   R20  job obsoleto (una optimizacion posterior ya cubrio este evento) -> 0 llamadas
//   R34  dos pulsaciones del boton dentro del intervalo minimo           -> 0 llamadas
//   R35  0 o 1 parada con coordenadas                                    -> 0 llamadas
//        (con 1 parada SI se pide el trazado, que es otro SKU; ver la rama)
//   R38  mas de RUTA_MAX_PARADAS -> se recorta, no se paga por el exceso
//   ★    265/R16: origen incoherente con las paradas -> se SUSTITUYE por el centroide
//        No corta la llamada: la ARREGLA. Con el origen a mil kilometros del racimo de
//        paradas el modelo es irresoluble y lo unico seguro de esa llamada es que se paga.
//        Va ANTES de la huella (265/R20) porque la huella debe describir el origen que
//        REALMENTE se envia; si no, la guarda de «sin cambios» cortaria por lo que no fue.
//   R36  mismo conjunto de paradas y mismo origen que la ultima vez      -> 0 llamadas
//
// ⚠️ ESTE ORDEN YA NO VIVE SOLO EN ESTE COMENTARIO. 265/R33 exige que las guardas corten
// «exactamente igual Y EN EL MISMO ORDEN», y hasta el cierre de menores de la 265 lo unico
// que lo sostenia era este parrafo — un comentario no se pone rojo. Lo fija ahora
// `tests/unit/services/optimizacion-ruta-service.test.ts`, describe «265/R33 — las guardas
// cortan EN ESTE ORDEN»: monta casos donde DOS guardas cortarian a la vez y afirma cual gana.
// Si reordenas algo de esta lista, ese describe te lo dice; los tests de cada guarda por
// separado, NO (medido: reordenar R20 y R34 mata 1 test de 40).
//
// ═══ ANTE FALLO DEL PROVEEDOR SE CONSERVA EL ULTIMO ORDEN VALIDO (R27) ═══
// Decision explicita del humano. NUNCA se borra la secuencia previa y NUNCA se cae en
// silencio a `createdAt desc`: la ruta se marca `desactualizada` (lo que alimenta el aviso
// de la UI) y se LANZA para que la cola aplique su backoff.
import { createHash } from "node:crypto";
import type {
  IRouteOptimizationClient,
  OptimizarOutcome,
} from "@/lib/interfaces/external/IRouteOptimizationClient";
import type {
  IRutaOptimizadaRepository,
  OrigenFuente,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import type {
  EjecutarOptimizacionOpts,
  EjecutarOptimizacionResult,
  IOptimizacionRutaService,
  TrazadoRuta,
  TrazadoTramo,
  TrazarTramoVivoResult,
} from "@/lib/interfaces/services/IOptimizacionRutaService";
import { codificarPolilinea, distanciaHaversineKm, distanciaTotalM } from "@/lib/geo/polilinea";
import { optlog, opterror } from "@/lib/logging/optimizer-log";
import type { IRoutesClient } from "@/lib/interfaces/external/IRoutesClient";

/** Fuente de las paradas. `Pick` para que los dobles de test no implementen 40 metodos. */
export interface ParadasRepo {
  findParadasEnReparto(mensajeroId: string): Promise<ParadaRutaRow[]>;
}

/** Logger inyectable, patron `GeocodeLogger` de la 91. NUNCA recibe PII ni secretos. */
export interface RutaLogger {
  warn(message: string): void;
}
/**
 * ⚠️ ESTE `warn` NO LLEGA A NADIE EN PRODUCCION, Y ESTA ASI A PROPOSITO.
 *
 * Es un no-op, y la UNICA construccion real del servicio (`buildOptimizacionRutaService`,
 * `lib/services/jobs/optimizacion-ruta-handler.ts`) pasa `undefined` en esta posicion, asi que
 * los avisos AGREGADOS de 265/R19 y R30 —«paradas recortadas al tope», «origen descartado por
 * incoherencia geografica»— se emiten contra este objeto vacio. LIMITE DECLARADO 5 de la ficha
 * 265 (`design.md` §14.3), cerrado asi por la puerta humana P8: la operacion se entera de que
 * una ruta se ordeno en local consultando `ruta_optimizada.secuencia_fuente`, que es un dato
 * persistido, no un log que expira. Su hermano vive en `lib/clients/fallback-route-optimization.ts`,
 * con la misma nota.
 *
 * ⚠️ Consecuencia practica, para que nadie la descubra tarde: **no cuelgues nada de estos
 * `warn`**. Escribirlos no es avisar, y leer el codigo puede dar la impresion contraria — que
 * es justo por lo que la revision de la 265 lo anoto (menor **m11**). Si algun dia hacen falta
 * de verdad, se inyecta un logger real en `buildOptimizacionRutaService`; el hueco ya esta
 * abierto en el constructor y no hace falta tocar el servicio.
 */
const defaultLogger: RutaLogger = { warn: () => {} };

/** El proveedor fallo (transitorio o config invalida). La cola aplica su backoff. */
export class RutaIntentoFallidoError extends Error {
  constructor(detalle: string) {
    super(detalle);
    this.name = "RutaIntentoFallidoError";
  }
}

/**
 * Feature 265 (R24, R32, design §7) — errores NUESTROS cuyos mensajes ya estan saneados POR
 * CONTRATO: citan la operacion y el estado, nunca el token, la URL ni una coordenada.
 *
 * ⚠️ SE COMPARA POR `name` Y NO CON `instanceof` A PROPOSITO. Un `instanceof` obligaria a este
 * servicio a importar `lib/clients/google-route-optimization`, es decir a conocer el proveedor
 * concreto — que es justo lo que `IRouteOptimizationClient` aisla (docs/architecture.md §2).
 * Cada una de estas clases fija su `this.name` explicitamente.
 */
const ERRORES_SANEADOS: readonly string[] = [
  "RutaRespuestaInvalidaError",
  "RutaPeticionRechazadaError",
  "RutaNoConfiguradoError",
  "RutaTokenError",
];

/** Motivo de una excepcion del cliente, SIN filtrar nada (R32). */
const MOTIVO_EXCEPCION_GENERICO = "optimizar ruta: el proveedor no respondio correctamente";

export function motivoDeExcepcion(error: unknown): string {
  // Ante un error de LIBRERIA se usa texto fijo: `error.message` de `google-auth-library` o de
  // `fetch` puede traer la peticion completa colgada, y ahi es donde viven las cabeceras con el
  // Bearer. Es la misma trampa que `opterror` ya documenta.
  if (!(error instanceof Error) || !ERRORES_SANEADOS.includes(error.name)) {
    return MOTIVO_EXCEPCION_GENERICO;
  }
  return error.message;
}

/**
 * Redondeo del origen para la huella de R36. 4 decimales ≈ 11 m: mas fino haria que el
 * jitter del GPS parado en un semaforo invalidara la huella y disparara una llamada
 * facturada por cada lectura. Mas grueso perderia cambios de calle reales.
 */
const ORIGEN_DECIMALES = 4;

/**
 * Centroide aritmetico de las paradas. UNA sola aritmetica para los DOS consumidores —el
 * escalon 3 de `resolverOrigen` y la guarda de coherencia de la 265—: dos cuentas del mismo
 * punto es exactamente el genero de divergencia que este repo ya ha pagado antes.
 *
 * ⚠️ Con `paradas` vacio devuelve NaN. Es correcto que reviente ahi y no que invente un
 * punto: la guarda R35 (0 o 1 parada) corta antes de que se pueda llamar sin paradas.
 */
function centroide(paradas: { latitud: number; longitud: number }[]): { lat: number; lng: number } {
  return {
    lat: paradas.reduce((s, p) => s + p.latitud, 0) / paradas.length,
    lng: paradas.reduce((s, p) => s + p.longitud, 0) / paradas.length,
  };
}

export class OptimizacionRutaService implements IOptimizacionRutaService {
  constructor(
    private readonly rutas: IRutaOptimizadaRepository,
    private readonly paradasRepo: ParadasRepo,
    private readonly client: IRouteOptimizationClient,
    private readonly config: RouteOptimizationConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: RutaLogger = defaultLogger,
    /**
     * Trazado de la ruta (Google Routes). OPCIONAL a proposito: `null` = no se dibuja, y
     * todo lo demas sigue igual. Es una llamada FACTURADA aparte, y su fallo NUNCA debe
     * tumbar una optimizacion que ya salio bien (ver `trazar`).
     */
    private readonly routes: IRoutesClient | null = null,
  ) {}

  async ejecutar(
    mensajeroId: string,
    opts: EjecutarOptimizacionOpts,
  ): Promise<EjecutarOptimizacionResult> {
    const ahora = this.now();
    optlog("service — ENTRADA", {
      mensajeroId,
      motivo: opts.motivo,
      jobCreatedAt: opts.jobCreatedAt?.toISOString(),
      ubicacionRecibida: opts.ubicacion !== undefined,
    });

    // R23: la ubicacion del navegador se persiste ANTES de cualquier guarda. Aunque la
    // optimizacion se omita, la posicion capturada sigue siendo util para la siguiente.
    if (opts.ubicacion !== undefined) {
      await this.rutas.upsertOrigen(mensajeroId, {
        lat: opts.ubicacion.lat,
        lng: opts.ubicacion.lng,
        capturadaAt: ahora,
        fuente: "gps",
      });
    }

    const ruta = await this.rutas.findByMensajero(mensajeroId);

    // ── R20: guarda de OBSOLESCENCIA ──────────────────────────────────────────────
    // El job de debounce en vuelo no se puede cancelar (`IJobRepository` no lo expone y
    // NO se le anade, design §4.1). Si entre su encolado y su ejecucion una optimizacion
    // posterior ya recalculo la ruta, este job no tiene nada que hacer: completarlo sin
    // llamar es el ahorro que compensa no poder cancelar.
    if (
      opts.jobCreatedAt !== undefined &&
      ruta?.calculadaAt != null &&
      opts.jobCreatedAt < ruta.calculadaAt
    ) {
      optlog("service — guarda R20: job obsoleto, 0 llamadas facturadas", {
        jobCreatedAt: opts.jobCreatedAt.toISOString(),
        rutaCalculadaAt: ruta.calculadaAt.toISOString(),
      });
      return { status: "omitida", razon: "obsoleta" };
    }

    // ── R34: intervalo minimo del boton manual ────────────────────────────────────
    // Solo aplica al disparo manual: los de la cola ya estan acotados por el debounce y
    // por la guarda de obsolescencia. Dos pulsaciones seguidas (doble clic, o el mensajero
    // impaciente) NO producen dos llamadas facturadas.
    if (opts.motivo === "manual" && ruta?.calculadaAt != null) {
      const transcurridoS = (ahora.getTime() - ruta.calculadaAt.getTime()) / 1000;
      if (transcurridoS < this.config.RUTA_SYNC_MIN_INTERVALO_S) {
        optlog("service — guarda R34: intervalo minimo, 0 llamadas facturadas", {
          transcurridoS,
          minimoS: this.config.RUTA_SYNC_MIN_INTERVALO_S,
        });
        return { status: "omitida", razon: "intervalo_minimo" };
      }
    }

    const todas = await this.paradasRepo.findParadasEnReparto(mensajeroId);
    // R37: las ordenes SIN coordenadas se EXCLUYEN de la optimizacion, no la abortan.
    // Quedan como paradas sin posicion (R28) y la lectura las muestra al final.
    const conCoordenadas = todas.filter(
      (p): p is ParadaRutaRow & { latitud: number; longitud: number } =>
        p.latitud !== null && p.longitud !== null,
    );
    optlog("service — paradas en reparto", {
      total: todas.length,
      conCoordenadas: conCoordenadas.length,
      sinCoordenadas: todas.length - conCoordenadas.length,
    });

    // ── R35: 0 o 1 parada ─────────────────────────────────────────────────────────
    // Optimizar un punto no significa nada: no hay orden que calcular. Se persiste la
    // secuencia trivial (o se limpia la vieja, si el mensajero ya entrego todo) SIN
    // llamar al proveedor de OPTIMIZACION.
    //
    // Pero con UNA parada si hay recorrido que enseñar —del origen a esa parada—, y no
    // dibujarlo dejaba al mensajero con un mapa de dos puntos sueltos justo en el caso mas
    // comun del final del dia. El TRAZADO si se pide (decision del humano, 2026-08-14).
    // Sigue siendo `omitida`: describe que no hubo ORDENACION, no que no pasara nada.
    if (conCoordenadas.length <= 1) {
      optlog("service — guarda R35: 0 o 1 parada, 0 llamadas de OPTIMIZACION", {
        conCoordenadas: conCoordenadas.length,
      });
      const unica = conCoordenadas[0];
      const origen =
        unica !== undefined
          ? this.resolverOrigen(ruta, conCoordenadas, ahora)
          : this.origenSoloDeUltimaConocida(ruta);
      const secuencia = unica !== undefined ? [unica.ordenId] : [];
      const huellaSet = this.huella(secuencia, origen);
      await this.rutas.reemplazarSecuencia(mensajeroId, secuencia, {
        calculadaAt: ahora,
        origen,
        huellaSet,
        // Feature 265 (R37): con 0 o 1 parada NO HUBO ORDENACION, asi que no hay procedencia
        // que afirmar. `null` es «no consta», y afirmar `proveedor` aqui seria mentir sobre
        // un calculo que nadie hizo.
        secuenciaFuente: null,
      });

      // El trazado SI se factura (Routes es su propio SKU). Se reusa el criterio de R36
      // para no pagarlo en cada disparo: si la parada y el origen son los mismos que la
      // ultima vez y la ruta sigue vigente, se devuelve el trazado ya persistido.
      //
      // OJO al orden: `cacheado` se lee de `ruta`, la cabecera de ANTES de la escritura de
      // arriba. Releer despues no serviria — `reemplazarSecuencia` acaba de limpiar las
      // columnas del trazado.
      const sinCambios = ruta?.huellaSet === huellaSet && ruta.estado === "vigente";
      if (unica === undefined || origen === null || sinCambios) {
        const cacheado = sinCambios && ruta !== null ? this.trazadoDesdeCache(ruta) : null;
        optlog("service — R35: no se redibuja", {
          conCoordenadas: conCoordenadas.length,
          sinOrigen: origen === null,
          sinCambios,
          trazadoEnCache: cacheado !== null,
        });
        // Se repone lo que la escritura de arriba borro: la secuencia es la MISMA (una sola
        // parada, la misma huella), asi que el dibujo guardado sigue siendo el suyo.
        if (cacheado !== null) await this.persistirTrazado(mensajeroId, huellaSet, cacheado);
        return {
          status: "omitida",
          razon: "sin_paradas",
          ...(cacheado !== null ? { trazado: cacheado } : {}),
        };
      }
      const trazado = await this.trazar([unica.ordenId], [unica], origen);
      await this.persistirTrazado(mensajeroId, huellaSet, trazado);
      return {
        status: "omitida",
        razon: "sin_paradas",
        ...(trazado !== null ? { trazado } : {}),
      };
    }

    // ── R38: tope de paradas ──────────────────────────────────────────────────────
    // `findParadasEnReparto` ya devuelve `createdAt asc`, que es el criterio pedido: se
    // optimizan las mas antiguas y el resto queda sin posicion (R28), no se descarta.
    const paradas = conCoordenadas.slice(0, this.config.RUTA_MAX_PARADAS);
    if (conCoordenadas.length > this.config.RUTA_MAX_PARADAS) {
      // Mensaje AGREGADO: un conteo, jamas un id ni una coordenada.
      this.logger.warn(
        `[optimizacion_ruta] paradas recortadas al tope (${this.config.RUTA_MAX_PARADAS})`,
      );
    }

    // ── 265/R16-R23: coherencia del origen ────────────────────────────────────────
    // Va DESPUES de resolver el origen (necesita uno ya resuelto) y DESPUES del recorte del
    // tope (el centroide debe calcularse sobre las paradas que DE VERDAD se envian), y ANTES
    // de la huella (R20): el origen que entra en la huella tiene que ser el que se envia.
    const origen = this.origenCoherente(this.resolverOrigen(ruta, paradas, ahora), paradas);

    // ── R36: huella del conjunto + origen ─────────────────────────────────────────
    // Si nada cambio desde la ultima optimizacion valida, el resultado seria identico:
    // pagarlo otra vez es tirar dinero. La huella ordena los ids para ser independiente
    // del orden de lectura, e incluye el origen redondeado.
    const huellaSet = this.huella(
      paradas.map((p) => p.ordenId),
      origen,
    );
    optlog("service — origen resuelto y huella calculada", {
      origen,
      huellaSet,
      huellaPrevia: ruta?.huellaSet ?? null,
      estadoRuta: ruta?.estado ?? null,
    });

    if (ruta?.huellaSet === huellaSet && ruta.estado === "vigente") {
      // Nada que RECALCULAR, pero el mapa sigue necesitando su linea. El trazado persistido
      // corresponde a esta misma huella —la DB solo lo conserva mientras la secuencia no
      // cambie— asi que se devuelve tal cual, sin llamar ni pagar nada.
      const cacheado = this.trazadoDesdeCache(ruta);
      optlog("service — guarda R36: mismo conjunto y origen, 0 llamadas facturadas", {
        trazadoEnCache: cacheado !== null,
        tramosEnCache: cacheado?.tramos.length ?? 0,
      });
      return {
        status: "omitida",
        razon: "sin_cambios",
        ...(cacheado !== null ? { trazado: cacheado } : {}),
      };
    }

    // ── Llamada FACTURADA al proveedor ────────────────────────────────────────────
    optlog("service — ninguna guarda corto: se LLAMA al proveedor (esto se factura)", {
      paradas: paradas.length,
    });
    // ⚠️ Feature 265 (R24-R26, design §7) — EL `try` NO ES DECORACION, ES EL DEFECTO MEDIDO.
    // Sin el, una EXCEPCION del cliente (respuesta con forma invalida, HTTP 400, fallo del
    // proveedor de token) atravesaba el servicio SIN pasar por `marcarDesactualizada` y
    // llegaba cruda al borde, que la convertia en «AppErrorCode inesperado INTERNAL»: pantalla
    // rota, 6 veces sobre 2 usuarios en produccion. Ahora cualquier excepcion recibe el MISMO
    // trato que los desenlaces de fallo: se conserva el orden previo, se marca desactualizada
    // y se lanza el fallo TIPADO —que la cola sigue viendo como excepcion (R26)—.
    let outcome: OptimizarOutcome;
    try {
      outcome = await this.client.optimizar({
        origen: { lat: origen.lat, lng: origen.lng },
        paradas: paradas.map((p) => ({ ordenId: p.ordenId, lat: p.latitud, lng: p.longitud })),
      });
    } catch (error) {
      opterror("service — el proveedor LANZO; se conserva el orden previo (R27)", error);
      const motivo = motivoDeExcepcion(error);
      await this.rutas.marcarDesactualizada(mensajeroId, motivo);
      throw new RutaIntentoFallidoError(motivo);
    }

    if (outcome.status === "ok") {
      await this.rutas.reemplazarSecuencia(mensajeroId, outcome.secuencia, {
        calculadaAt: ahora,
        origen,
        huellaSet,
        // Feature 265 (R35/R36): el servicio TRANSPORTA la procedencia, no la decide. Va en
        // la misma escritura que la secuencia que describe, asi que nunca puede quedar una
        // marca vieja pegada a un orden nuevo.
        secuenciaFuente: outcome.fuente,
      });
      optlog("service — SALIDA: ok, secuencia persistida", {
        secuencia: outcome.secuencia,
        paradas: outcome.secuencia.length,
        secuenciaFuente: outcome.fuente,
      });
      const trazado = await this.trazar(outcome.secuencia, paradas, origen);
      await this.persistirTrazado(mensajeroId, huellaSet, trazado);
      return {
        status: "ok",
        paradas: outcome.secuencia.length,
        secuenciaFuente: outcome.fuente,
        ...(trazado !== null ? { trazado } : {}),
      };
    }

    // ── 265/§5.3: `sin_solucion` SIN COMPUESTO = defensa en profundidad ────────────
    // En produccion esto no deberia llegar aqui: `FallbackRouteOptimizationClient` lo
    // intercepta y ordena en local. Pero si alguien cablea el cliente de Google SIN el
    // compuesto (los tests lo hacen), el trato es el de un fallo del proveedor: se conserva el
    // orden previo, se marca desactualizada y se lanza. NUNCA se persiste parcial, NUNCA se
    // cae en silencio.
    if (outcome.status === "sin_solucion") {
      this.logger.warn(
        `[optimizacion_ruta] el proveedor no sirvio todas las paradas (${outcome.servidas} de ` +
          `${outcome.enviadas}) y no hay calculo local cableado: se conserva el orden previo`,
      );
    }

    // R27: fallo del proveedor. NO se tocan las paradas — el ultimo orden valido queda
    // INTACTO. Se marca la ruta `desactualizada` (aviso de la UI) y se LANZA para que la
    // cola aplique su backoff. `outcome.detalle` viene ya saneado del cliente: cita la
    // operacion y el estado HTTP, nunca el token, la URL ni una coordenada (R14).
    if (outcome.status === "config_invalida") {
      // Ruidoso a proposito (mismo criterio que la 91): preferimos un dead-letter VISIBLE
      // a rutas que dejan de actualizarse en silencio.
      this.logger.warn("[optimizacion_ruta] el proveedor rechazo la credencial");
    }
    optlog("service — SALIDA: fallo del proveedor; se CONSERVA el orden previo (R27)", {
      status: outcome.status,
      detalle: outcome.detalle,
    });
    await this.rutas.marcarDesactualizada(mensajeroId, outcome.detalle);
    throw new RutaIntentoFallidoError(outcome.detalle);
  }

  /**
   * Guarda el trazado para que la proxima lectura —y la proxima guarda R36— tengan linea que
   * pintar sin volver a llamar a Routes.
   *
   * ═══ SOLO SE CACHEA `routes`. EL FALLBACK LOCAL NO ═══
   * Un trazado `local` no es un resultado: es la marca de que Google no contesto. Cachearlo
   * congelaria lineas RECTAS hasta que cambie el conjunto de paradas, porque la guarda R36
   * cortaria antes de reintentar. Dejando la columna vacia, el proximo disparo vuelve a
   * pedirle el dibujo a Routes y el mapa se cura solo en cuanto el proveedor vuelva.
   * El precio es alguna llamada de mas mientras Routes este caido; es el lado barato del error.
   *
   * NUNCA LANZA: se llega aqui con la secuencia YA persistida. Fallar por no haber podido
   * guardar el DIBUJO provocaria un reintento que volveria a pagar la OPTIMIZACION —la cara—
   * para arreglar lo accesorio. Mismo criterio que `trazar`.
   */
  /**
   * Trayecto EN VIVO desde la posicion actual hasta UNA parada. Ver el contrato para el
   * porque de que esto no se pueda cachear.
   *
   * ═══ EL ORDEN DE LAS GUARDAS ES EL DE SIEMPRE: LO BARATO PRIMERO ═══
   *   1. intervalo minimo  -> 0 llamadas, 0 lecturas de paradas
   *   2. sin cliente Routes-> 0 llamadas
   *   3. la parada es suya -> 0 llamadas si no lo es
   * Solo despues se llama al proveedor.
   *
   * LA COMPROBACION DE PERTENENCIA ES LA AUTORIZACION, no una validacion de forma.
   * `findParadasEnReparto` devuelve EXACTAMENTE las paradas en reparto de ESTE mensajero, asi
   * que buscar el `ordenId` ahi dentro responde de una vez «¿existe?» y «¿es suya?». Sin esto,
   * cualquier mensajero con sesion podria pedir el trayecto a la guia de otro y, de paso,
   * averiguar sus coordenadas de entrega (R14).
   */
  async trazarTramoVivo(
    mensajeroId: string,
    input: { ubicacion: { lat: number; lng: number }; ordenId: string },
  ): Promise<TrazarTramoVivoResult> {
    const ahora = this.now();
    const ruta = await this.rutas.findByMensajero(mensajeroId);

    if (ruta?.tramoVivoAt != null) {
      const transcurridoS = (ahora.getTime() - ruta.tramoVivoAt.getTime()) / 1000;
      if (transcurridoS < this.config.RUTA_SYNC_MIN_INTERVALO_S) {
        optlog("service — tramo vivo: intervalo minimo, 0 llamadas facturadas", {
          transcurridoS,
          minimoS: this.config.RUTA_SYNC_MIN_INTERVALO_S,
        });
        return { status: "intervalo_minimo" };
      }
    }

    if (this.routes === null) {
      optlog("service — tramo vivo: sin cliente de Routes");
      return { status: "no_disponible" };
    }

    const paradas = await this.paradasRepo.findParadasEnReparto(mensajeroId);
    const destino = paradas.find((p) => p.ordenId === input.ordenId);
    if (destino === undefined || destino.latitud === null || destino.longitud === null) {
      // Una parada suya pero SIN geocodificar cae aqui tambien. Es correcto: no hay punto al
      // que trazar, y el mensajero no puede distinguir ese caso del de una guia ajena — ni
      // falta que le hace.
      optlog("service — tramo vivo: la parada no es suya o no tiene coordenadas");
      return { status: "no_autorizada" };
    }

    optlog("service — tramo vivo: ninguna guarda corto, se LLAMA a Routes (esto se factura)");
    let outcome;
    try {
      outcome = await this.routes.trazar({
        origen: input.ubicacion,
        paradasEnOrden: [
          { ordenId: destino.ordenId, lat: destino.latitud, lng: destino.longitud },
        ],
      });
    } catch (error) {
      // Se traga la excepcion como en `trazar`: esto es apoyo visual, no una operacion.
      opterror("service — tramo vivo: el proveedor lanzo", error);
      return { status: "no_disponible" };
    }

    if (outcome.status !== "ok") {
      optlog("service — tramo vivo: el proveedor no dio geometria", { status: outcome.status });
      return { status: "no_disponible" };
    }

    // Se sella DESPUES del exito: cobrarle el intervalo por un intento que no le devolvio nada
    // dejaria al mensajero esperando sin haber recibido su trayecto.
    await this.rutas.marcarTramoVivo(mensajeroId, ahora);
    return {
      status: "ok",
      encodedPolyline: outcome.encodedPolyline,
      distanciaM: outcome.distanciaM,
      duracionS: outcome.duracionS,
    };
  }

  /**
   * Rearma el trazado del dominio a partir de lo persistido. La cabecera guarda la polilinea
   * entera; los tramos viven repartidos por las filas de las paradas, asi que hay que volver a
   * ordenarlos POR SECUENCIA — el `Map` no tiene orden util.
   *
   * TODO O NADA con los tramos, igual que en el cliente: se consumen por indice, asi que si a
   * alguna parada le falta el suyo se devuelven vacios. La polilinea entera sigue sirviendo.
   */
  private trazadoDesdeCache(ruta: RutaOptimizadaDTO): TrazadoRuta | null {
    if (ruta.trazado === null) return null;
    const enOrden = [...ruta.secuenciaPorOrden.entries()].sort((a, b) => a[1] - b[1]);
    const tramos = enOrden.map(([ordenId]) => ruta.tramoPorOrden.get(ordenId));
    const completos = tramos.every((t) => t !== undefined);
    return {
      ...ruta.trazado,
      tramos: completos && tramos.length > 0 ? (tramos as TrazadoTramo[]) : [],
    };
  }

  private async persistirTrazado(
    mensajeroId: string,
    huellaSet: string,
    trazado: TrazadoRuta | null,
  ): Promise<void> {
    if (trazado === null || trazado.fuente !== "routes") {
      optlog("service — trazado NO cacheado", { fuente: trazado?.fuente ?? "ninguno" });
      return;
    }
    try {
      await this.rutas.guardarTrazado(mensajeroId, huellaSet, trazado, trazado.tramos);
      optlog("service — trazado persistido", {
        fuente: trazado.fuente,
        tramos: trazado.tramos.length,
      });
    } catch (error) {
      opterror("service — no se pudo persistir el trazado; se sigue igual", error);
    }
  }

  /**
   * Pide a Google Routes la POLILINEA de la secuencia recien calculada. Devuelve `null` si
   * no hay cliente de trazado o si el trazado no salio: nunca lanza.
   *
   * POR QUE NO PROPAGA NINGUN FALLO: el trazado es accesorio. La ruta ya esta optimizada y
   * PERSISTIDA cuando se llega aqui; hacer fallar el job por no haber podido dibujarla
   * provocaria un reintento que volveria a pagar la optimizacion —la cara— para arreglar el
   * dibujo —lo barato—. Si Routes falla, el mensajero se queda sin linea en el mapa y con
   * su lista de paradas intacta.
   *
   * ⚠️ ESTO NO SE PERSISTE TODAVIA. `ruta_optimizada` no tiene columna para la polilinea, y
   * anadirla es una migracion. Por ahora el trazado viaja en el resultado (util para el
   * disparo manual) y queda en la traza. Ver el seguimiento anotado en el spec.
   */
  private async trazar(
    secuencia: string[],
    paradas: { ordenId: string; latitud: number; longitud: number }[],
    origen: { lat: number; lng: number },
  ): Promise<TrazadoRuta | null> {
    // La secuencia son `ordenId`; dibujar necesita COORDENADAS. Este mapa es el puente, y
    // reordena `paradas` al orden que decidio la optimizacion.
    const porOrdenId = new Map(paradas.map((p) => [p.ordenId, p]));
    const paradasEnOrden = secuencia
      .map((ordenId) => porOrdenId.get(ordenId))
      .filter((p): p is { ordenId: string; latitud: number; longitud: number } => p !== undefined)
      .map((p) => ({ ordenId: p.ordenId, lat: p.latitud, lng: p.longitud }));

    if (paradasEnOrden.length !== secuencia.length) {
      // No deberia pasar: el cliente ya valida que la secuencia cubra todas las paradas.
      // Sin correspondencia completa no se dibuja NADA: una linea a la que le falta una
      // parada es peor que ninguna linea, porque parece correcta.
      optlog("service — trazado omitido: la secuencia no cuadra con las paradas", {
        secuencia: secuencia.length,
        resueltas: paradasEnOrden.length,
      });
      return null;
    }

    // ── Trazado REAL, por calles ──────────────────────────────────────────────────
    if (this.routes !== null) {
      let outcome;
      try {
        outcome = await this.routes.trazar({ origen, paradasEnOrden });
      } catch (error) {
        // Ni siquiera una excepcion cancela el dibujo: se cae al trazado local.
        opterror("service — el trazado por calles lanzo; se usa el local", error);
        outcome = null;
      }
      if (outcome !== null && outcome.status === "ok") {
        optlog("service — trazado obtenido de Routes (por calles)", {
          distanciaM: outcome.distanciaM,
          duracionS: outcome.duracionS,
          polilineaChars: outcome.encodedPolyline.length,
          tramos: outcome.tramos.length,
        });
        return {
          encodedPolyline: outcome.encodedPolyline,
          distanciaM: outcome.distanciaM,
          duracionS: outcome.duracionS,
          fuente: "routes",
          tramos: outcome.tramos,
        };
      }
      optlog("service — Routes no dio polilinea; se cae al trazado local", {
        status: outcome?.status ?? "excepcion",
      });
    } else {
      optlog("service — sin cliente de Routes; trazado local directo");
    }

    // ── Trazado LOCAL, en linea recta ─────────────────────────────────────────────
    // Gratis, sin red y siempre disponible: se aplica IGUAL venga la secuencia de Google o
    // del fallback Haversine. Une origen + paradas en el orden calculado.
    const puntos = [origen, ...paradasEnOrden.map((p) => ({ lat: p.lat, lng: p.lng }))];
    const encodedPolyline = codificarPolilinea(puntos);
    const distanciaM = distanciaTotalM(puntos);
    // Se loguea el TAMANO, nunca la polilinea: decodificarla devuelve las coordenadas de los
    // domicilios de entrega una por una (R14, cabecera de este archivo).
    optlog("service — trazado LOCAL (lineas rectas entre paradas)", {
      puntos: puntos.length,
      distanciaM,
      polilineaChars: encodedPolyline.length,
    });
    // `duracionS` va a null a proposito: sin calles no hay tiempo de viaje que estimar, y
    // una cifra inventada acabaria mostrandose al mensajero como si fuera real.
    // `tramos` vacio: el trazado local es UNA recta continua por todos los puntos. Partirla
    // daria segmentos que no describen ningun recorrido, solo la cuerda entre dos domicilios.
    return { encodedPolyline, distanciaM, duracionS: null, fuente: "local", tramos: [] };
  }

  /**
   * R24/R25 — resolucion del ORIGEN, en tres escalones. NUNCA falla ni bloquea: la
   * denegacion del permiso de geolocalizacion en el navegador simplemente hace que no
   * llegue `ubicacion`, y se cae al escalon siguiente (R25).
   *
   *   1. `gps` con antiguedad < RUTA_ORIGEN_TTL_MIN   -> fuente "gps"
   *   2. la ultima conocida AUNQUE este vencida        -> fuente "ultima_conocida"
   *   3. el CENTROIDE de las paradas                   -> fuente "centroide"
   *
   * No hay cuarto escalon: si no hubiera ni una parada con coordenadas, la guarda R35 ya
   * habria cortado antes de llegar aqui. El centroide se eligio porque el esquema NO tiene
   * coordenadas de zona ni de bodega (verificado) y no requiere ninguna llamada externa;
   * anadirlas queda como seguimiento (design §11.2).
   *
   * La fuente se PERSISTE y se muestra en la UI: el mensajero debe saber cuando la ruta se
   * calculo desde un punto aproximado.
   */
  private resolverOrigen(
    ruta: RutaOptimizadaDTO | null,
    paradas: { latitud: number; longitud: number }[],
    ahora: Date,
  ): { lat: number; lng: number; fuente: OrigenFuente } {
    if (ruta !== null && ruta.origenLat !== null && ruta.origenLng !== null) {
      const vigente =
        ruta.origenAt !== null &&
        ahora.getTime() - ruta.origenAt.getTime() <= this.config.RUTA_ORIGEN_TTL_MIN * 60_000;
      return {
        lat: ruta.origenLat,
        lng: ruta.origenLng,
        // Escalon 1 vs 2: la MISMA coordenada, pero la fuente cambia para que la UI pueda
        // avisar de que el punto de partida esta viejo.
        fuente: vigente && ruta.origenFuente === "gps" ? "gps" : "ultima_conocida",
      };
    }
    // Escalon 3: centroide aritmetico de las paradas (la cuenta vive en `centroide`).
    return { ...centroide(paradas), fuente: "centroide" };
  }

  /**
   * Feature 265 (R16-R23, design §6) — ¿EL ORIGEN GUARDA RELACION CON LAS PARADAS?
   *
   * Medida: distancia de circulo maximo entre el origen y el centroide de las paradas que de
   * verdad se van a enviar. Por encima de `RUTA_ORIGEN_MAX_KM` el origen se DESCARTA y se baja
   * al escalon 3 de la escalera que la 92 ya diseño (gps -> ultima_conocida -> centroide).
   *
   * ═══ POR QUE SE SUSTITUYE Y NO SE CORTA EL TRABAJO (R23, alternativa A7) ═══
   * Lo que esta roto es el punto de PARTIDA, no las paradas. Un mensajero con seis entregas
   * tiene una ruta razonable entre ellas aunque no sepamos desde donde arranca; cortar el job
   * le deja sin ninguna y reintroduce el bucle de reintentos que la 265 vino a cerrar.
   *
   * TRES PROPIEDADES QUE HAY QUE CONSERVAR SI ESTO SE TOCA:
   *  · NO aplica cuando el origen YA es el centroide (R18): seria comparar un punto consigo
   *    mismo —siempre 0— y ademas garantiza que la sustitucion no puede entrar en bucle.
   *  · NO mira el TTL. Frescura y coherencia son cosas distintas: el origen del incidente era
   *    `gps` RECIENTE y estaba en otro pais. Un TTL vencido ya tiene su propio tratamiento.
   *  · ES PURA Y GRATIS (R22): dos sumas y una raiz sobre datos ya cargados. Cero llamadas
   *    facturadas, cero lecturas de base.
   */
  private origenCoherente(
    origen: { lat: number; lng: number; fuente: OrigenFuente },
    paradas: { latitud: number; longitud: number }[],
  ): { lat: number; lng: number; fuente: OrigenFuente } {
    if (origen.fuente === "centroide") return origen;
    const centro = centroide(paradas);
    const km = distanciaHaversineKm(origen, centro);
    if (km <= this.config.RUTA_ORIGEN_MAX_KM) return origen;

    optlog("service — guarda 265/R16: origen incoherente, se sustituye por el centroide", {
      km: Math.round(km),
      maxKm: this.config.RUTA_ORIGEN_MAX_KM,
      fuenteDescartada: origen.fuente,
      paradas: paradas.length,
    });
    // Aviso AGREGADO (R19): distancia redondeada y numero de paradas. NUNCA coordenadas.
    this.logger.warn(
      `[optimizacion_ruta] origen descartado por incoherencia geografica: ${Math.round(km)} km ` +
        `del centroide de ${paradas.length} paradas (maximo ${this.config.RUTA_ORIGEN_MAX_KM} km); ` +
        "se usa el centroide",
    );
    return { ...centro, fuente: "centroide" };
  }

  /**
   * Caso borde de R35 con CERO paradas: no hay centroide posible (dividir entre cero). Se
   * usa la ultima ubicacion conocida si la hay, y `null` si tampoco. La secuencia vieja se
   * limpia igual: el mensajero entrego todo y no quedan paradas que ordenar.
   */
  private origenSoloDeUltimaConocida(
    ruta: RutaOptimizadaDTO | null,
  ): { lat: number; lng: number; fuente: OrigenFuente } | null {
    if (ruta === null || ruta.origenLat === null || ruta.origenLng === null) return null;
    return { lat: ruta.origenLat, lng: ruta.origenLng, fuente: "ultima_conocida" };
  }

  /**
   * R36 — huella del conjunto de paradas + origen. Los ids se ORDENAN antes de hashear:
   * la huella identifica el CONJUNTO, no el orden de lectura (si dependiera del orden,
   * cualquier reordenacion de la consulta dispararia una llamada facturada de mas).
   * El origen se redondea (ver `ORIGEN_DECIMALES`) para absorber el jitter del GPS.
   */
  private huella(
    ordenIds: string[],
    origen: { lat: number; lng: number } | null,
  ): string {
    const ids = [...ordenIds].sort().join(",");
    const punto =
      origen === null
        ? "sin-origen"
        : `${origen.lat.toFixed(ORIGEN_DECIMALES)},${origen.lng.toFixed(ORIGEN_DECIMALES)}`;
    return createHash("sha256").update(`${punto}|${ids}`, "utf8").digest("hex");
  }
}
