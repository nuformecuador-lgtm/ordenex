import { registrarSuscripcionPush } from "@/lib/actions/push";
import {
  claveAplicacionDesde,
  clavesDeSuscripcion,
  contenedorDeServiceWorker,
  etiquetaDeDispositivo,
} from "@/lib/pwa/push-navegador";

/**
 * FICHA 422 (design §4, T4.1) — EL ALTA DE **ESTE** DISPOSITIVO, en un solo sitio. Simétrico de
 * `lib/pwa/baja-push.ts`.
 *
 * ## Por qué existe este archivo
 *
 * `activar()` hacía hoy dos cosas distintas en el mismo sitio: **pedir el permiso** —que es un
 * gesto de la persona y solo puede ocurrir tras tocar el interruptor (410/R10, R11)— y **suscribir
 * y registrar**. La reactivación silenciosa de esta ficha necesita la segunda **sin** la primera.
 * Extraerla es lo que permite que exista un solo camino hasta `pushManager.subscribe(`, en vez de
 * dos copias que se desincronizan.
 *
 * ## ⚠️ AQUÍ EL PERMISO SE **COMPRUEBA**, NUNCA SE PIDE (R16, R17)
 *
 * Esta función **no llama a `Notification.requestPermission()` jamás**, y una guardia del árbol
 * (`push-alta-punto-unico.guardia.test.ts`) exige que esa llamada siga apareciendo **una sola vez**
 * en todo el repositorio, dentro de `activar()`. Su primera comprobación real es
 * `Notification.permission !== "granted"`, y ahí se corta.
 *
 * **La preferencia no entra en esta función**, y eso es deliberado: quien la consulta es el
 * llamante, y aun con ella puesta esto no pasa de la comprobación del permiso sin permiso
 * concedido. Es el «la preferencia puesta no puede saltarse la comprobación del permiso» escrito
 * como una comprobación **propia**, no delegada en que el navegador lance: un `subscribe` sin
 * permiso rechaza, sí, pero entonces la regla viviría en el navegador y no en el código —y no
 * habría dónde ponerla roja—.
 *
 * ## R23 — aquí no se registra el `endpoint` ni las claves
 *
 * Los mensajes de fallo dicen QUÉ operación falló, nunca la credencial de entrega.
 */

/** Qué pasó de verdad con el alta. Lo consume el hook (para pintar estado) y la reactivación. */
export type ResultadoAlta =
  /** Hay suscripción viva en este dispositivo y el servidor la conoce. */
  | { estado: "suscrito" }
  /** ⚠️ El permiso NO está concedido. NO se pidió: se comprobó (R16/R17). */
  | { estado: "sin-permiso" }
  /** Este navegador no puede: sin service worker, o sin `PushManager` (el iPhone sin instalar). */
  | { estado: "sin-soporte" }
  /** Se intentó y no salió: sin red, `subscribe` rechazado, suscripción incompleta, servidor que
   *  rechaza el registro. El estado mostrado sigue siendo «sin activar» (R20). */
  | { estado: "fallo" };

function registrarFallo(operacion: string, causa: unknown): void {
  // Sin el `endpoint` ni las claves, ni de rebote: lo que se escribe es la operación y la causa.
  console.error(`[push] ${operacion} falló`, causa);
}

/**
 * Suscribe este dispositivo y registra la suscripción a nombre de la sesión abierta.
 *
 * `clavePublica` entra por parámetro porque quien la tiene ya resuelta es el llamante (el hook por
 * SWR, la reactivación por su propia lectura): pedirla aquí dentro sería una ida al servidor de más
 * en el camino en que ya se tenía.
 */
export async function suscribirYRegistrarEsteDispositivo(
  clavePublica: string,
): Promise<ResultadoAlta> {
  // ⚠️ PRIMERO EL PERMISO, Y SE LEE. `Notification.permission` es una LECTURA; `requestPermission()`
  // es una PETICIÓN, y esa no está en este archivo ni puede estarlo. Con el permiso en «default» o
  // en «denied» se corta aquí y no se suscribe nada, ESTÉ PUESTA O NO LA PREFERENCIA (R17).
  if (typeof Notification === "undefined") return { estado: "sin-soporte" };
  if (Notification.permission !== "granted") return { estado: "sin-permiso" };

  const contenedor = contenedorDeServiceWorker();
  if (!contenedor) return { estado: "sin-soporte" };

  try {
    // ⚠️ `getRegistration()` y NO `ready`: `navigator.serviceWorker.ready` no resuelve NUNCA si no
    // hay registro activo —y en desarrollo el service worker se des-registra solo—, así que
    // esperarlo aquí dejaría una promesa colgada para siempre en el camino silencioso.
    //
    // ESTO CAMBIA UNA LÍNEA DE `activar()`, y queda dicho en voz alta: antes esperaba a `ready`.
    // El intercambio es favorable en los dos extremos. Lo que se gana: `activar()` deja de poder
    // colgarse con el control deshabilitado para siempre si el worker nunca activa. Lo que se
    // arriesga: si alguien tocara el interruptor en el instante en que el worker aún está
    // instalando, `subscribe` rechaza y sale `{estado:"fallo"}` — el control se queda en «sin
    // activar», visible y reintentable, no en un estado mentiroso. El registro del worker ocurre
    // al cargar la página (`app/layout.tsx`), muy antes de que nadie abra el panel de la campana.
    const registro = await contenedor.getRegistration();
    if (!registro?.pushManager) return { estado: "sin-soporte" };

    const suscripcion = await registro.pushManager.subscribe({
      // Obligatorio en Chrome: sin él, `subscribe` rechaza.
      userVisibleOnly: true,
      applicationServerKey: claveAplicacionDesde(clavePublica),
    });

    const claves = clavesDeSuscripcion(suscripcion);
    if (!claves) {
      // Una suscripción a medias deja una fila que nunca podrá entregar nada y que el servicio de
      // push rechazará una y otra vez.
      await suscripcion.unsubscribe();
      registrarFallo("suscribir este dispositivo", "el navegador entregó una suscripción incompleta");
      return { estado: "fallo" };
    }

    const resultado = await registrarSuscripcionPush({
      ...claves,
      etiqueta: etiquetaDeDispositivo(navigator.userAgent),
    });
    if (resultado.status !== "ok") {
      // Una suscripción viva que el servidor no conoce es un dispositivo que cree que va a recibir
      // avisos y no los va a recibir: se deshace.
      await suscripcion.unsubscribe();
      registrarFallo("registrar la suscripción", resultado.status);
      return { estado: "fallo" };
    }

    return { estado: "suscrito" };
  } catch (error) {
    // El permiso concedido y el `subscribe` fallido es un estado real (sin red, sin service
    // worker activo). No se afirma «suscrito»: se registra y el llamante deja el control como
    // estaba (R20).
    registrarFallo("activar los avisos en este dispositivo", error);
    return { estado: "fallo" };
  }
}
