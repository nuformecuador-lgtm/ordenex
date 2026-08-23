import type { ICierreDiaRepository } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ICorteDiarioRepository } from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type {
  CorteDiarioResult,
  ICorteDiarioService,
} from "@/lib/interfaces/services/ICorteDiarioService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import { computeTotales, derivarPagos, derivarIngresoBodega } from "@/lib/utils/cierre-totales";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
// Feature 271 (T6.4, R38/R39/R47/R61): el aviso del `vencido` y la conversion de su jornada.
import {
  notificadorNoOp,
  type CierreVencidoNotificador,
} from "@/lib/notificaciones/notificadores";
import { jornadaDelCorte } from "@/lib/utils/jornada-cierre";

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 109 (T1.3): + `findEstatusIdByValue` para resolver los estatus ids de
// `en_reparto`/`sin_gestionar` que consume la transicion del corte (una vez por corrida).
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioVehiculoId" | "findEstatusIdByValue">;

// Feature 109 (R4): estados del catalogo que consume la transicion del corte diario.
const ESTADO_EN_REPARTO = "en_reparto";
const ESTADO_SIN_GESTIONAR = "sin_gestionar";
// Feature 235 (T4.4, R26): el corte barre TAMBIEN las ordenes con ayuda pedida. Sin esto, un
// mensajero que dejara el dia con ordenes en `ayuda_tienda` se quedaria con ellas colgando y su
// cierre bloqueado para siempre.
const ESTADO_AYUDA = "ayuda_tienda";
// Reusa la 37: gestiones pendientes del mensajero + creacion transaccional del cierre
// (parametrizada con estado='vencido', feature 41/C1).
type CierreRepo = Pick<ICierreDiaRepository, "findGestionesPendientes" | "crearCierre">;

/**
 * ⚠️ FEATURE 271 (R17) — INVARIANTE DERIVADO, ESCRITO DONDE SE LEE: **DOS `vencido` A LA VEZ ES
 * IMPOSIBLE**, y NO por una guarda. Sale de la propia regla, en tres pasos verificados contra el
 * codigo:
 *
 *   1. En cuanto un mensajero tiene UN `vencido`, `V >= 1` y queda BLOQUEADO para gestionar Y para
 *      recibir trabajo nuevo. No genera actividad nueva: ni gestiones, ni ordenes en la mano.
 *   2. El corte que creo ese `vencido` ya barrio, EN LA MISMA TRANSACCION, sus ordenes de
 *      `en_reparto` y `ayuda_tienda` a `sin_gestionar`, y vinculo sus gestiones sueltas
 *      (`CierreDiaRepository.crearCierre`).
 *   3. Por tanto la noche siguiente NO LE QUEDA NADA QUE CERRAR: el corte lo evalua, `crearCierre`
 *      encuentra 0 gestiones y 0 ordenes que barrer, y devuelve `null` por su guarda «algo paso».
 *      Sin segundo `vencido`, y `vencidosCreados` no sube (R22).
 *
 * POR ESO EL CORTE DEJA DE EXCLUIR A QUIEN TIENE UN CIERRE ABIERTO **SIN NINGUNA CONDICION NUEVA**
 * (S3, confirmado por el humano). Y por eso NO SE ESCRIBE CODIGO DEFENSIVO PARA «DOS `vencido`»:
 * seria programar para un estado inalcanzable, y un test de un estado imposible no puede fallar por
 * la razon correcta.
 *
 * DONDE SI SE ACUMULAN DOS CIERRES RE-SOLICITABLES: EN EL RECHAZO, que es RETROACTIVO —cae sobre un
 * cierre que el mensajero solicito cuando NO estaba bloqueado y por tanto pudo solicitar otro—. Ese
 * caso SI es alcanzable, SI tiene test (M2, `transicionarASolicitado`) y siempre incluye al menos un
 * `rechazado`.
 */

// Log de aviso inyectable (P2): omitir mensajero sin zona. Por defecto console.warn.
// NUNCA registra PII/secretos (R24): solo el conteo agregado al final.
export interface CorteDiarioLogger {
  warn(message: string): void;
}
const defaultLogger: CorteDiarioLogger = { warn: (m) => console.warn(m) };

