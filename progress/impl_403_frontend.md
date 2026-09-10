# impl_403 (FRONTEND) — T14: la pantalla dice que los envíos están espaciados

> Spec: `specs/403-webhook-destino-que-falla-siempre/` (T14 de `tasks.md`, design §7)
> Rama: `feat/403-webhook-destino-que-falla-pausa-y-avisa`
> Alcance: **solo la capa de presentación**. El backend (T1–T13, T15) está en
> `progress/impl_403_backend.md` y no se tocó ni una línea suya.

## Qué se añadió, y por qué está escrito así

Una línea más dentro del bloque `role="status"` del modal de gestión del webhook, que aparece
solo cuando la Server Action devuelve `pausada: true` **y la suscripción está activa** (H-2).
**El texto exacto**, copiado del render real y no de la intención (la fecha del ejemplo es la
del test, `2026-09-09T13:05:00.000Z`, formateada por el `Intl` de la máquina):

> Los envíos a este webhook se están espaciando: desde el 9/9/26, 8:05 a. m. el destino no
> acepta ninguno. No hay que hacer nada: vuelven a su ritmo normal en cuanto el destino acepte
> un envío. Si ya está resuelto, guarda la URL de nuevo para reintentarlo ahora.

**La fecha va EN MEDIO de la frase, y eso es el arreglo de la 3ª vuelta.** Antes cerraba la
frase (`…desde el ${fecha}.`) y el render real salía con **punto doble**: `dateStyle: "short"`
de es-EC devuelve `9/9/26, 8:05 a. m.` —año de dos dígitos y abreviatura CON punto— y ese punto
chocaba con el que cerraba la frase: «8:05 a. m..». No lo vio ningún test porque todos
construían la fecha con `Intl` y comparaban contra el mismo resultado; se vio **mirando el
render**. Ni una palabra del mensaje cambió, solo el orden, y así queda inmune también a un ICU
en formato 24 h (donde no hay abreviatura y el síntoma habría desaparecido con el orden aún
mal).

Y **sin fecha** (si `sinExitoDesde` llegara `null`, que el contrato permite):

> Los envíos a este webhook se están espaciando: el destino lleva un rato sin aceptar ninguno.
> No hay que hacer nada: vuelven a su ritmo normal en cuanto el destino acepte un envío. Si ya
> está resuelto, guarda la URL de nuevo para reintentarlo ahora.

Las tres decisiones de copy, porque son el punto de la task y no un detalle:

1. **No suena a corte.** Quien lee esto es el dueño de una integración que SIGUE conectada: la
   suscripción no se desactivó, no se dio de baja y no se canceló. La frase que más pesa es «no
   hay que hacer nada», y va antes que la salida manual. Un test recorre una lista de palabras
   prohibidas (`desactiv`, `dado de baja`, `cancel`, `suspend`, `bloquead`, `error`, `fall`) y
   otra de jerga (`circuito`, `backoff`, `429`, `cola`, `job`, `http`, `pausad`).
2. **La fecha se lee, no se descifra.** `sinExitoDesde` llega como ISO-8601 y se pinta con el
   MISMO formato que ya usaba la columna «Fecha de creación» de esa pantalla (es-EC, fecha
   corta + hora corta). Ese formato vivía metido dentro de `api-keys-columns.tsx`; se sacó a
   `_components/fecha-legible.ts` y ahora lo usan los dos, en vez de una segunda copia que
   acabaría divergiendo.
3. **Ni URL ni secreto en el aviso** (R13): el texto habla de «el destino», no lo nombra.

Lo que NO se hizo, a propósito: **ningún botón nuevo**. «Guardar URL»/«Registrar», que ya
existía, es la palanca manual de R7/R19, y el reinicio lo hace el servidor. La pantalla no
recalcula la pausa ni la deduce de nada: `pausada` llega ya resuelta y se recalcula en cada
`obtenerWebhook`, así que el `refrescar()` que ya corría tras cada mutación `ok` la apaga sola.

## Archivos

**Creados:** `app/(app)/configuracion/api/_components/fecha-legible.ts` ·
`tests/unit/components/fecha-legible.test.ts` (2ª vuelta, H-3)

