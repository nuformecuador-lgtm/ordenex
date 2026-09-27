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
import { nombreDeEstado } from "@/lib/types/order-status";

// Feature 266 (T4.1, design §4.4) — el corazon del endpoint de HABILITACION POR LOTE del canal
// por API key. Sin HTTP, sin Prisma y sin Next: recibe el actor ya autenticado y las filas ya
// desenvueltas, y devuelve un resultado POR FILA.

// FICHA 454 (T1.15): aqui vivia `ESTATUS_AYUDA = "ayuda_tienda"`. La ayuda es un hecho: la rama A se
// decide por la derivacion `ayudaAbierta` que trae la lectura.
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
  "findParaHabilitacionApi" | "registrarAyudaResuelta"
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
  return {
    numGuia,
    resultado: "error",
    estado: null,
    estadoNombre: null, // FICHA 455 (R24)
    ayudaCerrada: false,
    error: { codigo, mensaje: MENSAJE[codigo] },
  };
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
    //    Feature 302: `actor.usuarioId` es el DUEÑO resuelto (la tienda real si la key apunta a
    //    una), asi que `actor_usuario_id` del log de habilitacion pasa a nombrar a ESA tienda y no
    //    a la cuenta dedicada. Quien quiera saber QUE credencial actuo lo tiene en el `apiKeyId`
    //    del resultado de autenticacion, que es donde vive la trazabilidad de la key.
    const orden = await this.ordenRepo.findParaHabilitacionApi(numGuia, actor.usuarioId);
    if (orden === null) return filaConError(numGuia, "no_encontrada");

    // 4. R13/R14 — GUARDA DE ESTADO PROPIA, ANTES de cualquier escritura. Cubre `reprogramada`
    //    (R13-b) y la SEGUNDA habilitacion de una orden ya en `en_reparto` (R31/D3): un `error`
    //    honesto, no un acuse falso.
    // FICHA 454 (R24): habilitable = ayuda ABIERTA (derivacion) o un estado habilitable (`devuelta`).
    if (!orden.ayudaAbierta && !esEstadoHabilitableApi(orden.estatusValue)) {
      return filaConError(numGuia, "estado_no_habilitable");
    }

    // 5. RAMA A: el paquete sigue en la calle. Es el UNICO caso que mueve el estado, y solo se
    //    llega a el desde `ayuda_tienda` — una `devuelta` esta SIEMPRE desasignada (R14-b).
    //    FICHA 454: la condicion es la ayuda ABIERTA (la orden sigue `en_reparto`), y ya no mueve estado.
    if (orden.ayudaAbierta && orden.mensajeroAsignadoId !== null) {
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
      estadoNombre: nombreDeEstado(orden.estatusValue), // FICHA 455 (R24)
      ayudaCerrada: false,
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
    // FICHA 454 (T1.15, R24) — la ayuda se CIERRA con un hecho (`ayuda_habilitada_api`) y la orden
    // NO cambia de estado: ya estaba `en_reparto`. Guardado por «ayuda abierta» bajo candado; si la
    // cerro otra via entre la lectura y la escritura, `false` sin efectos y la fila es un error
    // honesto (R18/R25 de la 266), sin registro: una bitacora que afirme lo que no ocurrio es peor
    // que no tenerla.
    const cerrada = await this.ordenRepo.registrarAyudaResuelta({
      ordenId,
      tipo: "ayuda_habilitada_api",
      actorUsuarioId: actor.usuarioId,
      actorRol: actor.rol,
    });
    if (!cerrada) return filaConError(numGuia, "estado_no_habilitable");

    // R23/R25 (266) — el registro va DESPUES del hecho confirmado. `cambioDeEstado: false`: no hubo
    // transicion; `estadoResultante` es el estado en que la orden sigue.
    await this.logRepo.registrar({
      ordenId,
      actorUsuarioId: actor.usuarioId,
      nota,
      cambioDeEstado: false,
      estadoResultante: ESTATUS_EN_REPARTO,
    });

    // R24 (454, design §4.2: «la respuesta HTTP GANA `ayudaCerrada`»): `resultado: "habilitada"` y
    // `estado: "en_reparto"` se CONSERVAN —son el discriminador que el integrador ya lee y la
    // caracterizacion C22 los fija como invariante— y la clave NUEVA dice lo que cambio: la ayuda
    // quedo CERRADA. Que no hubo transicion lo registra la bitacora (`cambioDeEstado: false`).
    return {
      numGuia,
      resultado: "habilitada",
      estado: ESTATUS_EN_REPARTO,
      estadoNombre: nombreDeEstado(ESTATUS_EN_REPARTO), // FICHA 455 (R24)
      ayudaCerrada: true,
      error: null,
    };
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