/** CR es UTC-6 FIJO (sin horario de verano): restar 24 h ES restar un dia calendario. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Feature 246 (T2.1, design §5.1, R11/R13/R17) — EL ANCLA DEL CORTE, Y ES DONDE ESTA FICHA SE
 * ROMPE SOLA SI NADIE LEE ESTO.
 *
 * `diaCerrado` es la fecha CR de la JORNADA QUE LA CORRIDA CIERRA, es decir el dia ANTERIOR al
 * que la corrida inaugura. NO es «hoy».
 *
 * POR QUE EL ANCLA INGENUA NO SIRVE. El cron corre a las 00:00 CR del dia `D+1`, asi que
 * `startOfDayCR(now)` ya vale `D+1`. Una orden que bodega reservo anoche «para mañana» tiene
 * `fecha_reparto = D+1`. Con el predicado «protegida si `fecha_reparto > startOfDayCR(now)`»,
 * `D+1 > D+1` es FALSO y la orden SE BARRE: justo lo que esta ficha viene a impedir. Cambiar el
 * operador a `>=` la salvaria esa noche, pero dejaria el predicado dependiendo del INSTANTE exacto
 * en que Vercel dispara el cron. El error esta en el ANCLA, no en el operador.
 *
 * ROBUSTEZ SI EL CRON SE ADELANTA. Si dispara a las 23:5x CR del dia `D`, `startOfDayCR` da `D` y
 * `diaCerrado = D-1`: se barre todo lo de `D-1` hacia atras y lo de `D` sobrevive una corrida mas.
 * Se RETRASA un barrido; no se PIERDE ninguno, porque la corrida siguiente lo alcanza. Anclarlo en
 * `now` sin restar el dia tiene el defecto inverso, que si pierde la proteccion.
 *
 * Y LA PROTECCION CADUCA SOLA (R13): como el maximo reservable es «mañana» (D2), `diaCerrado`
 * avanza un dia cada noche y alcanza a la orden reservada en la corrida SIGUIENTE. Ninguna orden
 * puede quedar protegida dos veces, y nadie tiene que escribir nada para que expire.
 */
export function diaQueElCorteCierra(now: Date): Date {
  return new Date(startOfDayCR(now).getTime() - UN_DIA_MS);
}

/**
 * Feature 41 — logica de negocio del corte diario (R6-R11). Por cada mensajero con
 * actividad del dia sin cerrar y sin `solicitado` (R7/R10), deriva su bodega responsable
 * (R1, resolverDestinoCierre), snapshotea totales/pago/ingreso money-safe (R8, mismos
 * helpers que solicitarCierre) y crea un `cierre_dia estado='vencido'` en transaccion
 * todo-o-nada. Idempotente por vinculacion de gestiones (R9). No conoce HTTP ni Prisma
 * directo; testeable con dobles sin red/DB.
 */
export class CorteDiarioService implements ICorteDiarioService {
  constructor(
    private readonly corteRepo: ICorteDiarioRepository,
    private readonly cierreRepo: CierreRepo,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly tarifaZonaRepo: ITarifaZonaMensajeroRepository,
    private readonly logger: CorteDiarioLogger = defaultLogger,
    /**
     * FEATURE 271 (T6.4, R38/R39/R47) — notificador de «tu cierre del dia vencio», INYECTABLE y con
     * DEFAULT NO-OP (mismo patron que `CorteDiarioLogger`).
     *
     * Hasta hoy el corte NO emitia NINGUNA notificacion —verificado contra produccion: 0 filas en
     * `notificacion` a las 00:03 del 22/08— y ni siquiera recibia un notificador. El mensajero se
     * enteraba de su bloqueo al toparse con el rechazo.
     *
     * El default no-op no es comodidad: este servicio lo construye un CRON y la base de este repo es
     * compartida. Una suite que lo instancie sin inyectar no puede escribir avisos POR
     * CONSTRUCCION; el composition root (`app/api/cron/corte-diario`) inyecta el real.
     */
    private readonly notificarVencido: CierreVencidoNotificador = notificadorNoOp,
  ) {}

