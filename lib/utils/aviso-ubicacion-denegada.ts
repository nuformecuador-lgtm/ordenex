// Feature 399 — QUÉ se le dice al mensajero cuando el permiso de ubicación está DENEGADO.
//
// El desenlace `denegado` de `capturar-ubicacion.ts` no se toca: sigue saliendo SOLO con el
// código 1 (PERMISSION_DENIED) y sigue siendo el único que bloquea la gestión (feature 193,
// R19). Lo que cambia es el TEXTO, que hasta hoy mandaba SIEMPRE «al candado de la barra de
// direcciones».
//
// EL FALLO, medido en campo el 2026-09-08: `public/manifest.json` declara
// `"display": "standalone"`, así que una Ordenex abierta desde el ícono de la pantalla de
// inicio NO TIENE barra de direcciones NI candado. El aviso mandaba a una mensajera a tocar
// algo que en su pantalla no existe, y se quedó parada en la calle sin poder registrar la
// entrega. En Android ese permiso vive en Ajustes → Aplicaciones → Ordenex → Permisos →
// Ubicación, con «Usar ubicación precisa» activado, y de eso el mensaje no decía nada.
//
// DOS SEÑALES, y las dos son estándar (aquí no se husmea el user agent):
//
//  1. `display-mode` (media query) dice si la app está abierta INSTALADA o dentro de un
//     navegador. La soporta cualquier navegador capaz de instalar una PWA.
//  2. `navigator.permissions.query({ name: "geolocation" })` dice el estado del permiso DEL
//     SITIO, que no es lo mismo que el permiso del sistema operativo. Sirve para separar tres
//     cosas que el código 1 mezcla: el sitio bloqueado (`denegado`), el aviso que nunca se
//     contestó (`sin_decidir`) y el sitio con permiso al que el teléfono se lo niega igual
//     (`concedido` → el bloqueo está por encima del sitio, en la app).
//
// LO QUE NO SE HACE, A PROPÓSITO:
//
//  - **No se detecta el navegador embebido de WhatsApp.** No hay API que lo diga; la única vía
//    sería el user agent, que es justo lo que una app anfitriona puede reescribir a su gusto —y
//    además WhatsApp abre unas veces en su WebView y otras en una pestaña de Chrome, donde el
//    candado SÍ existe—. Una detección que acierte a medias manda a la gente al sitio
//    equivocado con más confianza que ahora, que es el fallo que esta ficha viene a arreglar.
//    Se cubre con UN texto que sirve en los dos: el candado, más una línea para salir del
//    navegador embebido si no lo ve.
//  - **No se distingue Android de iOS.** El caso medido es Android y la ruta de Ajustes que se
//    da es la de Android. En un iPhone con la app en la pantalla de inicio el nombre de los
//    menús no es exactamente ese; queda declarado como límite conocido en vez de inventado.
//  - **No se usa `navigator.standalone`** (el `display-mode` estándar ya cubre iOS 13+, y todo
//    lo anterior no puede instalar esta app).

/** Cómo está abierta la app AHORA. `navegador` incluye el navegador embebido de otra app. */
export type ContextoDeApertura = "app_instalada" | "navegador";

/**
 * Estado del permiso DEL SITIO según la Permissions API. `desconocido` cuando la API no está,
 * no conoce `geolocation` o lanza: entonces no se fuerza nada y manda el contexto.
 */
export type PermisoUbicacion =
  | "denegado"
  | "concedido"
  | "sin_decidir"
  | "desconocido";

/** Lo que se le muestra: una línea para el toast y los pasos para la pantalla. */
export interface AvisoUbicacion {
  /** Una sola frase, la que se lee de un vistazo con el teléfono en la mano. */
  resumen: string;
  titulo: string;
  /** Pasos numerados, uno por gesto. */
  pasos: readonly string[];
  /** Salida alternativa cuando el paso 1 no aparece en su pantalla. */
  nota?: string;
}

