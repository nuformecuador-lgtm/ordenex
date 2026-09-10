import { describe, it, expect, afterEach } from "vitest";
import { loadWebhookConfig, pausaConfigDe } from "@/lib/config/webhook";

// Feature 99 (R28/R32) — la configuracion ausente o vacia se resuelve a defaults sin lanzar;
// la clave de cifrado ausente -> null (no lanza). Patron geocode-config.
//
// FICHA 403 (T4, R8) — los TRES numeros del circuito entran por el mismo patron: default sin env,
// override por env, invalido -> default, y NUNCA lanza. Que no lance no es cosmetico: esta config
// la carga el drenador de la cola, que comparte proceso con otros cinco tipos de job; una
// excepcion al CARGARLA tumbaria la corrida entera.

const KEYS = [
  "WEBHOOK_TIMEOUT_MS",
  "WEBHOOK_REPLAY_WINDOW_S",
  "WEBHOOK_SECRET_ENC_KEY",
  // FICHA 403
  "WEBHOOK_PAUSA_FALLOS_MINIMOS",
  "WEBHOOK_PAUSA_VENTANA_MINUTOS",
  "WEBHOOK_PAUSA_INTERVALO_MS",
] as const;
const snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("R28 — config ausente/vacia -> defaults sin lanzar", () => {
  it("sin ninguna env definida devuelve los defaults y no lanza", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(300);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("valores vacios o invalidos caen a los defaults (no lanza)", () => {
    process.env.WEBHOOK_TIMEOUT_MS = "";
    process.env.WEBHOOK_REPLAY_WINDOW_S = "no-numero";
    process.env.WEBHOOK_SECRET_ENC_KEY = "";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(300);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("R32: la clave de cifrado ausente resuelve a null sin lanzar", () => {
    delete process.env.WEBHOOK_SECRET_ENC_KEY;
    expect(() => loadWebhookConfig()).not.toThrow();
    expect(loadWebhookConfig().WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("valores validos se leen tal cual", () => {
    process.env.WEBHOOK_TIMEOUT_MS = "3000";
    process.env.WEBHOOK_REPLAY_WINDOW_S = "120";
    process.env.WEBHOOK_SECRET_ENC_KEY = "una-clave";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(3000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(120);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBe("una-clave");
  });
});

describe("403/R8 — los tres numeros del circuito: 3 fallos / 30 min / 1 h por defecto", () => {
  it("⭑ sin ninguna env, los defaults son EXACTAMENTE los que fija R8", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_PAUSA_FALLOS_MINIMOS).toBe(3);
    // Se configura en MINUTOS y sale en MS: 30 min. Se afirma el numero final, que es el que usa
    // el predicado — no la multiplicacion, que seria afirmar contra su propia formula.
    expect(cfg.WEBHOOK_PAUSA_VENTANA_MS).toBe(1_800_000);
    // 1 h, el MISMO valor que `JOBS_BACKOFF_CAP_MS` por defecto: el peor caso de espera que este
    // sistema ya tolera para cualquier tipo de job (design §3).
    expect(cfg.WEBHOOK_PAUSA_INTERVALO_MS).toBe(3_600_000);
  });

  it("⭑ un env valido gana al default en los tres", () => {
    process.env.WEBHOOK_PAUSA_FALLOS_MINIMOS = "7";
    process.env.WEBHOOK_PAUSA_VENTANA_MINUTOS = "5";
    process.env.WEBHOOK_PAUSA_INTERVALO_MS = "900000";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_PAUSA_FALLOS_MINIMOS).toBe(7);
    expect(cfg.WEBHOOK_PAUSA_VENTANA_MS).toBe(300_000); // 5 min
    expect(cfg.WEBHOOK_PAUSA_INTERVALO_MS).toBe(900_000);
  });

  it("⭑ vacio, texto, cero y negativo caen al default SIN lanzar", () => {
    // El invariante del modulo (R28) aplicado a los tres nuevos: un env mal puesto degrada al
    // comportamiento por defecto, nunca tumba el drenado de la cola.
    //
    // ⚠️ UN DECIMAL **NO** ESTA EN ESTA LISTA, y es una decision consciente: `readPositiveInt` —el
    // helper compartido de este archivo desde la feature 99— usa `Number.parseInt`, asi que "3.5"
    // se lee como 3. Se mide abajo, por separado, en vez de "arreglarlo" aqui: cambiar el helper
    // afectaria tambien a `WEBHOOK_TIMEOUT_MS` y `WEBHOOK_REPLAY_WINDOW_S`, que llevan un año con
    // esa semantica. Un truncado es un valor razonable; una excepcion tumbaria la cola.
    for (const malo of ["", "  ", "no-numero", "0", "-5"]) {
      process.env.WEBHOOK_PAUSA_FALLOS_MINIMOS = malo;
      process.env.WEBHOOK_PAUSA_VENTANA_MINUTOS = malo;
      process.env.WEBHOOK_PAUSA_INTERVALO_MS = malo;
      expect(() => loadWebhookConfig()).not.toThrow();
      const cfg = loadWebhookConfig();
      expect(cfg.WEBHOOK_PAUSA_FALLOS_MINIMOS, `con "${malo}"`).toBe(3);
      expect(cfg.WEBHOOK_PAUSA_VENTANA_MS, `con "${malo}"`).toBe(1_800_000);
      expect(cfg.WEBHOOK_PAUSA_INTERVALO_MS, `con "${malo}"`).toBe(3_600_000);
    }
  });

  it("un decimal se TRUNCA (semantica heredada de `readPositiveInt`), no lanza ni cae al default", () => {
    // Se fija por escrito para que nadie lo lea como un descuido. `parseInt("3.5") === 3`.
    process.env.WEBHOOK_PAUSA_FALLOS_MINIMOS = "3.9";
    process.env.WEBHOOK_PAUSA_VENTANA_MINUTOS = "45.7";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_PAUSA_FALLOS_MINIMOS).toBe(3);
    expect(cfg.WEBHOOK_PAUSA_VENTANA_MS).toBe(2_700_000); // 45 min
  });

  it("⭑ `pausaConfigDe` traduce a la forma del predicado, sin reinterpretar nada", () => {
    // Es la funcion que usan el repositorio y el service para no tener que conocer los nombres de
    // los envs. Se afirma que traslada los MISMOS numeros: si aqui se colara una conversion, el
    // umbral que espacia reintentos y el que pinta la pantalla podrian salir distintos.
    process.env.WEBHOOK_PAUSA_FALLOS_MINIMOS = "4";
    process.env.WEBHOOK_PAUSA_VENTANA_MINUTOS = "45";
    const cfg = loadWebhookConfig();
    expect(pausaConfigDe(cfg)).toEqual({ fallosMinimos: 4, ventanaMs: 2_700_000 });
  });
});
