# Re-revisión acotada · ficha 410 · los tres bloqueantes

**Alcance:** SOLO los tres bloqueantes de `progress/review_410.md`. La revisión completa
(`ebb1d946`) no se repite. Arreglo medido: `ebb1d946..26bf70bd`.
**Worktree propio:** `R:/wt/rev410fix`, detached en `26bf70bd`, con `node_modules` propio
(`pnpm install --frozen-lockfile` + `prisma generate`). Ninguna reversión con `git checkout --`:
todas por copia byte a byte, verificadas con `md5sum`.

---

## 0 · Lo primero: ¿tocó producción? — **NO**

```
git diff --numstat ebb1d946..26bf70bd
12949  0  progress/gate_410_fix.log
   55  0  progress/history.md
  283  0  progress/impl_410_fix.md
   17  5  specs/410-notificaciones-push/tasks.md
  179  0  tests/integration/db/push-cupo-carrera.test.ts
  263  4  tests/unit/guards/push-cableado-unico.guardia.test.ts
```

`git diff --numstat --find-renames ebb1d946..26bf70bd -- lib app db` devuelve **vacío**. Cero líneas
de producción. El encargo se cumplió literalmente.

---

## 1 · B1 · el test de la carrera — **CERRADO**

Reapliqué **la mutación literal** del informe (`findFirst` -> `if (previo !== null) return false` ->
`create` en `try/catch` -> `return true`) sobre `lib/repositories/PushSuscripcionRepository.ts`.

| Medición mía | Resultado |
| --- | --- |
| Sin mutación | `5 passed (5)`; el caso nuevo en **38 ms** (la compuerta la abren las llegadas, no el tope) |
| Con la mutación, **5 corridas seguidas** | `1 failed / 4 passed (5)` — **las 5 de 5** |
| `git status` durante la corrida | **solo** `M lib/repositories/PushSuscripcionRepository.ts` |
| Reversión | md5 `b9b7edb7457918087f9abadb84aee0a1` idéntico al original; `git diff --stat lib/` vacío |

El rojo es el nuevo caso, con su aserción nombrada:

```
x  R7: con las DOS conexiones retenidas en create, sale UN cupo y UN encolado
AssertionError: EXACTAMENTE un encolado: ... expected [ ...(2) ] to have a length of 1 but got 2
```

Y **ejecuta el código de producción**: `new PushSuscripcionRepository(clienteConBarreraEnCreate(...))`
sobre el repositorio real, el decorador real y el índice único real; lo único envuelto es el cliente
de Prisma, por la costura que el propio constructor declara. Es exactamente el eslabón que faltaba.

### El tope de 15 s — **es sólido, y lo medí en vez de razonarlo**

Forcé el escenario de una sola llegada (mutación: un `return false` para la conexión B antes del
`create`). Resultado: **no se cuelga**. La compuerta se abre por el tope, y el caso falla con la
aserción NOMBRADA a los **15,65 s de tiempo de test / 16,33 s de duración**, dentro del
`testTimeout: 20000`:

```
AssertionError: la compuerta la abrio el TOPE, no las llegadas: las dos conexiones no
coincidieron en create y este caso no ha medido la ventana
```

El diseño es correcto y el porqué está bien escrito: la barrera va en `create` y no en `findFirst`
porque `create` lo llaman **las dos** implementaciones, así que el caso no puede colgarse contra la
buena.

### Los otros 4 casos verdes con la mutación — **de acuerdo con el implementador**

Ninguno debería haber enrojecido, y por razones distintas:

- los dos de autocomprobación miden el fontanero (el clon trae el índice, el repo escribe en el
  esquema desechable): indiferentes a `tomarCupoDelDia` por construcción;
- el de `Promise.all` **no puede** enrojecer: con las llamadas serializadas —que es lo que hace esta
  máquina, 5 de 5 medido por el reviewer anterior— la segunda lee la fila de la primera y devuelve
  `false`, o sea 1 cupo y 1 encolado. Es precisamente su insuficiencia lo que motivó B1;
- el de la mutación a pelo reproduce el SQL dentro del test: mide el motor y el índice, no el código.

---

## 2 · B2 · el censo del cableado — **CERRADO**

No me fié de la inyección en memoria. **Escribí el intruso de verdad en el árbol**
(`lib/notificaciones/notificador-satelite.ts`, productor de `cierre_dia_por_aprobar`, que **sí** es
elegible, construyendo su propio `NotificacionRepository`):

