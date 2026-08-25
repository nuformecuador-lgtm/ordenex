# Feature 281 — Bitácora de implementación

> Rama `feature/281-maestro-tarjeta-vacio-de-mas`. Frontend, complejidad baja.
> Fecha: 2026-08-25. Spec: `specs/281-maestro-tarjeta-vacio-de-mas/`.

---

## 0. La Tanda 0 (reproducir en la app) NO se ejecutó, y este es el motivo

`tasks.md` abre con una Tanda 0 que exige **conducir la aplicación con Playwright** para
contar las tarjetas antes de tocar una línea. **Se saltó a propósito, por decisión del
humano**, y no por comodidad: cuando se escribió el spec la causa era desconocida y la
captura de pantalla era la única evidencia disponible. Entre medias la causa quedó
cerrada **por una vía más fuerte que una captura**:

**Tres tests estaban rojos en `dev`, hoy, por esta causa exacta**, con el mensaje
`TestingLibraryElementError: Found multiple elements with the text: No hay postulaciones pendientes`:

| Archivo | Casos rojos |
| --- | --- |
| `tests/components/AdminMaestroDashboard.test.tsx` | 2 |
| `tests/components/HomePageMaestro.test.tsx` | 1 |

Un test rojo con ese mensaje **es** la medición que la Tanda 0 buscaba: dice que en el
DOM renderizado hay **dos** elementos con el texto del vacío de mensajeros donde debía
haber uno, y lo dice de forma reproducible y ejecutable, no como descripción de lo que
alguien cree que pasa. Una captura de Playwright habría añadido un píxel de confianza
sobre lo que estos tres rojos ya afirman en texto citable.

**Lo que esto NO cubre, y se dice en vez de taparlo:** no se ha mirado `/dashboard` con
un navegador en esta ficha. Si el defecto tuviera además una manifestación que jsdom no
ve —una tarjeta que salga del CSS, del shell o de un componente que en el test está
doblado—, esta ficha no la habría encontrado. Los rojos prueban el doble montaje; no
prueban que en el navegador se vean exactamente dos tarjetas y no tres por otra razón.

### R1, R2, R3 quedan así

- **R1** (contar en la app): **sustituido** por los tres rojos de arriba, con el motivo
  escrito. El texto citable existe: el propio informe de Testing Library imprime los dos
  `<p class="text-sm font-medium text-foreground">No hay postulaciones pendientes</p>`
  que encontró.
- **R2** (confirmar el blob **commiteado**, no el árbol de trabajo): **medido**, §1.
- **R3** (si la medida contradice al articulado, manda la medida): la medida **confirma**
  el articulado. Cuenta esperada 2 avisos de vacío, cuenta real 3, sobrante la de arriba
  sin título. No hubo que volver a la puerta humana.

---

## 1. R2 — el defecto está COMMITEADO, y el rastro se verificó de nuevo

`grep -c "<PostulacionesPendientesPanel />"` sobre el blob commiteado de cada rama:

| Ref | Montajes del panel |
| --- | --- |
| `HEAD` de esta rama (`f149e88c`) | **2** |
| `origin/dev` | **2** |
| `origin/prod` | **1** |

No es una mutación local: está en el blob de `dev`. **Producción NO lo tiene.**

Rastro, comprobado commit a commit en esta sesión (no heredado de la ficha):

| Commit | Fecha | Asunto | Montajes |
| --- | --- | --- | --- |
| `5c37e0ca` | 2026-08-20 | `fix(ui): el panel maestro deja de encabezar con un contenedor vacio` | **1** |
| `8400b76b` | 2026-08-21 | `Merge branch 'dev' … into ux` | **2** |

El montaje suelto **no lo escribió nadie**: lo repuso una **resolución de merge** que
deshizo el arreglo del día anterior. Es la razón por la que esta ficha no se cierra
borrando una línea: sin un test que cuente montajes, el siguiente merge lo vuelve a
traer exactamente igual, sin que nada se ponga rojo por escrito.

