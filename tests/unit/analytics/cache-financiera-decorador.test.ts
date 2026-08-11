import { describe, it, expect } from "vitest";
import { TAGS_FINANCIERA } from "@/lib/analytics/cache-tags";
import { CachedAnaliticaFinancieraService } from "@/lib/services/CachedAnaliticaFinancieraService";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type {
  IAnaliticaFinancieraService,
  ResultadoConsultaFinanciera,
} from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import { cacheFalsa } from "./_cache-falsa";

// Feature 179 / T2.1 — EL DECORADOR: R2, R4 y el paso 0 de R28.
//
// La cache es la FALSA CON SEMANTICA DE TAGS REAL de la 128 (`_cache-falsa.ts`), no un mock que
// cuente llamadas: guarda por clave, serializa como `unstable_cache` y borra por tag. Asi «se
// sirvio desde cache» es una afirmacion sobre el dato y no sobre un espia.
//
// Los repositorios entran por interfaz (`armarServicio`, dobles de la 127), asi que toda esta
// suite corre SIN runtime de Next y SIN `DATABASE_URL`.

describe("R2 · una segunda consulta equivalente no vuelve a llamar a ningun repositorio financiero", () => {
  it("la segunda consulta se sirve entera desde cache", async () => {
    const { servicio, consultasHechas } = armarServicio();
    const decorado = new CachedAnaliticaFinancieraService(servicio, cacheFalsa());
    const consulta = consultaDe("egresos");

    const primera = await decorado.consultar(consulta);
    const trasLaPrimera = consultasHechas();
    expect(trasLaPrimera).toBeGreaterThan(0); // si fuera 0, el resto del caso seria vacuo

    const segunda = await decorado.consultar(consulta);

    // Sin R2 todos los requisitos de invalidacion serian vacuos: no se puede demostrar que algo
    // se invalida si nunca se cachea.
    expect(consultasHechas()).toBe(trasLaPrimera);
    expect(segunda).toEqual(primera);
  });

  it("pero dos consultas DISTINTAS no se sirven la una a la otra", async () => {
    const { servicio, consultasHechas } = armarServicio();
    const decorado = new CachedAnaliticaFinancieraService(servicio, cacheFalsa());

    await decorado.consultar(consultaDe("egresos"));
    const trasLaPrimera = consultasHechas();
    await decorado.consultar(consultaDe("ingreso_flete"));

    expect(consultasHechas()).toBeGreaterThan(trasLaPrimera);
  });

  it("y cada entrada se escribe con el tag del dominio financiero, para que la invalidacion la alcance", async () => {
    const { servicio } = armarServicio();
    const cache = cacheFalsa();
    const decorado = new CachedAnaliticaFinancieraService(servicio, cache);

    await decorado.consultar(consultaDe("egresos"));
    expect(cache.tamano()).toBe(1);

    // El invalidador REAL borra por tag. Aqui se ejercita el tag del catalogo, no un literal.
    await cache.invalidar("manual", TAGS_FINANCIERA);
    expect(cache.tamano()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R4 — nada que no sea `status: "ok"` deja entrada                            */
/* -------------------------------------------------------------------------- */

/** Servicio interno que responde lo que se le diga y CUENTA cuantas veces le preguntaron. */
function internoQue(
  responder: () => Promise<ResultadoConsultaFinanciera>,
): IAnaliticaFinancieraService & { llamadas: () => number } {
  let n = 0;
  return {
    llamadas: () => n,
    async consultar(_c: ConsultaAnalitica): Promise<ResultadoConsultaFinanciera> {
      n += 1;
      return responder();
    },
  };
}

describe("R4 · un `dominio_invalido` y un fallo de repositorio no dejan entrada en cache", () => {
  it("un `dominio_invalido` no se cachea, y el segundo intento vuelve a preguntar", async () => {
    // La metrica es una CACHEABLE segun la politica: asi el caso entra de verdad por el envoltorio
    // y mide lo que R4 pide (no cachear un no-ok) en vez de salirse antes por el paso 0 de R28.
    const interno = internoQue(async () => ({
      status: "dominio_invalido",
      metricaId: "egresos",
    }));
    const cache = cacheFalsa();
    const decorado = new CachedAnaliticaFinancieraService(interno, cache);
    const consulta = consultaDe("egresos");

    const primera = await decorado.consultar(consulta);
    expect(primera).toEqual({ status: "dominio_invalido", metricaId: "egresos" });
    expect(cache.tamano()).toBe(0);
    expect(cache.claves).toEqual([]);

    // Y no se ha quedado pegado: la segunda consulta vuelve a preguntar de verdad.
    await decorado.consultar(consulta);
    expect(interno.llamadas()).toBe(2);
  });

  it("un fallo de repositorio se propaga tal cual y no deja entrada", async () => {
    const fallo = new Error("la base no respondio");
    const interno = internoQue(async () => {
      throw fallo;
    });
    const cache = cacheFalsa();
    const decorado = new CachedAnaliticaFinancieraService(interno, cache);
    const consulta = consultaDe("egresos");

    await expect(decorado.consultar(consulta)).rejects.toBe(fallo);
    expect(cache.tamano()).toBe(0);

    // Lo que R4 compra, dicho como se sufre: cachear el error lo volveria PERMANENTE durante
    // todo el TTL — un fallo transitorio de la base servido como respuesta buena durante una
    // hora, y el segundo intento del usuario devolviendo el mismo error sin haber tocado nada.
    await expect(decorado.consultar(consulta)).rejects.toBe(fallo);
    expect(interno.llamadas()).toBe(2);
  });

  it("y un `ok` posterior al fallo si se cachea: el decorador no se queda envenenado", async () => {
    const { servicio } = armarServicio();
    const cache = cacheFalsa();
    let falla = true;
    const interno: IAnaliticaFinancieraService = {
      async consultar(c) {
        if (falla) {
          falla = false;
          throw new Error("fallo transitorio");
        }
        return servicio.consultar(c);
      },
    };
    const decorado = new CachedAnaliticaFinancieraService(interno, cache);

    await expect(decorado.consultar(consultaDe("egresos"))).rejects.toThrow("fallo transitorio");
    const ok = await decorado.consultar(consultaDe("egresos"));

    expect(ok.status).toBe("ok");
    expect(cache.tamano()).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 (D3) — paso 0: la metrica no cacheable NI LEE NI ESCRIBE la cache        */
/* -------------------------------------------------------------------------- */

describe("R28 · una metrica no declarada cacheable no toca la cache", () => {
  it("`conciliacion_cierres` no escribe ninguna entrada", async () => {
    const { servicio, consultasHechas } = armarServicio();
    const cache = cacheFalsa();
    const decorado = new CachedAnaliticaFinancieraService(servicio, cache);

    await decorado.consultar(consultaDe("conciliacion_cierres"));
    const trasLaPrimera = consultasHechas();
    await decorado.consultar(consultaDe("conciliacion_cierres"));

    // NI LEE NI ESCRIBE: no es «no servir desde cache», es no entrar.
    expect(cache.tamano()).toBe(0);
    expect(cache.claves).toEqual([]);
    expect(consultasHechas()).toBe(trasLaPrimera * 2);
  });

  it("una metrica de otro dominio tampoco: su `dominio_invalido` sale sin tocar la cache", async () => {
    const { servicio } = armarServicio();
    const cache = cacheFalsa();
    const decorado = new CachedAnaliticaFinancieraService(servicio, cache);

    const r = await decorado.consultar(consultaDe("entregas"));

    expect(r).toEqual({ status: "dominio_invalido", metricaId: "entregas" });
    expect(cache.tamano()).toBe(0);
  });
});
