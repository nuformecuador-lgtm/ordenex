"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";

import { obtenerClavePublicaPush, registrarSuscripcionPush } from "@/lib/actions/push";
import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";
import {
  claveAplicacionDesde,
  clavesDeSuscripcion,
  contenedorDeServiceWorker,
  etiquetaDeDispositivo,
  haySoportePush,
} from "@/lib/pwa/push-navegador";

/**
 * FICHA 410 (tanda 5, T5.1 — R10-R15, R45, R46) — EL ESTADO DEL CANAL **EN ESTE DISPOSITIVO**.
 *
 * ## La decisión difícil de esta ficha vive aquí: CUÁNDO se pide el permiso
 *
 * **Nunca al montar (R10).** Un «no» del navegador es casi irreversible —hay que entrar a los
 * ajustes del sitio, y nadie entra—, así que pedirlo en el primer segundo, sin contexto y sin que
 * nadie haya echado nada de menos, es la forma más eficiente de perder el canal PARA SIEMPRE en
 * media plantilla. Además, en iOS `requestPermission` exige un gesto del usuario: al cargar ni
 * siquiera funcionaría.
 *
 * `Notification.requestPermission()` se llama en **un solo sitio de todo el árbol**, dentro de
 * `activar()`, que solo corre cuando la persona toca el interruptor (R11). Leer
 * `Notification.permission` —que es lo que hace el efecto de montaje— NO es pedirlo.
 *
 * ## Qué es un estado y qué es un fallo
 *
 * `clavePublica: null` significa «este despliegue no tiene canal» y **no es un error** (R13/R30,
 * lección de la ficha 400: un fallo de configuración no bloquea la operación). Sale como el estado
 * `sin-canal` y el control sencillamente no se ofrece. Lo mismo con una lectura que falla: se cae
 * hacia «no hay canal», nunca hacia «hay canal» — prometer menos y cumplir.
 *
 * ## R46: no tener suscripción no degrada nada
 *
 * Este hook no toca la campana ni sus datos. Un dispositivo sin suscripción sigue viendo todos sus
 * avisos exactamente igual; lo único que no tiene es el aviso del sistema con la app cerrada.
 */

/** Clave de caché de SWR para la clave pública. Estable para que las dos superficies compartan. */
export const CLAVE_PUBLICA_PUSH_SWR_KEY = "push:clave-publica";

export type EstadoPush =
  /** Todavía no se sabe: ni se pinta el control ni se pinta su ausencia. */
  | "cargando"
  /** No hay claves VAPID en este despliegue (R13/R30). No se ofrece nada. */
  | "sin-canal"
  /** El navegador no trae `PushManager` — el caso real es iOS sin instalar (R45). */
  | "no-soportado"
  /** Se puede activar y no está activado en este dispositivo. */
  | "sin-activar"
  /** Hay suscripción viva en este dispositivo (R14). */
  | "activado"
  /** El permiso está en «denegado»: no se vuelve a pedir (R12). */
  | "bloqueado";

interface EstadoDelDispositivo {
  soportado: boolean;
  permiso: NotificationPermission | null;
  suscrito: boolean;
}

export interface UsePushSuscripcionResult {
  /** R14: qué pasa EN ESTE DISPOSITIVO, en una sola palabra. */
  estado: EstadoPush;
  /** Hay una operación en curso: el control se bloquea para no pedir dos veces. */
  ocupado: boolean;
  /** R11: pide el permiso y suscribe. Es el ÚNICO camino hasta `requestPermission`. */
  activar: () => Promise<void>;
  /** R15: baja en el servidor y en el navegador. */
  desactivar: () => Promise<void>;
}

/**
 * La clave pública, por SWR porque es un dato PÚBLICO del cliente y se comparte entre superficies.
 *
 * Una lectura fallida devuelve `null`, o sea «sin canal»: es la caída correcta, porque la
 * alternativa —ofrecer el control con una clave que no tenemos— termina en un `subscribe` que
 * revienta después del permiso, que es el peor momento posible para fallar.
 */
async function leerClavePublica(): Promise<string | null> {
  const resultado = await obtenerClavePublicaPush();
  return resultado.status === "ok" ? resultado.clavePublica : null;
}