---

## 2. Baseline de rojos ANTES de tocar nada, y delta DESPUÉS

Medido con `pnpm exec vitest run <archivos>`, salida pegada en cada fila.

### Baseline (árbol de `dev`, antes del arreglo) — **3 archivos / 4 tests rojos**

| Archivo | Salida | ¿Mío? |
| --- | --- | --- |
| `tests/components/AdminMaestroDashboard.test.tsx` + `tests/components/HomePageMaestro.test.tsx` | `Test Files  2 failed (2)` · `Tests  3 failed \| 5 passed (8)` | **sí** |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | `Test Files  1 failed (1)` · `Tests  1 failed \| 17 passed (18)` | **NO — ajeno** |

### Después del arreglo — **1 archivo / 1 test rojo**

| Archivo | Salida | ¿Mío? |
| --- | --- | --- |
| `AdminMaestroDashboard.test.tsx` + `HomePageMaestro.test.tsx` | `Test Files  2 passed (2)` · `Tests  14 passed (14)` | verde |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | sigue en `1 failed` | **NO — ajeno** |

**Delta de esta rama: −2 archivos / −3 tests rojos. Ni uno nuevo.**
De 8 casos a 14: los 8 de antes intactos (ninguno relajado ni borrado) + **6 añadidos**.

> **Matiz honesto sobre el baseline, para que nadie lo lea como más de lo que es.** Esos
> «3 archivos / 4 tests» son la medida de **corridas dirigidas** a los archivos
> implicados, no de la suite entera de `dev`. La suite completa **sí** destapó un tercer
> archivo rojo —`tests/components/CrearTiendaForm.test.tsx`—, ajeno a esta ficha y no
> estable; queda medido y razonado en §9. `--changed` sólo ve tu diff: no detecta un `dev`
> que ya venía rojo, y ésta es justo esa clase de agujero.

### El rojo que queda es AJENO y esta ficha NO lo toca

`tests/unit/guards/superficie-de-uso.guardia.test.ts` denuncia
`lib/actions/tarifas.ts:67 obtenerTarifa` como Server Action **inalcanzable** —no tiene
pantalla que la consuma—. Su pantalla es la **ficha 275**, de otra sesión, que sigue
`pending`. **Por decisión explícita del humano no se arregla, no se anota en su archivo y
no se silencia.** El gate de esta rama se juzga contra ese rojo conocido: si el gate
completo termina en rojo con **exactamente ese fallo y ningún otro**, el resultado de
esta ficha es limpio.

---

## 3. El arreglo (T5, T6)

`app/(app)/_components/AdminMaestroDashboard.tsx`

- **Retirado** el `<PostulacionesPendientesPanel />` suelto de la línea 36, el que vivía
  fuera de todo `ContenedorSeccion`. Nada más: ni un texto, ni un rótulo, ni el orden, ni
  una clase. El `import` **no** quedó huérfano —el montaje titulado lo sigue usando—, así
  que se conserva.
- **Docblock ajustado**: se añadió el párrafo de la feature 281 que dice cuál es la
  composición válida (dos bloques, cada uno dentro de su `ContenedorSeccion` con título,
  **ningún** panel fuera de sección), qué pintaba el suelto, y que **entró por una
  resolución de merge**. No se reescribió la historia de las features 23/253/R36 ni se
  tocó nada bajo `progress/`: son fotos históricas.

Se borró el montaje **de arriba**, no el titulado (design §5.B): el titulado es el que
lleva el rótulo que R13 exige conservar y por el que los tests existentes lo localizan.

---

## 4. La prueba que cuenta (T7-T10), y por qué cuenta de verdad

Todo **añadido** a `tests/components/AdminMaestroDashboard.test.tsx`. Ni un caso
existente se reescribió, relajó ni borró.

La forma es **bilateral** en los dos sentidos, que es lo único que sirve:

- `getAllByText(...)` **lanza si sale CERO veces** → cubre el «de menos».
- `.toHaveLength(1)` **falla si sale DOS o más** → cubre el «de más».

Censo de aserciones prohibidas por R9 en los casos nuevos: **cero** `queryAllByText` sin
comparar longitud, **cero** `toBeTruthy()`, **cero** `length >= 1`. Los dos
`queryAllByText` que aparecen comparan `.toHaveLength(0)`, que es la aserción exacta que
R7 pide (con datos, **ningún** aviso de vacío).

| Caso nuevo | Mide | R |
| --- | --- | --- |
| «hay exactamente un “no hay postulaciones pendientes” y exactamente un “no hay vehículos ni bodegas”» | M1 — el síntoma que el humano vio en la captura | R4 |
| «con las dos listas vacías hay una sola región de cada panel» | M2 — la causa, por `getAllByRole("region", { name })` | R6 |
| «con postulaciones en las dos listas sigue habiendo una sola región de cada panel» | M2 **con datos**: no depende del estado de las listas | R6 |
| «la región de mensajeros tiene una tarjeta por ancestro y esa tarjeta lleva su rótulo» | M3 | R5 |
| «la región de vehículos y bodegas tiene una tarjeta por ancestro y esa tarjeta lleva su rótulo» | M3 | R5 |
| «cada postulación aparece una sola vez, los rótulos siguen y el vacío desaparece» | M4 | R7, R8 |

**M2 es la medida principal**, por encima de M1: M1 cuenta tarjetas de vacío y sólo
existe con la pantalla vacía; M2 cuenta **montajes** y vale con y sin datos, que es donde
el defecto también dolía (lista duplicada, dos regiones con el mismo nombre accesible).

**Límite declarado de M3, escrito también en el propio test:** localiza la tarjeta por
`[data-slot="card"]`, o sea por un detalle de la primitiva shadcn, no por un rol
accesible. Es deliberado: `ContenedorSeccion` **no emite `role="region"` a propósito** —su
docblock lo dice: los landmarks los declaran los shells, y las guardias de analítica
congelan cuántas regiones hay—. Darle un landmark para poder consultarlo por rol rompería
esas guardias y sería rediseñar el componente para acomodar un test.

---

## 5. R10 / T11 — la aserción heredada de `:120`, medida y no supuesta

`tasks.md` T2 preguntaba si `expect(listarMensajerosMock).toHaveBeenCalledTimes(1)`
estaba hoy verde o roja con el doble montaje. **Medido, y la respuesta es una tercera
opción que el spec no había previsto:**

Ese caso estaba **rojo**, pero **moría antes de llegar a la línea 120**: la traza señala
`tests/components/AdminMaestroDashboard.test.tsx:118:18`, el
`findByText("No hay postulaciones pendientes")` que revienta con `Found multiple elements`.
Es decir:

- La suite **sí venía rota** en `dev` (hipótesis 2 de `requirements.md`), y
- **la sensibilidad de `:120` al doble montaje NO llegó a medirse**, porque la ejecución
  nunca llegó ahí. No se puede afirmar ni que sea insensible ni que no lo sea.

**Lo hecho:** la línea se conserva **sin relajar ni borrar** (R13) y, tras el arreglo,
**vuelve a verde por sí sola** —el caso entero pasa—. Junto a ella se escribió el
comentario que dice **qué no mide**: que no es prueba de «el panel se monta una vez», que
SWR deduplica por clave y podría estar en 1 con dos montajes, y que la cardinalidad de
montajes la mide M2 por regiones del DOM. **R6 no se apoya en esa línea.**

---

## 6. Las mutaciones vistas morder (T12, R9)

Corridas **secuencialmente y nunca en paralelo con el gate** —una guardia leída sobre un
árbol que otro proceso está mutando no dice nada—. Cada mutación se aplicó desde una copia
de respaldo, se **comprobó en disco** antes de correr los tests (contando las apariciones
en el archivo mutado, en vez de confiar en que el script dijera «aplicada»), y el árbol se
restauró después con `diff` contra el respaldo.

