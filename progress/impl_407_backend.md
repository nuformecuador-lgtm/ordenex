# 407 — Bitácora del BACKEND: autorizar la asignación de una orden sin ubicación

> **Alcance de este documento: SOLO el backend (T1–T6).** Los modales, los literales de
> `geocodificacion-motivo-messages.ts` y los dos guardias de la UI (T7–T11) los escribe el
> agente de frontend sobre esta misma rama. Aquí no se ha tocado nada bajo `app/(app)/**`.

- **Rama:** `feat/407-autorizar-asignacion-sin-ubicacion`
- **SHA base:** `48918e60` (`docs(407): el spec adelgaza, el rastro sale por decision del humano`)
- **Spec:** `specs/407-autorizar-asignacion-sin-ubicacion/{requirements,design,tasks}.md`

---

## 1. Qué se hizo, en una frase

La petición de asignación puede traer un **conjunto de ids autorizados**; el gate, **dentro de
su rama R3 y solo ahí**, convierte `direccion_no_geocodificable` en el estado asignable nuevo
`asignable_sin_ubicacion_autorizada` para esos ids; los dos writers lo reenvían, lo cuentan en
una cifra propia y la exponen solo si es mayor que cero. **Nada se persiste** (R9): sin tabla,
sin columna, sin migración, sin tocar `db/schema.prisma`.

---

## 2. Archivos

### Producción (8, exactamente los del design §9 «Backend»)

| Archivo | Cambio |
| --- | --- |
| `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` | estado nuevo en `EstadoAsignabilidad` **y** en `EstadoAsignable`; 2.º parámetro opcional `autorizadasSinUbicacion?: ReadonlySet<string>` en `evaluar`; `MOTIVOS_AUTORIZABLES_SIN_UBICACION` + `esMotivoAutorizableSinUbicacion` |
| `lib/services/AsignabilidadCoordenadasService.ts` | el `if` **dentro** de la rama `STATUS_DETERMINISTAS`; parámetro con `= new Set<string>()`; tercer valor en la lista de `esAsignable`; cabecera normativa ampliada |
| `lib/interfaces/services/IGuiaAsignacionService.ts` | `AsignarBodegaInput.autorizarSinUbicacionIds?: string[]` + `sinUbicacionAutorizada?: number` en `ok`/`partial` |
| `lib/interfaces/services/IAsignacionSateliteService.ts` | espejo exacto |
| `lib/services/GuiaAsignacionService.ts` | `gateCoordenadas` recibe y reenvía el conjunto; segunda cifra sobre el mismo `Map`; `aviso407` |
| `lib/services/AsignacionSateliteService.ts` | lo mismo en el bloque `4b` |
| `lib/types/orden-guia.ts` | `asignarBodegaSchema` + `AsignarBodegaResult` |
| `lib/types/recepcion-satelite.ts` | `asignarSateliteSchema` + `AsignarSateliteResult` |

**Cero migraciones, cero cambios en `db/`, cero repositorios tocados.** El diff completo contra
la base son 13 archivos (8 de producción + 5 de tests) y ni uno vive bajo `app/`, `db/` o
`lib/repositories/`.

### Tests (5)

| Archivo | Qué |
| --- | --- |
| `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` | **nuevo** (26 casos): T2 y T3 |
| `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` | ampliado: 26 → **38** casos |
| `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` | ampliado: 20 → **31** casos |
| `tests/integration/actions/ordenes-guia-action.test.ts` | ampliado: el passthrough del borde |
| `tests/integration/actions/asignacion-satelite-action.test.ts` | ampliado: espejo |

`tests/unit/services/asignabilidad-coordenadas.test.ts` **no se tocó** y sigue verde entero
(T4): el paso nuevo es aditivo.

---

## 3. Mapa `R<n>` → test

