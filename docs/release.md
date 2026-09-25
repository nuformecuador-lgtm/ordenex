# Lista de release

> **Por qué existe este archivo.** Porque sin él, las comprobaciones que **caducan** acaban siendo
> casillas de un solo uso dentro del `tasks.md` de una feature: se escriben, la feature se cierra, y
> nadie las vuelve a mirar. Ya pasó tres veces —el R27 de la 261, la verificación visual de la 264 y
> las tres tareas `C` de la 265—, y las tres veces la respuesta fue «esto debería ser un paso de
> release». Aquí está el paso.
>
> **Cómo se usa:** se recorre entero, en orden, cada vez que se despliega a `prod`. Lo que no
> aplique se marca como no aplicable **diciendo por qué**; no se salta en silencio.

---

## 1 · Antes de abrir la release

- [ ] **El gate COMPLETO, sobre el SHA que se va a desplegar.** `./init.sh` a secas, nunca
      `--rapido`. Escribe `INIT_EXIT` **dentro** del log:
      `{ ./init.sh; echo "INIT_EXIT=$?"; } > gate.log 2>&1`
      Leer el exit code del comando que lo envuelve no vale: un `echo` posterior lo tapa y un gate
      **rojo** llega como «exit code 0». Ya pasó.
- [ ] **Re-comprobar que `dev` no se ha movido** entre el gate y la release. Otra sesión empuja en
      paralelo, y el pre-vuelo caduca: compara el SHA medido con `origin/dev` **justo antes** de
      abrir el PR.
- [ ] **Re-medir lo que caduca.** Toda medición contra producción que una ficha cite como vigente
      es una **foto**. Si la ficha dice «se re-mide antes de desplegar», se re-mide **ahora**, no se
      cita la del día anterior.
- [ ] **Repasar las fichas `in_progress` que entran.** Una ficha abierta suele esconder deuda del
      tipo «repetir antes de desplegar»; se lee su `status_note` entera, no su título.
- [ ] **Variables de entorno**, si la release las necesita: `vercel env ls production` y
      `vercel env ls preview`. **Se fijan por entorno, NUNCA en Production y Preview a la vez** — en
      este repo una variable compartida ya apuntó al proyecto Supabase equivocado en uno de los dos.

## 2 · La release

- [ ] PR de `dev` → `prod`, con el cuerpo diciendo **qué cambia para quien lo usa**, no qué archivos
      se tocaron.
- [ ] Esperar a que el despliegue de producción quede en **READY** — no basta con que el PR esté
      mergeado.

## 2 bis · Desplegar un parche SIN arrastrar lo que espera en `dev`

> **Vigente desde el 2026-09-17 y mientras SF-001 siga sin desplegarse.** Decisión del humano:
> SF-001 sale cuando él lo diga, y hasta entonces lo urgente tiene que poder salir solo.

`dev` es un superconjunto de `prod` y lleva **109 commits / 435 archivos / 6 migraciones** de ventaja.
Un PR de `dev` → `prod` se lo lleva **todo**. Así que un parche que tenga que salir antes **no se
ramifica de `dev`**:

```
git fetch origin
git checkout -b fix/<id>-<slug> origin/prod     # ← de prod, NO de dev
# … arreglo + gate …
# PR contra prod, merge, esperar READY
git checkout dev && git merge prod              # ← devolverlo a dev, o dev deja de ser superconjunto
```

El paso de vuelta **no es opcional**: si se olvida, el parche se pierde en la siguiente release de
`dev` y el defecto vuelve sin que nadie entienda por qué.

### Las tres condiciones que hacen que esto sea barato

1. **Sin migración, sin tocar el esquema.** Las 6 migraciones que esperan en `dev` fueron escritas
   suponiendo el esquema de hoy. Si un parche lo cambia en producción, esas migraciones se van a
   aplicar sobre un esquema que ya no es el que suponían. **Si un parche necesita migración de
   verdad, se para y se replantea la espera** — no se improvisa.
2. **Comprobar que el archivo es el mismo en las dos ramas** antes de empezar:
   `git diff origin/prod...origin/dev --name-only -- <ruta>`. Si sale vacío, el arreglo aplica limpio
   en ambas. Si no, estás escribiendo **dos versiones** de la misma corrección, y eso hay que
   decidirlo a sabiendas.
3. **Un parche, un problema.** La tentación de «ya que estoy» es lo que convierte un desvío de una
   tarde en una segunda rama de mantenimiento.

### ⚠️ El gate de una rama nacida de `prod` NO puede pasar en verde, y no es culpa del parche

**Medido el 2026-09-17 con la ficha 440**, la primera que usó este procedimiento. La base local está
migrada al esquema de `dev` —incluidas las 6 migraciones que esperan—, pero el código de la rama es el
de `prod`, que no sabe que esas columnas existen:

```
Test Files  52 failed | 1923 passed
     Tests  342 failed | 28512 passed
INIT_EXIT=1
Raw query failed. Code: 23502.
el valor nulo en la columna «sinpe_numero» de la relación «zona» viola la restricción not-null
```

**Cómo se distingue de un rojo de verdad.** Las tres condiciones, y hay que comprobar las tres:

1. **Todos los rojos caen bajo `tests/integration/`.** Ni uno fuera.
2. **Ninguno es de un archivo de tu ficha.**
3. **Los mensajes son de esquema** —columna inexistente, `not null` violado, relación que no está—,
   no aserciones de negocio fallando.

Si se cumplen las tres, el rojo es **del entorno**. Lo que vale como verificación es
**typecheck + lint + todo lo que no sea `integration`**, y eso **se escribe en el PR con sus cifras**:
no se mete nada en el baseline, no se «arregla» ningún test y no se fuerza el gate.

**Lo que NO hay que hacer: rebobinar la base local al esquema de `prod`.** Es compartida, así que
dejaría en rojo el gate de cualquier otra sesión o agente que esté trabajando sobre `dev`.

### ✅ Pero SÍ se puede tener el gate entero en verde: una base copia, no la compartida

**Añadido el 2026-09-17**, después de que la sección de arriba se quedara corta. La frase «no se puede»
era falsa: lo que no se puede es **tocar la base compartida**. Una copia aparte no le hace nada a nadie,
y con ella la integración —donde vive el SQL que estas releases suelen cambiar— sí se prueba de verdad.

La receta, medida construyendo la release del 2026-09-17:

1. **Clonar, no migrar desde cero.** `CREATE DATABASE ordenex_rel TEMPLATE ordenex` desde la base
   `postgres` (antes, un `pg_terminate_backend` sobre las conexiones a la plantilla). Copiar es lo que
   trae los DATOS. Crear una vacía y correrle `prisma migrate deploy` deja el esquema bien y **392
   ficheros de integración en rojo**, porque muchas suites exigen una tabla `orden` poblada de la que
   tomar las FKs; se niegan a correr y lo dicen. Que se nieguen es lo correcto —el fallo mudo sería
   reportar verde sin comprobar nada— pero no sirve como verificación.
2. **Quitar a mano lo que la rama no tiene.** Para SF-001 fueron las tres columnas `sinpe_*` de `zona`,
   las cuatro de conciliación de `cierre_bodega` (con su FK, su índice y el CHECK de coherencia), la
   tabla `asistente_uso_diario`, y borrar esas filas de `_prisma_migrations`.
3. **Los valores de enum NO se pueden dropear**, y son los que quedan mordiendo: nueve ficheros
   `*-migration.test.ts` siguieron rojos con `expected [ …(54) ] to deeply equal [ …(51) ]`. Se
   recrea el tipo: `ALTER TABLE … ALTER COLUMN … TYPE text`, `DROP TYPE`, `CREATE TYPE` con la lista
   leída de `pg_enum` menos los sobrantes, y `ALTER … USING`. Antes hay que borrar las filas que usen
   un valor que se va (aquí fueron 0). Comprobar primero cuántas columnas dependen del tipo: si es
   una, como aquí, la cirugía es de cuatro sentencias.
4. **Apuntar el `.env` del worktree a la copia** —`DATABASE_URL` y `DIRECT_URL`— y `prisma generate`
   ANTES de sembrar o probar nada: el cliente generado con el esquema de `dev` contra una base sin
   esas columnas falla por «column does not exist» y parece otra cosa.
5. **`prisma generate` se pisa entre árboles** (comparten `node_modules` por el junction). No correrlo
   mientras hay otro gate vivo, y **regenerar en `dev` al terminar**, o el siguiente typecheck de `dev`
   sale rojo sin motivo aparente.

Resultado: `Test Files 1989 passed`, `Tests 29056 passed | 26 skipped`, `INIT_EXIT=0` — los mismos 26
saltados que `dev`, o sea ninguno por falta de base.

