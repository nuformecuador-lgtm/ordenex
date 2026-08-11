import { describe, it, expect } from "vitest";
import { ANALITICA_CACHE_DISABLED_ENV } from "@/lib/config/analitica-cache";
import {
  CachedAnaliticaFinancieraService,
  decorarFinancieraConCache,
} from "@/lib/services/CachedAnaliticaFinancieraService";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import { cacheFalsa } from "./_cache-falsa";

// Feature 179 / T2.1 — R22: EL KILL-SWITCH EXISTENTE APAGA TAMBIEN EL DINERO.
//
// No se crea una bandera nueva: es `ANALITICA_CACHE_DISABLED` (128, `lib/config/analitica-cache.
// ts`), con el mismo default ENCENDIDO. Dos banderas para la misma cache serian dos formas de
// apagarla y una de creer que esta apagada cuando no lo esta.
//
// ⚠ APAGADO SIGNIFICA «NO ENTRAR», NO «NO SERVIR». Un decorador que dejara de servir desde cache
// pero siguiera escribiendo entradas es un PLACEBO: el operador que apaga la bandera cree que ha
// dejado de cachear dinero y la cache se sigue llenando. Por eso el caso mide `tamano()` y
// `claves`, no solo el contador de consultas.
//
// `env` entra por parametro (patron de `decorarRollupConCache`) para no mutar `process.env`.

const APAGADA = { [ANALITICA_CACHE_DISABLED_ENV]: "1" } as const;

describe("R22 · con la cache deshabilitada, toda consulta financiera va a la base", () => {
  it("dos consultas identicas llaman dos veces a los repositorios", async () => {
    const armado = armarServicio();
    const cache = cacheFalsa();
    const servicio = decorarFinancieraConCache(armado.servicio, cache, APAGADA);
    const consulta = consultaDe("egresos");

    await servicio.consultar(consulta);
    const trasLaPrimera = armado.consultasHechas();
    expect(trasLaPrimera).toBeGreaterThan(0);

    await servicio.consultar(consulta);

    expect(armado.consultasHechas()).toBe(trasLaPrimera * 2);
  });

  it("y NO se lee ni se escribe una sola entrada: es un kill-switch, no un placebo", async () => {
    const armado = armarServicio();
    const cache = cacheFalsa();
    const servicio = decorarFinancieraConCache(armado.servicio, cache, APAGADA);

    await servicio.consultar(consultaDe("egresos"));
    await servicio.consultar(consultaDe("ingreso_flete"));

    expect(cache.tamano()).toBe(0);
    expect(cache.claves).toEqual([]);
  });

  it("devuelve el servicio DESNUDO, el mismo objeto: no hay envoltorio que pueda tocar la cache", () => {
    const armado = armarServicio();
    const servicio = decorarFinancieraConCache(armado.servicio, cacheFalsa(), APAGADA);
    expect(servicio).toBe(armado.servicio);
  });
});

describe("R22 · sin la variable definida, la cache esta HABILITADA", () => {
  it("el decorador envuelve y la segunda consulta ya no toca los repositorios", async () => {
    const armado = armarServicio();
    const cache = cacheFalsa();
    // Entorno VACIO: ausencia de la variable = encendida. Invertir el default dejaria la feature
    // inservible en produccion hasta que alguien hiciera un deploy para encenderla.
    const servicio = decorarFinancieraConCache(armado.servicio, cache, {});

    expect(servicio).toBeInstanceOf(CachedAnaliticaFinancieraService);

    await servicio.consultar(consultaDe("egresos"));
    const trasLaPrimera = armado.consultasHechas();
    await servicio.consultar(consultaDe("egresos"));

    expect(armado.consultasHechas()).toBe(trasLaPrimera);
    expect(cache.tamano()).toBe(1);
  });

  it("los valores que apagan son los de la 128, no una segunda tabla", async () => {
    const armado = armarServicio();
    for (const valor of ["1", "true", "TRUE", "yes", "on"]) {
      const servicio = decorarFinancieraConCache(armado.servicio, cacheFalsa(), {
        [ANALITICA_CACHE_DISABLED_ENV]: valor,
      });
      expect(servicio, valor).toBe(armado.servicio);
    }
    // Y cualquier otra cosa la deja ENCENDIDA.
    expect(
      decorarFinancieraConCache(armado.servicio, cacheFalsa(), {
        [ANALITICA_CACHE_DISABLED_ENV]: "quiza",
      }),
    ).toBeInstanceOf(CachedAnaliticaFinancieraService);
  });
});