**Modificados:**
- `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx` — `WebhookEstado` pasa a ser
  el tipo del contrato (`WebhookVistaPublica`) en vez de una copia local que ya se había
  quedado corta; `pausada`/`sinExitoDesde` derivados junto a `activa`; la línea nueva,
  condicionada a `activa && pausada` (H-2).
- `app/(app)/configuracion/api/_components/api-keys-columns.tsx` — su `formatFechaCreacion`
  ahora delega en `fecha-legible` (mismo resultado; solo decide su propio `—`).
- `tests/components/WebhookAccionCell.test.tsx` — 9 tests nuevos (16 → 25).
- `specs/403-webhook-destino-que-falla-siempre/tasks.md` — las 15 casillas marcadas (H-5).

## Mapa `R<n> → test` (la parte de UI; el resto está en la bitácora del backend)

| R | Qué exige de la pantalla | Test |
| --- | --- | --- |
| **R18** | que el dueño VEA que está espaciada y desde cuándo | `tests/components/WebhookAccionCell.test.tsx` → «con `pausada: true` la pantalla avisa de que los envíos se están espaciando y desde cuándo» (texto literal completo) |
| **R18** | y que NO lo vea cuando no lo está | ídem → «con `pausada: false` NO hay aviso — una suscripción sana no alarma a nadie» y «sin suscripción (webhook: null) tampoco hay aviso» |
| **R18** | fecha legible, no el timestamp crudo de la acción | ídem → «la fecha se lee como fecha, no como el timestamp crudo que llega de la acción» (afirma que no aparece el ISO ni un `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}`) |
| **R18** | el caso `sinExitoDesde: null` del contrato | ídem → «sin `sinExitoDesde` el aviso sigue apareciendo, sin hueco ni fecha inventada» |
| **R19** | tras «Guardar URL», el aviso se apaga sin recargar | ídem → «tras 'Guardar URL' el aviso desaparece sin recargar la página» (2ª lectura de `obtenerWebhook`, el modal sigue en pie) |
| **R9** (su regla de vocabulario, aplicada a la UI) | nunca «se desactivó»/«se dio de baja»/«se canceló», y sin jerga | ídem → «el aviso NO dice que se desactivó, ni que se dio de baja, ni suena a jerga técnica» |
| **R13** | ni la URL ni el secreto en el texto | ídem → «el aviso no filtra la URL del webhook ni el secreto» |
| **H-2** (revisión) | una suscripción dada de baja NO puede decir a la vez que no existe y que sus envíos se espacian | ídem → «con la suscripción dada de baja no se muestra el aviso de espaciado, aunque venga `pausada: true`» (afirma además que el bloque `role="status"` dice UNA sola cosa) |
| **H-3** (revisión, parcial) | el caso vacío del formateador de fecha | `tests/unit/components/fecha-legible.test.ts` → «EL CASO VACÍO: una fecha no interpretable devuelve `null`, nunca «Invalid Date»» |
| **Puntuación** (3ª vuelta) | que el aviso no se lea con un punto doble, y que la fecha no vuelva a cerrar la frase | `tests/components/WebhookAccionCell.test.tsx` → «PUNTUACIÓN: la fecha va EN MEDIO de la frase, y el aviso nunca se lee con un punto doble» (síntoma `..` + causa: tras la fecha sigue la frase) · y la variante sin fecha lo comprueba también en «sin `sinExitoDesde` el aviso sigue apareciendo…» |

## Mutaciones: cuatro, las cuatro muertas

Arnés autocomprobado (`sha1` antes/después, aborta con código 2 si el archivo no cambió) sobre
`WebhookAccionCell.tsx`, restaurando desde copia y verificando el `sha1` de vuelta.

| # | Qué se rompió | Rojo |
| --- | --- | --- |
| **M1** | se BORRA el bloque JSX del aviso entero | **6 tests rojos** de 23 (`Unable to find an element with the text: /se están espaciando/i` en los 5 que lo leen, + el de R19) |
| **M2** | se muestra justo al revés (`{!pausada ? (`) | **8 tests rojos** de 23 — caen los 6 anteriores Y los dos que exigen AUSENCIA: «con `pausada: false` NO hay aviso» y «sin suscripción tampoco hay aviso», ambos con `expected <p …(1)></p> to be null` |