### ⚠️ Y comprobá en qué rama estás JUSTO ANTES de commitear

**Pasó el 2026-09-17, escribiendo esta misma sección.** Un agente trabajando en la copia principal
cambió la rama por debajo, el commit aterrizó en la rama del parche en vez de en `dev`, y el
`git push origin dev` **salió con éxito porque no había nada que empujar**. La cadena entera reportó
verde y la sección no existía en ninguna parte.

`git branch --show-current` antes de `git add`. Y si el trabajo desaparece, está en `git reflog`:
`git reflog | grep commit` lo encuentra, y un `cherry-pick` lo devuelve.

### ⚠️ CORREGIDO el 2026-09-17: reimplementar no es lo mismo que hacer `cherry-pick`

**Lo que esta sección decía, y estaba mal:** que una ficha construida encima de `dev` «no se puede
llevar sola a `prod`» porque su diff se apoya en código que `prod` no tiene. El ejemplo era la
**437** (el encabezado), que en `dev` toca un `PageHeader` donde vive `AyudaBoton` —2 referencias en
`dev`, 0 en `prod`—, y la conclusión era que llevarla exigía «escribir a mano una segunda versión».

**Lo medido al construir la release del 2026-09-17:** `git cherry-pick 40899ebf` sobre una rama
nacida de `origin/prod` **aplicó limpio**, sin conflicto. Y con él los otros nueve commits del lote
(438, 439, 441, 442, 443, 444, 445, 446). Diez de diez.

La razón es que el conflicto no se decide por «de qué árbol viene el archivo» sino por **si los dos
cambios tocan las mismas líneas**. La 437 cambia clases de Tailwind en la fila del encabezado; la 433
añade un `<AyudaBoton />` doce líneas más abajo. Regiones distintas del mismo archivo → `git` las
mezcla sin preguntar.

**La comprobación que sí vale**, y que sustituye a la anterior: traer los commits y **diffear el
resultado contra `dev`**.

```
git diff origin/prod <rama-release> --name-only > /tmp/archivos.txt
git diff <rama-release> origin/dev --stat -- $(tr '\n' ' ' < /tmp/archivos.txt)
```

De los 65 archivos que aportó aquella release, **64 salieron byte a byte idénticos a `dev`**. El
único distinto fue `PageHeader.tsx`, y la diferencia eran exactamente las 12 líneas del `AyudaBoton`
—o sea, justo lo que NO debía viajar—. Eso es lo que convierte «parece que aplicó» en «es `dev`
menos lo que se queda».

**Lo que sí sigue siendo cierto:** el criterio de cuándo usar esta vía. Si arregla algo que lleva
meses roto y nadie se está quejando hoy, **viaja con la release**; la vía de `prod` es para lo que
está rompiéndose ahora. Lo que cambia es que, cuando hay que usarla, **es mucho más barata de lo que
esta sección prometía**.

### El coste de esperar, para tenerlo a la vista

Cada semana que SF-001 siga en `dev`, su release es más grande y el desvío de cada parche más
probable. **La divergencia no es gratis**: este repo ya pagó una vez una release con 65 archivos en
conflicto por romper la ascendencia. Si la espera se alarga, la conversación no es «cómo parcheamos»
sino «por qué seguimos esperando».

## 3 · Después de desplegar, y esto no es opcional

- [ ] **Errores de runtime**: `get_runtime_errors` con una ventana que cubra el despliegue. Cero es
      la respuesta esperada; cualquier otra cosa se investiga antes de seguir.
- [ ] **Las comprobaciones que sólo existen en producción.** Toda ficha visual o con datos que en
      local no existen deja aquí su comprobación concreta, con el **número esperado**. Un «se ve
      bien» no es una verificación.
- [ ] **Migraciones**: si la release lleva alguna, confirmar contra la base que aplicó y que **no
      tocó filas que no debía** (`updated_at = created_at` es la prueba barata de que nada más se
      escribió).
- [ ] **Los jobs recurrentes tienen su primera fila.** Desde la ficha 313 el propio build la
      siembra (`scripts/migrate-deploy.ts`, lineas `[siembra] ...` del log del deploy), asi que
      normalmente basta con leerlas. Si el log no esta a mano, la consulta es directa:
      `SELECT tipo, estado, run_after FROM jobs WHERE tipo IN ('liberar_reprogramadas','analitica_rollup_diario') AND estado <> 'failed';`
      **Se espera una fila por tipo** (dos de `analitica_rollup_diario` si se despliega entre las 00:00 y las 00:30 CR, y es correcto: ver la release del 2026-09-15). Cero es el fallo del 2026-08-28: un recurrente se re-agenda
      solo *despues* de correr, asi que sin la primera fila no hay ninguna, y no falla nada. Costo
      40 ordenes atrapadas en `reprogramada` y un rollup diario que no se escribio nunca, con el
      build en verde dos dias y la unica senal siendo un operador que no podia trabajar.
- [ ] **Cerrar las fichas** que esta release termina de verdad, y **decir en su nota lo que sigue
      vivo** en vez de darlas por limpias.

---

## Release del 2026-09-21 (2.ª) — la 453, y SF-001 sigue esperando