const PASO_AJUSTES = "Abrí los Ajustes del teléfono (en algunos se llama Configuración).";
const PASO_PERMISOS = "Tocá Permisos y después Ubicación.";
const PASO_PRECISA =
  "Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».";

/**
 * Ordenex abierta desde su ícono: no hay barra de direcciones ni candado, y el permiso es el
 * de la aplicación. Se evita nombrar el candado incluso para negarlo: mandar la vista a
 * buscar algo que no está es exactamente lo que dejó parada a la mensajera.
 */
const AVISO_APP_INSTALADA: AvisoUbicacion = {
  resumen:
    "Para registrar la gestión hace falta tu ubicación. Abriste Ordenex desde su ícono, " +
    "así que el permiso se activa en los Ajustes del teléfono.",
  titulo: "Activá la ubicación desde los Ajustes del teléfono",
  pasos: [
    PASO_AJUSTES,
    "Entrá en Aplicaciones y buscá Ordenex.",
    PASO_PERMISOS,
    PASO_PRECISA,
    "Volvé a Ordenex y tocá «Guardar gestión» otra vez.",
  ],
};

/**
 * El texto de siempre, que en un navegador es CORRECTO y por eso se conserva palabra por
 * palabra. Lo único que se le suma es la salida para quien entró desde un enlace de WhatsApp.
 */
const AVISO_NAVEGADOR: AvisoUbicacion = {
  resumen:
    "Para registrar la gestión hace falta tu ubicación. Activá el permiso desde el candado " +
    "de la barra de direcciones (Permisos del sitio → Ubicación) y volvé a intentarlo.",
  titulo: "Activá la ubicación para este sitio",
  pasos: [
    "Tocá el candado que está al lado de la dirección web, arriba.",
    "Entrá en Permisos del sitio y activá Ubicación.",
    "Volvé acá y tocá «Guardar gestión» otra vez.",
  ],
  nota:
    "Si abriste Ordenex desde un enlace de WhatsApp y no ves el candado, tocá los tres " +
    "puntos y elegí «Abrir en Chrome».",
};

/**
 * El sitio YA tiene el permiso y aun así el navegador devolvió PERMISSION_DENIED: el bloqueo
 * está un piso más arriba, en el permiso que el teléfono le da a la app del navegador. Mandar
 * a esta persona al candado sería mandarla a un interruptor que ya está encendido.
 */
const AVISO_NAVEGADOR_SIN_PERMISO_DEL_TELEFONO: AvisoUbicacion = {
  resumen:
    "Para registrar la gestión hace falta tu ubicación. Este sitio ya tiene el permiso, " +
    "así que hay que dárselo al navegador desde los Ajustes del teléfono.",
  titulo: "El permiso lo tiene que dar el teléfono",
  pasos: [
    PASO_AJUSTES,
    "Entrá en Aplicaciones y buscá el navegador que estás usando: Chrome, Samsung Internet…",
    PASO_PERMISOS,
    PASO_PRECISA,
    "Volvé acá y tocá «Guardar gestión» otra vez.",
  ],
};

/**
 * Nadie ha decidido nada todavía (el aviso del navegador se cerró sin contestar). Aquí no hay
 * ningún ajuste que cambiar: hay que volver a pedirlo y tocar «Permitir». La nota apunta al
 * sitio que corresponde por si el aviso no llega a salir.
 */
function avisoSinDecidir(contexto: ContextoDeApertura): AvisoUbicacion {
  return {
    resumen:
      "Para registrar la gestión hace falta tu ubicación. Tocá «Guardar gestión» otra vez y " +
      "elegí «Permitir» cuando el teléfono te pregunte.",
    titulo: "Falta que aceptes el aviso de ubicación",
    pasos: [
      "Tocá «Guardar gestión» otra vez.",
      "Cuando el teléfono te pregunte por la ubicación, elegí «Permitir».",
    ],
    nota:
      contexto === "app_instalada"
        ? "Si no te sale ningún aviso, activá la ubicación en los Ajustes del teléfono: Aplicaciones → Ordenex → Permisos → Ubicación."
        : "Si no te sale ningún aviso, tocá el candado que está al lado de la dirección web y activá Ubicación.",
  };
}

