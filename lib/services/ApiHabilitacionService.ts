import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHabilitacionApiRepository } from "@/lib/interfaces/repositories/IOrdenHabilitacionApiRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CodigoErrorHabilitacion,
  FilaHabilitacionInput,
  HabilitacionLoteResult,
  IApiHabilitacionService,
  ResultadoFilaHabilitacion,
} from "@/lib/interfaces/services/IApiHabilitacionService";
import { TOPE_CARACTERES_NOTA_HABILITAR } from "@/lib/config/habilitacion-api";
import { esEstadoHabilitableApi } from "@/lib/types/habilitacion-api";

// Feature 266 (T4.1, design §4.4) — el corazon del endpoint de HABILITACION POR LOTE del canal
// por API key. Sin HTTP, sin Prisma y sin Next: recibe el actor ya autenticado y las filas ya
// desenvueltas, y devuelve un resultado POR FILA.

/** El estatus desde el que —y SOLO desde el que— se puede volver a la calle (design §1). */
const ESTATUS_AYUDA = "ayuda_tienda";
/** El estatus al que vuelve la rama A: la orden regresa a reparto, con su mismo mensajero. */
const ESTATUS_EN_REPARTO = "en_reparto";

/**
 * Los mensajes de cada codigo, en un solo sitio. **NUNCA llevan la key ni su hash** (R5): son
 * textos fijos, sin interpolar nada de la peticion salvo la guia, que el integrador ya conoce.
 */
const MENSAJE: Record<CodigoErrorHabilitacion, string> = {
  fila_invalida:
    "num_guia debe ser un entero positivo y nota un texto no vacio de hasta " +
    `${TOPE_CARACTERES_NOTA_HABILITAR} caracteres`,
  duplicada_en_lote: "esa guia ya aparece antes en este mismo lote",
  no_encontrada: "no existe una orden viva con esa guia",
  estado_no_habilitable: "el estado actual de la orden no admite habilitacion",
};

/**
 * **LA FORMA DE ESTE `Pick` ES PARTE DEL DISENO** (design §4.4/§4.5). El service NO tiene acceso
 * a `prisma` ni a ningun metodo de escritura de estado que no sea `transicionarAyuda`, que es EL
 * PUNTO UNICO real (235/R8). Un segundo `updateMany` sobre `orden.estatus_id` no es que este
 * prohibido por convencion: **no compila**.
 */
export type OrdenRepoParaHabilitacionApi = Pick<
  IOrdenRepository,
  "findParaHabilitacionApi" | "findEstatusIdByValue" | "transicionarAyuda"
>;

/** Una fila cuyos CAMPOS ya pasaron R7: la guia es un entero positivo y la nota viene recortada. */
interface FilaValida {
  numGuia: number;
  nota: string;
}

/**
 * R7 — valida los CAMPOS de UNA fila. Es del service y no del borde a proposito: una fila mal
 * formada NO puede tumbar el lote entero (design §3.2), asi que el envoltorio (zod) solo mira la
 * forma del lote y los campos se miran aqui, fila por fila.
 *
 * Sin coercion: un `num_guia` de tipo texto NO se convierte. El contrato pide un entero, y
 * adivinar el tipo del integrador es como se cuela una guia `"0012"` que en la base no existe.
 */
function validarFila(fila: FilaHabilitacionInput): FilaValida | null {
  const { num_guia: numGuia, nota } = fila;
  if (typeof numGuia !== "number" || !Number.isInteger(numGuia) || numGuia <= 0) return null;
  if (typeof nota !== "string") return null;
  const notaRecortada = nota.trim();
  if (notaRecortada.length === 0) return null;
  if (notaRecortada.length > TOPE_CARACTERES_NOTA_HABILITAR) return null;
  return { numGuia, nota: notaRecortada };
}

/** Atajo para las filas que fallan: `estado` es SIEMPRE `null` en el desenlace `error` (R10). */
function filaConError(
  numGuia: unknown,
  codigo: CodigoErrorHabilitacion,
): ResultadoFilaHabilitacion {
  return { numGuia, resultado: "error", estado: null, error: { codigo, mensaje: MENSAJE[codigo] } };
}

/**
 * Feature 266 (design §4.4) — habilita pedidos con novedad por LOTE desde el canal por API key.
 *
 * ⚠️ **LA GUARDA DE ESTADO VIVE AQUI** (R13/R14), antes de invocar ninguna escritura. El punto
 * unico del rescate declara su riesgo al reves («la guarda vive AQUI, en el punto unico, y no en
 * los llamadores», `lib/services/rescate-ayuda.ts`), y este endpoint **no pasa por
 * `rescatarOrdenAyuda`**: sin guarda propia no tendria ninguna primera red. El `WHERE` guardado
 * de `transicionarAyuda` sigue siendo la segunda.
 *
 * El lote se recorre SECUENCIALMENTE y en orden: N transacciones cortas, una por fila (design §8,
 * riesgo 4). No se paraleliza — el dedupe de R8 evita dos transiciones sobre la misma orden, pero
 * no el coste en conexiones.
 */
export class ApiHabilitacionService implements IApiHabilitacionService {
  constructor(
    private readonly ordenRepo: OrdenRepoParaHabilitacionApi,
    private readonly logRepo: IOrdenHabilitacionApiRepository,
  ) {}

  async habilitarLote(
    actor: Actor,
    filas: readonly FilaHabilitacionInput[],
  ): Promise<HabilitacionLoteResult> {
    const resultados: ResultadoFilaHabilitacion[] = [];
    /** R8: las guias ya procesadas en ESTE lote. Solo entran las que pasaron R7. */
    const vistas = new Set<number>();

    for (const fila of filas) {
      resultados.push(await this.procesarFila(actor, fila, vistas));
    }

    // R11: misma cardinalidad y mismo orden que la entrada — el integrador casa por indice.
    return { resumen: resumir(resultados), resultados };
  }

