import { eliminarSuscripcionPush, olvidarPreferenciaDeAvisos } from "@/lib/actions/push";
import { contenedorDeServiceWorker } from "@/lib/pwa/push-navegador";

/**
 * FICHA 410 (R15, R19, R20, R23) + FICHA 422 (R7-R13) — LA BAJA DE **ESTE** DISPOSITIVO, en un solo
 * sitio, y **CON SU MOTIVO DECLARADO**.
 *
 * La llaman dos superficies que no se parecen en nada: el interruptor del control
 * (`hooks/usePushSuscripcion.ts`, 410/R15) y el botón de salir (`app/_components/LogoutButton.tsx`,
 * 410/R19). Que sea la misma función es lo que impide que una de las dos se olvide de la mitad del
 * trabajo —darse de baja en el navegador **y** borrar la fila en el servidor son dos cosas, y con
 * una sola el dispositivo sigue recibiendo o el servidor sigue intentándolo—.
 *
 * ## Lo que la 422 cambia, y lo que NO (R9)
 *
 * Las dos superficies **siguen haciendo el mismo trabajo sobre el dispositivo**: las mismas dos
 * mitades, en el mismo orden, con el mismo «no lanza nunca». Lo único que las distingue ahora es lo
 * que significan para la **preferencia de la persona**:
 *
 *   · apagar el interruptor es **decir que no** → la preferencia se borra (R7);
 *   · cerrar sesión es **solo irse** → la preferencia se conserva (R8), y por eso al volver a
 *     entrar en este mismo dispositivo los avisos se reactivan solos.
 *
 * Separar la INTENCIÓN sin separar el TRABAJO es todo el diseño de este archivo.
 *
 * ## Por qué el motivo es un parámetro OBLIGATORIO y no un opcional con valor por defecto
 *
 * Con `strict: true`, una tercera superficie que escriba `darDeBajaDeEsteDispositivo()` **no
 * compila**. No hay valor por defecto a propósito: un defecto convertiría «no dijo por qué» en «se
 * asume que solo se va», que es precisamente la mitad que se olvida (R10). Y el `switch` de abajo
 * es **exhaustivo**: añadir un tercer motivo sin decidir qué significa para la preferencia tampoco
 * compila, porque el `default` asigna a `never`. La decisión vive en UN solo sitio.
 *
 * El tipo obliga a declarar *un* motivo; la guardia
 * `tests/unit/guards/push-intencion-de-baja.guardia.test.ts` obliga además a que alguien escriba
 * **por qué ése**, con su cuenta exacta de llamadas.
 *
 * ## Esta función NO LANZA NUNCA, y ese es su contrato (410/R20, 422/R12)
 *
 * Quien la llama al cerrar sesión no puede quedarse decidiendo qué hacer con un fallo: la persona
 * pidió salir y sale. Eso vale también para el borrado de la preferencia (R12): si falla, la baja
 * del dispositivo se completa igual, el cierre de sesión se completa igual, y el fallo **no se
 * absorbe en silencio** —queda registrado con su operación y su causa, que es lo que pide
 * `docs/conventions.md`— pero no se propaga.
 */

/**
 * POR QUÉ SE DA DE BAJA ESTE DISPOSITIVO. No es metadato: es lo único que distingue «dijo que no»
 * de «solo se fue», y de eso depende si la preferencia sobrevive al cierre de sesión.
 *
 * ⚠️ UNIÓN CERRADA A PROPÓSITO. Un tercer motivo no se puede añadir «y ya»: hay que tratarlo en el
 * `switch`, y tratarlo obliga a decidir si esa superficie está diciendo que no o solo yéndose.
 */
export type MotivoDeLaBaja =
  /** La persona apagó el interruptor. DIJO QUE NO: la preferencia se borra (R7). */
  | "la-persona-apago-el-interruptor"
  /** La persona cerró sesión. NO dijo que no: la preferencia se conserva (R8). */
  | "cierre-de-sesion";

/** Qué le pasó al DISPOSITIVO. Se devuelve para que un test pueda afirmarlo; la interfaz no lo pinta. */
export type EstadoBajaPush = "sin-suscripcion" | "dada-de-baja" | "fallo-parcial";

/** Qué le pasó a la PREFERENCIA de la persona. Es la mitad nueva, y se cuenta APARTE del dispositivo. */
export type EstadoPreferenciaTrasBaja = "borrada" | "conservada" | "fallo-al-borrar";

export interface ResultadoBajaPush {
  estado: EstadoBajaPush;
  preferencia: EstadoPreferenciaTrasBaja;
}

/**
 * R23 — el `endpoint` es una dirección con una credencial de entrega dentro, así que no puede
 * acabar en la consola **ni de rebote**, dentro del mensaje de un error de red.
 *
 * Por eso la causa se limpia antes de registrarla: cualquier cosa con forma de dirección web se
 * sustituye. No es paranoia decorativa —un `TypeError: Failed to fetch https://fcm.googleapis…`
 * es exactamente la forma en que esto se filtraría— y se prueba con una mutación: un error que
 * lleva el endpoint dentro no lo puede dejar salir.
 */
