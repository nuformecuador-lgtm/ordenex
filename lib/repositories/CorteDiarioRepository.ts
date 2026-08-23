import { type PrismaClient } from "@prisma/client";
import type {
  ICorteDiarioRepository,
  MensajeroSinCierreRow,
} from "@/lib/interfaces/repositories/ICorteDiarioRepository";

// ⚠️ FEATURE 271 (T3.1, R21) — AQUI VIVIA `ESTADOS_CIERRE_ABIERTOS`, LA LISTA QUE RESTABA DEL CORTE
// A QUIEN YA TENIA UN CIERRE ABIERTO. Se va entera, junto con la consulta y el `filter` que la
// usaban, y NO se sustituye por ninguna condicion nueva (S3, confirmado por el humano el
// 2026-08-23).
//
// POR QUE SE VA: sostenia el invariante 109/R30 —«un mensajero nunca tiene 2 cierres abiertos»—, que
// la ficha 271 DEROGA (R9). Es exactamente lo que rompio el caso medido en produccion: el cierre
// `79cb2c0f` paso a `solicitado` el 22/08 a las 16:39 y las 2 gestiones de las 16:56 del mensajero
// se quedaron con `cierre_id` NULL porque el corte del 23/08 —que NO fallo, 200 a las 06:00:27— lo
// resto de su lista y no pudo crearle el segundo cierre. Dinero cobrado sin cierre al que ir.
//
// POR QUE NO HACE FALTA NINGUNA CONDICION NUEVA, que es la pregunta que esto invita a hacerse:
//   · un mensajero que AUN NO estaba bloqueado y no cerro su dia recibe su `vencido` — es como
//     aparecen los casos 5 y 6 de la tabla de verdad;
//   · un mensajero YA bloqueado entra en el bucle pero NO TIENE NADA QUE CERRAR: el corte que lo
//     bloqueo ya barrio sus ordenes a `sin_gestionar` en la misma transaccion y vinculo sus
//     gestiones, asi que `crearCierre` encuentra 0 y 0 y devuelve `null` por su guarda «algo paso»
//     (271/R22). Eso es lo que hace que el invariante derivado R17 —dos `vencido` a la vez es
//     IMPOSIBLE— se sostenga SOLO, sin una guarda que lo imponga;
//   · un mensajero con un `solicitado` de ayer que trabajo hoy y no cerro recibe su SEGUNDO cierre.
//     Es exactamente el caso de `79cb2c0f`, y es el objetivo de esta ficha.
//
// COSTE: el corte evalua mas mensajeros que antes. El universo sigue siendo «los que tienen
// actividad», no todos; la medida esta en `progress/impl_271.md`.

// Feature 109 (R4) + feature 235 (R26): estados de una orden que el corte transiciona a
// `sin_gestionar` — el mensajero no la gestiono ni la recogio de vuelta antes del corte del dia.
//
// ⚠️ ESTA LISTA Y LA DEL SERVICE SON LA MISMA VERDAD VISTA DOS VECES, y esa es la trampa que costo
// una regresion. `CorteDiarioService` resuelve los ids de estos mismos estados para pasarselos a
// `crearCierre` (que es quien ESCRIBE), pero la lista de abajo decide QUIENES entran siquiera en el
// bucle. Si las dos divergen, el barrido queda correcto «de crearCierre hacia dentro» y roto desde
// la seleccion hacia fuera: exactamente lo que paso con `ayuda_tienda` entre el commit del estatus y
// esta correccion — un mensajero que acababa el dia con TODO en ayuda y sin gestiones sin cerrar no
// entraba en la lista, no recibia su cierre `vencido` y sus ordenes no se barrian NUNCA.
//
// Es UNION, no sustitucion: `en_reparto` sigue estando. La guardia
// `tests/unit/guards/carga-del-mensajero.guardia.test.ts` censa las dos listas y exige que digan lo
// mismo.
//
// FEATURE 246 (T2.2/T8.1) — LA SELECCION YA NO ES SOLO POR ESTATUS: ES POR ESTATUS **Y DIA**.
// Esta lista sigue diciendo QUE estados barre el corte, pero desde la 246 una orden en uno de esos
// estados solo arrastra a su mensajero al bucle si su `fecha_reparto` NO es posterior al dia que la
// corrida cierra (o si no tiene ninguna). El predicado de dia esta abajo, en el `where` de la rama
// (b), y es EL MISMO que aplica `CierreDiaRepository.crearCierre` al escribir (R16).
const ESTADOS_A_BARRER = ["en_reparto", "ayuda_tienda"];

type CortePrismaClient = Pick<PrismaClient, "gestionOrden" | "orden" | "cierreDia">;

/**
 * Feature 41 — repositorio del corte diario. SOLO queries Prisma (sin logica de
 * negocio: quien recibe un `vencido` lo decide el service). Money-safe: no calcula
 * totales aqui (eso lo hace el service con los helpers de snapshot).
 */
export class CorteDiarioRepository implements ICorteDiarioRepository {
  constructor(private readonly prisma: CortePrismaClient) {}