**`prod` = `3965b568`** (PR #818, merge commit con 2 padres) · `dpl_HjyBpMcrngoc5LvQpZ1hm4P8GGzh`
**READY en 86 s** · alias `ordenex.co` con `aliasError: null`.

La primera release por la vía de §2 bis que **lleva migración**: `20260921120000_vista_filtro`,
aditiva, sin backfill y sin enum.

### Lo verificado DESPUÉS de desplegar

- **La migración aplicó**: **200** migraciones (199 + la suya), **0 revertidas**, y la última es
  `20260921120000_vista_filtro`. La tabla existe con sus **8 columnas** y **0 filas**.
- **La app responde**: `/` y `/login` en 200, `/manifest.json` en 200, `/ordenes` en 307 (protegido).
- **Errores de runtime** en la hora siguiente: **cero**.
- **Gate completo en verde sobre la rama**: `INIT_EXIT=0`, `Test Files 2007 passed`,
  `Tests 29306 passed | 26 skipped`, con **274 ficheros de `integration/db` y ninguno saltado**
  (`progress/gate_release_453.log`).

### El cherry-pick NO aplicó limpio, y esa es la lección de esta release

A diferencia de las tres anteriores, aquí hubo **cuatro** resoluciones a mano, y tomar «la versión
de ellos» en cualquiera de las tres primeras habría roto la release:

1. **`db/schema.prisma`**: el bloque en conflicto traía **dos** líneas nuevas para el modelo
   `Usuario`, y sólo una era de la 453. La otra era la relación con `AsistenteUsoDiario`, **una tabla
   de SF-001 que en `prod` no existe**. Aceptar el bloque entero deja el esquema apuntando a una
   tabla inexistente.
2. **Dos censos** (`api-key-dependencias-usuario.ts`, `orden-traspaso-migration.test.ts`) traían las
   entradas de SF-001 mezcladas con las de la 453. Se quedaron sólo las de la 453.
3. **El contador de `schema-drift-saneamiento.test.ts`**, y éste es el silencioso: en `prod` son
   **DIEZ** tablas, en `dev` **DOCE**, y en esta rama la respuesta correcta es **ONCE**. Ni uno ni
   otro. Se calculó contando la lista real, y el gate lo confirmó en verde.

> **Regla que deja esta release:** cuando el cherry-pick de una ficha choca con `dev`, el conflicto
> casi nunca es entre «la ficha» y `prod` — es que **SF-001 viaja pegado al diff**. Mirar línea por
> línea qué parte del bloque es de la ficha y cuál es del vecino. Y desconfiar especialmente de los
> **números**: un contador copiado de cualquiera de los dos lados queda mintiendo sin que nada falle.

**El diff de vuelta**: de los 39 ficheros que aportaba la rama, **35 byte a byte idénticos a `dev`**.
Los 4 distintos son exactamente los resueltos a mano.

### Y el paso de vuelta también chocó

Al mergear `prod` → `dev`, los mismos cuatro ficheros volvieron a dar conflicto, y ahí la respuesta
correcta es **la contraria**: en `dev` el contador es **DOCE** y los censos SÍ llevan SF-001. Se
resolvió con la versión de `dev`, comprobando que el esquema conserva **las dos cosas**
(`VistaFiltro` y `AsistenteUsoDiario`) y que `prisma validate` pasa.

### Lo que NO salió

**SF-001 entero** (429–436), con sus 6 migraciones. Sale cuando lo diga el humano.

---

## Release del 2026-09-21 — la 450, y SF-001 sigue esperando

**`prod` = `97822ca2`** (PR #817, merge commit con 2 padres) · `dpl_4wxxh16Y6G8ehjWfC3hSKi58arYq`
**READY** en 76 s · alias `ordenex.co` con `aliasError: null`.

La tercera que usa la vía de §2 bis: rama nacida de `origin/prod` (`9d3d67b5`) con los **8 commits de
la 450** traídos por `cherry-pick`. **Cero conflictos de código.** Los dos únicos fueron
`feature_list.json` y `progress/current.md`, resueltos dejando la versión de `prod`: el estado del
arnés vive en `dev`, y llevarlo habría metido en producción las fichas de SF-001 marcadas `done`
—que allí sería mentira—.

**La comprobación que lo hace creíble:** de los 25 ficheros que la rama aporta, **24 son byte a byte
idénticos a `dev`**. El único distinto es este mismo archivo, y por un desfase **preexistente**:
`prod` arrastra 262 líneas de menos porque las recorridas de las dos releases del 17 y la sección
§2 bis se escribieron en `dev` **después** de mergear, y nunca llegaron.

### Lo verificado, con su evidencia

- **Gate completo en verde sobre la rama**: `INIT_EXIT=0`, `Test Files 1994 passed`,
  `Tests 29146 passed | 26 skipped`, 675 s (`progress/gate_release_450_c.log`). De
  `tests/integration/db` corrieron **286 ficheros, ninguno saltado**: la sonda de la ficha se
  ejecutó de verdad. Los 26 saltados son la referencia de `dev` (17 de `AnaliticaPage`, 9 de
  `AnaliticaShell`).
- **Sin migraciones**: 199 antes y 199 después, **0 revertidas**, última
  `20260917120200_cierre_rechazo_tienda`.
- **La app responde**: `/` y `/login` en **200**. Y la receta de la PWA, los cuatro:
  `/manifest.json`, `/sw.js` y `/offline.html` en **200**; `/ordenes` en **307** (sigue protegido).
- **Errores de runtime** en la hora siguiente al despliegue: **cero**.

### Cómo se consiguió el gate contra el esquema de `prod`

Segunda aplicación de la receta de «✅ Pero SÍ se puede tener el gate entero en verde», y confirma
que funciona. Sobre la copia `ordenex_rel` (`TEMPLATE ordenex`, con 0 conexiones vivas medidas antes
del `pg_terminate_backend`): drop de las 3 columnas `sinpe_*` de `zona` y sus 2 CHECK; drop de las 4
de conciliación de `cierre_bodega` con su FK, su índice y sus 2 CHECK, **recreando** el parcial
`cierre_bodega_zona_solicitado_uq`; `DROP TABLE asistente_uso_diario`; recreación del enum
`historial_accion_tipo` de **55 a 52** valores —1 sola columna dependiente y **0 filas** usando los
que se iban—; y `DELETE 6` en `_prisma_migrations`. **La base compartida no se tocó**: comprobado
después, sigue con sus 55 valores, sus columnas `sinpe_*` y sus 205 filas.

> ⚠️ `prisma generate` es global al árbol. Hubo que regenerarlo **dos veces**: una con el esquema de
> la rama (sin ella, el typecheck cae con `ZonaCreateInput` exigiendo `sinpeNumero`) y otra al volver
> a `dev`. Si se olvida la segunda, el siguiente typecheck de `dev` sale rojo sin motivo aparente.

### Lo que NO salió

**SF-001 entero** (429, 430, 431, 432, 433, 434, 435, 436), con sus 6 migraciones. Sale cuando lo
diga el humano.

### Un rojo que NO era de la release

Una corrida del gate sobre la rama de la ficha cayó por
`tests/unit/components/api-keys-module.eliminar.test.tsx`. Medido: falla **1 de cada 3 veces
corriendo solo y sin carga**, la rama no toca ni un archivo de api-keys, y el gate repetido sobre el
**mismo SHA** pasó en verde sin tocar una línea. Queda registrado como ficha **452** en vez de como
folclore.

---

## Release del 2026-09-17 (2.ª) — la 449, el fulfillment en Analítica

**`prod` = `9d3d67b5`** · PR #816 · deployment **success**.

Segunda del día por la misma vía, y ya sin sorpresas: una ficha sola, dos commits (`a1a216cd` backend,
`c8f9b29d` frontend) traídos por `cherry-pick` a una rama nacida de `origin/prod` (`9a1b40be`). Cero
conflictos. **Los 20 ficheros que aportaba salieron byte a byte idénticos a `dev`** — los 20, no 19.

Lo verificado:

- **Gate completo en verde** sobre la rama: `Test Files 1990 passed`, `Tests 29097 passed | 26 skipped`,
  `INIT_EXIT=0`, con 378 ficheros de integración corridos y `DATABASE_URL resuelta`. La base de
  verificación se montó con la receta de arriba (copia con `TEMPLATE`, cirugía de columnas y del enum):
  199 migraciones, enum en 52.
- **Sin migraciones**: 199 antes y 199 después.
- **Errores de runtime** tras el despliegue: **uno**, y no es de esta release — `prisma.distrito.count()`
  P2028 al revalidar la caché de los contadores públicos, grupo que existe desde el **2026-08-28**, una
  sola ocurrencia y **sobre el deployment anterior**. Queda como deuda conocida, no como regresión.
- **La app responde**: `/` y `/login` en 200.
- **La cifra que la ficha vino a enseñar, medida en producción**: 867 filas y **₡605.616** en los
  últimos 7 días. Eso es lo que Analítica tiene que mostrar ahora y antes escondía.

**Lo que NO salió:** SF-001, otra vez intacto.

---

## Release del 2026-09-17 — todo lo que esperaba en `dev` MENOS SF-001

**`prod` = `9a1b40be`** · PR #814 · deployment `783LDc7yrDfog6npD1ZnSoHwoPqH`, **success**.

La primera que usa la vía de §2 bis para lo contrario de un parche: en vez de sacar una ficha sola,
saca **todas menos una familia**. Diez fichas —437, 438, 439, 440, 441, 442, 443, 444, 445, 446—
traídas por `cherry-pick` a una rama nacida de `origin/prod`. **Cero conflictos en los trece commits.**

**La comprobación que hace que esto sea creíble** no es que aplicara limpio, es el diff de vuelta: de
los 65 ficheros que la rama aportaba, **64 salieron byte a byte idénticos a `dev`**, y el único
distinto —`PageHeader.tsx`— se diferenciaba en exactamente las 12 líneas del `AyudaBoton` de SF-001.
O sea: `dev` menos lo que se queda, no una reescritura.

Lo verificado, con su evidencia:

- **Gate completo en verde sobre la rama**: `Test Files 1989 passed`, `Tests 29056 passed | 26 skipped`,
  `INIT_EXIT=0` (`progress/gate_release_2026-09-17.log`). Los 26 saltados son los mismos que deja
  `dev`: **ninguno por falta de base**, con 378 ficheros de integración corridos. Cómo se consiguió
  contra el esquema de `prod`: la receta de «✅ Pero SÍ se puede tener el gate entero en verde».
- **Sin migraciones**: 199 antes y 199 después, última `20260917120200_cierre_rechazo_tienda`. Las 6
  de SF-001 siguen esperando en `dev`.
- **Errores de runtime**: `get_runtime_errors` con ventana de 1 h tras el despliegue → **cero**.
- **Los recurrentes tienen su fila**: una `pending` de `liberar_reprogramadas` y una de
  `analitica_rollup_diario`.
- **La app responde**: `/` y `/login` en 200. Y el componente de la 438 viaja en el payload servido
  —«No encontramos esta página» aparece en el HTML de `/login`—, que es la confirmación de que el
  código desplegado ES esta rama. *(Ojo: `/ruta-inexistente` sin sesión da 307 a `/login`, así que el
  404 en sí no se puede comprobar sin iniciar sesión. Queda pendiente de mirar con sesión.)*

**Los números de Analítica, medidos contra producción ANTES del despliegue**, para comparar contra lo
que se vea en pantalla. La ventana va en UTC a propósito: `orden.created_at` es un `timestamp` sin
zona que guarda UTC, y convertirlo con `AT TIME ZONE` lo desplaza seis horas.

| ventana | base antes | base después | % antes | % después |
| --- | --- | --- | --- | --- |
| últimos 7 días | 1098 órdenes | **724** | 41,4 % | **40,2 %** |
| 16-sep (CR) | 321 órdenes | **67** | 33,9 % | **23,9 %** |

Lo que se arregla es **la base**: un día deja de arrastrar órdenes cargadas otros días. El porcentaje
de los 7 días casi no se mueve; el de un día concreto baja 10 puntos, y esa era la cifra que mentía.

**Lo que NO salió, y sigue esperando:** SF-001 entero (fichas 429, 430, 431, 432, 433, 434, 435, 436),
con sus 6 migraciones. Sale cuando lo diga el humano.

**Media ficha desplegada:** la **440** salió a medias **a propósito**. El síntoma está taponado —un
tropiezo de base ya no es un 500 mudo en el portal del mensajero— pero la causa raíz, la conexión que
vuelve al pool con la transacción abortada, no se ha tocado. La ficha se queda `pending` diciéndolo.

---

## Release del 2026-08-23 (2.ª) — la 271, recorrida

**`prod` = `37b5944b`** · desplegado y **READY** · PR #484.

Lo verificado, con su evidencia:

- **Gate completo sobre el SHA desplegado** (`82b45e26`, `dev` ya mergeado): `INIT_EXIT=0` leído
  **dentro** del log, 1341 archivos / 18.129 tests.
- **`dev` no se movió** entre el gate y la release: medido y `origin/dev` coincidían al abrir el PR.
- **Re-medido lo que caduca, y aquí no era un trámite:** esta ficha **bloquea gente**, así que se
  contó cuántos mensajeros quedaban bloqueados en el instante del despliegue. **Cero**, los cinco
  libres — incluido el del caso que originó la ficha, que sale libre correctamente por tener un solo
  cierre y estar solicitado.
- **Una sola ficha `in_progress`** (la 271), que es la que se desplegaba: sin deuda escondida.
- **Variables de entorno**: no aplica, la release no añade ninguna.
- **Migración `20260823120000_notificacion_evento_bloqueo_cierre`**, con foto **antes** y **después**:

  | | Antes | Después |
  |---|---|---|
  | Valores en `notificacion_evento` | 6 | **8** |
  | Filas en `notificacion` | 91 | **91** |

  Los 6 previos coincidían exactamente con la lista que el `down.sql` declara como «el enum antes de
  esta migración», así que la cadena estaba donde debía.
- **Errores de runtime: cero** en la ventana que cubre el despliegue.

### Lo que NO se cierra aquí, y por qué

- **El primer efecto real lo produce el cron de esta noche.** A las 00:00 el corte deja de excluir a
  quien ya tiene un cierre abierto. Nada de lo verificado hoy lo cubre: se mira la mañana del 24 que
  los `vencido` creados son los que deben y que **salieron sus avisos** — que es lo primero que este
  cron emite en toda su vida.
- **T3.5** (coste de la corrida del corte) queda declarada sin medir, con su condición de reapertura.

---

## Release del 2026-08-23 — recorrida

**`prod` = `6bc566b8`** · desplegado y **READY** · 55 commits.

Primera release hecha siguiendo esta lista. Lo verificado, con su evidencia:

| paso | resultado |
| --- | --- |
| Gate **completo** sobre el SHA desplegado | `6090fda2` — 1324 archivos, **17.884 tests**, `INIT_EXIT=0` leído dentro del log |
| `dev` no se movió entre gate y release | SHA medido y `origin/dev` idénticos |
| Mediciones re-tomadas (03:14 CR) | `M1 = 0` · `M2 = 35` · **6** jobs `failed` de la familia de la 265, como línea base |
| Fichas `in_progress` | **ninguna** |
| Variables por entorno | `GOOGLE_CLOUD_PROJECT_ID` en Production y Preview por separado; `RUTA_DEBUG_LOG` en **ninguno** |
| Errores de runtime tras desplegar | **cero** |
| Migraciones aplicadas | las dos: el value del enum presente, y `secuencia_fuente` creada **sin tocar ninguna fila existente** (0 con valor) |
| **C7** | **cero** líneas `optimizer***:` con el cron corriendo — ver arriba |

⚠️ **`C3` no se pudo cerrar**: `ruta_optimizada_parada` sigue **vacía** en producción, así que el
umbral `RUTA_ORIGEN_MAX_KM = 200` continúa **declarado sin calibrar**.

⚠️ **`C8` no es concluyente todavía**: cero jobs `failed` de esa familia desde el despliegue, pero
**no ha pasado tiempo suficiente** para que sea evidencia. Se re-mira con un día de tráfico real.

---

## Pendiente para la PRÓXIMA release

> Se rellena cuando una ficha deja una comprobación que **sólo** se puede hacer desplegando. Se
> vacía al ejecutarla. Si esta sección tiene entradas, **la release no está terminada** aunque el
> despliegue esté verde.

### De la 459 — la caja con el dinero real (DINERO: bloqueante)

1. **Antes de desplegar:** crear el bucket PRIVADO `wallet-comprobantes` en preview y en producción (hoy no
   existe en ninguno; `progress/medicion_457.md` M5). Sin él, todo registro con comprobante se rechaza.
2. **Tras desplegar, en este orden y sin saltar (R91):** contraste C0–C2, C5 y C7 de
   `specs/459-la-caja-muestra-el-dinero-real/design.md` §11 por el MCP, en solo lectura, después de cada
   bloque (A: la fórmula; B: los tipos y tablas; C: la reclasificación de los 203). Se anota en
   `progress/contraste_459.md`. **Cualquier diferencia distinta de 0,00, o C2 con filas, detiene la release.**
3. **Esperado tras C:** la cifra principal −9.186.220,50 («Flujo de dinero registrado»); «De las tiendas»
   = Σ saldos (−4.780.583,97 en la línea base); ganancia sin cambio; 203 filas y 25.769.034,50 reclasificados.
   Producción se mueve cada día: vale la IGUALDAD, no los números exactos.
4. La migración de reclasificación solo actúa en la base donde existen esos ids (producción). En preview no
   escribe nada: es lo esperado.
5. Errores de runtime en la hora siguiente al despliegue: 0 (memoria «diagnosticar prod con los logs de Vercel»).

### De la 450 — la advertencia de `pg` en los logs de Vercel

> **Esta entrada NO bloquea el `done` de la 450** (decisión 2 del humano, 2026-09-21). La prueba de
> cierre de esa ficha es el contador determinista de consultas en vuelo + `./init.sh` completo en
> verde, y las dos están hechas. Esto es la comprobación en campo de una atribución que ya está
> medida en laboratorio.

- [ ] **Qué mirar.** Ocurrencias de `Calling client.query() when the client is already executing a
      query` en los logs de Vercel (`get_runtime_errors`, ventana de **7 días**).
- [ ] **Con qué comparar.** El número de antes: **32 ocurrencias, 22 usuarios, última el
      2026-09-20**, observadas en `/cierre-dia` y `/api/cron/corte-diario`.
      ⚠️ **Eso cuenta INSTANCIAS, no eventos.** `pg` construye el aviso con `util.deprecate`, que
      emite **una sola vez por proceso**: 32 ocurrencias significan ≥32 instancias que tocaron el
      camino al menos una vez, no 32 veces que ocurrió.
- [ ] **Cuándo toca mirarla.** **7 días después** del despliegue del entregable 1 de la 450. La release salió el **2026-09-21**, así que
      **se mira el 2026-09-28**.
- [ ] **Cómo se lee el resultado.** La 450 midió en laboratorio quién lo emite, lo dejó **nombrado
      y SECUENCIADO**: `lib/repositories/CierreDiaRepository.ts`, la lectura del snapshot con
      `SNAPSHOT_SELECT` dentro del `$transaction` de `crearCierre`. Eran 5 relaciones anidadas que
      Prisma expandía a 1+5 consultas y lanzaba a la vez sobre la única conexión de la transacción;
      ahora proyecta los FK y lee los cinco catálogos de uno en uno. Medido a los dos lados en
      `tests/integration/db/emisor-relaciones-anidadas.test.ts`: **5 en vuelo y 4 solapes con el
      aviso capturado → 1 en vuelo y 0 solapes**. Por tanto:
      - **0 es lo ESPERADO.** Confirma en campo lo que el laboratorio ya midió.
      - **>0 NO significa que el arreglo falló**, sino que hay **otro emisor** que no es éste. Lo
        que encontramos es *un* emisor verificado, nunca probado único. Antes de tocar nada, mirar
        el censo del brazo C de `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts`:
        hoy declara **6 lecturas con 2 relaciones hermanas en 4 archivos** (`CierreDiaRepository`,
        `CierresAdminRepository`, `LiquidacionPagoRepository`, `UserRepository`), que **no** llegan
        al umbral del aviso —hacen falta tres— pero son el primer sitio donde mirar. Y recordar que
        ese censo mira sólo `lib/`.
- [ ] **Y el 25P02 sigue en cero.** Comprobar que `/mis-asignaciones/reparto` sigue **sin** errores
      `current transaction is aborted` (`25P02`) en la misma ventana de 7 días. El parche de la
      440 lleva en cero desde el **2026-09-17 10:14 UTC** y la 450 no lo toca: si apareciera uno,
      la causa está en esta release y no en el tráfico.

### De la 284 — la PWA: el relevo, la purga y el manifiesto

> **Un service worker NO se puede medir en local**: el de producción se autodestruye en
> `localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`), así que `pnpm build && pnpm
> start` **tampoco** sirve. Estas seis comprobaciones sólo existen sobre HTTPS real, y por
> decisión del humano (2026-08-25) se hacen **en producción justo después de desplegar**.
> Cada fila se responde con **un número o un nombre**, nunca con «se ve bien».

- [x] **M8 · CERRADO EL 2026-08-26 — LA PWA YA ES INSTALABLE.** Medido contra `https://ordenex.co`
      **sin cookies**, con los cuatro `curl -sI` de abajo:

      ```
      /manifest.json  ->  HTTP/1.1 200 OK    (antes: 307)
      /sw.js          ->  HTTP/1.1 200 OK    (antes: 307)
      /offline.html   ->  HTTP/1.1 200 OK    (antes: 307)
      /ordenes        ->  HTTP/1.1 307       (sigue protegido, como debe)
      ```

      **El arreglo del `matcher` de la 284 llegó y funciona.** Hasta hoy los tres respondían 307 a
      `/login` y por eso la PWA **nunca se pudo instalar** desde que existe. Esto era la premisa de
      la que colgaba el resto de la 284: con los tres en 307, nada de lo que hace la PWA llegaba al
      dispositivo. Ya no.
      **Lo que sigue SIN comprobar** —y ningún `curl` puede hacerlo— es que el navegador de un
      teléfono **ofrezca instalar** (Chrome → menú → «Instalar aplicación»). Eso queda en M5.

      > **La receta, para repetirla en cualquier release** (los cuatro se leen sin cookies; si
      > alguno de los tres primeros vuelve 307, el `matcher` se rompió otra vez y nada de lo que
      > hace la PWA llega al dispositivo):
      >
      > ```
      > curl -sI https://ordenex.co/manifest.json | head -1     # se espera: 200
      > curl -sI https://ordenex.co/sw.js         | head -1     # se espera: 200
      > curl -sI https://ordenex.co/offline.html  | head -1     # se espera: 200
      > curl -sI https://ordenex.co/ordenes       | head -1     # se espera: 307 (protegido)
      > ```

- [ ] **M1 · El relevo espera.** Con la app abierta, desplegar y recargar: en DevTools →
      Application → Service Workers debe aparecer uno **`waiting`** y el que dice **`activated`**
      debe seguir siendo el anterior. **Se anota qué versión está en cada estado.**
- [ ] **M2 · La página viva no se rompe.** Sin cerrar la app, navegar por tres pantallas:
      **cero** errores de carga de chunk en Console, y `next-static-v1` **sigue existiendo** (nadie
      la borró bajo la página viva). **Se anota el número de errores y el nombre de las cachés.**
- [ ] **M3 · El aviso, y que no recargue solo.** Debe aparecer el aviso «Hay una versión nueva»
      **sólo cuando no hay nada a medias** (probarlo con un formulario empezado: no debe salir).
      Al pulsar **Actualizar ahora**, la pestaña recarga; **una segunda pestaña abierta NO debe
      recargarse sola**. Tras la recarga, en Cache Storage quedan **sólo** `next-static-v2` y
      `pages-cache-v2`: las `v1` **desaparecieron**.
- [ ] **M4 · El tope.** Navegar hasta superar el tope y mirar Cache Storage: el número de entradas
      de `next-static-v2` **no pasa de 200**. Y con el número real a la vista, **re-medir
      `TOPE_ESTATICOS`**, que hoy está **declarado SIN CALIBRAR** (producción se vació el
      2026-08-25 y no se pudo contar el recorrido del mensajero).
- [ ] **M5 · Instalabilidad.** Application → Manifest: **0 errores**; `id` presente; la app **no**
      aparece duplicada en el lanzador de un teléfono que ya la tuviera instalada. Y en un iPhone,
      que el icono de la pantalla de inicio **no** tenga doble redondeo.
- [ ] **M6 · Lighthouse.** Chrome de escritorio, incógnito, sesión de **mensajero**, dispositivo
      **Mobile**. Se exige `html-has-lang` y `html-lang-valid` en **PASS** y **Accesibilidad ≥ 90**.
      Se anotan **URL, fecha, versión de Chrome y de Lighthouse** y el número de cada categoría. Si
      no llega al umbral, **la ficha no está hecha**: se escribe el número y qué auditoría lo baja.
- [ ] **M7 · El camino de rescate, probado UNA vez en un teléfono de verdad.** Abrir
      `https://<dominio>/?rescate=sw`: la app debe volver a cargar y, en DevTools → Application,
      **no debe quedar ningún service worker registrado ni ninguna caché**. Es la salida que
      convierte «un SW roto es irrecuperable sin borrar los datos del sitio» en «se abre una URL».
      **Probarlo cuando no hace falta es la única forma de saber que funciona el día que haga
      falta**; si falla, hay que arreglarlo antes de que exista una base instalada.

### De la 264 — el detalle del cierre

- [x] ~~**Ver la sección «Órdenes sin gestionar» en pantalla.** Cierre terminado en `8F88DCD5`:
      debe listar 4 guías, y el pie seguir en ₡14.900 general y ₡2.000 de pago al mensajero.~~
      **IRREPETIBLE, dado de baja el 2026-08-26.** Medido ese día contra producción: `cierre_dia`
      tiene **0 filas**. El cierre `8F88DCD5` y sus 4 guías **se borraron el 2026-08-25**, cuando el
      humano vació producción para el arranque comercial. No es una comprobación pendiente: es una
      que ya no se puede hacer, y dejarla como casilla sin marcar engaña a quien la lea.
      **Si se quiere la garantía, hay que rehacerla sobre un cierre nuevo de la operación real** —
      y entonces son otras guías y otras cifras, así que es una tarea nueva, no ésta.

### De la 262 — corregir el día de reparto

Lo que `F6` **no pudo cubrir en local por falta de datos**, y en producción sí existe:

- [ ] **Corregir el día desde `/recepcion-satelite/en-bodega`** con cuenta `adminSatelite`. En local no hay
      ninguna orden de su zona en un estado que esa pantalla ofrezca, y **no hay camino por la UI**:
      el botón exige `por_recoger`, que exige asignar, que exige coordenadas — y sólo 4 órdenes de
      ~70 las tenían.
- [ ] **«Una orden de otra zona no aparece», sobre un listado CON contenido.** En local se comprobó
      sobre un listado **vacío**, así que no discrimina entre «el acotado funciona» y «no había nada
      que mostrar». Es la comprobación de aislamiento entre zonas: merece datos de verdad.
- [ ] **Un caso de `ayuda_tienda`**: en local no hay ninguna orden en ese estado. **Y en producción
      tampoco, medido el 2026-08-26**: de 167 órdenes de la operación real, los estados vivos son
      `en_reparto` 86, `en_ruta_bodega_satelite` 58, `en_preparacion` 15, `en_bodega_central` 7 y
      `por_recoger` 1. **Cero en `ayuda_tienda`.** Sigue abierta, pero no se desbloquea esperando:
      se desbloquea el día que la operación real produzca una, y entonces hay que acordarse.

### De la 262 — una pregunta de producto, no una comprobación

- [ ] **Decidir si «Del 23 al 24 de agosto» se cambia.** Medido mirando la pantalla: se lee como un
      **rango de dos días** en la mitad de los casos —«del 24 al 23» es inequívoco porque ningún
      rango corre hacia atrás; «del 23 al 24» no—. Lo agrava que la entrada de corrección es **la
      única sin la flecha `A → B`** que llevan las demás, así que toda la carga de indicar el cambio
      cae en la preposición: **falta el verbo**. Es contrato en `design.md` §14.4. Si se cambia, lo
      barato es el encabezado (`ETIQUETA_CORRECCION_DIA`), no el cuerpo que está bajo test.

### De la 265 — el optimizador

- [ ] **C3 · Re-medir M1** con `ruta_optimizada_parada` ya poblada, para saber si el umbral
      `RUTA_ORIGEN_MAX_KM = 200` —hoy **declarado sin calibrar**— se sostiene. El 2026-08-22 la tabla
      estaba **vacía** y por eso el número se fijó a ojo.
- [x] **C7 · Cero líneas `optimizer***:`** — ✅ **VERIFICADO el 2026-08-23 tras la release**, y con
      un cero que significa algo: el cron `procesar-jobs` corrió **cuatro veces** (09:20, 09:21,
      09:22 y 09:23) sobre el despliegue nuevo y **no imprimió ni una** línea `optimizer***:`.
      Con el build anterior, **cada una de esas corridas volcaba un bloque de configuración entero**
      —`projectId`, claves, timeouts—. Un cero sólo vale si lo que lo produciría llegó a correr, y
      corrió. **No pongas `RUTA_DEBUG_LOG=1`** en ningún entorno sin un diagnóstico abierto que lo
      justifique: vuelca coordenadas de destinatarios.
- [ ] **C8 · Cero jobs `optimizacion_ruta` en `failed`** con «respuesta del proveedor con forma
      inesperada» **posteriores al despliegue**. Antes había **6**, todos del 2026-08-22. Es la
      única comprobación de que el arreglo funcionó **donde ocurrió el incidente**: ninguna de las
      17.000 pruebas verdes la sustituye.
      ⚠️ **Re-medido el 2026-08-24 y SIGUE SIN PODER CERRARSE, ahora con el motivo dicho:** no hay
      **ningún** job `optimizacion_ruta` —de ningún estado— posterior al **2026-08-22 16:56 CR**, o
      sea **ninguno después del despliegue**. El último `failed` es del **2026-08-21 23:43 CR**.
      «Cero `failed`» vuelve a ser un cero que no significa nada, exactamente como el de `C7` antes
      de comprobar que el cron sí había corrido. Hace falta **una optimización real** después del
      despliegue para que este cero valga.
- [ ] **`F6` en preview** (265 y 262): la mitad que en local **no tiene poder de resolución** —sin
      llamada al proveedor no se puede distinguir «no se llamó» de «no había credencial»—. Preview
      **sí** tiene la credencial (comprobado el 2026-08-23); lo que hace falta es un despliegue y una
      cuenta que exista en **su** base, que es distinta de la de producción desde julio.

---

## Release NO abierta — 2026-08-24

`dev` = **`7c211f2f`**, gate COMPLETO en verde (`INIT_EXIT=0`, 1375 archivos / 18.707 tests).
`prod` sigue en **`37b5944b`**. Se recorrió el §1 de esta lista y **se paró en el cuarto punto**,
que es justo el que existe para esto: *repasar las fichas `in_progress` que entran*.

**Qué lo paró:** `dev` lleva, además de la 276 y la 277, el cambio de tarifas de otra sesión, y
dentro va **`20260825120000_drop_tarifa_status`** — un **`DROP COLUMN` sobre una tabla de dinero**,
irreversible. Su mitad frontend (**ficha 275**) sigue `pending`.

**Lo que se comprobó antes de decidir**, para que no haya que repetirlo:

- La revisión de esa ficha **existe y aprobó**: «APROBADO CON RESERVAS», **0 bloqueantes de
  código**, 40/40 requisitos. Sus dos bloqueantes eran de bookkeeping.
- **No queda código vivo usando `tarifas.status`**: los únicos aciertos del grep son comentarios que
  explican su retirada.
- El gate está verde sobre ese mismo árbol, con los tests de componentes dentro.

**Decisión del humano:** esperar a que la otra sesión cierre su 275 —o confirme que su parte puede
salir— en vez de arrastrar un borrado irreversible ajeno en una release que no es suya. Separar no
era opción: `dev` es un solo árbol y aislar lo de esta sesión exigiría cherry-picks.

### Cuando se abra, esto ya está medido — pero CADUCA

Las dos condiciones de despliegue de la 276 se ejecutaron el 2026-08-24:

- **R37 limpia**: única orden en el umbral, la guía `28098171`, en `devuelta`; **cero** fuera. La
  condición de parada de Q6 no se cumple.
- **T6 congela CERO órdenes el primer día** (medido por primera vez): 2 `reprogramada` vivas,
  0 liberables hoy, las dos con su cierre ya aprobado.

⚠️ **Son fotos. Se re-miden el día que se abra la release**, no se citan éstas. Cualquier cierre que
la bodega apruebe entre medias puede crear una orden en el umbral que R18 dejaría inasignable.

---

## Release del 2026-08-25 — la 276, la 277, la 279 y la cascada de tarifas

**`prod` = `e4ff7182`** · PR #492 · `dev` = `258b6468`, y **`dev` es ancestro de `prod`** (comprobado:
todo el trabajo llegó, no solo el PR en verde).

