# Chore — reducir el flake de jsdom

Rama: `chore/flake-jsdom-medido` (desde `origin/dev`).

> **El flake de esta máquina tiene DOS mecanismos distintos, no uno.** Es la
> conclusión central de este chore y la razón de que ningún ajuste global (ni
> workers, ni `testTimeout`) lo eliminara nunca del todo.
>
> | | Mecanismo | Se manifiesta como | ¿Lo arregla subir `testTimeout`/acotar workers? |
> | --- | --- | --- | --- |
> | **(1)** | `await import()` dentro del `it` mete la carga del árbol de módulos bajo `testTimeout` | **timeout** | Lo hace más raro, no lo elimina |
> | **(2)** | `waitFor` sobre una **ausencia** seguido de una aserción **síncrona** de **presencia** | **elemento no encontrado** | **No. En absoluto** |
>
> Esto explica por qué subir el `testTimeout` a 20 s en su día hizo el flake más
> raro pero no lo eliminó: solo tocaba el mecanismo (1).

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

## 6. Qué queda abierto

- **`ControlDescargaTransversal` sigue SIN diagnosticar.** No tiene el mecanismo
  (1) (su `import(` es de tipo) **ni el (2)** (se revisó: su único
  `not.toBeInTheDocument` está en la forma *inversa* —espera una presencia
  (`descargarBlobMock` llamado) y luego afirma una ausencia síncrona—, que no
  produce intermitencia sino, como mucho, una aserción débil). Si reaparece hay
  que medirlo por separado: es un tercer mecanismo, todavía desconocido.
- **El detector del patrón (2) es heurístico**, no un análisis semántico: mira el
  cuerpo textual del `waitFor` y las sentencias síncronas siguientes hasta el
  primer `await`. Puede haber variantes que no cubra (p. ej. la espera repartida
  entre helpers, o `findBy*` mezclado). No es una garantía de ausencia.
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

## 7. Verificación

- `pnpm typecheck` — limpio.
- `pnpm lint` — 0 errores (44 warnings preexistentes, **ninguno** en los archivos
  tocados).
- `pnpm exec vitest run tests/components tests/integration` — **323 archivos,
  3742 tests, todos en verde** (169 s).
- `CuentasPorPagarTable.test.tsx` en solitario **×5** — 5/5 verde.
- Prueba por **mutación** del filtro — rojo como debe, revertida (§5).

Suite completa: **no ejecutada aquí**; el gate lo corre el leader.

## 8. Qué llevarse de aquí

Tres cosas que costaron medición y conviene no volver a pagar:

1. **Acotar workers no arregla flake de jsdom** en esta máquina: −3% en el test
   lento y +11% en la suite. Medido dos veces. No reintentar.
2. **Subir `testTimeout` tampoco**: solo enmascara el mecanismo (1) y es ciego al
   (2). Que un flake se vuelva "más raro" al subir el timeout NO confirma que la
   causa sea la lentitud.
3. **En tests de listas que recargan del servidor, la presencia y la ausencia van
   en el mismo `waitFor`, presencia primero.** Es el invariante que evita el
   mecanismo (2).
