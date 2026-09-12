# Ficha 422 — Bitácora de implementación (frontend, tandas 5 y 6)

> Rama `feat/422-preferencia-push-recordada`, worktree `R:/wt/wt422f`, base `e6205770` (la punta que
> dejó el backend con las tandas 1-4).
> **Alcance: tanda 5 (la reactivación) y tanda 6 (cierre).** Lo de las tandas 1-4 está en
> `progress/impl_422_backend.md` y **no se ha tocado ni una línea** de ello, salvo donde se dice.
>
> El archivo que pide `tasks.md` para T6.3 se llama `progress/impl_422.md`; aquí se escribe
> `impl_422_frontend.md` para no pisar la bitácora del backend, que ya partió el nombre en dos.

---

## 1. Qué se construyó, en una línea

Un componente propio, `components/shared/PushReactivacion.tsx`, montado en `app/(app)/layout.tsx`
con la preferencia bajando por props. Devuelve `null`, no pide nada al navegador y solo **aprovecha**
un permiso ya concedido.

---

## 2. Archivos

### Creados

```
components/shared/PushReactivacion.tsx
tests/components/PushReactivacion.test.tsx
progress/impl_422_frontend.md
```

### Modificados

```
app/(app)/layout.tsx                        (+lectura de la preferencia y montaje del componente)
components/shared/PushOptIn.tsx             (+la frase de R25 en `TEXTOS.ayuda`)
tests/components/AppLayout.test.tsx         (+3 casos: la preferencia baja por props; sin sesión no se monta)
tests/components/PushOptIn.test.tsx         (+2 casos de R25/R26; el literal de la ayuda, actualizado)
tests/integration/db/usuario-preferencia.test.ts  (+3 casos: la carrera del MISMO endpoint, T6.1/R22)
specs/422-preferencia-push-recordada/tasks.md     (casillas de T5.1-T5.3, T6.1, T6.3; T6.2 declarada)
```

**Nada de backend, ni de base, ni de rutas de API.** Lo único que se tocó fuera de la capa de
presentación es un archivo de tests de integración (T6.1), que es una tarea de esta tanda.

---

## 3. Las cuatro decisiones que había que tomar bien

### 3.1 Por qué un componente del layout y NO una línea en el hook

Es la decisión que el encargo traía ya desmontada y aquí queda medida en el código: `PushOptIn` —el
único consumidor de `usePushSuscripcion`— se monta dentro del panel de la campana, que es un
`<Popover.Portal>` **sin `keepMounted`** (y en `@base-ui/react@1.6.0` ese prop es `false` por
defecto). El panel **no existe** mientras la campana está cerrada. La reactivación ahí ocurriría la
primera vez que alguien **abre la campana**: justo el gesto que esta ficha existe para no pedir.

En el layout del portal ocurre al cargar **cualquier** página autenticada, y además:

- **R24** sale gratis: ese layout no se pinta sin sesión, así que en la landing no hay nada montado
  que pueda reactivar. La otra mitad la ponen las Server Actions, que exigen actor (410/R50).
- **R23** sale gratis: el layout **persiste entre navegaciones**, así que el intento es uno por
  CARGA del portal y no uno por página visitada.

El precedente exacto, como decía el encargo, es `<AvisoVersionNueva />`.

### 3.2 Las dos lecturas del layout van en `Promise.all`, no encadenadas

`app/(app)/layout.tsx` ya resolvía el nombre del usuario con `UserRepository.findById`. Añadir la
preferencia **detrás** de esa espera le sumaría una segunda ida a la base, en serie, a **todas** las
páginas del portal. En paralelo, el coste en reloj es el de la más lenta de las dos. Es el único
cambio que hice sobre código que no era mío, y está escrito en el archivo con su porqué.

### 3.3 La preferencia no puede saltarse el permiso, y no lo comprueba este componente solo

El backend lo blindó donde importa: la preferencia **ni entra** en
`suscribirYRegistrarEsteDispositivo`. Aquí no se ha deshecho nada de eso. El componente lee
`Notification.permission` como **tercer** corte del camino —después de la preferencia y del soporte
del navegador—, y la función del alta **vuelve a comprobarlo** por su cuenta. Dos cortes, y el de
abajo es el que la guardia G2 vigila que esté **antes** del `subscribe`.

Lo que esto significa para quien lo usa: con el permiso en «default» o en «denied» no pasa
absolutamente nada y el interruptor aparece como siempre.

### 3.4 Si falla, el interruptor no miente — y eso no es una promesa, es una cadena