### §1 recorrido, con su evidencia

- **Gate COMPLETO sobre el SHA exacto que se despliega**: `./init.sh` → `INIT_EXIT=0`,
  **1386 archivos / 18.868 tests**, con `INIT_EXIT` escrito dentro del log.
- **`dev` no se movió** entre el gate y la release: `258b6468` antes y después. Se re-comprobó **tres
  veces** durante la tanda, y en dos de ellas **sí se había movido** — de ahí la tercera colisión de
  ids del día.
- **Re-medido lo que caduca**, que es lo que este archivo existe para no olvidar:
  - **R37 de la 276**, re-ejecutada **hoy** y no citada de ayer: la única orden viva con
    `intentos >= 3` es la guía `28098171`, en `devuelta`, y **cero** fuera de ese estado. La
    condición de parada de Q6 no se cumple.
  - **T6 congela 0 órdenes el primer día**: 2 `reprogramada` vivas, 0 liberables hoy, las dos con su
    cierre ya aprobado.
- **Fichas `in_progress` que entran, leídas enteras** (ver el riesgo declarado abajo).
- **Variables de entorno**: no aplica — ninguna de las fichas de esta tanda añade ni cambia
  configuración de entorno.

### Lo irreversible, medido ANTES de salir

`20260825120000_drop_tarifa_status` **borra `tarifas.status`** y su tipo `estado_tarifa`. Un
`DROP COLUMN` no se deshace, así que se midió qué se pierde: **`tarifas` tiene 2 filas y las dos son
`activo`**. **Ni una `inactivo`**, así que la pérdida real de información es **cero**. Entran ocho
migraciones en total; ninguna de las de esta sesión mueve filas.