| Corrida | Resultado |
| --- | --- |
| Guardia sin intruso | `22 passed (22)` |
| **Con el intruso en el árbol** | **`2 failed / 20 passed (22)`**, y el rojo nombra la ruta: `{ ruta: "lib/notificaciones/notificador-satelite.ts", apariciones: 1, autorizadas: 0 }` |
| Tras borrarlo | `22 passed (22)`, `git status` limpio |

### Los dos modos de fallo que este repo ya midió — **descartados los dos**

**(1) «mide por método, no por escritura».** Probé las dos direcciones sobre el árbol real:

- **quitar** una aparición declarada (`lib/actions/notificaciones.ts`, la única que tiene) ->
  **2 rojos**: «`lib/actions/notificaciones.ts` no construye las 1 veces declaradas: expected +0 to
  be 1» y el censo. El `censar()` compara con **distinto**, no con «mayor que», así que una lista
  blanca que se desvía de la realidad también enrojece;
- **añadir** una **segunda** aparición dentro de un archivo YA autorizado (`notificadores.ts`) ->
  **7 rojos**. Cuenta apariciones de verdad.

**(2) «arnés que reporta sin ejecutar».** Los 22 casos se ejecutan (`--reporter=verbose`, todos con
duración). Tres de las autocomprobaciones las puse rojas yo mutando el árbol real, así que **no son
prosa**: reaccionan. El barrido llega a **1.386** archivos (lo conté a mano con `find`: 1386), contra
el «más de 800» que el test exige.

### La lista blanca no se pasó de ancha

Tres rutas, cada una con **cuenta exacta = 1** y motivo obligado (más de 80 caracteres). No declara
carpetas. Y comprobé que **no hay ninguna construcción de `NotificacionRepository` fuera de `lib/`
y `app/`** en todo el repo (salvo `tests/`), así que las dos raíces del censo bastan.

Los tres motivos, además, **se afirman** en vez de suponerse: `eventoPuedeEmpujar("orden_rechazada")`
y `("carga_masiva_terminada")` en `false`, con control positivo `("cierre_dia_por_aprobar")` en
`true` para que no pasen con un predicado que devuelva `false` siempre.

---

## 3 · B3 · las casillas — **CERRADO** (con una excepción declarada)

`tasks.md`: **39 marcadas / 1 sin marcar**.

