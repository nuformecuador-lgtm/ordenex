# Chore — reducir el flake de jsdom

Rama: `chore/flake-jsdom-medido` (desde `origin/dev`).

> **El flake de esta máquina tiene TRES mecanismos distintos, no uno.** Es la
> conclusión central de este chore y la razón de que ningún ajuste global (ni
> workers, ni `testTimeout`) lo eliminara nunca del todo.
>
> | | Mecanismo | Se manifiesta como | ¿Lo arregla subir `testTimeout`/acotar workers? |
> | --- | --- | --- | --- |
> | **(1)** | `await import()` dentro del `it` mete la carga del árbol de módulos bajo `testTimeout` | **timeout** | Lo hace más raro, no lo elimina |
> | **(2)** | `waitFor` sobre una **ausencia** seguido de una aserción **síncrona** de **presencia** | **elemento no encontrado** | **No. En absoluto** |
> | **(3)** | **foto del DOM tomada antes de que la carga asiente**, comparada después | **diff con «Cargando» en un lado** | **No. En absoluto** |
>
> Esto explica por qué subir el `testTimeout` a 20 s en su día hizo el flake más
> raro pero no lo eliminó: solo tocaba el mecanismo (1).
>
> **(2) y (3) son familia** —los dos son carreras con carga asíncrona— pero de
> forma distinta, y por eso el detector del (2) **no** ve al (3): busca otra forma
> sintáctica. Cada uno se encontró cuando el anterior dejó de tapar la suite.

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

## 4. Descartados para el mecanismo (1)

- **`CuentasPorPagarTable.test.tsx`** — uno de los dos del flake histórico, pero
  **no tiene el patrón (1)**: cero `import()` dinámicos. Nada que subir.
  → Resultó tener el mecanismo **(2)**. Ver §5.
- **`ControlDescargaTransversal.test.tsx`** — el otro del flake histórico. Su
  único `import(` está en **posición de tipo**
  (`importOriginal<typeof import("@/lib/utils/xlsx-template")>()`), no es una
  importación dinámica en runtime. Nada que subir.

Que estos dos no tuvieran el patrón (1) fue la pista de que había un segundo
mecanismo. Lo confirmó la suite completa: **903 de 904 archivos verdes, y el
único rojo fue `CuentasPorPagarTable`**.

## 5. Mecanismo (2): esperar una ausencia no garantiza una presencia

El fallo observado **no era un timeout**:

```
FAIL  CuentasPorPagarTable — búsqueda por nombre (servidor, T L.2)
      > filtra la lista por nombre de mensajero sin tocar montos
TestingLibraryElementError: Unable to find an element with the text: Ana Mensajera
```

La tabla se renderizaba entera (el `<table>` sale completo en el error, con su
cabecera). Lo que faltaba era **la fila**. El código era:

```js
await waitFor(() =>
  expect(within(tabla()).queryByText("Beto Repartidor")).not.toBeInTheDocument(),
);
expect(within(tabla()).getByText("Ana Mensajera")).toBeInTheDocument();  // ← SÍNCRONO
```

Es una **carrera**: el `waitFor` espera a que *desaparezca* Beto y justo después
se exige *sin esperar* que *esté* Ana. Con la búsqueda resuelta **en el servidor**
(T L.2 de la 170) existe un instante —tabla vacía o en carga— en el que Beto ya
no está y Ana todavía no ha llegado. El `waitFor` se satisface ahí y el
`getByText` falla.

**La regla:** esperar la ausencia de A no garantiza la presencia de B. Las dos
condiciones van dentro del **mismo** `waitFor`, con la **presencia primero** (es
la condición fuerte, la que ancla a que la página nueva ya llegó):

```js
await waitFor(() => {
  expect(within(tabla()).getByText("Ana Mensajera")).toBeInTheDocument();
  expect(within(tabla()).queryByText("Beto Repartidor")).not.toBeInTheDocument();
});
```

### Barrido del patrón en todo el repo

Se escaneó con un detector propio (`await waitFor(...)` cuyo cuerpo solo afirma
una ausencia, seguido de una aserción síncrona de presencia en el mismo bloque).
Validado contra el árbol pre-arreglo: **5 sitios sobre 454 `await waitFor(`**.

| Sitio | ¿Carga asíncrona? | Acción |
| --- | --- | --- |
| `CuentasPorPagarTable.test.tsx:165` | sí (página del servidor) | **arreglado** — era el rojo real |
| `NotificationsBell.test.tsx:271` | sí (lista revalidada tras descartar) | **arreglado** |
| `PlantillasModule.test.tsx:112` | sí (revalidación SWR tras eliminar) | **arreglado** |
| `PostulacionesPendientesPanel.test.tsx:187` | sí (panel revalida el listado) | **arreglado** |
| `Modal.test.tsx:390` | **no** | **NO se toca** (ver abajo) |

Tras el arreglo el detector baja de 5 a 1, y el único restante es el de `Modal`.