### ⚠️ Riesgo declarado y aceptado por el humano

La ficha **278 (plantilla de carga masiva v3)**, de otra sesión, entró en esta release **sin informe
de revisión ni bitácora en el repo** —no existe `progress/review_278.md` ni ningún archivo suyo— y
con estado `in_progress`. Su código ya estaba mergeado en `dev` cuando se abrió la release.

También entró la **274 (cascada de tarifas)**, que **sí** tiene revisión: «APROBADO CON RESERVAS»,
0 hallazgos bloqueantes de código, 40/40 requisitos. Su mitad frontend, la **275**, sigue `pending`.

El humano decidió el alcance dos veces con estos datos delante. Se deja escrito **aquí** y en el
cuerpo del PR para que sea un riesgo registrado y no uno recordado.

### ✅ La 271, cerrada por fin — verificado en producción anoche

El corte de las **00:01:21 CR del 25** creó el cierre `5efa70b9` (`vencido`, 1 gestión + 2 órdenes
barridas) y **emitió los avisos**: `notificacion` pasa de **0 a 4** filas `cierre_dia_vencido` —
cero en toda la historia de la tabla hasta anoche.

Y el aviso **nombra el día trabajado**: «Tu cierre **del 24 de agosto** venció sin enviarse a
aprobación…». No el 25 de su nacimiento. Ese off-by-one era media ficha 271, y aquí queda medido en
producción, no razonado. Los otros tres avisos van a bodega (maestro, admin, adminSatélite) **sin
datos de nadie**.