  /**
   * R7/R10 + feature 109 (R4) -> FEATURE 271 (T3.1, R21): mensajeros DISTINCT a evaluar en el corte
   * = UNION de (a) los que tienen `gestion_orden.cierre_id IS NULL AND anulada_at IS NULL`
   * (actividad del dia sin cerrar, comportamiento 41/67) y (b) los que tienen >=1 `orden` no borrada
   * en alguno de los `ESTADOS_A_BARRER` — `en_reparto` (109) o `ayuda_tienda` (235) — a las que el
   * corte llevara a `sin_gestionar`.
   *
   * ⚠️ YA NO SE RESTA A NADIE. Hasta la 271 se excluia a quien tuviera un cierre ABIERTO, para
   * sostener el invariante 109/R30 que esta ficha DEROGA (R9). Un mensajero con un `solicitado` de
   * ayer que trabaja hoy DEBE entrar y recibir su segundo cierre; el que no tenga nada que cerrar lo
   * descarta `crearCierre` con su guarda «algo paso», que ya existia (R22). Ver el bloque del
   * principio del archivo con las tres razones.
   *
   * Devuelve `zonaId` (usuario.zona_id) para derivar el destino (R1). Solo queries (sin logica de
   * negocio).
   *
   * FEATURE 246 (T2.2, R11/R14/R16/R17): `diaCerrado` llega YA CALCULADO desde el service —la
   * fecha CR de la jornada que esta corrida cierra— y se usa tal cual en el `where` de la rama
   * (b). Aqui NO se calcula ninguna fecha y NO hay aritmetica de zona horaria: si cada repositorio
   * la derivara por su cuenta, dos consultas de la MISMA corrida podrian caer a distinto lado de
   * la medianoche.
   */
  async findMensajerosConActividadSinCierre(diaCerrado: Date): Promise<MensajeroSinCierreRow[]> {
    // (a) actividad del dia aun sin cerrar. Feature 67/R17: una gestion ANULADA NO cuenta.
    const pendientes = await this.prisma.gestionOrden.findMany({
      where: { cierreId: null, anuladaAt: null },
      distinct: ["mensajeroId"],
      select: { mensajeroId: true, mensajero: { select: { zonaId: true } } },
    });

    // (b) feature 109/R4 + 235/R26: mensajeros con ordenes que el corte tiene que barrer al pasar
    // de dia — las que siguen en `en_reparto` Y las que quedaron en `ayuda_tienda`. Las segundas
    // son el caso que la 235 rompio y que aqui se repone: pedir ayuda NO crea `gestion_orden`, asi
    // que un mensajero que recoge una guia, pide ayuda y se va a casa no aparece por la rama (a)
    // tampoco. Sin este `in` no entra por ninguna de las dos.
    const enReparto = await this.prisma.orden.findMany({
      where: {
        deletedAt: null,
        estatus: { value: { in: ESTADOS_A_BARRER } },
        mensajeroAsignadoId: { not: null },
        // Feature 246 (R11/R12/R16/R20) — EL PREDICADO GEMELO. Es LITERALMENTE el mismo `OR` que
        // aplica `CierreDiaRepository.crearCierre` al escribir; si los dos dejaran de decir lo
        // mismo, el barrido quedaria correcto «de crearCierre hacia dentro» y roto desde la
        // seleccion hacia fuera — la forma exacta del fallo que la 235 costo.
        //
        // Se pregunta «¿esta reservada para un dia que AUN NO HA LLEGADO?», no «¿es de hoy?»: por
        // eso `fechaReparto: null` entra POR LA PRIMERA RAMA y se barre igual que siempre (R19/R20).
        // `NULL` significa una sola cosa aqui, y es «no reservada».
        OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }],
      },
      distinct: ["mensajeroAsignadoId"],
      select: { mensajeroAsignadoId: true, mensajeroAsignado: { select: { zonaId: true } } },
    });

    // UNION por mensajeroId, conservando su zona (fuente de verdad viva: usuario.zona_id).
    const byMensajero = new Map<string, string | null>();
    for (const p of pendientes) byMensajero.set(p.mensajeroId, p.mensajero.zonaId);
    for (const o of enReparto) {
      if (o.mensajeroAsignadoId === null) continue; // el WHERE ya lo excluye; guarda de tipos
      if (!byMensajero.has(o.mensajeroAsignadoId)) {
        byMensajero.set(o.mensajeroAsignadoId, o.mensajeroAsignado?.zonaId ?? null);
      }
    }
    if (byMensajero.size === 0) return [];

    // FEATURE 271 (T3.1, R21): AQUI ESTABA LA TERCERA CONSULTA —a `cierre_dia`— Y EL `filter` QUE
    // RESTABA A QUIEN YA TENIA UN CIERRE ABIERTO. Se fueron las dos. El metodo devuelve la UNION de
    // (a) y (b) SIN RESTAR A NADIE; quien no tenga nada que cerrar lo resuelve `crearCierre` con su
    // guarda «algo paso», que ya existia y no se toca (R22).
    return [...byMensajero.keys()].map((mensajeroId) => ({
      mensajeroId,
      zonaId: byMensajero.get(mensajeroId) ?? null,
    }));
  }
}