| # | Mutación | Comprobación en disco | Resultado | Qué se puso rojo |
| --- | --- | --- | --- | --- |
| **MUT-1** | restaurar `<PostulacionesPendientesPanel />` suelto | 3 apariciones del panel en el archivo | **ROJO — `Tests  7 failed \| 1 passed (8)`** | M1, M2 (vacío **y** con datos), M3-mensajeros, M4, y los 2 casos heredados |
| MUT-2 | duplicar el `<ContenedorSeccion>` de vehículos | 2 montajes de `PostulacionRecursoPanel` | **ROJO — `Tests  7 failed \| 1 passed (8)`** | M1-recursos, M2-recursos, M3-recursos, M4 |
| MUT-3 | quitar el `<ContenedorSeccion>` de mensajeros dejando el panel suelto | 1 contenedor en el archivo | **ROJO — `Tests  3 failed \| 5 passed (8)`** | M3 (`expected null not to be null`) y el rótulo |
| MUT-4 | cambiar el texto del `EmptyState` de mensajeros | 1 aparición del texto mutado | **ROJO — `Tests  5 failed \| 3 passed (8)`** | M1 y M2-vacío (`Unable to find an element with the text`) |
| MUT-5 | con datos, restaurar el montaje suelto | — | **ROJO** (cubierto por MUT-1) | M4: `expected [ <div…>, <div…> ] to have a length of 1 but got 2` |

**Sobre MUT-5, dicho sin adornos:** MUT-5 y MUT-1 son **la misma mutación del árbol**
—«restaurar el montaje suelto»—; la única diferencia que el design les da es qué caso mira
cada una. La corrida de MUT-1 ejecuta el archivo entero, incluido el caso con datos, así
que su rojo **es** la evidencia de MUT-5. No se corrió dos veces la misma mutación para
poder escribir dos filas.

Mensajes de aserción de **MUT-1**, la mutación obligatoria de esta ficha:

```
281/R4 … AssertionError: expected [ <p …(1)></p>, <p …(1)></p> ] to have a length of 1 but got 2
281/R6 (vacío)     … AssertionError: expected [ <section …(2)>…(1)</section>, …(1) ] to have a length of 1 but got 2
281/R6 (con datos) … AssertionError: expected [ <section …(2)>…(3)</section>, …(1) ] to have a length of 1 but got 2
281/R5 … TestingLibraryElementError: Found multiple elements with the role "region" and name "Postulaciones pendientes"
281/R7+R8 … AssertionError: expected [ <div …(2)></div>, <div …(2)></div> ] to have a length of 1 but got 2
```

MUT-1 era la que no se podía saltar: es literalmente el defecto que esta ficha arregla, y
es el que un merge ya deshizo una vez. **Muerde: 7 de 8 casos.**

Árbol restaurado y comprobado: `diff` contra los respaldos → **idénticos**;
`git diff --stat` de `PostulacionesPendientesPanel.tsx` → **vacío** (MUT-4 no dejó rastro).
Tras restaurar, las cuatro suites de la pantalla y sus dos paneles:
`Test Files  4 passed (4)` · `Tests  34 passed (34)`.

---

## 7. Frontera del diff (T13, R11, R12)

`git diff --name-only` sobre el código:

```
app/(app)/_components/AdminMaestroDashboard.tsx   |  11 +-
tests/components/AdminMaestroDashboard.test.tsx   | 194 +++-
```

**Cero** `db/`, **cero** `lib/`, **cero** `app/api/`, **cero** `components/`. Ni esquema,
ni migración, ni RLS, ni consulta, ni servicio, ni repositorio, ni Server Action, ni ruta,
ni contrato. El cambio vive **entero** en la capa de composición de una pantalla (R11).