Solo se listan los requisitos con parte backend. R13–R20 (y la parte de UI de R12 y R17) las
cubre el frontend en `progress/impl_407.md`; aquí se marcan como tales para que nadie los dé
por cubiertos por error.

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| **R1** | «geocode_status %s + sin coordenadas + id autorizado → `asignable_sin_ubicacion_autorizada`» (los TRES deterministas) · «407/R1: la irresoluble MARCADA sale en `resultados` y NO en `bloqueadas`» · **«con el gate REAL enganchado, la marca viaja del input al gate»** (en los dos writers) | `asignabilidad-coordenadas-autorizada` · `guia-asignacion-gate-coordenadas` · `asignacion-satelite-gate-coordenadas` |
| **R2** | «$estado sigue bloqueando AUNQUE la orden venga marcada» (los cuatro estados de cola, **todos con la marca**) · «un lote mixto: la irresoluble marcada pasa, la que está en curso marcada NO» · «407/R2: marcar una orden que NO es autorizable no la desbloquea» (los dos writers) | ídem |
| **R3** | «un id marcado que NO está en el lote no cambia el estado de nadie» · «marcar UNA no arrastra a las demás del mismo lote» · «407/R3: marcar un id que NO está en el lote no cambia nada» (los dos writers) | ídem |
| **R4** | «lat/lng presentes + id marcado → `asignable`, no el estado nuevo» | `asignabilidad-coordenadas-autorizada` |
| **R5** | «R5 (no-regresión): la MISMA fila SIN la marca sigue bloqueando» · «407/R10: con cero autorizadas, la clave NO EXISTE» con su `toEqual` completo · «R5: sin el campo, el service recibe la lista VACÍA» (las dos actions) · **y `asignabilidad-coordenadas.test.ts` entero, sin tocar una expectativa** | los cinco |
| **R6** | bloque «407/R6-R7 — la marca NO desactiva ninguna otra guarda»: sin rol → `forbidden`; mensajero bloqueado por cierres; origen no permitido; tope de intentos. En satélite además `sin_zona`, `bodega_bloqueada` y `zona_ajena` | `guia-asignacion-gate-coordenadas` · `asignacion-satelite-gate-coordenadas` |
| **R7** | en cada uno de esos casos: `expect(g.evaluar).not.toHaveBeenCalled()` **y** `asignarBodegaLote`/`asignarSateliteLote` `not.toHaveBeenCalled()` | ídem |
| **R8** | «407/R8: lote mixto → `partial`, la marcada se asigna y la que está en curso se reporta» (lote de 3, en los dos writers) | ídem |
| **R9** | «la segunda llamada SIN marca, sobre la MISMA fila, vuelve a bloquear» · «tampoco muta la fila que recibió» · «una instancia NUEVA tampoco hereda nada» | `asignabilidad-coordenadas-autorizada` |
| **R10** | «407/R10: con cero autorizadas, la clave NO EXISTE en el resultado» (`not.toHaveProperty`, no `toBeUndefined`) · «el lote entero marcado y bloqueado → `conflict` sin ninguna cifra» · y la cifra presente en `ok` y en `partial` | los dos writers |
| **R11** | «407/R11: las dos cifras son DISJUNTAS — una orden de la 400 y otra de la 407» → `{ sinUbicacion: 1, sinUbicacionAutorizada: 1 }` y la suma cuadra con las asignadas | los dos writers |
| **R12** | **Backend:** son dos campos distintos y disjuntos (R11) y el estado nuevo nunca se filtra como `motivo` (`expect(JSON.stringify(r)).not.toContain(...)`). **La parte del texto** (`autorizacion-texto-no-miente.guardia`) es del frontend, T9. | los dos writers |
| **R17** | **Backend:** «$motivo: el predicado y el gate dicen lo MISMO» para **cada** valor de `EstadoBloqueante`, más «las recetas producen EXACTAMENTE el estado que dicen» (no-vacuidad) y «hay al menos uno de cada lado». **El guardia sobre los dos modales** es del frontend, T8. | `asignabilidad-coordenadas-autorizada` |
| R13, R14, R15, R16, R18, R19, R20 | **frontend (T7–T11)** — no cubiertos aquí | — |

Extra que el spec no pedía pero el borde sí merece: «un id que no es uuid en la marca →
`validation_error`, sin tocar el service», en las dos actions.

---

## 4. Contrapruebas y mutaciones

Regla que se siguió: **cada caso nuevo se mató con una mutación antes de creérselo.** Son
**13**: doce las mata un test y una (la nº 1) la mata `tsc`. Se aplicaron con un script que
revierte al terminar y **comprueba por sha256 que los seis archivos vigilados vuelven byte a
byte a su estado previo** (`revert limpio: True`) — porque un arnés de mutaciones que no
demuestra que ejecutó algo ya mintió en este repo.