  /** El algoritmo de design §4.4, para UNA fila. Nunca lanza: todo desenlace es un resultado. */
  private async procesarFila(
    actor: Actor,
    fila: FilaHabilitacionInput,
    vistas: Set<number>,
  ): Promise<ResultadoFilaHabilitacion> {
    // 1. R7 — campos de la fila. La guia viaja tal cual llego (`unknown`): no se puede prometer
    //    un entero de algo que no lo era.
    const valida = validarFila(fila);
    if (valida === null) return filaConError(fila.num_guia, "fila_invalida");
    const { numGuia, nota } = valida;

    // 2. R8 — la PRIMERA aparicion se procesa; las siguientes no vuelven a escribir nada.
    if (vistas.has(numGuia)) return filaConError(numGuia, "duplicada_en_lote");
    vistas.add(numGuia);

    // 3. R3/R4 — el owner es SIEMPRE `actor.usuarioId` y se fuerza en el `where` del repo. El
    //    `null` es OPACO: no distingue «no existe» de «es de otra tienda».
    const orden = await this.ordenRepo.findParaHabilitacionApi(numGuia, actor.usuarioId);
    if (orden === null) return filaConError(numGuia, "no_encontrada");

    // 4. R13/R14 — GUARDA DE ESTADO PROPIA, ANTES de cualquier escritura. Cubre `reprogramada`
    //    (R13-b) y la SEGUNDA habilitacion de una orden ya en `en_reparto` (R31/D3): un `error`
    //    honesto, no un acuse falso.
    if (!esEstadoHabilitableApi(orden.estatusValue)) {
      return filaConError(numGuia, "estado_no_habilitable");
    }

    // 5. RAMA A: el paquete sigue en la calle. Es el UNICO caso que mueve el estado, y solo se
    //    llega a el desde `ayuda_tienda` — una `devuelta` esta SIEMPRE desasignada (R14-b).
    if (orden.estatusValue === ESTATUS_AYUDA && orden.mensajeroAsignadoId !== null) {
      return await this.ramaA(actor, numGuia, nota, orden.id);
    }

    // 6. RAMA B: el paquete ya esta en bodega. Solo log, CERO escrituras de estado (R20) y CERO
    //    webhooks (R22) — sin transicion, el choke point no se invoca y no hay nada que encolar.
    await this.logRepo.registrar({
      ordenId: orden.id,
      actorUsuarioId: actor.usuarioId,
      nota,
      cambioDeEstado: false,
      estadoResultante: orden.estatusValue,
    });
    return {
      numGuia,
      resultado: "habilitada_sin_cambio_de_estado",
      estado: orden.estatusValue,
      error: null,
    };
  }

  /** Rama A (design §4.4.5): resuelve el catalogo, transiciona y RECIEN DESPUES registra. */
  private async ramaA(
    actor: Actor,
    numGuia: number,
    nota: string,
    ordenId: string,
  ): Promise<ResultadoFilaHabilitacion> {
    // 5.1. R19 — FALLO CERRADO al resolver el catalogo: si alguno de los dos values no resuelve,
    //      la fila se rechaza SIN escribir nada. Mismo criterio que `rescate-ayuda.ts`.
    const [origenId, destinoId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTATUS_AYUDA),
      this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_REPARTO),
    ]);
    if (origenId === null || destinoId === null) {
      return filaConError(numGuia, "estado_no_habilitable");
    }

    // 5.2. R15/R16 — LA UNICA ESCRITURA DE ESTADO, por el punto unico, guardada por el origen y
    //      con su append al historial en la MISMA transaccion. D6: la entrada NO lleva `motivo` —
    //      la nota vive SOLO en la bitacora, y copiarla aqui le daria dos hogares.
    const transiciono = await this.ordenRepo.transicionarAyuda({
      ordenId,
      estatusOrigenId: origenId,
      estatusDestinoId: destinoId,
      actorUsuarioId: actor.usuarioId,
      origenTipo: "habilitacion_api",
    });
    // R18/R25 — la orden se movio entre la lectura y la escritura: 0 filas afectadas, ningun
    // efecto parcial, y NINGUN registro. Una bitacora que afirme un cambio que no ocurrio es peor
    // que no tener bitacora.
    if (!transiciono) return filaConError(numGuia, "estado_no_habilitable");

    // 5.3. R23/R25 — el registro va DESPUES de la transicion confirmada, y a proposito (design
    //      §8, riesgo 1): el hueco de atomicidad se acepta en la direccion segura.
    await this.logRepo.registrar({
      ordenId,
      actorUsuarioId: actor.usuarioId,
      nota,
      cambioDeEstado: true,
      estadoResultante: ESTATUS_EN_REPARTO,
    });

    return { numGuia, resultado: "habilitada", estado: ESTATUS_EN_REPARTO, error: null };
  }
}

/** R10 — el recuento. Invariante: `total === habilitadas + habilitadasSinCambioDeEstado + conError`. */
function resumir(resultados: readonly ResultadoFilaHabilitacion[]) {
  return {
    total: resultados.length,
    habilitadas: resultados.filter((r) => r.resultado === "habilitada").length,
    habilitadasSinCambioDeEstado: resultados.filter(
      (r) => r.resultado === "habilitada_sin_cambio_de_estado",
    ).length,
    conError: resultados.filter((r) => r.resultado === "error").length,
  };
}