**R12/R13 — ni una cadena visible cambió:** el título «Panel maestro», la descripción
«Postulaciones pendientes: mensajeros, y vehículos o bodegas ofrecidos desde la web» y los
dos rótulos de sección siguen literales. El único cambio de prosa está en el **docblock**,
que no se renderiza.

---

## 8. Mapa R → verificación (cerrado)

| R | Cómo quedó verificado | Dónde |
| --- | --- | --- |
| R1 | **sustituido** por los 3 tests rojos con `Found multiple elements`, con el motivo escrito | §0 |
| R2 | `git show` de `HEAD`, `origin/dev` y `origin/prod` + los dos commits del rastro | §1 |
| R3 | la medida **confirma** el articulado (3 tarjetas, sobrante la de arriba); no hubo desvío | §0 |
| R4 | `getAllByText(<vacío mensajeros>)` → 1 y `getAllByText(<vacío recursos>)` → 1 | caso «hay exactamente un…» · rojo con MUT-1 y MUT-4 |
| R5 | `region.closest('[data-slot="card"]')` ≠ null y el rótulo dentro de esa tarjeta | 2 casos «…tiene una tarjeta por ancestro…» · rojo con MUT-3 |
| R6 | `getAllByRole("region", { name })` → 1 para cada panel, **con y sin datos** | 2 casos «…una sola región de cada panel» · rojo con MUT-1 y MUT-2 |
| R7 | con datos: `queryAllByText(<vacío>)` → 0 en ambos, y los dos rótulos presentes | caso «cada postulación aparece una sola vez…» |
| R8 | con datos: `getAllByText("Nombre-u1 Ap")` → 1 y `getAllByText("Persona-r1")` → 1 | mismo caso · rojo con MUT-1/MUT-5 |
| R9 | las 5 mutaciones con su rojo y su salida + censo de aserciones prohibidas: cero | §6, §4 |
| R10 | `:120` medida (moría en `:118`, nunca se ejecutó), conservada sin relajar, con su límite escrito al lado | §5 |
| R11 | `git diff --name-only`: sólo el componente y su test | §7 |
| R12 | ninguna cadena visible modificada; sólo el docblock | §7 |
| R13 | los 8 casos previos siguen y pasan sin tocarse; título, descripción y rótulos intactos | §2, §7 |

**Ninguna fila queda pendiente.**

---

## 9. Gate

- `pnpm run db:generate` **antes** del gate: `✔ Generated Prisma Client (v7.8.0)`. Un
  cliente Prisma rancio da falsos negativos de typecheck que no son del cambio.
- `./init.sh` **completo**, con `INIT_EXIT=$?` **dentro** del log y sin `tail` —canalizar
  por `tail` un comando en segundo plano trunca el fichero en origen y el rojo se queda
  sin nombre—.

### Corrida 1 — `INIT_EXIT=1`

```
✓ typecheck paso
lint: sólo warnings de `no-unused-vars` preexistentes (ninguno en los archivos de esta ficha)
Test Files  2 failed | 1390 passed (1392)
     Tests  2 failed | 18938 passed | 26 skipped (18966)
  Duration  519.35s
INIT_EXIT=1
```

Los **dos** rojos, con nombre:

1. `tests/unit/guards/superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67
   obtenerTarifa`. **AJENO**, ficha 275, `pending`. Es el rojo conocido contra el que se
   juzga esta rama.
2. `tests/components/CrearTiendaForm.test.tsx` → «una tienda con SÓLO tarifas de zona
   tampoco se ofrece», `TestingLibraryElementError: Unable to find an accessible element
   with the role "option"` en `opcionesDelSelect` (`:93`), tras hacer clic en el
   `combobox`. **También ajeno**, y además **no es un rojo estable**.

Sobre el segundo, con lo medido y sin adornarlo:

- **No puede venir de este cambio.** Ese archivo importa
  `@/app/(app)/configuracion/tarifas/_components/CrearTiendaForm` y dos tipos; **cero**
  referencias a `AdminMaestroDashboard` o a `PostulacionesPendientesPanel`. El diff de
  esta rama no llega a él ni por importación transitiva.