| # | Mutación | Qué rompe | Resultado |
| --- | --- | --- | --- |
| 1 | quitar el valor de `EstadoAsignable` dejándolo en `EstadoAsignabilidad` | el tripwire de la 400 | **MATA** — `TS2741: Property 'asignable_sin_ubicacion_autorizada' is missing … in type 'Record<EstadoBloqueante, string>'` (+ `TS2820`). Es la contraprueba obligatoria de T1: **el tripwire está vivo** |
| 2 | sacar el `if` de la rama R3 y ponerlo como **paso propio** antes de la cola | R2 | **MATA** — 9 casos rojos |
| 3 | guardar el conjunto en un **campo de la instancia** | R9 | **MATA** — 1 caso rojo (la segunda llamada sin marca) |
| 4 | acortar la lista interna de `esAsignable` (fallo mudo: **compila**) | R1 | **MATA** — 5 casos rojos |
| 5 | añadir `geocodificacion_agotada` a `MOTIVOS_AUTORIZABLES_SIN_UBICACION` | R17/T3 | **MATA** — 3 casos rojos |
| 6 | `GuiaAsignacionService` **no reenvía** la marca a `evaluar` | R1 | **MATA** — 4 rojos |
| 7 | `GuiaAsignacionService` no cuenta la segunda cifra | R10/R11 | **MATA** — 4 rojos |
| 8 | `GuiaAsignacionService` expone la cifra **también en cero** | R10 | **MATA** — 5 rojos |
| 9 | `AsignacionSateliteService` **no reenvía** la marca | R1 | **MATA** — 4 rojos |
| 10 | `AsignacionSateliteService` no cuenta la segunda cifra | R10/R11 | **MATA** — 4 rojos |
| 11 | `AsignacionSateliteService` expone la cifra en cero | R10 | **MATA** — 5 rojos |
| 12 | `asignarBodegaSchema` pierde el campo | R1 (borde) | **MATA** — 4 rojos |
| 13 | `asignarSateliteSchema` pierde el campo | R1 (borde) | **MATA** — 4 rojos |

**Ninguna sobrevivió.**

Las mutaciones 6 y 9 son las que importan de verdad, por la familia **«el composition root que
no inyecta»**: un writer que importa el parámetro y no lo pasa dejaría la feature muerta con la
suite en verde. Aquí no basta con que los dobles honren el segundo argumento — hay además, en
cada writer, **un caso con `AsignabilidadCoordenadasService` REAL enganchado**, alimentado por
un `findParaAsignabilidad` que devuelve el `ZERO_RESULTS` del caso de producción, y con su
contraste sin marca en la misma prueba.

---

## 5. El gate

`./init.sh` **completo**, obligado por `lib/types/**` (`lib/types/orden-guia.ts` y
`lib/types/recepcion-satelite.ts`). `--rapido` se habría negado solo.

El `.env` se copió al worktree a propósito: sin él, **147 archivos de `tests/integration/db`
se saltan** y el gate saldría verde sin haber tocado la capa de datos. Con él, los `skipped`
son **26** en las tres corridas — ninguno relevante para esta ficha, que no añade ni un test
contra Postgres.

### Corrida 1 — `164e1921` — `INIT_EXIT=1`, **rojo MÍO, arreglado**

```
 Test Files  1 failed | 1850 passed (1851)
      Tests  1 failed | 26914 passed | 26 skipped (26941)
   Duration  633.81s
ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts
INIT_EXIT=1
```

**Causa, y no era deuda ajena.** Ese guardia no lee el docstring de `esAsignable` entero: lee
una **ventana fija de 1400 caracteres** inmediatamente anterior a la firma y exige encontrar
«FEATURE 400» dentro. Mi párrafo de la 407 empujó ese texto **235 caracteres fuera**.
Arreglado en `6e3bb221`: el párrafo se acorta a lo que dice de verdad y —lo que importa más—
se deja un aviso **por encima** del párrafo de la 400 explicando la ventana, porque lo que el
guardia mide es la distancia de «FEATURE 400» a la firma y el texto escrito arriba no consume
margen. Margen actual: **115 caracteres**.

### Corrida 2 — `6e3bb221` — `INIT_EXIT=1`, **contención con el otro agente**

```
 Test Files  1 failed | 1850 passed (1851)
      Tests  1 failed | 26914 passed | 26 skipped (26941)
   Duration  832.11s
ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/db/gasto-fijo-plantilla-borrado.test.ts
INIT_EXIT=1
```

