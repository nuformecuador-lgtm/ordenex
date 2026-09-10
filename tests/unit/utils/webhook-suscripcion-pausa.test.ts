import { describe, it, expect } from "vitest";
import { estaPausada, type WebhookPausaConfig } from "@/lib/utils/webhook-suscripcion-pausa";

// FICHA 403 (T3) — EL PREDICADO DEL CIRCUITO, medido solo. Cubre R4 (cruzar umbral + ventana
// pausa), R6 (no cruzarlos NO pausa) y los dos casos limite exactos.
//
// POR QUE ESTE ARCHIVO EXISTE APARTE del test del service: esta funcion es la UNICA fuente de
// verdad de "¿esta pausada?" y la usan DOS caminos —el drenador, para espaciar el reintento, y la
// consulta de la pantalla, para pintar el aviso—. Si divergieran, la cola estaria espaciando
// reintentos que el dueño no ve, o al reves. Aqui se fija el contrato una sola vez.
//
// ⚠️ EL RIESGO REAL DE ESTA FICHA ES EL FALSO POSITIVO, no el falso negativo. Hay un integrador de
// verdad conectado: pausar a un destino sano por una caida corta le espacia las entregas una hora
// sin motivo. Por eso la mitad de los casos de abajo son casos que NO deben pausar.

const CONFIG: WebhookPausaConfig = { fallosMinimos: 3, ventanaMs: 30 * 60_000 };

const ANCLA = new Date("2026-09-09T10:00:00.000Z");
/** `ancla + minutos`, para no escribir fechas a mano en cada caso. */
function tras(minutos: number): Date {
  return new Date(ANCLA.getTime() + minutos * 60_000);
}

describe("403/R4 — cruzar el umbral Y la ventana pausa", () => {
  it("⭑ 3 fallos y 30 minutos sin exito: pausada", () => {
    expect(estaPausada(3, ANCLA, tras(30), CONFIG)).toBe(true);
  });

  it("mas fallos y mas tiempo tambien: el umbral es un piso, no una igualdad", () => {
    expect(estaPausada(9, ANCLA, tras(120), CONFIG)).toBe(true);
    expect(estaPausada(2042, ANCLA, tras(5 * 24 * 60), CONFIG)).toBe(true);
  });
});

describe("403/R6 — lo que NO debe pausar (el falso positivo es el riesgo)", () => {
  it("⭑ CAIDA CORTA Y AISLADA: 5 fallos en 4 minutos NO pausa", () => {
    // EL CASO QUE MAS IMPORTA. Un despliegue del integrador, un reinicio, un pico de latencia: la
    // suscripcion acumula fallos de sobra en pocos minutos, pero no lleva 30 minutos sin recibir
    // nada. Espaciarle los reintentos una hora por esto seria convertir una caida de 4 minutos en
    // una interrupcion de una hora — la cura peor que la enfermedad.
    expect(estaPausada(5, ANCLA, tras(4), CONFIG)).toBe(false);
  });

  it("⭑ un fallo aislado y luego silencio real: 1 fallo y 3 horas NO pausa", () => {
    // El otro lado del mismo riesgo. Con trafico muy esporadico, un unico fallo seguido de
    // silencio (porque no llega ningun pedido mas) dejaria pasar la ventana sola. Sin el piso de
    // fallos, el siguiente intento —dias despues— entraria en pausa por el mero paso del reloj
    // sobre UN dato. Por eso hacen falta las DOS condiciones y no una.
    expect(estaPausada(1, ANCLA, tras(180), CONFIG)).toBe(false);
    expect(estaPausada(2, ANCLA, tras(180), CONFIG)).toBe(false);
  });

  it("cero fallos no pausa por mucho tiempo que pase", () => {
    expect(estaPausada(0, ANCLA, tras(60 * 24 * 30), CONFIG)).toBe(false);
  });

  it("un `ahora` ANTERIOR al ancla (reloj corrido) no pausa: la resta sale negativa", () => {
    // Defensa barata contra un reloj que retrocede: la diferencia negativa nunca alcanza la
    // ventana, asi que el desenlace seguro es "no pausada" — nunca "pausada por accidente".
    expect(estaPausada(99, ANCLA, tras(-120), CONFIG)).toBe(false);
  });
});

describe("403 — los dos limites EXACTOS, uno a uno", () => {
  it("⭑ el fallo numero 3 con la ventana cumplida pausa; el 2 no", () => {
    expect(estaPausada(2, ANCLA, tras(30), CONFIG)).toBe(false);
    expect(estaPausada(3, ANCLA, tras(30), CONFIG)).toBe(true);
  });

  it("⭑ el minuto 30 exacto pausa; el 29 (y un milisegundo antes) no", () => {
    // `>=` y no `>`: R4 dice «alcanza el umbral» y «han transcurrido AL MENOS la ventana». Un `>`
    // dejaria el caso exacto sin pausar, y ese es justo el instante que el spec nombra.
    expect(estaPausada(3, ANCLA, tras(29), CONFIG)).toBe(false);
    expect(estaPausada(3, ANCLA, new Date(ANCLA.getTime() + 30 * 60_000 - 1), CONFIG)).toBe(false);
    expect(estaPausada(3, ANCLA, tras(30), CONFIG)).toBe(true);
  });
});

describe("403/R8 — el umbral viene de la config, no del codigo", () => {
  it("⭑ con otro umbral el resultado cambia: no hay ningun 3 ni ningun 30 escrito dentro", () => {
    // Anti-hardcode. Si la funcion ignorara la config y llevara los numeros dentro, este caso
    // saldria igual que el de arriba y la ficha no seria configurable (R8) ni ajustable por el
    // humano sin tocar codigo.
    const laxa: WebhookPausaConfig = { fallosMinimos: 10, ventanaMs: 6 * 60 * 60_000 };
    expect(estaPausada(3, ANCLA, tras(30), laxa)).toBe(false);
    expect(estaPausada(10, ANCLA, tras(6 * 60), laxa)).toBe(true);

    const estricta: WebhookPausaConfig = { fallosMinimos: 1, ventanaMs: 60_000 };
    expect(estaPausada(1, ANCLA, tras(1), estricta)).toBe(true);
  });
});

describe("403 — la funcion es PURA", () => {
  it("no muta sus argumentos ni depende del reloj del sistema", () => {
    const ancla = new Date(ANCLA);
    const ahora = tras(45);
    const antesAncla = ancla.getTime();
    const antesAhora = ahora.getTime();

    estaPausada(5, ancla, ahora, CONFIG);
    estaPausada(5, ancla, ahora, CONFIG);

    expect(ancla.getTime()).toBe(antesAncla);
    expect(ahora.getTime()).toBe(antesAhora);
    // Determinista: dos llamadas identicas dan lo mismo, sin `Date.now()` de por medio.
    expect(estaPausada(5, ancla, ahora, CONFIG)).toBe(estaPausada(5, ancla, ahora, CONFIG));
  });
});