/**
 * Qué se le dice, según cómo esté abierta la app y qué diga la Permissions API.
 *
 * En `app_instalada` el permiso del sitio y el de la aplicación son el mismo interruptor para
 * quien lo usa, así que `denegado`, `concedido` y `desconocido` van todos a la misma ruta de
 * Ajustes: no hay nada que ganar partiéndolos y sí que perder mandando a dos sitios.
 */
export function avisoUbicacionDenegada(
  contexto: ContextoDeApertura,
  permiso: PermisoUbicacion,
): AvisoUbicacion {
  if (permiso === "sin_decidir") return avisoSinDecidir(contexto);
  if (contexto === "app_instalada") return AVISO_APP_INSTALADA;
  if (permiso === "concedido") return AVISO_NAVEGADOR_SIN_PERMISO_DEL_TELEFONO;
  return AVISO_NAVEGADOR;
}

/**
 * Los tres `display-mode` en los que el navegador NO pinta una barra de direcciones con
 * candado que tocar. `minimal-ui` entra porque su barra reducida tampoco lo lleva.
 */
const MODOS_SIN_BARRA_DE_DIRECCIONES = [
  "(display-mode: standalone)",
  "(display-mode: fullscreen)",
  "(display-mode: minimal-ui)",
] as const;

/**
 * Cómo está abierta la app. **Se llama desde un manejador de eventos, nunca al renderizar**:
 * en el servidor `window` no existe, y resolverlo en el primer render obligaría a pintar una
 * respuesta provisional que puede ser la equivocada.
 *
 * Ante la duda devuelve `navegador`, y no es por simetría: `matchMedia` lo tiene cualquier
 * navegador capaz de instalar una PWA, así que si falta, lo que hay delante no es una app
 * instalada. Además es el texto que ya se venía dando y es el correcto en un navegador.
 */
export function detectarContextoDeApertura(): ContextoDeApertura {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "navegador";
  }
  const sinBarra = MODOS_SIN_BARRA_DE_DIRECCIONES.some((consulta) => {
    try {
      return window.matchMedia(consulta).matches === true;
    } catch {
      // Un `matchMedia` que no entiende la consulta no es una app instalada: es un navegador
      // viejo. Se ignora esta consulta y se sigue con las otras.
      return false;
    }
  });
  return sinBarra ? "app_instalada" : "navegador";
}

/**
 * Estado del permiso del SITIO. Nunca lanza: lo que no se puede saber se dice `desconocido` y
 * el texto lo decide el contexto. Safari no expone `geolocation` en la Permissions API en
 * todas sus versiones y `query` lanza `TypeError` con un nombre que no conoce — por eso el
 * `try` envuelve la llamada entera y no solo el `await`.
 */
export async function leerPermisoUbicacion(): Promise<PermisoUbicacion> {
  if (typeof navigator === "undefined") return "desconocido";
  const permisos = navigator.permissions as Permissions | undefined;
  if (!permisos || typeof permisos.query !== "function") return "desconocido";
  try {
    const estado = await permisos.query({
      name: "geolocation" as PermissionName,
    });
    switch (estado?.state) {
      case "denied":
        return "denegado";
      case "granted":
        return "concedido";
      case "prompt":
        return "sin_decidir";
      default:
        return "desconocido";
    }
  } catch {
    // No se propaga: esto se consulta para MEJORAR un mensaje, y quedarse sin mensaje sería
    // peor que darlo por el contexto. El desenlace queda tipificado como `desconocido`.
    return "desconocido";
  }
}