**Por qué `Modal.test.tsx:390` se deja como está:** no hay recarga asíncrona. El
`role="status"` es el indicador de ocupado del propio modal, que desaparece
cuando la promesa rechazada se asienta; el `dialog` no se recarga de ningún
servidor. Es más: que el diálogo **siga ahí** es justo lo que el caso mide (R22,
"no cierra el modal al rechazar"), así que la aserción síncrona es la correcta y
meterla en un `waitFor` la debilitaría. No hay ventana de carrera.

**Un matiz honesto:** también se endureció el ancla del segundo caso de
`CuentasPorPagarTable` (línea ~181, «el texto viaja TAL CUAL al servidor…»). Ese
**no** tenía la forma exacta del defecto —lo que le sigue es una aserción sobre
`paginadoMock.mock.calls`, no sobre el DOM— y por eso el detector no lo marca.
Se cambió por coherencia y como defensa en profundidad, no porque estuviera roto.

### Que siga midiendo lo mismo (prueba por mutación)

Se mutó el doble de la Server Action para que la búsqueda **devuelva la lista
entera** (el filtro deja de aplicarse):

```js
const filtrados = mensajeros; // MUTACIÓN: el filtro NO se aplica
```

Resultado — el test se pone **rojo**, así que sigue midiendo que el filtro filtra:

```
× filtra la lista por nombre de mensajero sin tocar montos 1121ms
× el texto viaja TAL CUAL al servidor y una ráfaga de teclas es UNA sola lectura 1119ms
Tests  2 failed | 4 passed (6)

Error: expect(element).not.toBeInTheDocument()
       expected document not to contain element, found <span ...
```

Mutación **revertida**.

### Estabilidad

`CuentasPorPagarTable.test.tsx` en solitario, 5 corridas seguidas: **5/5 en
verde**, 6 tests cada una, fase `tests` entre 1.45 s y 1.50 s (dispersión ~3%).

## 6. Mecanismo (3): fotografiar la pantalla antes de que la carga asiente

**`ControlDescargaTransversal` DEJA DE ESTAR SIN DIAGNOSTICAR.** Falló en una
suite completa y su causa es un tercer mecanismo:

```
FAIL tests/components/descarga/ControlDescargaTransversal.test.tsx:486
  > descargar no altera la página, la búsqueda ni las filas visibles
AssertionError: Familia B paginada, con búsqueda de servidor: expected {…} to deeply equal {…}

  { "busqueda": "Beto", "filas": 2, "paginacion": "Página 1 de 1…",
-   "tabla": "…EstadoCargando",
+   "tabla": "…EstadoBeto Repartidor₡4000.10₡4000.10₡0.00Al día",
  }
```

El test toma una **foto de la pantalla ANTES** de descargar y la compara
**después**. La foto «antes» se tomó con la tabla todavía en **«Cargando»**: los
datos llegaron entre las dos fotos. **Lo que alteró la pantalla no fue la
descarga, fue la carga inicial sin terminar.**

### Por qué el ancla anterior era ambigua (la parte no obvia)

La preparación de la Familia B esperaba así:

```js
await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(2));
```

El estado de carga del `DataTable` pinta un `<tr>` con `role="status"`
(«Cargando», sr-only) **más** filas skeleton `aria-hidden`. Como las skeleton
**no** cuentan como `row`, durante la carga `getAllByRole("row")` devuelve
`header + status = 2`… **exactamente el mismo número que el estado ya asentado**
(`header + la fila real`). El ancla no distinguía «cargando» de «listo».

Es la misma lección del mecanismo (2) en otra forma: **un ancla que el estado
transitorio también satisface no es un ancla.**

### El arreglo

Un helper `esperarTablaAsentada(titulo, { presente, ausente })` con criterio
**positivo**, aplicado en las **tres** familias (no solo en la B, que fue la que
falló):

| Familia | Ancla anterior | Por qué era insuficiente |
| --- | --- | --- |
| A con filtros (`Órdenes`) | `waitFor(mock llamado 2 veces)` | que la consulta **salga** no es que la página **llegue** |
| A sin filtros (`Usuarios`) | `findByText("Usuario 1")` | no excluía una revalidación en vuelo |
| B paginada (`Cuentas por pagar`) | `rows === 2` | la carga también da 2 filas |

**Un intento fallido que conviene recordar:** el primer criterio fue solo
«`Beto Repartidor` presente + sin carga», y puso **5 tests en rojo**. Motivo:
`initialData` ya contiene a Beto, así que esa condición es cierta **antes de que
el filtro se aplique**. Lo que distingue al estado filtrado es que **Ana se fue**.
De ahí el parámetro `ausente`. Es el mismo error que se estaba arreglando, dado
la vuelta: anclar a algo que el estado equivocado también cumple.

### Guardia estructural

`fotoDeLaPantalla` ahora **se niega a fotografiar una tabla en carga**:

```js
expect(
  within(tabla).queryByRole("status"),
  `${titulo}: se fotografió la pantalla con una carga en vuelo`,
).not.toBeInTheDocument();
```

Convierte este fallo de «diff intermitente y lejos de su causa» en un error
inmediato que **se explica solo**. Límite honesto: solo puede saltar cuando la
carrera se materializa; no la previene.