El componente **no toca ningún estado visible**. El interruptor (410/R14) lee el **dispositivo**, y
si la reactivación falla el dispositivo se queda sin suscripción: dirá «Avisarme en este
dispositivo», que es la verdad. La pieza que lo sostiene es el `unsubscribe()` de rescate de
`alta-push` cuando el servidor rechaza el registro — una suscripción viva que el servidor no conoce
es exactamente el estado que haría mentir al control. **Está medido con una mutación** (M11f, §5) y
con el caso de R20, que monta el interruptor **al lado** de la reactivación y afirma lo que la
persona lee.

---

## 4. La guardia G2, que ya estaba esperando

Pasó de una rama a la otra sola, como decía el backend en su §7.4:

- Antes: `components/shared/PushReactivacion.tsx` no existía → exigía que **nadie** escribiera
  `<PushReactivacion`.
- Ahora: el archivo existe → exige que el **único** montaje del árbol esté en `app/(app)/layout.tsx`.

No se tocó ni una línea de la guardia, y pasa en verde con el montaje puesto (13 casos). La mutación
M3 la pone roja además del test de comportamiento, que es justo lo que el diseño quería.

---

## 5. Las mutaciones

Cada una se aplicó **sola**, se corrió sobre los archivos que debían cazarla, se anotó el rojo y se
revirtió con **copia byte a byte + `sha256sum -c`** (nunca `git checkout --`). Las tres declaradas
«no ejecutables» por el backend eran M3, M7 y M9: las tres están ejecutadas aquí.

| # | Mutación | Rojos | Qué se puso rojo |
| --- | --- | --- | --- |
| **M0f** (control, diseñada para morir) | En `PushReactivacion.tsx`, invertir el corte del permiso: `Notification.permission === "granted"` → `return` | **18 de 21** | Todo el archivo menos los tres casos que no dependen del permiso. |
| **M3** | Que la reactivación llame a `Notification.requestPermission()` cuando el permiso está en «default» | **4** | `PushReactivacion.test.tsx` › con el permiso en «default» / en «denied» / en NINGÚN escenario se llama a la petición **y** `push-alta-punto-unico.guardia.test.ts` › una sola aparicion, y esta en `activar()` del hook |
| **M7** | Que `PushReactivacion` pinte un aviso al reactivar | **3** | `PushReactivacion.test.tsx` › el componente no pinta NADA · › NO aparece ningún aviso en la página · › tampoco cuando falla |
| **M9** | Quitar el `useRef` de un solo intento | **1** | `PushReactivacion.test.tsx` › el doble montaje del modo estricto de React NO dispara un segundo intento |
| **M11f** (añadida) | En `alta-push.ts`, quitar el `unsubscribe()` de rescate cuando el servidor rechaza el registro | **2** | `PushReactivacion.test.tsx` › el servidor rechaza el registro: se deshace la suscripción y el interruptor NO dice «Activado» **y** `alta-push.test.ts` › el servidor rechaza el registro: se DESHACE la suscripción |

### 5.1 La de control, y por qué está

En este repo un arnés reportó **9/9 supervivientes dos veces sin haber ejecutado un test**. M0f es
una mutación **diseñada para morir a lo grande**: invierte el sentido del corte del permiso, así que
el camino feliz deja de ocurrir y los negativos empiezan a ocurrir. **Murió: 18 rojos de 21 casos.**
Sin ese número, las otras cuatro filas de la tabla no significarían nada.

### 5.2 Salidas reales

```
$ # M0f — control
Tests  18 failed | 3 passed (21)
$ cp $PRISTINO/PushReactivacion.tsx components/shared/PushReactivacion.tsx && sha256sum -c SHA256.txt
components/shared/PushReactivacion.tsx: OK
app/(app)/layout.tsx: OK

$ # M3
× ⭑ una sola aparicion, y esta en `activar()` del hook
× ⭑ con el permiso en «default», la preferencia puesta NO se salta la comprobación
× ⭑ con el permiso en «denied», la preferencia puesta NO se salta la comprobación
× ⭑ R16: en NINGÚN escenario se llama a la petición de permiso del navegador
Tests  4 failed | 30 passed (34)

$ # M7
× ⭑ el componente no pinta NADA: su árbol renderizado está vacío
× ⭑ y NO aparece ningún aviso en la página al reactivar (ni toast, ni alerta)
× ⭑ tampoco cuando falla: un fallo silencioso sigue siendo silencioso
Tests  3 failed | 18 passed (21)

$ # M9
× ⭑ el doble montaje del modo estricto de React NO dispara un segundo intento
Tests  1 failed | 20 passed (21)

$ # M11f
× ⭑ el servidor rechaza el registro: se DESHACE la suscripción del navegador      (alta-push.test.ts)
× ⭑ el servidor rechaza el registro: se deshace la suscripción y el interruptor NO dice «Activado»
Tests  2 failed | 31 passed (33)

$ # revertidas las cinco, con su huella verificada
lib/pwa/alta-push.ts: OK
components/shared/PushReactivacion.tsx: OK
app/(app)/layout.tsx: OK
```