M2 es la que importa de verdad: un aviso que sale siempre es tan inútil como no tenerlo, y es
justo lo que un `pausada` mal leído produciría.

**Segunda vuelta (H-2): M3, también muerta.**

| # | Qué se rompió | Rojo |
| --- | --- | --- |
| **M3** | se quita la condición nueva: `{activa && pausada ? (` vuelve a `{pausada ? (` | **1 test rojo** de 24, y es exactamente el del caso: «con la suscripción dada de baja no se muestra el aviso de espaciado, aunque venga `pausada: true`» → `expected <p …(1)></p> to be null`. Los otros 23 siguen verdes, o sea que la condición nueva no rompió ningún caso previo |

**Tercera vuelta (puntuación): M4, también muerta.**

| # | Qué se rompió | Rojo |
| --- | --- | --- |
| **M4** | se deshace la reordenación y la fecha vuelve a cerrar la frase (`el destino lleva sin aceptar ninguno desde el ${fecha}.`) | **2 tests rojos** de 25: «con `pausada: true` la pantalla avisa… y desde cuándo» (el literal completo) y «PUNTUACIÓN: la fecha va EN MEDIO de la frase, y el aviso nunca se lee con un punto doble» → `expected '…' not to contain '..'` |

El test de puntuación vigila **las dos** cosas: el síntoma (`..`) y la causa (que tras la fecha
siga la frase y no la cierre un punto). Solo con el síntoma, un ICU en formato 24 h —sin
`a. m.`— lo dejaría pasar con el orden otra vez mal.

---

## Segunda vuelta: los dos hallazgos de la revisión que tocaba cerrar

**H-2 — dos frases que se contradicen.** Reproducido por el reviewer: `activa=false` +
`pausada=true` a la vez (dar de baja no reinicia el circuito y `findByOwner` no filtra por
`activa`), y la pantalla pintaba «No hay webhook registrado» **y** «sus envíos se están
espaciando». Arreglado donde lo cifró la revisión, en la condición del bloque
(`WebhookAccionCell.tsx`): `{activa && pausada ? (`. Se eligió esa vía y no reiniciar el
circuito en `desactivarByOwner` porque esto es frontend y esa otra es una escritura de
repositorio, fuera de este alcance — y porque la frase es falsa aunque el dato sea fiel: una
suscripción de baja no recibe entregas, así que no hay nada que espaciar. El porqué queda
escrito en el docblock, junto a la condición, para que el próximo que lo toque no lo deshaga
sin enterarse; y el test del caso lo sostiene (M3).

**H-5 — `tasks.md` con 0 de 15.** Marcadas las 15: T1–T13 y T15 las hizo el backend, T14 esta
bitácora. `CHECKPOINTS.md` línea 9 lo pide por su letra («todas las tasks están marcadas
`[x]`»). Comprobado que no queda ninguna `- [ ]` en el archivo.

**H-3 — cubierto a nivel de módulo, no de columna.** Salía casi gratis, así que
`tests/unit/components/fecha-legible.test.ts` afirma el contrato del formateador nuevo, incluido
**el caso vacío** (fecha no interpretable → `null`, nunca «Invalid Date»). Lo que sigue **sin**
test es el `?? SIN_DATO` de la columna «Fecha de creación» —que una fecha ilegible se pinte como
`—` en la tabla—: es deuda preexistente que este refactor preserva tal cual, y cubrirla exige
renderizar las columnas, que es otro archivo y otra ficha.

H-1 (orden de merge con la 401), H-4 (un destino que aletea) y H-6 quedan como los dejó la
revisión: no son de este alcance.

## El gate: `INIT_EXIT=1`, y el rojo NO es de este diff

`progress/gate_403_frontend.log` (corrida completa, `DATABASE_URL` **exportada**, no copiada:
`DATABASE_URL ok (70 chars, prefijo postgresql:)`).

```
✓ typecheck paso
✓ lint paso            (183 problems, 0 errors — 183 warnings, el patrón preexistente)
 Test Files  5 failed | 1834 passed (1839)
      Tests  7 failed | 26624 passed | 26 skipped (26657)
   Duration  773.02s
INIT_EXIT=1
```

- **`skipped`: 26, los legítimos y ninguno más** — `AnaliticaPage` 17 + `AnaliticaShell` 9,
  ajenos. **`tests/integration/db/` corrió entera** (no se saltó ni un archivo): de hecho el
  rojo VIENE de ahí, o sea que esos tests tocaron Postgres de verdad.
