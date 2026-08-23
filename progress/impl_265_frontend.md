# Feature 265 — Bitácora del bloque FRONTEND (`FE1`-`FE4` + `F6`)

> Rama `feature/265-optimizador-frontend`, desde `origin/dev` en `c9e0e056` (el merge del
> bloque backend, PR #464). Alcance: **sólo la capa de presentación** y las mutaciones
> `M-v` … `M-z`, que el backend dejó explícitamente para aquí porque mutan la pantalla.
> Lo que quedó a deber está en la última sección, dicho y no disimulado.

---

## 1 · El defecto que cierra este bloque, en una frase

Hasta hoy la pantalla de reparto era **idéntica** viniera el orden de las paradas del servicio
de rutas o lo hubiera calculado la app por cercanía en línea recta. El mensajero salía con un
orden aproximado creyéndolo óptimo, y no había forma de que se enterara: ni tras un `F5`, ni
cuando el orden lo calculaba el cron, ni cuando la degradación venía de la falta de credencial
—el caso que **ya ocurría en silencio antes de esta ficha**—.

El backend dejó el dato (`ruta_optimizada.secuencia_fuente`). Este bloque lo pinta.

---

## 2 · Archivos

### Modificados — producción (2)

| Archivo | Cambio |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` | **FE1** · derivada `ordenAproximado` + `Alert variant="default"` hermano del aviso de ruta desactualizada, **fuera del acordeón del mapa** |
| `app/(app)/mis-asignaciones/_components/SincronizarRutaButton.tsx` | **FE2** · el `case "ok"` pasa de dos desenlaces a **tres**: `omitida` / orden local (`toast.warning`) / lo demás |

### Modificados — tests (2)

| Archivo | Cambio |
| --- | --- |
| `tests/components/RepartoModule.test.tsx` | **FE3** · `describe` nuevo con 6 casos (el `it.each` cuenta 2). **Ni una línea de los tests que ya estaban** |
| `tests/components/SincronizarRutaButton.test.tsx` | **FE3** · 5 casos nuevos al final del `describe` existente (el `it.each` cuenta 2). **Ni una línea de los que ya estaban** |

### Creados

- `progress/impl_265_frontend.md` (este archivo).

**Ningún componente nuevo, ninguna primitiva nueva** (`design.md` §14.5): se usa el `Alert` de
`components/ui/alert.tsx`, que ya estaba importado en `RepartoModule`. No se tocó `lib/`, ni
`db/`, ni ninguna Server Action.

---

## 3 · Lo que se pinta, y por qué así

### 3.1 · Aviso A — persistente, en la pantalla (FE1)

> **El orden de las paradas es aproximado**
> Lo calculamos en la app, por cercanía en línea recta: no toma en cuenta calles ni tráfico.
> Revísalo antes de salir.

- **`variant="default"`, no `destructive`.** No es un error: es una ruta **utilizable** que
  conviene revisar. El rojo sigue reservado a «El orden mostrado no está actualizado», que sí
  describe una ruta que no se puede seguir.
- **Fuera del acordeón del mapa.** El orden manda en la **lista**, que se ve siempre; el mapa
  se pliega. Un aviso sobre el orden escondido dentro de un mapa cerrado es un aviso que no
  existe.
- **`ruta.secuenciaFuente === "local"`, no `!== "proveedor"`.** `null` es **no consta** y ahí
  la pantalla se calla: ni avisa ni afirma lo contrario (**R45**). La diferencia la mata una
  mutación propia, `M-v2` (§5).

### 3.2 · Aviso B — el toast (FE2)

> Ruta ordenada de forma aproximada: revisa el orden de las paradas.

El `case "ok"` tenía **dos** desenlaces y ahora tiene **tres**. `omitida` conserva su mensaje
(«La ruta ya estaba al día.»): no se recalculó nada, así que no hay nada nuevo que contar. Y
`null` cae en «Ruta sincronizada.» a propósito — sin dato no se afirma de más, pero tampoco se
alarma sobre una ruta de la que no sabemos nada malo.

El resto del `switch` (`conflict`, `forbidden`, `unauthenticated`, `validation_error`) **no se
tocó**.

### 3.3 · Las tres señales siguen siendo tres (R43)

| Señal | Qué dice | Dónde se ve |
| --- | --- | --- |
| Punto de partida aproximado | *desde dónde* se calculó | `<p>` dentro del bloque del mapa (feature 92) |
| Línea punteada | el **dibujo** no sigue calles | `RutaMapaInner`, `dashArray` cuando `trazado.fuente !== "routes"` |
| **Orden aproximado** ← nuevo | el **orden** no lo calculó el servicio de rutas | `Alert` de FE1 |

⚠️ **La tercera no es un texto, y eso hay que decirlo.** El diseño (§10.2) habla de «los tres
textos presentes»; en el DOM sólo hay **dos textos**, porque el trazado local se manifiesta como
una línea punteada de Leaflet, no como una frase. El test afirma la tercera **donde de verdad se
decide**: la geometría con `fuente: "local"` que llega al mapa. Es lo honesto, y queda escrito
para que nadie lea el test buscando un tercer literal que no existe.

---

## 4 · Mapa `R<n> → test`

Sólo los requisitos de este bloque. `R1`-`R37`, `R46`-`R49` están en
`progress/impl_265_backend.md`.

| R | Qué exige | Test que lo defiende |
| --- | --- | --- |
| **R38** | Aviso visible **desde el primer render**, sin pulsar nada | `RepartoModule.test.tsx` → «R38/R40: con el orden calculado en la app, el aviso está desde el PRIMER render — sin pulsar nada» (se afirma sobre el render inicial, sin `await`, sin abrir el mapa) · mitad negativa en «R38/R45: … NO hay aviso» |
| **R39** | El toast lo dice y no se limita a «Ruta sincronizada.» | `SincronizarRutaButton.test.tsx` → «R39: con el orden calculado en la app el toast lo DICE, y no dice «Ruta sincronizada.»» (afirma el `warning` **y** que `success` no se llamó) · mitad negativa: «R39/R45: … el toast sigue siendo «Ruta sincronizada.»» · caso propio de `omitida` |
| **R40** | Dice **qué** pasa y **qué hacer** | `RepartoModule.test.tsx` → mismo test de R38: el cuerpo literal («Revísalo antes de salir.») se afirma **dentro** del aviso |
| **R41** | Sin jerga, sin siglas, sin el nombre del cálculo local | `RepartoModule.test.tsx` → «R41/R42: el texto del aviso no lleva jerga interna…» sobre el `textContent` **renderizado**, acotado al aviso · `SincronizarRutaButton.test.tsx` → «R41/R42: ese aviso no lleva jerga interna ni datos de nadie» |
| **R42** | Sin coordenadas, direcciones, guías ni ids | ídem (regex de decimales + de guía/dirección/id del fixture) |
| **R43** | Las tres señales conviven y siguen distintas | `RepartoModule.test.tsx` → «R43: las TRES señales conviven y siguen siendo tres cosas distintas» (los dos textos presentes, `aviso.contains(origen) === false`, ninguno absorbe el hecho del otro, y `trazado.fuente === "local"` llega al mapa) |
| **R44** | Avisa **cualquiera que sea la causa**, sin nombrarla | `RepartoModule.test.tsx` → «R44: avisa sin nombrar la causa…» · el otro medio lo cubre el backend: `fallback-route-optimization.test.ts` → «los DOS caminos de degradacion marcan `local`» |
| **R45** | Sin dato, ni aviso ni afirmación contraria | `RepartoModule.test.tsx` → `it.each` con `"proveedor"` y `null` · `SincronizarRutaButton.test.tsx` → `it.each` con `"proveedor"` y `null` |

**Dos precauciones que este repo ya pagó caras, y que aquí se aplicaron:**

1. **Ningún literal se importa del componente.** Los textos están escritos **a mano** en los dos
   archivos de test. Un texto comparado contra la función que lo genera está siempre verde.
2. **Toda ausencia va emparejada con una presencia.** Los `toBeNull` del `it.each` van con un
   `expect(cardDe("REM-G1")).toBeInTheDocument()`: sin eso, un render vacío los dejaría verdes
   igual.

---

## 5 · Mutaciones — las cinco de la ficha, más una propia, con su salida real

Arnés: `scratchpad/mutar_fe.py`. Aplica **una** mutación por corrida, ejecuta vitest de verdad y
**revierte siempre** en `finally`. Se autocomprueba de tres formas, y las tres hicieron falta:

- **Aborta si el texto a mutar no está en el archivo** (una mutación que no se aplicó y sale
  «muere» es una mentira);
- **corre la base sin mutar antes de nada** → `exit=0`, `Test Files 3 passed (3)`,
  `Tests 121 passed (121)`. Sin ese verde, ningún rojo posterior probaría nada;
- **el arnés se cazó a sí mismo un fallo:** la primera versión pasaba `--reporter=basic`, que
  vitest 4 no tiene, y **todas** las corridas habrían salido `exit=1` → «muere» sin ejecutar un
  solo test. Es exactamente el fallo que este repo ya sufrió dos veces.

| # | Mutación | Veredicto | Test rojo (con su salida) |
| --- | --- | --- | --- |
| **M-v** | `ordenAproximado = true` (mostrar el aviso siempre) | **muere** | `R38/R45: con secuenciaFuente = proveedor NO hay aviso…` y `= null NO hay aviso…` — `Tests 5 failed \| 89 passed` |
| **M-v2** (propia) | `secuenciaFuente !== "proveedor"` (tratar `null` como local) | **muere** | `R38/R45: con secuenciaFuente = null NO hay aviso…` — `Tests 4 failed \| 90 passed` |
| **M-w** | El compuesto marca `local` **sólo** por credencial ausente | **muere** | `los DOS caminos de degradacion marcan local: por sin_solucion` (+3) — `Tests 4 failed \| 107 passed` |
| **M-x** | Fundir el aviso del orden con el del punto de partida | **muere** | `R43: las TRES señales conviven…` (+3) — `Tests 4 failed \| 90 passed` |
| **M-y** | Dejar el toast en «Ruta sincronizada.» con orden local | **muere** | `R39: con el orden calculado en la app el toast lo DICE…` — `Tests 1 failed \| 9 passed` |
| **M-z** | Meter «Haversine» y una coordenada en el texto del aviso | **muere** | `R41/R42: el texto del aviso no lleva jerga interna…` (+1) — `Tests 2 failed \| 92 passed` |

**Por qué `M-v2` no estaba en la ficha y aun así se corrió.** `M-v` («mostrarlo siempre») muere
por el caso `"proveedor"` **sin necesidad del caso `null`**: con sólo esa mutación, un
componente que tratara «no consta» como «local» pasaría todos los tests. `M-v2` ataca justo esa
grieta y es la que de verdad defiende **R45**.

**Por qué `M-w` se mutó en el compuesto y no en el componente, y esto es una corrección al
diseño.** El diseño la sitúa en «unitario del compuesto + componente». En el componente **no es
expresable**: la pantalla no recibe la causa de la degradación —a propósito, R44— así que no hay
nada que condicionar a «falta la credencial». Lo que el componente puede probar, y prueba, es
que el aviso sale **de la marca sola**. La mutación se aplicó donde de verdad se decide
(`lib/clients/fallback-route-optimization.ts`, revertido) y allí murió con nombre. Queda escrito
para que nadie lea «M-w → componente» como si estuviera comprobado.

### 5.1 · Un hallazgo que sacó el arnés y que NO se ha arreglado

`M-v` y `M-v2` pusieron rojos **tres tests ajenos** que nada tienen que ver con la ruta:

```
73/R6 (T5.3): DEVOLVER sin causa NO envía y muestra el error junto al campo
R12: bloqueado muestra el aviso accionable de BLOQUEO
R12: bloqueado con puntero fijado NO entra en foco …
```

Los tres usan `screen.getByRole("alert")` **en singular** (`RepartoModule.test.tsx:839`, `:1152`,
`:1463`), que lanza si hay más de una alerta en pantalla. **No es un defecto que introduzca esta
feature** —hoy ya se rompen si alguien combina `bloqueado: true` con `estado: "desactualizada"`,
que también pinta un `Alert`— y **no se ha tocado nada**: están verdes con los fixtures que
tienen. Pero quien escriba mañana un caso con «bloqueado + orden local» se va a topar con un
error de *multiple elements* que no dice lo que parece. Queda anotado, no arreglado: cambiarlos
sin necesidad sería tocar tests ajenos.

---

## 6 · F6 — «Ver la app». Hecho, y hecho **en local**, no en preview

⚠️ **Divergencia declarada respecto al spec.** La task manda verificar **en preview**. Desde este
bloque **no hay preview**: la rama no está desplegada y el MCP de Supabase está fijado al ref de
producción. Lo que se hizo es la **misma comprobación contra el entorno local**, con el dev
server y Chromium conducido con Playwright, y **se dice cuál de los cinco puntos no queda cerrado
así**.

Entorno medido: dev server local, base local, `GOOGLE_ROUTE_OPT_PROJECT_ID`,
`…_CLIENT_EMAIL` y `…_PRIVATE_KEY` **ausentes** → toda optimización degrada al cálculo local.
Es decir: **el escenario que se ve abajo es el de R44** —la degradación por falta de credencial,
la que hasta hoy era invisible—, y sale a la primera.

Cuenta: `mensajero.qa@ordenex.test`, con **2 paradas con coordenadas** en `en_reparto` (de 8
órdenes) y una `ruta_optimizada` que venía con `secuencia_fuente = NULL`.

### Punto 1 — sincronizar y que no haya pantalla rota ✅

`38` invocaciones de `sincronizarRuta` en el log del dev server. **Cero** apariciones de
`AppErrorCode inesperado`, **cero** `500`, **cero** errores de JS en la página
(`page.on("pageerror")` → `ninguno` en las tres sesiones).

### Punto 2 — negando el permiso de geolocalización ✅

Contexto sin `permissions: ["geolocation"]` → la sincronización **funciona igual** y la pantalla
sigue mostrando sus avisos. Nada se bloquea por el permiso.

### Punto 3 — el origen incoherente ⚠️ (mitad verificada, mitad no verificable en local)

Se falseó la posición del navegador a **Medellín** (`6.3422343, -75.514335`), el origen exacto del
incidente. La ruta **sale ordenada igual** y la consulta de sólo lectura devuelve:

```
mensajero_id 9cbcccb6-…  estado vigente  origen_fuente centroide  secuencia_fuente local
calculada_at 2026-08-23T03:20:53.397Z
```

`origen_fuente = 'centroide'` es la prueba observable de que **la guarda descartó ese origen**
(R17). ⚠️ Lo que **no** se puede comprobar en local es «y **no** se llamó al proveedor con ese
origen»: sin credencial no se llama al proveedor **nunca**, así que el caso no distingue. Esa
mitad sigue pendiente de preview.

### Punto 4 — el mensajero se entera ✅

**Antes** de sincronizar (`secuencia_fuente = NULL`, ruta anterior a la feature) — **no hay
aviso del orden**, que es justo lo que manda **R45**:

```
alertas: [ "El orden mostrado no está actualizado\nLa ruta cambió desde el último cálculo…" ]
```

**Después** de sincronizar:

```
alertas: [
  "El orden mostrado no está actualizado\n…",
  "El orden de las paradas es aproximado\nLo calculamos en la app, por cercanía en línea
   recta: no toma en cuenta calles ni tráfico. Revísalo antes de salir."
]
```

**Tras `F5`** — idéntico. El aviso sobrevive a la recarga porque el dato está persistido, que era
toda la razón de la columna.

**El toast**, leído del viewport `[aria-label="Notificaciones"]` justo tras pulsar:

```
Ruta ordenada de forma aproximada: revisa el orden de las paradas.
```

Y con la ruta ya al día, el mismo botón dice **«La ruta ya estaba al día.»** — los tres
desenlaces del `case "ok"`, vistos en pantalla.

### Punto 5 — las dos señales a la vez y distintas ✅

En la sesión del origen de Medellín (origen sustituido por el centroide) las dos aparecen juntas
y por separado:

```
alertas:        [ "…", "El orden de las paradas es aproximado\nLo calculamos en la app…" ]
parrafoOrigen:  [ "El punto de partida es aproximado (no se usó tu ubicación GPS reciente)." ]
```

Dos elementos, dos textos, ninguno absorbe al otro.

### 6.1 · ⚠️ Lo que hubo que hacer para entrar, y hay que decirlo

**Se corrió `scripts/seed-usuarios-qa.ts` contra la base LOCAL.** El login fallaba con «Correo o
contraseña inválidos»: el hash de la base **no correspondía** al `QA_PASSWORD` del `.env`, señal
de que otra sesión lo rotó. El seed **rota las cuatro cuentas QA a la vez**
(`admin.qa`, `mensajero.qa`, `tienda.qa`, `satelite.qa`) y sólo toca el hash —es idempotente por
email y no altera ids ni relaciones—. Se fijó al valor que **ya estaba en el `.env`**, o sea se
restauró el estado documentado, no se inventó uno nuevo. **Si a otro agente le deja de funcionar
el login de QA en local, es por esto.** No se tocó `seed-maestro`.

Otro efecto de F6, dicho también: **la ruta del mensajero QA de la base local quedó recalculada**
(`secuencia_fuente = 'local'`, `origen_fuente` según la última corrida). Es lo que la app hace
al pulsar el botón, no una escritura mía a mano.

---

## 6.2 · El gate: `./init.sh` COMPLETO, en verde

```
== Arnes SDD :: init (modo: completo) ==
-> pnpm run typecheck        ✓
-> pnpm run lint             ✖ 99 problems (0 errors, 99 warnings)  → ✓ lint paso
-> pnpm run test
 Test Files  1317 passed (1317)
      Tests  17742 passed | 26 skipped (17768)
   Duration  347.20s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
== init OK ==
INIT_EXIT=0
```

Tres cosas que se comprueban aquí y no se dan por supuestas:

1. **`INIT_EXIT=0` está escrito DENTRO del log**, no detrás de un `echo`. En este repo un `echo`
   posterior ya hizo pasar un gate rojo por «exit code 0».
2. **Los 99 *warnings* de lint son los mismos que traía `dev`** (el bloque backend midió
   exactamente 99 en su corrida). Ninguno sale de esta rama; **0 errores**.
3. **La lista de «migraciones sin down.sql» NO creció**: son las tres `ruta_*` del 2026-08-14
   que ya venían así, y que **no se tocan** (editar una migración aplicada es *drift*).

⚠️ **Y algo que sí cambió respecto al gate del backend, dicho porque importa:** aquél terminó en
`INIT_EXIT=1` con **2 rojos** de
`tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts`, que compara
enums de la **base local compartida** contra una lista literal y veía de más un valor de la
feature 262. **Aquí ya no aparecen**: `1317` archivos y `17742` tests, todos verdes. No se tocó
ese test ni se relajó nada.

La causa, **medida y no supuesta**: las dos migraciones de la 262 ya están **en la base de esta
rama** y no lo estaban en la del backend.

```
$ git ls-tree --name-only 241f1842 db/migrations/ | grep -c 'orden_dia_reparto_cambio|…_dia_reparto_corregido'  → 0
$ git ls-tree --name-only c9e0e056 db/migrations/ | grep -c 'orden_dia_reparto_cambio|…_dia_reparto_corregido'  → 2
```

O sea: el rojo del backend era exactamente lo que dijo —el árbol iba por detrás de la base local
compartida— y se curó solo al mergear la 262, sin que nadie tocara nada.

**Pre-vuelo (C2):** `git fetch origin dev` → `origin/dev` sigue en `c9e0e056`, la misma base.
Nadie la movió mientras corría este bloque.

Antes del gate se corrió `pnpm exec prisma generate --schema db/schema.prisma`: el cliente vive
en el `node_modules` **compartido** por *junction* y otra sesión puede regenerarlo por debajo,
dejando un typecheck rojo con tipos que sí existen. Ya pasó dos veces en el bloque backend.

---

## 7 · Decisiones que tomé y no estaban escritas letra por letra

**1 · El saneo de texto (R41/R42) se acota AL AVISO, no a la pantalla.** El diseño dice
«aserción sobre el DOM renderizado». Aplicada a todo el documento sería imposible de cumplir: la
pantalla de reparto lleva direcciones, nombres y guías **de verdad**, que ahí son legítimas. La
regla habla de «esos textos», así que la aserción va sobre el `textContent` del `Alert`.

**2 · `null` en el toast no dispara el aviso.** El tipo garantiza hoy que una ejecución no
omitida trae `"proveedor"` o `"local"` (`EjecutarOptimizacionResult.ok.secuenciaFuente` es
requerido y no nullable), así que el caso no debería darse. Se decidió igual, y hacia el lado
prudente: sin dato no se alarma. Es la misma lectura de **R45** que hace el aviso persistente,
y así las dos superficies dicen lo mismo ante la misma entrada.

**3 · No se tocó ni una línea de los tests que ya estaban.** Los cinco fixtures que el diseño
nombraba ya los había actualizado el backend (B22). FE4 se reduce a comprobar que siguen verdes,
y lo están: `RepartoAyuda`, `RepartoAyudaResueltaPorLaTienda`, `MarcarLuegoToggle`,
`GestionarOrdenPanelHilo` y `MisAsignacionesPage` → **5 archivos, 43 tests, todo verde**, sin un
solo cambio mío.

**4 · El aviso hereda `role="alert"` del primitivo,** y eso se afirma en el test. No se añadió
`aria-live` ni ningún atributo extra: `components/ui/alert.tsx` ya lo pone, y duplicarlo sería
sobre-ingeniería sobre una primitiva compartida.

---

## 8 · Lo que quedó a deber

1. **F6 se hizo en LOCAL, no en preview** (§6). Los puntos 1, 2, 4 y 5 quedan cerrados con
   evidencia pegada; del punto 3 queda pendiente la mitad «no se llama al proveedor con el
   origen incoherente», **que en local no se puede distinguir** porque sin credencial no se
   llama al proveedor nunca. Repetir en preview cuando haya despliegue.

2. **El texto de los avisos no está probado con un mensajero de verdad.** Es prosa dirigida a
   una persona y aquí sólo la ha leído una máquina. Si el humano quiere otra frase, cambiarla
   cuesta dos literales y dos tests.

3. **Tres tests ajenos usan `getByRole("alert")` en singular** (§5.1). No se han tocado; están
   verdes. Es una mina para el siguiente que escriba un caso con dos alertas a la vez.

4. **La tercera señal de R43 no es un texto** (§3.3): el trazado local se ve como línea punteada
   y el test lo afirma por la geometría que llega al mapa, no por un literal. El diseño decía
   «los tres textos»; en el DOM hay dos.

5. **`feature_list.json` y `progress/current.md` no se tocaron**, como se me indicó.

6. **Se re-sembraron las contraseñas QA de la base local** (§6.1). Efecto secundario declarado.