### Que siga midiendo lo mismo (dos mutaciones)

R37 existe para probar que **descargar no altera la pantalla**. Se mutó la
producción (`CuentasPorPagarTable`) para que la descarga SÍ la altere:

1. `setBusqueda("")` + `setPage(1)` dentro de `obtenerFilas` → rojo:
   `- "busqueda": "Beto"` / `+ "busqueda": ""`.
2. `setAplicada("")` (desaplica el filtro) → rojo, y esta vez en las **filas**:
   `- "filas": 2` / `+ "filas": 3`, con el `tabla` mostrando otra vez a Ana.

La segunda importa especialmente: prueba que el arreglo **no** volvió insensible
la comparación del contenido de la tabla, que es justo lo que se tocó. Ambas
**revertidas**; `git diff app/` limpio.

### Estabilidad

`ControlDescargaTransversal.test.tsx` en solitario, **5 corridas: 5/5 verde**
(7 tests cada una, fase `tests` 5.36–5.62 s).

## 7. Qué queda abierto

- **La tercera forma NO es detectable con heurística, y está medido.** Se escribió
  un detector (capturas de estado del DOM ancladas solo a un mock) y se validó
  contra el árbol pre-arreglo: **devuelve 0 antes y después**, o sea **sensibilidad
  cero al defecto real**. La razón: la espera insuficiente estaba **dentro de
  `caso.preparar(...)`**, a un nivel de indirección de la foto; saber si un helper
  arbitrario deja la UI asentada es una propiedad **semántica**, no sintáctica.
  Población en riesgo medida, para dimensionar: **42 capturas de estado del DOM**
  en `tests/`. La mitigación real es la **guardia en tiempo de ejecución**, no un
  detector estático.
- **El detector del patrón (2) es heurístico**, no un análisis semántico: mira el
  cuerpo textual del `waitFor` y las sentencias síncronas siguientes hasta el
  primer `await`. Puede haber variantes que no cubra (p. ej. la espera repartida
  entre helpers, o `findBy*` mezclado). No es una garantía de ausencia.
- **Los arreglos del mecanismo (2) NO están en `chore/deuda-170-listados`.** Viven
  en `chore/flake-jsdom-medido` (commit `bb296907`). Medido en esta rama: el
  detector del (2) sigue dando **5 sitios**, y una de tres corridas del barrido
  `tests/components tests/integration` falló 1 archivo (las otras dos: 323/323).
  Mientras esa rama no aterrice, ésta seguirá flakeando por el mecanismo (2).
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

## 8. Verificación

Mecanismos (1) y (2), en `chore/flake-jsdom-medido`:

- `pnpm typecheck` limpio · `pnpm lint` 0 errores · `tests/components
  tests/integration` **323 archivos / 3742 tests verdes** · `CuentasPorPagarTable`
  ×5 en verde · mutación del filtro roja como debe, revertida.

Mecanismo (3), en `chore/deuda-170-listados`:

- `pnpm typecheck` — limpio.
- `pnpm lint` — 0 errores (44 warnings preexistentes, ninguno en lo tocado).
- `pnpm exec vitest run tests/components tests/integration` — **323 archivos,
  3742 tests verdes**… en 2 de 3 corridas. La otra falló 1 archivo, por el
  mecanismo (2), que **no está arreglado en esta rama** (ver §7).
- `ControlDescargaTransversal.test.tsx` en solitario **×5** — 5/5 verde.
- **Dos mutaciones** de producción, rojas como deben y revertidas (§6).

Suite completa: **no ejecutada aquí**; el gate lo corre el leader.

## 9. Qué llevarse de aquí

Cuatro cosas que costaron medición y conviene no volver a pagar:

1. **Acotar workers no arregla flake de jsdom** en esta máquina: −3% en el test
   lento y +11% en la suite. Medido dos veces. No reintentar.
2. **Subir `testTimeout` tampoco**: solo enmascara el mecanismo (1) y es ciego a
   (2) y (3). Que un flake se vuelva "más raro" al subir el timeout NO confirma
   que la causa sea la lentitud.
3. **Un ancla que el estado transitorio también satisface no es un ancla.** Es el
   invariante común a (2) y (3): la presencia y la ausencia van en el mismo
   `waitFor`, presencia primero; y «la consulta salió» (un mock llamado) no es
   «la pantalla llegó».
4. **Contra estas carreras vale más una guardia en tiempo de ejecución que un
   detector estático.** El detector del (2) funcionó porque su forma es
   sintáctica; el del (3) se midió con **sensibilidad cero** porque la suya es
   semántica. Cuando la propiedad es «¿está la UI asentada?», hay que preguntarlo
   en ejecución.

## 10. Cómo se encontró cada uno (para la próxima)

Ninguno de los tres apareció mirando código: **cada uno se destapó cuando el
anterior dejó de tapar la suite**. El (1) salió de medir la hipótesis vieja y
verla caer; el (2) apareció en la primera suite completa tras arreglar el (1);
el (3), en la primera suite completa tras arreglar el (2). El corolario práctico
es que **una suite completa verde de una sola pasada no cierra un flake**: hace
falta repetirla.