### §3 recorrido tras desplegar — todo verificado

- **Despliegue `READY`** (`dpl_3Gfyukq…`), alias `ordenex.vercel.app` apuntando y `aliasError: null`.
  No basta con que el PR esté mergeado, y por eso se espera.
- **Cero errores de runtime** en la ventana que cubre el despliegue.
- **Las ocho migraciones aplicaron, y se comprobó contra la base qué hicieron:**
  - `rechazo_tope_intentos` **existe** en `orden_historial_origen_tipo`.
  - `tarifas.status` **ya no existe**, y su tipo `estado_tarifa` **tampoco**.
  - **`tarifas` conserva sus 2 filas**: el `DROP COLUMN` no se llevó ninguna.
  - **0 órdenes tocadas** por el despliegue, de **163** vivas. Ninguna migración de esta tanda
    escribió una fila que no le tocaba.

### Pendiente para la PRÓXIMA release — lo que sólo se puede ver en producción

- [ ] **Las dos pantallas nuevas del adminSatélite** (279). Sus e2e están **`NOT EXECUTED`**: las
      rutas se corrigieron **por lectura**. Falta entrar como `adminSatelite` y comprobar, con el
      número delante: que el menú «Órdenes» abre como acordeón con **«Por recibir»** y
      **«En bodega»**; que **`/recepcion-satelite` redirige** a «Por recibir» y no da 404; que el
      **escáner está montado en las dos**, incluida «Por recibir» **con la lista vacía**; y que
      **ninguna card ofrece «Aceptar»**.
