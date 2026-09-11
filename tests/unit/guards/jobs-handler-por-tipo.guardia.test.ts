import { describe, it, expect } from "vitest";
import { JobTipo as JobTipoPrisma } from "@prisma/client";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";

// FICHA 410 (T3.8, R36) — TODO VALOR DE `job_tipo` TIENE HANDLER REGISTRADO.
//
// ---------------------------------------------------------------------------------------------
// POR QUE UNA GUARDIA Y NO UN CASO MAS DEL TEST DE REGISTRO
// ---------------------------------------------------------------------------------------------
// El test que ya existia (`tests/unit/api/procesar-jobs-registro.test.ts`) compara contra una LISTA
// ESCRITA A MANO. Esa lista protege de perder un handler, pero NO de anadir un valor al enum sin
// handler: quien anade el valor tiene que acordarse ADEMAS de actualizar la lista, y si no lo hace
// el test se pone rojo por «la lista no cuadra», que es un diagnostico que invita a arreglar la
// lista en vez de escribir el handler.
//
// Esta guardia pregunta al ENUM DE PRISMA, que es la unica fuente de lo que hay en la base. Un job
// encolado de un tipo sin handler se queda `pending` PARA SIEMPRE: se reclama cada minuto, gasta
// sitio en el lote de diez y nunca progresa. No falla; se queda quieto, que es el modo de fallo mas
// caro de esta cola.
//
// Vive en `tests/unit/guards/` porque las guardias corren SIEMPRE, tambien en el modo rapido.

const AHORA = new Date("2026-09-12T18:00:00.000Z");

describe("410/R36 · guardia: ningun tipo de job se queda sin handler", () => {
  it("autocomprobacion: el enum de Prisma trae los diez valores", () => {
    // Sin esto, una extraccion rota dejaria el barrido de abajo verde sobre una lista vacia.
    const valores = Object.values(JobTipoPrisma);
    expect(valores.length).toBeGreaterThanOrEqual(10);
    expect(valores).toContain("push_web");
    expect(valores).toContain("liberar_reprogramadas");
  });

  it("⭑ cada valor de `job_tipo` tiene su handler en `buildHandlers`", () => {
    const handlers = buildHandlers(() => AHORA);
    const sinHandler = Object.values(JobTipoPrisma).filter((tipo) => !handlers.has(tipo));
    expect(
      sinHandler,
      "un tipo sin handler es un job que se queda `pending` para siempre, sin fallar",
    ).toEqual([]);
  });

  it("⭑ y no sobra ninguno: el registro no tiene handlers de tipos que ya no existen", () => {
    const delEnum = new Set<string>(Object.values(JobTipoPrisma));
    const sobrantes = [...buildHandlers(() => AHORA).keys()].filter((t) => !delEnum.has(t));
    expect(sobrantes).toEqual([]);
  });

  it("construir el registro no lanza ni abre conexion, tampoco sin claves VAPID", () => {
    // `getPrismaClient()` es un singleton PEREZOSO y `buildPushWebService` NO llama a
    // `loadPushConfig()` salvo que el canal este configurado. Si lo hiciera, un despliegue sin
    // VAPID reventaria aqui y se llevaria por delante el drenado de los otros nueve tipos.
    const anterior = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect(() => buildHandlers(() => AHORA)).not.toThrow();
      expect(buildHandlers(() => AHORA).has("push_web")).toBe(true);
    } finally {
      if (anterior.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = anterior.pub;
      if (anterior.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = anterior.priv;
    }
  });

  it("⭑ `push_web` NO es recurrente: lo dispara un aviso, no el reloj", () => {
    // Re-agendarlo mandaria un push por minuto a la misma persona, que es exactamente lo contrario
    // de la regla «uno al dia por tipo».
    expect(buildRecurrencias().has("push_web")).toBe(false);
    // Los dos que SI lo son siguen estandolo.
    expect([...buildRecurrencias().keys()].sort()).toEqual([
      "analitica_rollup_diario",
      "liberar_reprogramadas",
    ]);
  });
});