El guardia de la corrida 1 volvió a verde. El rojo nuevo es **otro archivo, y no es mío**:

```
AssertionError: expected 25 to be 24
 ❯ tests/integration/db/gasto-fijo-plantilla-borrado.test.ts:143
     expect(r.movimientosDespues).toBe(r.movimientosAntes);
```

Esa aserción cuenta **todas** las filas de `wallet_movimiento` antes y después del borrado. Si
otro proceso inserta una fila entre las dos cuentas, sale 25 donde había 24 — que es
exactamente la contención con el agente que trabaja en paralelo **contra la misma base local**
que anunció el leader (allí el síntoma era `40P01`; aquí es una cuenta global que se mueve).

**Las dos corridas del archivo, como pide el protocolo:**

| Corrida | Resultado |
| --- | --- |
| dentro del gate completo (bajo carga y con el otro agente escribiendo) | `1 failed` |
| **aislado**, `pnpm exec vitest run tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` | **`1 passed`** |

Y el argumento que cierra el caso: **mi diff no toca nada de esa familia.** Los 13 archivos del
diff son los ocho de asignación más cinco de tests; ni `wallet`, ni `gasto fijo`, ni una
consulta. Además la corrida 1 —sobre el mismo código de esa parte— **no tuvo este rojo**: no es
determinista a partir de mi cambio. **No se añade al baseline**: no es deuda medida de nadie,
es un flake de base compartida, y `tests/baseline-rojos.json` no se toca ni para eso.

### Corridas 3 y 4 — `6e3bb221` — `INIT_EXIT=1` las dos, **y cada una en un archivo DISTINTO**

```
corrida 3:  Test Files  1 failed | 1850 passed (1851)
            Tests  1 failed | 26914 passed | 26 skipped (26941)   —   777.84s
            ROJO NUEVO: tests/integration/db/seed-zonas-cruza-por-codigo.test.ts
            AssertionError: expected +0 to be 1   (`salida.resolucion.creados`)
            ...con `prisma.$transaction.timeout` en la pila
            INIT_EXIT=1

corrida 4:  Test Files  1 failed | 1850 passed (1851)
            Tests  1 failed | 26914 passed | 26 skipped (26941)   —   637.08s
            ROJO NUEVO: tests/integration/db/usuarios-filtro-busqueda.test.ts
            DriverAdapterError: se ha detectado un deadlock
            INIT_EXIT=1
```

La corrida 4 trae **la firma exacta que el leader anunció antes de empezar**: `40P01`, «se ha
detectado un deadlock», en `tests/integration/db/**`.

**Las dos corridas de cada archivo:**

| Archivo | Dentro del gate | Aislado |
| --- | --- | --- |
| `gasto-fijo-plantilla-borrado.test.ts` (corrida 2) | `1 failed` | **`1 passed`** |
| `seed-zonas-cruza-por-codigo.test.ts` (corrida 3) | `1 failed` | **`8 passed`** |
| `usuarios-filtro-busqueda.test.ts` (corrida 4) | `1 failed` | **`11 passed`** |

Y la medida que cierra el asunto — **la capa de datos entera, aislada, sobre este mismo
código**:

```
pnpm exec vitest run tests/integration/db
 Test Files  230 passed (230)
      Tests  2746 passed (2746)
   Duration  52.08s
```

### Qué dicen esas cuatro corridas juntas

- **Un solo archivo rojo por corrida, y en las tres últimas es uno DISTINTO cada vez.** Un
  fallo determinista de mi diff saldría en el mismo sitio siempre.
- Los tres son de `tests/integration/db/**` y los tres **pasan aislados**; los 230 archivos de
  esa carpeta pasan enteros en 52 s.
- Las cifras del resto no se mueven ni una: **1850 archivos y 26.914 tests verdes, 26
  saltados**, idénticas en las cuatro corridas.
- **Mi diff no toca ni una consulta, ni el esquema, ni una migración.** Son 13 archivos: los 8
  de asignación y 5 de tests.
- Los tres síntomas son los de una **base local compartida con otro agente escribiendo en
  paralelo**: una cuenta global de `wallet_movimiento` que se mueve entre dos lecturas, un
  `INSERT` que no crea porque la fila ya estaba, y un deadlock de Postgres con su nombre.