- [ ] **El tope de intentos, visto por el mensajero** (276). Cuando una orden llegue a 2 intentos,
      comprobar que su panel ofrece **sólo** «Entregada», «Rechazada» e «Incidente» — y que
      «Reportar incidente» **sigue estando**, que fue decisión firmada.
- [ ] **La primera orden que alcance el umbral**: comprobar que queda `rechazada` y que emite su
      `cobroRechazado`. Esta release **acelera dinero** —hasta ahora el sistema erraba a propósito
      hacia no cobrar— y ese primer cobro es el que hay que mirar con lupa.

---

## Release del 2026-08-26 — las etiquetas legibles y la PWA que por fin se instala

**`prod` = `115fbbaf`**, READY, **cero errores de runtime**, **sin migraciones**. Salen la **282** y la
**284**; la 281 y la 283 ya habían salido.

### ✅ M8, la comprobación que lo decidía todo — verificada CONTRA PRODUCCIÓN

| ruta | antes | ahora |
| --- | --- | --- |
| `/manifest.json` | **307 → /login** | **200** |
| `/sw.js` | **307 → /login** | **200** |
| `/offline.html` | **307 → /login** | **200** |
| `/icons/icon-512.png` | 200 | 200 |
| `/ordenes` | 307 | **307** (sigue protegido) |

**La PWA de Ordenex se puede instalar por primera vez.** El manifiesto llevaba **meses** detrás del
login: el navegador lo pide **sin credenciales**, recibía el redirect y **nunca llegaba a ofrecer la
instalación**. Todo lo construido encima —el botón, las capturas, los iconos— estaba bien hecho y era
**inalcanzable**.

Verificado además sobre lo que sirve producción: el manifiesto trae `id`, **cuatro variantes de
icono** (`any` + `maskable`) y sus 3 capturas; el HTML declara **`lang="es"`**; y **el camino de
rescate viaja inline** en el documento.

### Cómo esto se descubrió, y qué lo tapaba

La ficha original de la PWA **aprobó su requisito de Lighthouse con un razonamiento** —«los elementos
necesarios están presentes, lo que asegura el puntaje»— **en vez de correrlo**. Correr Lighthouse una
vez, o un `curl -I` de un minuto, lo habría gritado. **Una medida no se sustituye por un argumento**,
y ésta es la factura.

### ⚠️ Lo que queda vivo para vigilar

- **`?rescate=sw`** — la salida de emergencia. Si un service worker deja la app inservible,
  `https://ordenex.vercel.app/?rescate=sw` limpia el origen **sin que nadie borre datos a mano**.
  Viaja inline en el HTML, así que funciona aunque los chunks estén rotos. **Ejercerla una vez en un
  teléfono real (M7)** ahora que apenas hay base instalada.
- **Puede haber service workers VIEJOS ahí fuera.** El script del SW se pedía con credenciales
  `same-origin`, así que **para un usuario con sesión sí se instalaba** — y son los del
  `skipWaiting()` que cachean sin mirar el estado. **M0/T0.1 sigue sin ejecutar** y es ahora o nunca.
- **M1–M5** después, contando con que puede haber cachés `v1` que purgar.
- **`TOPE_ESTATICOS = 200` sin calibrar**: aceptable, el peor caso es una descarga extra.
- **El rojo ajeno** (`obtenerTarifa`, ficha 275) sigue vivo: `docs/release.md` exige gate verde y
  **esta release se saltó esa regla a sabiendas**, por decisión del humano con el dato delante.

### De las etiquetas, para bodega

Una dirección de **3 líneas entra con holgura, 4 entra justa, y a partir de 5 corta con «…»**. Y si
la red falla, **ya no se descarga nada** y sale un mensaje — antes salía la etiqueta con el importe
roto.

---

## Release del 2026-09-04 (2.ª) — la 373, recorrida

**`prod` = `84266ff5`** · desplegado y **READY** a las 20:35:30Z · PR #703 · despliegue
`dpl_Furgjw7jmzsCYTJMwgj8xDjvTXed`.

Lleva **solo la ficha 373** (eliminar una API key sin uso). Lo de las otras sesiones del día
—analítica por API key y el arreglo del emisor de webhooks— ya había salido en el PR #701.

Lo verificado, con su evidencia:

- **Gate completo sobre el SHA desplegado** (`36326f38`, `dev` ya integrado en la rama antes del
  PR): `INIT_EXIT=0` leído **dentro** del log, 1720 archivos / **24.522 tests**, 26 saltados
  (preexistentes de AnaliticaPage/Shell), `.env` presente.
- **`dev` no se movió** entre el gate y la release: `36326f38` en los dos momentos. Y sí se había
  movido ANTES, durante el trabajo: entraron 4 commits de otras sesiones, se integraron en la rama
  y se volvió a pasar el gate sobre la combinación.
- **Re-medido lo que caduca**: las 2 API keys de producción con 0 órdenes, 0 tarifas, 0 wallet y 0
  pagos, ambas `activa` — con la regla nueva, ninguna es borrable sin desactivarla antes.
- **Una sola ficha `in_progress`** (la 373), cerrada en el mismo empujón.
- **Variables de entorno**: `NEXT_PUBLIC_APP_URL=https://ordenex.co`, fijada **solo en Production**
  tras separarla de Preview (compartían entrada). Este despliegue es el que la activa, porque
  `NEXT_PUBLIC_*` se incrusta en build.
- **Migración `20260904120000_historial_accion_api_key_eliminada`**, con foto antes y después:

  | | Antes | Después |
  |---|---|---|
  | Valores en `historial_accion_tipo` | 44 | **45** |
  | `api_key_eliminada` existe | no | **sí** |
  | Filas en `historial_accion` | 34 | **34** |
  | Filas en `api_key` | 2 | **2** |

  Aplicada a las 20:34:04Z. En la ventana exacta de la migración: **0 órdenes, 0 usuarios y 0 api_key
  con `updated_at`** — no tocó ni una fila de datos.
- **Errores de runtime: cero achacables a la release.** El único grupo es un `DeprecationWarning` de
  `pg` que existe desde el 2026-07-27, visto por última vez a las 19:39:54Z —antes del despliegue— y
  sobre el deployment anterior.
- **Jobs recurrentes**: una fila pendiente por tipo (`liberar_reprogramadas=1`,
  `analitica_rollup_diario=1`).
- **El dominio**: `ordenex.co` sirve la app nueva (movido desde el proyecto viejo este mismo día),
  `www` conserva su 308 al apex, la app vieja sigue viva en `rapidisimo-app.vercel.app`, y el manual
  de la API responde 200 en el dominio.

### Lo que NO se cierra aquí, y por qué

- **La tensión R13** queda aceptada, no resuelta: una key `activa` y con órdenes reporta motivo
  `activa` por el camino del borrado y `ordenes` en el listado. Solo alcanzable por carrera.
- **`TarifaRepository.hardDelete` y `ZonaRepository.hardDelete`** siguen comprobando
  `e.code === "P2003"`, la forma que **no ocurre** con `@prisma/adapter-pg`, y sus tests la fabrican
  a mano. Probablemente nunca devuelven `"referenced"`. No se tocó.
- **El desbordamiento horizontal de la tabla** de API keys es preexistente: las 7 columnas de datos
  suman 838 px de mínimo y a 1024 px hay 718. Lo que esta release arregla es **qué queda fuera**:
  ahora la cola de datos, no los controles.

---

## Release del 2026-09-15 — la 423, la 424, la 425, la 426 y la 427, recorrida

**`prod` = `1ab83dd5`** · merge commit con 2 padres (sin squash) · PR #796 · despliegue
`dpl_8MuD5fsVkFAVSRJ7mvQCh6ufWQJP`, creado a las 06:14:07Z y **READY** · migraciones aplicadas a las
06:14:23Z.

Lleva **cinco fichas**, 50 commits y 4 migraciones:

| Ficha | Qué cambia |
| --- | --- |
| **423** | ordenar las tablas de órdenes por número de remisión (orden natural, columna generada `clave_remision`) |
| **424** | el admin vuelve a poder eliminar órdenes, con rastro en el historial |
| **425** | los rechazos que registra la tienda llegan al cierre del mensajero, sin tocar el dinero |
| **426** | una ruta `/api/*` con la sesión vencida responde `401` JSON, no la página de login |
| **427** | traspasar a otro mensajero las órdenes que alguien ya lleva encima |

### §1 recorrido, con su evidencia

- **Gate completo sobre `9bf519c7`** (= `origin/dev`), con la base libre: `INIT_EXIT=0` leído dentro
  del log, **1.974/1.974** archivos y **28.836** tests, 0 rojos.