function causaSinDirecciones(causa: unknown): string {
  const texto =
    causa instanceof Error ? `${causa.name}: ${causa.message}` : String(causa);
  return texto.replace(/\bhttps?:\/\/\S+/gi, "«dirección omitida»");
}

function registrarFallo(operacion: string, causa: unknown): void {
  console.error(`[push] ${operacion} falló`, causaSinDirecciones(causa));
}

/**
 * LA INTENCIÓN, RESUELTA EN UN SOLO SITIO Y DE FORMA EXHAUSTIVA.
 *
 * Devuelve qué pasó con la preferencia. NO LANZA (R12): un fallo al borrarla no puede impedir que
 * el dispositivo se dé de baja ni que la sesión se cierre.
 */
async function resolverLaIntencion(motivo: MotivoDeLaBaja): Promise<EstadoPreferenciaTrasBaja> {
  switch (motivo) {
    case "la-persona-apago-el-interruptor": {
      // R7 — DIJO QUE NO. Si no se borrara aquí, la aplicación volvería a suscribir este
      // dispositivo la próxima vez que la persona entrara: la habría contradicho.
      try {
        const resultado = await olvidarPreferenciaDeAvisos();
        if (resultado.status !== "ok") {
          registrarFallo("borrar la preferencia de avisos", resultado.status);
          return "fallo-al-borrar";
        }
        return "borrada";
      } catch (error) {
        registrarFallo("borrar la preferencia de avisos", error);
        return "fallo-al-borrar";
      }
    }
    case "cierre-de-sesion":
      // R8 — SOLO SE FUE. No se toca nada: la decisión de la persona sobrevive a la sesión, y es
      // lo que permite reactivar los avisos sin volver a pedirle nada cuando vuelva a entrar.
      return "conservada";
    default: {
      // Un motivo nuevo sin tratar NO COMPILA. Es la mitad del diseño de este archivo.
      const _exhaustivo: never = motivo;
      throw new Error(`motivo de baja sin tratar: ${String(_exhaustivo)}`);
    }
  }
}

export async function darDeBajaDeEsteDispositivo(
  motivo: MotivoDeLaBaja,
): Promise<ResultadoBajaPush> {
  // ⚠️ LA INTENCIÓN VA PRIMERO, Y ANTES DEL CORTE POR «SIN SUSCRIPCIÓN» (R11). No es orden
  // estético: si fuera después, apagar el interruptor en un dispositivo cuya suscripción se
  // evaporó entre el render y el clic —el navegador la caducó, otra pestaña se dio de baja— saldría
  // por `sin-suscripcion` dejando la preferencia PUESTA, y la aplicación resucitaría los avisos al
  // día siguiente. La persona habría dicho que no y la aplicación le habría dicho que sí.
  const preferencia = await resolverLaIntencion(motivo);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Y A PARTIR DE AQUÍ, EL TRABAJO DEL DISPOSITIVO ES **IDÉNTICO** PARA LOS DOS MOTIVOS (R9).
  // Ni una rama por motivo: las mismas dos mitades, en el mismo orden, con el mismo contrato de
  // no lanzar. Lo contrario es justo lo que la 410 evitó juntando las dos superficies aquí.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const contenedor = contenedorDeServiceWorker();
  if (!contenedor) return { estado: "sin-suscripcion", preferencia };

  let suscripcion: PushSubscription | null = null;
  try {
    const registro = await contenedor.getRegistration();
    suscripcion = (await registro?.pushManager?.getSubscription()) ?? null;
  } catch (error) {
    registrarFallo("leer la suscripción de este dispositivo", error);
    return { estado: "fallo-parcial", preferencia };
  }

  // R46: no haber estado suscrito nunca no es un fallo, ni aquí ni en el servidor.
  if (!suscripcion) return { estado: "sin-suscripcion", preferencia };

  let fallo = false;

  // EL SERVIDOR PRIMERO: es quien decide a qué dispositivos se envía. Si solo se pudiera hacer una
  // de las dos cosas, la que de verdad corta el push es ésta.
  //
  // ⚠️ 410/R19 INTACTO: se manda EL ENDPOINT DE ESTE NAVEGADOR y nada más, con los dos motivos. Las
  // suscripciones de los otros dispositivos de esta persona no se tocan —ni al salir ni al apagar
  // el interruptor—, y la acción del servidor además acota el borrado al par (usuario de la
  // sesión, endpoint). Aquí no hay, ni puede haber, una baja «de todos mis dispositivos».
  try {
    const resultado = await eliminarSuscripcionPush({ endpoint: suscripcion.endpoint });
    if (resultado.status !== "ok") {
      fallo = true;
      registrarFallo("borrar la suscripción en el servidor", resultado.status);
    }
  } catch (error) {
    fallo = true;
    registrarFallo("borrar la suscripción en el servidor", error);
  }

  // Y la baja en el navegador va IGUAL, aunque la de arriba haya fallado: son independientes, y
  // encadenarlas dejaría al dispositivo suscrito por un error que no es suyo.
  try {
    await suscripcion.unsubscribe();
  } catch (error) {
    fallo = true;
    registrarFallo("darse de baja en el navegador", error);
  }

  return { estado: fallo ? "fallo-parcial" : "dada-de-baja", preferencia };
}