**M9 pone rojo UN solo caso, y lo digo en vez de maquillarlo.** El otro caso de R23 —el que
re-renderiza con las mismas props— **no** la caza, porque la lista de dependencias del efecto ya
impide que se vuelva a ejecutar. Sigue teniendo valor (fija que un re-render no es una carga nueva),
pero el que sostiene R23 de verdad es el del modo estricto.

---

## 6. T6.2 — la medición del backfill contra producción: NO la hice, y por qué

**No se marca la casilla.** Esta tarea (a) mide contra la base de **producción** y (b) se hace
**antes de aplicar la migración allí**, o sea durante el despliegue. Las dos cosas están fuera del
alcance de un agente de frontend, y además **en este entorno no hay acceso a la base de producción**
(el MCP de Supabase no está en mi conjunto de herramientas). Inventar un número habría sido peor que
no darlo.

Queda **abierta para quien despliegue**, y es de las que hay que hacer **antes**:

```sql
-- ANTES de aplicar la migración, en solo lectura:
SELECT COUNT(DISTINCT usuario_id) AS personas_con_suscripcion FROM push_suscripcion;

-- DESPUÉS de aplicarla, las tres cifras que tienen que cuadrar:
SELECT COUNT(*)                                  AS filas,
       COUNT(*) FILTER (WHERE avisos_push)       AS puestas,
       COUNT(*) FILTER (WHERE updated_at = created_at) AS intactas
  FROM usuario_preferencia;
```

`filas = puestas = intactas = <el número de antes>`. La tercera columna es la que prueba que **nada
más** tocó esas filas, y depende de que el `update` del repositorio no reescriba `created_at` — lo
cual tiene su propio test contra Postgres (`usuario-preferencia.test.ts` › actualizar toca
`updated_at` y NO `created_at`).

> Aviso de contexto: producción se vació a propósito el 2026-08-25 (arranque comercial). Un **0**
> ahí significaría «aún no ha pasado», no «está roto» — pero hay que mirarlo igual, porque un 0 en
> `personas_con_suscripcion` y un número distinto de 0 en `filas` sí sería un problema.

---

## 7. Lo que NO se pudo comprobar como estaba escrito

- **Comprobación visual en un navegador de verdad: imposible en este entorno.** No hay navegador
  disponible, así que nadie ha visto la reactivación ocurrir en una pestaña real. Lo que sí está
  medido es el comportamiento con el doble del navegador de la 410 (`tests/fixtures/navegador-push.ts`),
  que desde la tanda 4 **actualiza `Notification.permission`** como uno real. Lo que queda sin
  medir, y conviene que alguien lo mire antes de dar la ficha por buena en producción: que el
  service worker esté **activo** en el instante en que el layout monta (si no lo está, el camino
  sale por `sin-soporte` y no pasa nada malo, pero tampoco se reactiva hasta la siguiente carga).
- **P3 (la redacción del texto) sigue abierta.** La frase se escribió en **tuteo** —«Si cierras
  sesión…»— y no en el voseo que proponía el diseño, porque el resto de este mismo control está en
  tuteo («Te avisamos», «abre los ajustes») y mezclar los dos registros dentro de una tarjeta se lee
  como un descuido. **No es una decisión cerrada:** cambiarla es una línea en `PushOptIn.tsx` y el
  literal que la fija en `PushOptIn.test.tsx`.
- **P2 sigue como estaba:** el interruptor sigue diciendo el estado de **este dispositivo**, no la
  preferencia de la persona. Con la reactivación silenciosa hay un efecto visible nuevo y pequeño:
  si el panel de la campana ya estaba abierto cuando ocurre, el interruptor **no** se actualiza solo
  —su hook lee al montar— y dirá «Avisarme en este dispositivo» hasta que se cierre y se vuelva a
  abrir. Es lo que la decisión humana pedía (nada visible, sin avisos), pero conviene saberlo.

---

## 8. Trazabilidad — los requisitos de estas tandas