- **Aislado pasa:** `pnpm exec vitest run tests/components/CrearTiendaForm.test.tsx` →
  `Test Files  1 passed (1)` · `Tests  4 passed (4)`.
- **Y aun así, «pasa aislado» no es «pasa en la suite»**: son dos medidas distintas y no
  se van a confundir aquí. El síntoma —un portal de Radix cuyas `option` no han llegado
  al DOM cuando la consulta mira— es el perfil de un flake bajo carga, no el de una
  regresión. Por eso se corrió el gate **una segunda vez**.

### Corrida 2 — `INIT_EXIT=1`, mismo árbol, sin tocar una línea

```
✓ typecheck paso
Test Files  1 failed | 1391 passed (1392)
     Tests  1 failed | 18939 passed | 26 skipped (18966)
  Duration  515.77s
INIT_EXIT=1
```

El **único** rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts` →
`lib/actions/tarifas.ts:67 obtenerTarifa`. **El rojo ajeno de la ficha 275, y ninguno
más.** `CrearTiendaForm.test.tsx` pasó, sin que se le tocara nada: era flake bajo carga,
como el perfil del síntoma sugería.

### Lectura del gate, con los números que importan

| | Archivos rojos | Tests rojos |
| --- | --- | --- |
| Baseline de `dev` (corridas dirigidas) | **3** | **4** |
| Tras el arreglo, gate completo corrida 2 | **1** | **1** |

Y ese **1** es exactamente el guard ajeno de la ficha **275**. `INIT_EXIT=1` es, para esta
rama, el resultado esperado y limpio: el gate no puede terminar en verde mientras el rojo
de otra sesión siga en `dev`, y **taparlo no era una opción** —el humano lo dejó dicho—.

**Lo que este gate NO demuestra:** que `dev` esté sano. Sigue rojo, por la 275. Esta ficha
sólo demuestra que **su delta es negativo**: quita tres rojos y no estrena ninguno.

---

## 10. Abierto para el leader

- **`origin/dev` se movió durante esta sesión**: de `e9aed77e` a `eb98e176` (PR #494,
  ficha 246, el gate del cierre y las órdenes reservadas para después). Toca
  `lib/interfaces/…`, `lib/repositories/CierreDiaRepository.ts`,
  `lib/services/CierreDiaService.ts` y sus dos tests: **cero solape** con la frontera de
  esta ficha. Aun así, el pre-vuelo caduca: hay que volver a comparar contra `origin/dev`
  antes de abrir la release.
- **El rojo ajeno sigue vivo** (§2): `superficie-de-uso.guardia` →
  `lib/actions/tarifas.ts:67 obtenerTarifa`, ficha **275**, `pending`. Esta ficha no lo
  tocó, por decisión del humano.
- **Q5 sin responder:** ¿se quiere confirmación en **producción** después de desplegar
  —volver a `/dashboard` y contar dos tarjetas—? Producción **no** tiene el defecto
  (`origin/prod` monta uno), así que desplegar esta rama no arregla nada visible para el
  usuario final: **impide que el defecto llegue** en la próxima release. Conviene decirlo
  al humano, que lo dio de alta con una captura que creía de producción.
- **Ficha propuesta (design §5.D), no dada de alta:** una guardia repo-wide contra el
  mismo componente montado dos veces en un JSX de página. Descartada **para esta ficha**
  porque el análisis de JSX por texto da falsos positivos legítimos y M2 ya cierra el caso
  por el DOM. Si se quiere red para toda la familia de «fallos mudos», es ficha aparte.
- **Lo que evita que vuelva, dicho con nombre:** el defecto entró por una **resolución de
  merge** (`8400b76b`), no por una decisión de nadie. Quien revise un merge que toque
  `AdminMaestroDashboard.tsx` tiene ahora un test que cuenta montajes y un docblock que
  avisa; sin eso, el siguiente merge lo repone en silencio.
