import { eliminarSuscripcionPush } from "@/lib/actions/push";
import { contenedorDeServiceWorker } from "@/lib/pwa/push-navegador";

/**
 * FICHA 410 (R15, R19, R20, R23) — LA BAJA DE **ESTE** DISPOSITIVO, en un solo sitio.
 *
 * La llaman dos superficies que no se parecen en nada: el interruptor del control
 * (`components/shared/PushOptIn.tsx`, R15) y el botón de salir (`app/_components/LogoutButton.tsx`,
 * R19). Que sea la misma función es lo que impide que una de las dos se olvide de la mitad del
 * trabajo —darse de baja en el navegador **y** borrar la fila en el servidor son dos cosas, y con
 * una sola el dispositivo sigue recibiendo o el servidor sigue intentándolo—.
 *
 * ## Esta función NO LANZA NUNCA, y ese es su contrato (R20)
 *
 * Quien la llama al cerrar sesión no puede quedarse decidiendo qué hacer con un fallo: la persona
 * pidió salir y sale. El fallo **no se absorbe en silencio** —queda registrado con su operación y
 * su causa, que es lo que pide `docs/conventions.md`— pero no se propaga.
 */

/** Qué pasó de verdad. Lo devuelve para que un test pueda afirmarlo; la interfaz no lo pinta. */
export type ResultadoBajaPush =
  | { estado: "sin-suscripcion" }
  | { estado: "dada-de-baja" }
  | { estado: "fallo-parcial" };

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

export async function darDeBajaDeEsteDispositivo(): Promise<ResultadoBajaPush> {
  const contenedor = contenedorDeServiceWorker();
  if (!contenedor) return { estado: "sin-suscripcion" };

  let suscripcion: PushSubscription | null = null;
  try {
    const registro = await contenedor.getRegistration();
    suscripcion = (await registro?.pushManager?.getSubscription()) ?? null;
  } catch (error) {
    registrarFallo("leer la suscripción de este dispositivo", error);
    return { estado: "fallo-parcial" };
  }

  // R46: no haber estado suscrito nunca no es un fallo, ni aquí ni en el servidor.
  if (!suscripcion) return { estado: "sin-suscripcion" };

  let fallo = false;

  // EL SERVIDOR PRIMERO: es quien decide a qué dispositivos se envía. Si solo se pudiera hacer una
  // de las dos cosas, la que de verdad corta el push es ésta.
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

  return fallo ? { estado: "fallo-parcial" } : { estado: "dada-de-baja" };
}