| R | Test | Estado |
| --- | --- | --- |
| R14 | `PushReactivacion.test.tsx` › al montar evalúa y, sin pedir NADA, suscribe y registra | ✅ |
| R15 | `PushReactivacion.test.tsx` › (el mismo) + `registrarMock` con las claves y la etiqueta | ✅ |
| R16 | `PushReactivacion.test.tsx` › R16: en NINGÚN escenario se llama a la petición · `push-alta-punto-unico.guardia.test.ts` | ✅ |
| R17 | `PushReactivacion.test.tsx` › con el permiso en «default»/«denied» … NO se salta la comprobación (+ su control positivo) | ✅ |
| R18 | `PushReactivacion.test.tsx` › con `avisosRecordados={false}` no se le pregunta ni al navegador (+ su control positivo) | ✅ |
| R19 | `PushReactivacion.test.tsx` › el componente no pinta NADA · › NO aparece ningún aviso · › tampoco cuando falla | ✅ |
| R20 | `PushReactivacion.test.tsx` › el servidor rechaza el registro… el interruptor NO dice «Activado» · › sin red… · › service worker no activo | ✅ |
| R21 | `PushReactivacion.test.tsx` › registra la suscripción QUE YA HAY y no llama a `subscribe` · › si reafirmar falla | ✅ |
| R22 | `usuario-preferencia.test.ts` › las dos reactivaciones concurrentes dejan UNA fila · › la exclusion es ESTRUCTURAL | ✅ |
| R23 | `PushReactivacion.test.tsx` › el doble montaje del modo estricto · › ni un re-render · › CONTROL: dos cargas sí intentan dos veces | ✅ |
| R24 | `AppLayout.test.tsx` › SIN sesión válida no se monta nada que pueda reactivar · `push-alta-punto-unico.guardia.test.ts` | ✅ |
| R25 | `PushOptIn.test.tsx` › dice las DOS mitades: al salir y al volver | ✅ |
| R26 | `PushOptIn.test.tsx` › ni promete avisos sin sesión, ni usa jerga técnica | ✅ |

Y el cableado, que no es un requisito pero es la lección de los dos notificadores muertos:
`AppLayout.test.tsx` › **con actor, monta la reactivación pasándole la preferencia leída** afirma que
alguien le **pasa** el dato, no que el layout lo importe. Con `avisosPushDe` devolviendo `false`, la
prop baja `false` (R2).

---

## 9. Salidas reales

### 9.1 El gate rápido SE NEGÓ, y con razón

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    db/migrations/20260915120000_usuario_preferencia/down.sql
    db/migrations/20260915120000_usuario_preferencia/migration.sql
    db/schema.prisma
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

Mi diff es 100 % frontend, pero el gate mide **la rama contra `dev`**, y ahí dentro va la migración
del backend. No se forzó: se corrió el completo.

### 9.2 `./init.sh` (gate COMPLETO)

```
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 184 problems (0 errors, 184 warnings)
✓ lint paso
...
 Test Files  1950 passed (1950)
      Tests  28325 passed | 26 skipped (28351)
   Duration  586.82s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1950 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**`INIT_EXIT=0` está escrito DENTRO del log**, no leído del código de salida del proceso: en esta
sesión cinco gates rojos llegaron como «exit code 0» porque un `echo` posterior tapó el código, y al
backend de esta misma ficha le pasó en su primera corrida.

**Los 184 avisos de lint son los mismos de `dev`** (el backend contó exactamente 184), **0 errores**,
y ninguno cae en un archivo de esta tanda.

**Los `skipped` son 26 y son los de siempre:**

```
tests/components/AnaliticaPage.test.tsx  (64 tests | 17 skipped)
tests/components/AnaliticaShell.test.tsx (15 tests |  9 skipped)
```

**Cero saltados de `tests/integration/db/`** (`grep -c` sobre el log: `0`), o sea que la capa de
datos —incluida la carrera de T6.1— **se ejecutó de verdad**. El `.env` se copió al worktree antes
de correr nada, precisamente para que no pasara lo contrario.

**La cuenta cuadra sola:** el backend cerró con **1949 archivos / 28296 tests**; esta tanda cierra
con **1950 / 28325**. Son **+1 archivo y +29 tests**, y los 29 son exactamente los míos:

```
tests/components/PushReactivacion.test.tsx        (21 tests)   ← nuevo
tests/components/AppLayout.test.tsx               (10 tests)   ← 7 + 3
tests/components/PushOptIn.test.tsx               (16 tests)   ← 14 + 2
tests/integration/db/usuario-preferencia.test.ts  (14 tests)   ← 11 + 3
tests/unit/guards/push-alta-punto-unico.guardia.test.ts (13 tests)  ← intacta, y ahora por la otra rama
```