export function usePushSuscripcion(): UsePushSuscripcionResult {
  const { data: clavePublica, isLoading: cargandoClave } = useSWR<string | null>(
    CLAVE_PUBLICA_PUSH_SWR_KEY,
    leerClavePublica,
    {
      // La clave se resuelve en tiempo de ejecución (R32) pero cambia cada varios meses: revalidar
      // al enfocar la ventana sería una petición por cada vuelta a la pestaña, en cada pantalla,
      // para un dato que no se mueve. Una recarga la recoge, y rotar una clave ya implica avisar.
      revalidateOnFocus: false,
      revalidateIfStale: false,
    },
  );

  const [dispositivo, setDispositivo] = useState<EstadoDelDispositivo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // ⚠️ R10 — ESTE EFECTO NO PIDE NADA. Mira si el navegador puede, LEE el permiso que ya hay y
  // pregunta si este dispositivo tiene suscripción. Ni una llamada a `requestPermission`.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      if (!haySoportePush()) {
        if (vivo) setDispositivo({ soportado: false, permiso: null, suscrito: false });
        return;
      }
      const permiso = Notification.permission;
      let suscrito = false;
      try {
        const registro = await contenedorDeServiceWorker()?.getRegistration();
        suscrito = Boolean(await registro?.pushManager?.getSubscription());
      } catch {
        // Sin registro de service worker no hay suscripción que encontrar. No es un error que la
        // persona deba ver: el control aparece «sin activar», que es la verdad.
        suscrito = false;
      }
      if (vivo) setDispositivo({ soportado: true, permiso, suscrito });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const estado: EstadoPush =
    dispositivo === null || cargandoClave
      ? "cargando"
      : // El canal manda sobre el soporte, y el orden es deliberado: sin claves VAPID no hay push
        // en NINGÚN navegador, así que decirle a alguien «instala la app en tu pantalla de inicio»
        // sería mandarle a dar un paso que no le va a servir de nada (R13 antes que R45).
        !clavePublica
        ? "sin-canal"
        : !dispositivo.soportado
          ? "no-soportado"
          : dispositivo.permiso === "denied"
            ? "bloqueado"
            : dispositivo.suscrito
              ? "activado"
              : "sin-activar";

  const activar = useCallback(async () => {
    if (ocupado || !dispositivo?.soportado || !clavePublica) return;
    // R12: con el permiso denegado NO se vuelve a pedir. La llamada sería un no-op silencioso en
    // el navegador, y aquí se corta antes para que quede escrito que es una decisión.
    if (dispositivo.permiso === "denied") return;

    setOcupado(true);
    try {
      // R11 — EL ÚNICO `requestPermission` DEL ÁRBOL, y solo tras el gesto de la persona.
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setDispositivo({ soportado: true, permiso, suscrito: false });
        return;
      }

      const contenedor = contenedorDeServiceWorker();
      if (!contenedor) return;
      const registro = await contenedor.ready;
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveAplicacionDesde(clavePublica),
      });

      const claves = clavesDeSuscripcion(suscripcion);
      if (!claves) {
        await suscripcion.unsubscribe();
        console.error("[push] el navegador entregó una suscripción incompleta");
        setDispositivo({ soportado: true, permiso, suscrito: false });
        return;
      }

      const resultado = await registrarSuscripcionPush({
        ...claves,
        etiqueta: etiquetaDeDispositivo(navigator.userAgent),
      });
      if (resultado.status !== "ok") {
        // Una suscripción viva que el servidor no conoce es un dispositivo que cree que va a
        // recibir avisos y no los va a recibir: se deshace.
        await suscripcion.unsubscribe();
        console.error("[push] registrar la suscripción falló", resultado.status);
        setDispositivo({ soportado: true, permiso, suscrito: false });
        return;
      }

      setDispositivo({ soportado: true, permiso, suscrito: true });
    } catch (error) {
      // El permiso concedido y el `subscribe` fallido es un estado real (sin red, sin service
      // worker). No se afirma «activado»: se registra y se deja el control como estaba.
      console.error("[push] activar los avisos en este dispositivo falló", error);
    } finally {
      setOcupado(false);
    }
  }, [clavePublica, dispositivo, ocupado]);

  const desactivar = useCallback(async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      // R15: baja en el servidor Y en el navegador, en un solo sitio y sin lanzar.
      await darDeBajaDeEsteDispositivo();
      setDispositivo((previo) => (previo ? { ...previo, suscrito: false } : previo));
    } finally {
      setOcupado(false);
    }
  }, [ocupado]);

  return { estado, ocupado, activar, desactivar };
}