- **Cero `Test timed out`** en toda la corrida (el flake de saturación que avisó el backend no
  se reprodujo).
- **Mis 4 archivos, verdes:** `WebhookAccionCell.test.tsx (23 tests)`, `ApiKeysModule (32)`,
  `ConfiguracionApiPage (5)`, `api-keys-tabla-una-linea.guardia (6)`.

**Los 5 rojos son «Base local compartida rompe gates ajenos», medido, no supuesto.** Los 7
tests que caen son todos del bloque «la base aplicada» de las migraciones de enums, y todos
fallan por el MISMO valor de más leído de la base:

```
- Expected      + Received
    "webhook_suscripcion_pausada",
+   "geocodificacion_caida",
```

`geocodificacion_caida` **no existe en ninguna parte de esta rama** (`grep` sobre `db/`,
`lib/`, `tests/` = 0 resultados): lo añadió `feat/401-geocodificador-avisa-y-se-recupera`
(commit `621c802b`) a la base Postgres **local, que es compartida entre worktrees**. Este diff
no toca `db/`, ni `lib/`, ni ninguno de esos 5 archivos (siguen idénticos a HEAD). La salida
documentada es mergear primero la ficha cuya migración causa el rojo; no es algo que se arregle
—ni deba arreglarse— desde el frontend de esta ficha.

## Lo que no cuadra con el spec, dicho en vez de improvisado

1. **El texto no es el literal propuesto en design §7.** La propuesta era «Sus reintentos están
   espaciados desde X por fallos de entrega sostenidos…». Se cambió por lenguaje llano por
   encargo explícito: «fallos de entrega sostenidos» le pide al dueño interpretar un fallo, y
   el mecanismo (que son *reintentos*) es problema del servidor, no suyo. El propio spec marca
   el copy como pregunta abierta 2 («si Producto quiere un texto distinto, es un cambio de
   copy, no de mecanismo»). El mecanismo no cambió.
2. **Son DOS archivos bajo `app/`, no uno.** Design §7 dice que `WebhookAccionCell.tsx` es «el
   único archivo bajo `app/` que toca este spec». El encargo pedía reutilizar el formato de
   fecha de esa pantalla en vez de traer una forma nueva, y el formato estaba encerrado dentro
   de `api-keys-columns.tsx` —que IMPORTA `WebhookAccionCell`, así que importarlo de vuelta
   habría creado un ciclo—. Se extrajo a `_components/fecha-legible.ts`, consumido por los dos.
   Es presentación pura, sin cambio de comportamiento (la columna «Fecha de creación» pinta
   exactamente lo mismo, incluido su `—`), y evita la segunda copia del formato.
3. ~~**`tasks.md` no se marca.**~~ **Resuelto en la 2ª vuelta (H-5):** las 15 casillas están
   marcadas. Mi razón original («no estrenar convención») era mala: `CHECKPOINTS.md` lo pide
   por su letra y la 393 lo lleva así (35 marcadas, 0 sin marcar).
4. ~~**El texto que se ve tiene un punto doble: «…desde el 9/9/26, 8:05 a. m..».**~~ **Resuelto
   en la 3ª vuelta, con el visto bueno de quien lleva el copy.** Se declaró sin tocarlo (el
   copy ya estaba aprobado y no me correspondía cambiarlo por mi cuenta), y una vez autorizado
   se aplicó la reordenación propuesta: `desde el ${sinExitoDesde} el destino no acepta
   ninguno.`. Ni una palabra del mensaje cambió. Lo vigila el test «PUNTUACIÓN…» (mutación M4).

**Y la lección, porque la parte que falló fue la mía:** la primera versión de esta bitácora
decía que el aviso mostraba «9/9/2026, 8:05». Nunca lo vi renderizado —lo deduje del
`dateStyle: "short"`— y estaba mal en las dos mitades: el año va con dos dígitos y la hora trae
`a. m.`. Los tests no me contradijeron porque construían la fecha con el MISMO `Intl` y la
comparaban contra sí misma: eran verdes y ciegos a la vez. Salió mirando el render de verdad al
escribir el test del formateador.