- **T6.4 — correcta y no dice de más.** Lo escrito coincide con la evidencia del humano: solo
  `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, **par distinto por entorno**, una en *Production* y otra
  en *Preview*, ninguna en *Development*, verificado con `vercel env ls`; `VAPID_SUBJECT` no se puso
  y el motivo está comprobado contra el código — `piezasVapidAusentes()` (`lib/config/push.ts`) solo
  filtra la pública y la privada, y `pushConfigurado()` lo documenta. Ninguna clave pegada.
  *(El título de la tarea sigue diciendo «las tres variables»; el cuerpo lo explica.)*
- **T6.5 — SIN marcar, con su motivo escrito** en la línea y declarada límite abierto en
  `history.md`. Correcto.
- **T6.6 — la entrada del 2026-09-11 en `progress/history.md` la leí entera.** Dice **qué se midió y
  qué casi se cuela**, no un changelog: los dos bloqueantes con sus números (157/157 verdes y 5 de 5;
  213 archivos y 3.124 tests en verde con el canal saltado), por qué el caso de `Promise.all` nunca
  llegaba a la ventana, por qué la barrera va en `create`, la corrección de
  `lib/actions/notificaciones.ts`, y el límite abierto con nombre. Es una entrada de las buenas.

---

## 4 · La corrección que el implementador le hizo al reviewer — **ES CIERTA**

Verificada en los archivos reales, eslabón por eslabón. El grafo MCP me dio dónde mirar pero con
**líneas rancias** —daba `emitir.ts:267` y `NotificacionService:79-94`, y lo real está en ~297 y
191-206—, así que lo confirmé en el archivo, como manda la regla 7:

```
lib/actions/notificaciones.ts:55            new NotificacionRepository(prisma) -> buildService()
lib/services/NotificacionService.ts:191-206 notificarCargaTerminada -> emitirCargaMasivaTerminada(this.repo, ...)
lib/notificaciones/emitir.ts (~297)         emitirCargaMasivaTerminada -> emitirFilas -> await repo.crear(fila, tx)
```

Ese repositorio **llega a CREAR**. `lib/actions/notificaciones.ts` **no es «solo lectura»**: el
motivo que escribió el informe original estaba mal y el implementador lo corrigió bien. No es
agujero porque `carga_masiva_terminada` tiene `push: "no"` en el catálogo, y eso ahora **se afirma
en un test**.

---

## 5 · Gate completo — **lo corrí yo, y reproduce**

`./init.sh` en mi worktree, capturando el código de salida del propio `init.sh` y escribiéndolo
**dentro** del log en la línea siguiente, sin nada en medio que lo tape:

| Medición | Implementador (`progress/gate_410_fix.log`) | **Mío** |
| --- | --- | --- |
| `INIT_EXIT` | 0 | **0** |
| Modo | `completo` (el rápido se negó solo) | **`completo`** |
| Archivos | 1919 passed (1919) | **1919 passed (1919)** |
| Tests | 27779 passed / 26 skipped (27805) | **27779 passed / 26 skipped (27805)** |
| Skipped | 17 `AnaliticaPage` + 9 `AnaliticaShell` | **idéntico; cero de `integration/db`** |
| Lint | 184 problems, 0 errores | **184 problems, 0 errores** |
| Postgres | «DATABASE_URL resuelta: los 163 archivos ... SI se ejecutan» | **idéntico** |

No hay «init OK» barato por `.env` ausente: los 163 archivos contra Postgres se ejecutaron. Los 26
saltados los enumeré uno a uno en MI log: son exactamente esos dos archivos y **ninguno** de
`integration/db`.

**Sobre el `INIT_EXIT` del log del implementador:** lo revisé en el script. `gate410fix.sh` redirige
`./init.sh --rapido` al log y en la **línea siguiente** anexa el código de salida de ese mismo
comando, **sin ningún `echo` intermedio**, así que el valor es el de `init.sh`. Y el log empieza con
«Arnes SDD :: init (modo: completo)»: el rápido se escaló solo, como debía.

**Nota de arnés (mía, no de la rama):** mi primera corrida salió `INIT_EXIT=1` con «Cannot find
module web-push». Era mi junction de `node_modules` apuntando al del repo principal (rama `dev`),
que no trae la dependencia que esta rama añade. Se arregla con `node_modules` propio. Lo dejo porque
le pasará a cualquiera que revise esta rama con junction.

---

## Hallazgos

**menor 1 — un número de la bitácora no reproduce.** `impl_410_fix.md` dice que con la mutación los
archivos del backend dan «1 failed / 152 passed (153)». Los **13 archivos** que la propia ficha
enumera (`impl_410_backend.md`) dan hoy **170 tests** en verde, y con la mutación **1 failed / 169
passed**. La dirección del dato —exactamente un rojo, y es el caso nuevo de R7— **sí** reproduce; el
total está mal. No cambia ningún veredicto, pero la cifra escrita no es la medida.

**menor 2 — el margen del tope es de 4,35 s.** Medido: el camino del tope falla a los 15,65 s contra
un `testTimeout` de 20 s. Bajo carga —familia de flakes ya medida en este repo— podría degradar a un
timeout mudo de vitest. Es el peor caso de un caso **que ya está fallando**, así que no pierde señal:
solo la pierde de nombre. Si algún día molesta, bajar el tope a 10 s lo resuelve.

**menor 3 — el `unref` del temporizador del tope.** Si el bucle de eventos quedara vacío, un
temporizador con `unref` no dispara y el caso moriría por el `testTimeout` en vez de por su aserción.
Hoy no puede pasar (los dos clientes de Prisma mantienen sockets abiertos), pero es lo único que
separa el mensaje nombrado del mudo.

**nota de estado, no hallazgo — el checkpoint 9 de `CHECKPOINTS.md`** («todas las tasks marcadas
con equis») **no se cumple literalmente**: T6.5 sigue sin marcar. Es deliberado y del humano, con
motivo escrito y declarada límite abierto. **No lo cuento como bloqueante** —marcarla en falso sería
peor— pero el checkpoint queda **abierto hasta el 2026-09-12**, y el leader tiene que saberlo antes
de cerrar la ficha.

**Ningún hallazgo BLOQUEANTE.**

---

## Veredicto

# OK

Los tres bloqueantes están cerrados **con medición propia**, no con la bitácora: la mutación de R7
sale roja 5 de 5 ejecutando el código de producción, el intruso escrito de verdad en el árbol pone la
guardia en rojo nombrando la ruta, el censo cuenta apariciones en las dos direcciones, las casillas
dicen lo que pasó y nada más, la corrección sobre `lib/actions/notificaciones.ts` es cierta, y el
gate completo da `INIT_EXIT=0` con los mismos 1919 / 27779 / 26 que reportó el implementador. Cero
líneas de producción tocadas.

Queda vivo T6.5 —la única prueba de que el canal existe— y los siete menores del informe original,
ninguno bloqueante.
