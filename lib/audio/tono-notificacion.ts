/**
 * Feature 161 — generador del tono de aviso in-app (design §2.1).
 *
 * PREMISA de la feature: no existe API para invocar el tono del sistema desde JS. El tono
 * nativo solo suena con la Notification API (feature 162, sin implementar); para el aviso
 * in-app hay que producir el sonido, y se SINTETIZA en lugar de enviar un archivo (D2):
 * cero assets, cero peso de red, funciona offline sin tocar `public/sw.js` y el timbre se
 * ajusta editando las constantes de abajo.
 *
 * Todo fallo es SILENCIOSO por diseno (R4, R6), mismo criterio que el R48 de la feature
 * 146: un tono que no puede sonar no rompe la cabecera ni interrumpe al usuario.
 *
 * Sin React ni ciclo de render (R8): se ejercita sin montar componentes.
 */

/** Las dos notas, en Hz: A5 -> D6. La segunda MAS aguda que la primera (R2). */
const NOTAS_HZ = [880, 1174.66] as const;

/** Duracion de cada nota. Dos notas = 180 ms, por debajo del techo de 300 ms (R2). */
const DURACION_NOTA_S = 0.09;

/** Ganancia pico: un aviso, no un sobresalto. */
const GANANCIA_PICO = 0.12;

/**
 * Valor al que baja la rampa de atenuacion. `exponentialRampToValueAtTime` no admite cero,
 * y este es lo bastante bajo para ser silencio audible sin chasquido al cortar (R3).
 */
const GANANCIA_SILENCIO = 0.0001;

/** Contexto reutilizado durante toda la carga de pagina (R5). */
let contexto: AudioContext | null = null;

/** Evita acumular listeners de desbloqueo con varias superficies montadas (R7). */
let gestoRegistrado = false;

type ConstructorAudioContext = new () => AudioContext;

/** El constructor del contexto, o `null` si estamos en servidor (R9) o sin soporte (R4). */
function obtenerConstructor(): ConstructorAudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    webkitAudioContext?: ConstructorAudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Contexto perezoso y unico (R5). Devuelve `null` en servidor o sin soporte, y tambien si
 * el navegador rechaza crearlo: quien llama NUNCA recibe una excepcion (R4, R9).
 */
function obtenerContexto(): AudioContext | null {
  if (contexto) return contexto;
  const Constructor = obtenerConstructor();
  if (!Constructor) return null;
  try {
    contexto = new Constructor();
  } catch {
    // Navegador con la API presente pero que rechaza instanciarla (limite de contextos,
    // politica del embebido). Es exactamente el caso de R4: sin sonido y sin ruido.
    contexto = null;
  }
  return contexto;
}

/** Programa una nota: oscilador sinusoidal con rampa de atenuacion hasta el silencio (R3). */
function programarNota(ctx: AudioContext, frecuencia: number, inicio: number): void {
  const oscilador = ctx.createOscillator();
  const ganancia = ctx.createGain();

  oscilador.type = "sine";
  oscilador.frequency.value = frecuencia;

  const fin = inicio + DURACION_NOTA_S;
  ganancia.gain.setValueAtTime(GANANCIA_PICO, inicio);
  ganancia.gain.exponentialRampToValueAtTime(GANANCIA_SILENCIO, fin);

  oscilador.connect(ganancia);
  ganancia.connect(ctx.destination);
  oscilador.start(inicio);
  oscilador.stop(fin);
}

/**
 * Prepara el audio en el PRIMER gesto del usuario (R7). Es obligatorio: la politica de
 * autoplay hace nacer el contexto en `suspended`, y sin un gesto previo el tono no se oye.
 * Idempotente: solo el primer llamado registra los listeners.
 */
export function prepararAudio(): void {
  if (gestoRegistrado || typeof window === "undefined") return;
  gestoRegistrado = true;

  const desbloquear = () => {
    const ctx = obtenerContexto();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };

  window.addEventListener("pointerdown", desbloquear, { once: true, passive: true });
  window.addEventListener("keydown", desbloquear, { once: true, passive: true });
}

/**
 * Emite el tono: dos notas breves y ascendentes (R2). Si el contexto quedo suspendido
 * (pestana que volvio de background, gesto que nunca ocurrio) intenta reanudarlo y emite
 * tras el reanudado; si no lo logra, no suena y no lanza (R6).
 */
export function reproducirTono(): void {
  const ctx = obtenerContexto();
  if (!ctx) return;

  const emitir = () => {
    try {
      const ahora = ctx.currentTime;
      NOTAS_HZ.forEach((frecuencia, i) => {
        programarNota(ctx, frecuencia, ahora + i * DURACION_NOTA_S);
      });
    } catch {
      // El contexto pudo cerrarse entre la comprobacion y el uso. Fallo silencioso (R4).
    }
  };

  if (ctx.state === "suspended") {
    void ctx
      .resume()
      .then(emitir)
      .catch(() => {});
    return;
  }
  emitir();
}

/** Solo para tests: limpia el singleton y la marca de listener entre casos. */
export function reiniciarAudioParaTests(): void {
  contexto = null;
  gestoRegistrado = false;
}