  async ejecutarCorte(now: Date = new Date()): Promise<CorteDiarioResult> {
    // Feature 246 (T2.1, R16/R17): el ancla se calcula UNA vez por corrida y viaja como PARAMETRO
    // a las DOS capas —la que SELECCIONA y la que ESCRIBE—, para que no puedan decir cosas
    // distintas. Ver `diaQueElCorteCierra`: es el dia que la corrida CIERRA, no el que inaugura.
    const diaCerrado = diaQueElCorteCierra(now);
    // R1: la clasificacion a central usa la zona central (o null: fallback satelite).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    // Feature 109 (T1.3, R4): resuelve UNA vez los estatus ids de la transicion del corte. Si el
    // catalogo aun no tiene `sin_gestionar` (seed pendiente), se omite la transicion y el corte se
    // comporta como la 41 (solo `vencido` por gestiones) — no bloquea el flujo money-critical.
    const [enRepartoEstatusId, ayudaEstatusId, sinGestionarEstatusId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO),
      this.ordenRepo.findEstatusIdByValue(ESTADO_AYUDA),
      this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
    ]);
    // Feature 235: los TRES o ninguno. `ayudaEstatusId` es obligatorio en `CorteSinGestionarInput`,
    // asi que un olvido de cableado rompe el typecheck en vez de dejar ordenes sin barrer.
    const corteSinGestionar =
      enRepartoEstatusId !== null && ayudaEstatusId !== null && sinGestionarEstatusId !== null
        ? // Feature 246 (T2.3): `diaCerrado` viaja DENTRO del input del barrido, no como argumento
          // suelto, para que el mismo valor que filtro la seleccion filtre la escritura (R16).
          { enRepartoEstatusId, ayudaEstatusId, sinGestionarEstatusId, diaCerrado }
        : undefined;
    // R4/R7/R10: mensajeros que "debian cerrar" (gestiones sin cerrar) O que dejaron ordenes en
    // `en_reparto` al pasar de dia; sin un cierre ABIERTO (R10/R29).
    // Feature 246 (R11/R14/R16): el MISMO `diaCerrado` que recibira `crearCierre`.
    const mensajeros = await this.corteRepo.findMensajerosConActividadSinCierre(diaCerrado);

    let vencidosCreados = 0;
    let mensajerosSinZona = 0;

    for (const m of mensajeros) {
      // P2: sin zona no se puede derivar la bodega responsable -> se omite.
      if (m.zonaId === null) {
        mensajerosSinZona += 1;
        continue;
      }

      // R7/R9: relee las gestiones aun sin cerrar (una corrida previa pudo vincularlas). Feature
      // 109 (R8): YA NO se hace `continue` si son 0 — el mensajero puede estar en la lista SOLO por
      // ordenes `en_reparto` (money-neutral). `crearCierre` decide via la guarda "algo paso": si no
      // vincula gestiones NI transiciona `sin_gestionar`, devuelve null (idempotencia R9).
      const gestiones = await this.cierreRepo.findGestionesPendientes(m.mensajeroId);

      // R1: bodega responsable derivada (misma regla que solicitarCierre).
      const { destinoTipo } = resolverDestinoCierre(m.zonaId, centralZonaId);

      // R8: snapshot money-safe con los MISMOS helpers que solicitarCierre (37/39/56).
      const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(m.mensajeroId);
      const tarifa = await this.tarifaZonaRepo.resolvePagoTarifa(m.zonaId, vehiculoId);
      const totales = computeTotales(gestiones);
      const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);
      const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
        gestiones,
        tarifa,
      );

      // R6/R8/R23: crea el `vencido` con la MISMA tx de vinculacion + snapshot. Si vincula
      // 0 gestiones (carrera con una solicitud) devuelve null: no cuenta como creado (R9).
      const cierreId = await this.cierreRepo.crearCierre({
        mensajeroId: m.mensajeroId,
        estado: "vencido",
        destinoTipo,
        destinoZonaId: m.zonaId,
        // Feature 109 (T1.3, R4/R6) + feature 235 (T4.4, R26): en la MISMA tx transiciona a
        // `sin_gestionar` las ordenes del mensajero que sigan en `en_reparto` Y las que esten en
        // `ayuda_tienda`, cada una desde SU origen real (via choke point). undefined si el catalogo
        // no lo soporta (seed pendiente).
        corteSinGestionar,
        totales,
        pagoByGestionId,
        totalPagoMensajero,
        ingresoByGestionId,
        totalIngresoBodegaRechazos,
      });
      if (cierreId !== null) {
        vencidosCreados += 1;
        // FEATURE 271 (T6.4, R38/R39): UNA emision POR CIERRE CREADO, dentro del bucle y DESPUES de
        // que `crearCierre` devuelva un id. NUNCA por un `null`: un `null` significa que no se creo
        // nada, y avisar de un cierre que no existe seria peor que no avisar.
        //
        // LA JORNADA: `diaCerrado`, el ANCLA que esta misma corrida ya calculo y con el que
        // selecciono y escribio. El corte es el UNICO sitio del arbol que sabe su jornada sin
        // derivarla, y usar aqui otro valor seria abrir la tercera version del mismo dato.
        // La conversion a `YYYY-MM-DD` vive en el derivador (`jornadaDelCorte`, R61) y NO aqui,
        // porque tiene delante la trampa de las dos convenciones de fecha de este repo.
        //
        // ⚠️ ESTE ES EL AVISO QUE MAS SE EMITE Y EL QUE PEOR SALIA: `created_at` de un `vencido` va
        // SIEMPRE un dia por delante de la jornada, porque este cron corre a las 00:0x de la
        // madrugada SIGUIENTE al dia que cierra. Medido: `79cb2c0f` nacio el 22 y su jornada es el
        // 21. Decirle «tu cierre del 22» a quien trabajo el 21 —y lee el aviso el 22— era mandarlo
        // a buscar un cierre que no reconoce.
        //
        // BEST-EFFORT (R47): `notificarVencido` absorbe su propio fallo, asi que la corrida termina
        // y devuelve su resumen aunque la campana este caida. El corte es money-critical.
        await this.notificarVencido({
          cierreId,
          zonaId: m.zonaId,
          mensajeroUsuarioId: m.mensajeroId,
          jornadaCR: jornadaDelCorte(diaCerrado),
        });
      }
    }

    // P2: aviso agregado sin PII (R24).
    if (mensajerosSinZona > 0) {
      this.logger.warn(
        `[corte-diario] ${mensajerosSinZona} mensajero(s) con actividad pendiente omitidos por no tener zona asignada`,
      );
    }

    return { mensajerosEvaluados: mensajeros.length, vencidosCreados, mensajerosSinZona };
  }
}
