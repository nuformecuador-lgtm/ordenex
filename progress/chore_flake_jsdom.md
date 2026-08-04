# Chore — reducir el flake de jsdom

Rama: `chore/flake-jsdom-medido` (desde `origin/dev`).

## 1. La hipótesis vieja, y por qué se descartó

El chore original suponía que el flake venía de **contención entre workers** y que
la vía era **acotarlos**. Se midió y se descartó:

| Config | `OrdenesModuleReuse` | Suite completa |
| --- | --- | --- |
| default (~11 forks, 12 cores) | **8873 ms** | ~220 s |
| `poolOptions.forks.maxForks: 6` | **8594 ms** (−3%) | **244 s (+11%)** |

Acotar los workers **no baja** la duración del test lento (−3% está dentro del
ruido) y **encarece la suite un 11%**. Se revirtió: no se toca `vitest.config.ts`.

## 2. La causa real, medida

`tests/components/OrdenesModuleReuse.test.tsx` tiene 82 líneas y 2 tests, y
tardaba 8,6–8,9 s. Su desglose en aislado:

```
Duration 7.74s (transform 1.05s, setup 172ms, import 382ms, tests 5.73s, environment 1.23s)
```

**5,73 s de 7,74 estaban DENTRO de la fase `tests`.** El motivo: los tests hacían
`await import()` **dentro del `it`** de una página completa de Next y de un
dashboard. Cargar y transformar ese árbol de módulos ocurría, por tanto, dentro
del cuerpo del test, y **contaba contra `testTimeout` (20 s)**. Con esa base,
un pico de carga bastaba para cruzar el límite: **eso era el flake**.

El arreglo no hace el trabajo más rápido — lo **mueve fuera del presupuesto del
test**, a las fases `import`/`transform`, que no están sujetas a `testTimeout`.

## 3. Antes / después por archivo

Medido con `pnpm exec vitest run <archivo>` en aislado. La columna que importa es
`tests`, la única sujeta a `testTimeout`.

| Archivo | `tests` antes | `tests` después | Δ |
| --- | --- | --- | --- |
| `OrdenesModuleReuse.test.tsx` | 5.61 s | **53 ms** | −99% |
| `HomePage.test.tsx` | 3.23 s | **50 ms** | −98% |
| `HomePageRol.test.tsx` | 2.88 s | **183 ms** | −94% |
| `HomePageMaestro.test.tsx` | 2.84 s | **210 ms** | −93% |

Líneas `Duration` completas:

```
OrdenesModuleReuse  antes:   7.61s (transform 1.02s, setup 175ms, import  357ms, tests 5.61s, environment 1.23s)
OrdenesModuleReuse  después: 7.43s (transform 1.02s, setup 171ms, import 5.79s, tests   57ms, environment 1.18s)

HomePage            antes:   5.03s (transform 935ms, setup 166ms, import  211ms, tests 3.23s, environment 1.19s)
HomePage            después: 5.06s (transform 954ms, setup 165ms, import 3.45s, tests   50ms, environment 1.18s)

HomePageRol         antes:   5.22s (transform 932ms, setup 177ms, import  597ms, tests 2.88s, environment 1.35s)
HomePageRol         después: 5.12s (transform 950ms, setup 175ms, import 3.35s, tests  183ms, environment 1.19s)

HomePageMaestro     antes:   5.05s (transform 923ms, setup 174ms, import  620ms, tests 2.84s, environment 1.18s)
HomePageMaestro     después: 5.05s (transform 908ms, setup 168ms, import 3.26s, tests  210ms, environment 1.18s)
```

La duración total apenas se mueve (el trabajo es el mismo), y eso es lo esperado:
el objetivo no era abaratar la suite sino **sacar la carga de módulos del reloj
del test**. Ninguna aserción cambió; solo se subieron imports.

### Por qué subir el import es seguro aquí

Tres condiciones verificadas antes de tocar nada:

1. `vi.mock` es *hoisted* por Vitest por encima de los imports estáticos, así que
   los mocks se siguen aplicando antes de cargar el módulo bajo prueba.
2. **No hay `resetModules`** — ni en `vitest.config.ts` ni en los tests. Sin él,
   los `await import()` repetidos del mismo especificador ya devolvían el
   **módulo cacheado**, no uno fresco: no había semántica de "recargar tras
   configurar el mock" que preservar.
3. `app/(app)/dashboard/page.tsx` lee los mocks **en tiempo de llamada** a
   `Home()`, no en tiempo de importación (nada depende de mocks en el ámbito de
   módulo). Lo mismo para `app/(app)/ordenes/page.tsx`.

## 4. Descartados a propósito

- **`CuentasPorPagarTable.test.tsx`** — uno de los dos del flake histórico, pero
  **no tiene el patrón**: cero `import()` dinámicos. Nada que subir.
- **`ControlDescargaTransversal.test.tsx`** — el otro del flake histórico. Su
  único `import(` está en **posición de tipo**
  (`importOriginal<typeof import("@/lib/utils/xlsx-template")>()`), no es una
  importación dinámica en runtime. Nada que subir.

Que estos dos no tengan el patrón significa que **su flake histórico tiene otra
causa**, todavía sin diagnosticar (ver abiertos).

## 5. Qué queda abierto

- **El flake de `CuentasPorPagarTable` y `ControlDescargaTransversal` sigue sin
  causa conocida.** Este chore no los toca porque la causa medida aquí no
  aplica a ellos. Si reaparecen, hay que medirlos por separado.
- **Quedan ~36 archivos con `await import()` sin tocar**, deliberadamente: solo
  se intervinieron los que superaban 2,5 s en la fase `tests`. En
  `tests/components` los restantes son `LandingPage` (5), `LoginPage` (3),
  `OrdenesCargaMasivaNotificacion` (2), `ConfiguracionApiPage` (1),
  `ConfiguracionPlantillasPage` (1), `OrdenesCargaResumen` (1). No se midieron
  por encima del umbral; además, algunos `await import()` del repo existen **a
  propósito** (cargar tras `vi.stubEnv`, tras fijar estado dinámico de un mock, o
  para probar el efecto de importar) y subirlos rompería lo que miden. No
  convertir en masa.
- **El margen frente a `testTimeout` no se midió bajo carga real**, solo en
  aislado. La hipótesis es que con la fase `tests` en decenas de ms el margen es
  amplísimo, pero la confirmación es empírica: que el flake no reaparezca.

## 6. Verificación

- `pnpm typecheck` — limpio.
- `pnpm lint` — 0 errores (44 warnings preexistentes, **ninguno** en los archivos
  tocados).
- `pnpm exec vitest run tests/components tests/integration` — **323 archivos,
  3742 tests, todos en verde** (152 s).

Suite completa: **no ejecutada aquí**; el gate lo corre el leader.
