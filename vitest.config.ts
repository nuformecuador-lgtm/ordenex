import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Feature 203 — concurrencia del runner, FIJADA POR MEDICION (2026-08-12).
 *
 * El default de vitest 4 en modo `run` es `max(availableParallelism() - 1, 1)`, que en la
 * maquina de referencia (i5-11400H: 12 hilos logicos pero solo 6 nucleos FISICOS) da 11
 * workers. Con `isolate: true` —el default, y no se toca: cada archivo estrena proceso— eso
 * son 11 procesos node compitiendo por 6 nucleos reales, mas los que aun se estan apagando
 * (vitest lanza el teardown y NO lo espera hasta el final de la corrida).
 *
 * Medido sobre la suite entera (1067 archivos / 13.365 tests), el test MAS LENTO de toda la
 * corrida —que es exactamente lo que mide `testTimeout`— sale asi:
 *
 *   | maxWorkers | wall (s)        | test mas lento | tests >5s | procesos node pico |
 *   |------------|-----------------|----------------|-----------|--------------------|
 *   | 11 (default, limpio)         | 286 / 336 | 5,8 / 6,0 | 1-2 | 22             |
 *   | 11 (default, +1 core ocupado)| 457       | **13,6**  | 24  | **34**         |
 *   | **8 (elegido)**              | 304 / 343 / 321 | **4,7 / 5,3 / 5,2** | **0-1** | **19** |
 *   | 6                            | 553       | 4,8       | 0   | —              |
 *
 * 8 gana en las dos direcciones a la vez: no cuesta reloj frente a 11 (304-343s contra 286-336s,
 * dentro de la propia varianza de 11) y deja el techo en ~5s con CERO o UN test por encima de 5s.
 * 6 baja igual el techo pero desperdicia hardware (+62% de reloj). 11 es el unico que llego a un
 * techo de dos cifras, y le basto UN core extra ocupado para hacerlo: ahi el margen contra el
 * limite de 20s cae a 1,5x, que es el rojo espurio que motivo esta feature.
 *
 * El pico de procesos importa por el SEGUNDO modo de fallo, el grave ("Failed to start forks
 * worker" / duraciones de horas): con 11 workers se contaron 34 procesos node vivos a la vez
 * —23 mas que los workers, porque los que se apagan se acumulan— y con 8 se cuentan 19. La
 * memoria nunca fue el cuello (nunca bajo de 14 GB libres de 40); el cuello son los procesos.
 *
 * 2/3 de los hilos logicos es la proporcion medida (12 -> 8); se expresa como formula y no como
 * un 8 literal para que otra maquina no quede sobre-suscrita.
 */
const MAX_WORKERS = Math.max(2, Math.round(availableParallelism() * (2 / 3)));

export default defineConfig({
  test: {
    maxWorkers: MAX_WORKERS,
    // Entorno por defecto: node (tests de backend/repositorios/servicios).
    // Los tests de componente (React) declaran su propio entorno con la
    // directiva `// @vitest-environment jsdom` al inicio del archivo, para
    // no afectar los tests existentes que corren en node.
    environment: "node",
    globals: true,
    // Timeout por test/hook. El default de vitest (5000ms) provocaba flakiness NO determinista
    // bajo la carga de la suite completa: HomePage, HomePageRol, OrdenesModuleReuse y a veces
    // CierreDiaPage caian con "Test timed out in 5000ms" por contencion de CPU en paralelo, pero
    // pasaban en aislado.
    //
    // Feature 203 — se REVISO si habia que volver a subirlo (tres archivos cayeron a los 20s en
    // una sesion) y la medicion dijo que NO, que el numero no era el problema: con `maxWorkers`
    // ya corregido arriba, el test mas lento de la suite entera es de 4,7s, o sea 4,3x de margen.
    // Y el peor factor de degradacion que se consiguio provocar —la suite compitiendo con 12
    // procesos quemando CPU— fue 3,35x (mediana 1,69x, p90 2,63x): 4,7s x 3,35 = 15,7s, que
    // SIGUE cabiendo en 20s. Subirlo no arregla nada que no arregle ya la concurrencia, y solo
    // sirve para que un cuelgue de verdad tarde mas en dar la cara.
    //
    // Lo que NO cubre este numero, y conviene saberlo al leer un rojo: los fallos de tipo
    // "Timeout waiting for worker to respond" / "Failed to start forks worker" NO los gobierna
    // `testTimeout` sino `WORKER_START_TIMEOUT`, que vitest fija en 90s y no es configurable.
    // Si el rojo dice eso, no es un test lento: es que el runner no pudo arrancar un proceso.
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jest-dom.ts"],
    environmentOptions: {
      jsdom: {
        // Necesario para que jsdom dispare la sumision implicita del
        // formulario (evento "submit") al hacer click en un boton
        // type="submit", comportamiento que jsdom solo activa en modo
        // "visual". No afecta a los tests que corren en entorno "node".
        pretendToBeVisual: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