- **`dev` no se movió** entre el gate y la release: seguía en `9bf519c7` al abrir el PR, comprobado
  después del corte de medianoche. `dev` es ancestro de `prod`: llegó todo el trabajo, no solo el PR.
- **Re-medido lo que caduca**: el desglose de la 425 seguía en 46 rechazos (Carlos Cambronero 19,
  Andrés Agüero 7, Andy Cortés 7, Kendall Hernández 6, Johel Hernández 4, Arnel Guillen 3).
- **Avisos enviados por el humano antes de mergear**: a Nuform (el contrato de la 426) y a quien
  aprueba cierres (la 425), con la corrección de que un `vencido` se destraba antes de aprobarse.

### Por qué salió DESPUÉS del corte de medianoche

Carlos Cambronero y Kendall Hernández pidieron su cierre del día **antes** del despliegue. Con la 425
activa en el corte de las 00:00 CR, cada uno habría recibido un `vencido` con solo sus rechazos: dos
cierres abiertos y **sin poder recibir trabajo por la mañana**. Decisión del humano: esperar al corte.
El corte corrió a las **06:00:11Z sobre el despliegue anterior** (`dpl_BHHLortez6Fawogco5ZwawHMUtpy`)
y creó 4 `vencido` normales (Fabiola Flores, Carlos Eduardo, Joyce 1 Mesen y Jaffet Viquez). El
último cierre de la base nació a las 06:00:16Z: **ninguno se ha creado todavía con la 425 activa**.

### §3 recorrido tras desplegar — todo verificado

- **El código nuevo sirve producción**: la primera respuesta `401` del chunk llegó a las 06:15:37Z.
- **Errores de runtime: cero en el despliegue nuevo.** El único grupo de la ventana es el
  `DeprecationWarning` de `pg` que existe desde el 2026-07-27, visto por última vez a las 06:00:11Z en
  el cron del corte y sobre el despliegue anterior.
- **Peticiones del despliegue nuevo** (06:14→06:22): el cron `procesar-jobs` en `200` cada minuto; los
  únicos no-`200` son las sondas de esta verificación (2 × `401` del chunk, 1 × `307` de `/ordenes`).
  Ningún `5xx`.
- **426:** `POST https://ordenex.co/api/ordenes/carga-masiva/chunk` sin cookie → `401` con
  `Content-Type: application/json` y `{"status":"error","code":"UNAUTHORIZED",...}` (antes, `307` al
  login). `/ordenes` sigue en `307`; `/login`, `/manifest.json` y `/sw.js` en `200`.
- **Las cuatro migraciones**, con foto antes y después:

  | | Antes | Después |
  |---|---|---|
  | Última migración | `20260915120000_usuario_preferencia` | `20260917120200_cierre_rechazo_tienda` (4 nuevas, 0 revertidas) |
  | Valores en `notificacion_evento` | 15 | **17** |
  | Valores en `notificacion_entidad_tipo` | 13 | **14** |
  | `orden_traspaso_mensajero` | no existe | **existe, 0 filas, RLS activo** |
  | `cierre_rechazo_tienda` | no existe | **existe, 0 filas, RLS activo** |
  | Órdenes vivas | 2.163 | **2.163** |
  | Órdenes sin `clave_remision` | — | **0** |

  El índice `orden_prioridad_clave_remision_idx` existe. **Ninguna orden tocada por la migración:** 0
  órdenes con `updated_at` en la ventana de las 06:14. Las últimas escrituras son 11 órdenes a las
  06:00 (la hora del corte y de `liberar_reprogramadas`) y 11 a las 05:41, todas antes del despliegue.
- **Jobs recurrentes: `liberar_reprogramadas` con 1 fila pendiente (16/09 a las 06:00Z) y
  `analitica_rollup_diario` con 2, y es correcto.** El despliegue cayó entre las 00:00 y las 00:30 CR,
  así que la siembra del build plantó a las 06:14:23Z `analitica_rollup_diario:2026-09-15` (corre el
  16/09) **antes** de que el rollup de las 06:30Z encadenara esa misma clave. `JobRepository.enqueue`
  inserta con `ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING`, y en toda la
  historia de la tabla no hay ni un `run_after` repetido de estos dos tipos. **Verificado a las 06:31:58Z:** el rollup de las 06:30Z terminó en `done` a las 06:30:05Z, al primer intento y sin error, y para el 16/09 sigue habiendo **una sola fila**, la sembrada: el encadenado chocó con la clave y no duplicó ni falló. Desde el despliegue, 0 jobs fallidos, y `get_runtime_errors` sigue en cero hasta las 06:32Z.
  **Para la próxima:** un despliegue entre las 00:00 y las 00:30 CR ve dos rollups pendientes y no es
  un fallo; «una fila por tipo» vale fuera de esa media hora.

### Lo que NO se cierra aquí, y por qué

- **V5 de la 425, mañana**: sobre el primer cierre que traiga rechazos, comprobar que
  `total_pago_mensajero` = Σ del pago de las gestiones con `cierre_id` y que ningún rechazo tiene
  `cierre_id`. Si antes se aprueba el cierre del 11/09 de Arnel Guillen, sus tres órdenes saldrán por
  ese —el bloque 139 libera las `rechazada` por `mensajeroAsignadoId`— y V5 no demostraría la salida
  por la 425.
- **La primera noche con la 425** (corte del 16/09 a las 00:00 CR): Andy Cortés (7 rechazos) y Arnel
  Guillen (3), que no están trabajando, recibirán un `vencido` con sus rechazos. Se saca con «Destrabar
  cierre vencido» y después «Aprobar»; para desbloquear a Arnel basta resolver ese cierre nuevo.
- **Seguimientos, ninguno bloquea**: la carrera entre el R9 de la 412 y el N/V de la 271 (rojos falsos
  en el gate, ficha aparte); tres casos que faltan en el test del `WHERE` de la 425 (hoy los protege el
  literal del predicado); y de la 427, la lista de destinos solo de zona central (no sirve a una
  satélite), un mensajero sin vehículo que aparece habilitado y la concordancia «Se movieron 1 orden».
- **Del humano**: los 25 rechazos sin `ingreso_bodega_rechazo`, y el correo de las 4 funcionalidades
  nuevas, pendiente de aprobación del cliente.

## Release del 2026-09-15 (2.ª) — la 428, recorrida

`prod` = **`efd06fb4`** (PR #798, merge commit con **2 padres** —`1ab83dd5` + `7c4b77ee`—, no squash).
Despliegue `dpl_3oHKLtGvYMPKHvap4TPRhpkTnsPD` **READY**, target `production`, alias `ordenex.co` y
`www.ordenex.co` con `aliasError: null`.

**Una sola ficha, y el diff es 100 % de presentación**: ninguna migración, ningún cambio de esquema,
de servicios ni de consultas. Por eso esta recorrida es corta — no hay filas que contar.

| Ficha | PR | Qué |
| --- | --- | --- |
| **428** | #797 | los dos conmutadores de orden de `/ordenes`, solo con icono y tooltip |

### Verificado

- **Gate completo sobre `dev`** (`7c4b77ee`, el SHA que se mergea): `INIT_EXIT=0` escrito DENTRO del
  log, **1975/1975 archivos**, **28.858 tests**, **cero archivos saltados** —`integration/db`
  ejecutado—. Log en `progress/gate_dev_428.log`.
- **Revisión OK sin bloqueantes**: 8 mutaciones aplicadas, 8 muertas (`progress/review_428.md`).
- **Comprobación visual hecha por el humano** sobre la rama antes de mergear. Es la que cuenta aquí:
  la suite corre en jsdom, sin CSS, y ningún test sabe si «Filtros» vuelve a la primera línea.
- `ordenex.co`, `/login` y `/sw.js` en **200** después de desplegar.

### Lo que NO se pudo medir, dicho en voz alta

**Los errores de runtime.** `get_runtime_errors` dio *timeout* dos veces seguidas (ventanas de 1 h y
24 h). No es «cero errores»: es que no se midió. Queda para la próxima sesión, o para cuando la
consulta responda.

### Decisión del humano que NO se reproponer

Los dos conmutadores pasan a solo icono con sus dos costes aceptados: en móvil no hay hover y los
iconos quedan mudos, y las MISMAS dos flechas significan «Más recientes/Más antiguas» con fecha y
«Más altas/Más bajas» con remisión. Se ofrecieron dos variantes más conservadoras y las descartó.

### Deuda anotada, fuera de esta release

El naranja `brand-outline` de «Descargar» y del botón de columnas compite con el naranja de
selección (22 tablas), y `ColumnasPopover` y «Filtros» usan el mismo icono `SlidersHorizontal` a
40 px uno del otro (12 pantallas).