**Veredicto del gate: verde salvo contención de base compartida.** No queda ningún rojo
atribuible a esta ficha; el único que lo era (corrida 1) está arreglado y verificado en las
tres corridas siguientes. **Nada se añadió a `tests/baseline-rojos.json`**: un flake de base
compartida no es deuda medida de nadie, y el baseline no se toca «para pasar el gate».

⚠️ **Para el leader:** conviene repetir `./init.sh` cuando el otro agente haya terminado, antes
de la release. Lo que aquí no se puede demostrar es una corrida completa sin contención, porque
la contención no depende de mí.

### Poda del baseline (T14)

El gate no propuso podar ningún archivo de `tests/baseline-rojos.json` en ninguna de las
corridas. No se toca.

### Comandos sueltos

```
pnpm run typecheck   → sin errores
pnpm run lint        → 0 errores (183 warnings preexistentes, ninguno en archivos de esta ficha)
```

---

## 6. Lo que queda listo para el frontend

El frontend no tiene que tocar nada de backend. Esto es lo que ya puede consumir:

### Lo que importa de `@/lib/interfaces/services/IAsignabilidadCoordenadasService`

```ts
export const MOTIVOS_AUTORIZABLES_SIN_UBICACION: readonly EstadoBloqueante[];
export function esMotivoAutorizableSinUbicacion(motivo: string): boolean;
```

Es un módulo **sin dependencias de runtime**, así que un componente cliente lo importa sin
arrastrar Prisma ni `node:crypto`. **R17 exige que los dos modales usen ESTE predicado**, nunca
un literal propio: el guardia vigente (`geocodificacion-motivo-por-orden-mismo-modulo`) se pone
rojo si el código de un modal contiene `"direccion_no_geocodificable"` como string, y su lista
`MOTIVOS_DEL_GATE` (escrita a mano, `:39-47`) tiene que ganar el octavo estado,
`"asignable_sin_ubicacion_autorizada"` — **eso es T8 y no está hecho**.

### Lo que se manda al asignar

`asignarDesdeBodega` y `asignarDesdeSatelite` aceptan un campo más, ya validado en el borde:

```ts
autorizarSinUbicacionIds: string[]   // uuids; `.default([])`, así que se puede omitir
```

⚠️ **Son uuids.** El schema lo exige (`z.array(z.string().uuid())`), así que la segunda
petición tiene que mandar el `ordenId` real, no el `numRemision` ni un id de pantalla. Un valor
que no sea uuid devuelve `validation_error` **sin tocar el service** (hay test).

Y recuerda lo que decidió el design §4.2: la segunda petición va **acotada a las autorizables**,
no al lote entero. En la ruta `partial` una parte del lote ya está asignada; reenviarla la
encontraría en `por_recoger` y el writer abortaría todo con «estado de origen no permitido».

### Lo que devuelve

`AsignarBodegaResult` y `AsignarSateliteResult`, en `ok` y en `partial`:

```ts
sinUbicacionAutorizada?: number   // AUSENTE cuando vale cero, nunca `0`
```

Es **campo hermano** de `sinUbicacion` (la cifra de la 400) y de `bloqueadas`, jamás anidado en
ellos. Las dos cifras son **disjuntas**: ninguna orden se cuenta en las dos. `conflict` no lleva
ninguna de las dos — ahí no se asignó nada.

**No reutilices el texto de la 400 para esta cifra (R12).** Aquél dice «por un problema del
sistema, **no de la dirección**» y aquí la dirección **sí** es el problema: sería falso. Los dos
literales de la 407 están **aprobados y fijados a mano** en `design.md` §5.1 y §5.2 y se copian
carácter a carácter; los tests los afirman **escritos a mano**, nunca contra la constante
exportada.

### Lo que NO existe, para que nadie lo busque

No hay Server Action nueva, ni tabla, ni columna, ni forma de saber **quién** autorizó. La
autorización es un parámetro de la propia asignación y muere con la petición: si la orden se
libera y se reasigna, **hay que volver a autorizarla**. Es la decisión del humano del
2026-09-10 (design §8-A1), tomada a sabiendas.

---

## 7. Veredicto

Backend completo y medido: el gate acepta la marca dentro de su rama R3, los dos writers la
reenvían y la cuentan aparte, el borde la valida, nada se persiste, 13 mutaciones aplicadas y
13 muertas, y los únicos rojos que quedan son tres archivos distintos de `integration/db` que
pasan aislados mientras otro agente escribe en la misma base local.
