# review_382 — el carácter que no se puede imprimir dice de qué orden es

- **Rama:** `fix/382-etiqueta-caracter-no-cubierto` · **HEAD revisado:** `c77ac23c`
- **Base:** `origin/dev` = `c76139a0` (medido durante la revisión: la rama es **exactamente un
  commit** sobre `origin/dev`, sin drift). **PR:** #725.
- **Diff:** 7 archivos, +437/−24. **Ficha `sdd: false`**: no hay `specs/382/`, así que la fuente de
  la verdad es el `status_note` de la 382 en `feature_list.json`.
- **Revisor:** reviewer. **Fecha:** 2026-09-07.

> **Veredicto: RECHAZADO — por UN bloqueante, y es documental.**
> El código está bien y no hay que tocarlo: cero bloqueantes de código, gate **completo** verde
> corrido por el revisor, y **6 mutaciones aplicadas de las que 5 murieron**. Lo que falta es
> `progress/impl_382.md`, que `CHECKPOINTS.md` exige y que además es el único sitio donde podrían
> quedar escritos los `R1`/`R2` que el código cita seis veces y que **hoy no existen en ninguna
> parte**. Se cierra escribiendo un archivo, no un parche.

---

## 1. Lo que está BIEN (verificado, no supuesto)

Esta sección existe para poder distinguir «revisado y correcto» de «no mirado».

### 1.1 Los dos mensajes que NO debían cambiar son idénticos, byte a byte

Comprobado contra `git show dev:<archivo>`, no de memoria:

- **`mensajeEtiquetaNoCabe`** (`EtiquetasGuiaModal.tsx`): la línea del literal da el **mismo md5**
  en `dev` (línea 82) y en `HEAD` (línea 86): `cd4edbb99452ec10602926333a3f152f`. Solo se movió de
  sitio al insertarse la función nueva encima.
- **`ERROR_FUENTE_ETIQUETA`** vive en `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts`, que
  **no está en el commit**: `git diff dev...HEAD` sobre ese archivo devuelve **0 líneas**. El texto
  sigue siendo «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.».

### 1.2 Tres mensajes, tres, y distinguibles

El `catch` de `handleDescargar` tiene ahora tres salidas disjuntas (`ErrorEtiquetaNoCabe` →
`ErrorCaracterNoImprimible` → resto). Las clases son disjuntas, así que el orden de las ramas no
esconde ninguna. Y **solo el de la fuente manda reintentar**: el nuevo dice literalmente
«Reintentar no lo cambia … corrige ese dato en la orden 11081885».

### 1.3 Las aserciones son literales, y lo demuestra la mutación

Era la sospecha principal del encargo, y **no se cumple**: los mensajes NO se afirman contra las
funciones que los generan. Los literales están escritos a mano en el test (`MENSAJE_CARACTER`,
`MENSAJE_FUENTE`, y el de «no cabe» pegado entero dentro del `findByText`), y
`expect(ERROR_FUENTE_ETIQUETA).toBe(MENSAJE_FUENTE)` clava la constante de producción contra una
copia independiente. Medido con mutaciones, no leído (ver §3): reescribir cualquiera de los tres
textos pone rojo.

El único sitio donde se usan las funciones generadoras es el test de **distinción**
(`new Set(tres).size === 3`), y ahí es correcto: lo que se afirma es una propiedad estructural
—que ninguno es el saco de los demás—, no la redacción.

### 1.4 `exigirCobertura` sigue negándose a imprimir

Lo único que cambió es a QUÉ lanza (`ErrorCaracterNoImprimible` en vez de `Error` pelado) y que
recibe `numGuia`. La decisión es la misma línea de antes:
`const falta = caracterNoCubierto(...); if (falta === null) return; throw …`. No se relajó ninguna
comprobación, no se añadió ninguna lista de excepciones y `seguroEnFuenteEstandar` no se tocó.
Confirmado además por la mutación **M1** (§3): forzar el `return` mata 5 tests.

### 1.5 `numGuia` obligatorio: no hay ni un valor de relleno

Los **únicos dos call sites de producción** están en `lib/pdf/etiquetas-dibujo.ts`:

- línea 309 — `exigirCobertura(fuente, texto, "texto de la etiqueta", etiqueta.numGuia)`
- línea 354 — `exigirCobertura(fuente, monto, "Monto a cobrar", etiqueta.numGuia)`

Los dos pasan el dato real. **No hay `0`, ni `-1`, ni `??`, ni `!`**, ni un cast. Y no podría
haberlo por accidente: en `lib/types/etiqueta-guia.ts:16`, `numGuia: number` es obligatorio y está
comentado como «garantizado: solo ordenes con guia (R2)», así que no hay `null` que tapar.

Los otros tres call sites son de test (`1042`, `1042`, `11081885`) y ahí el literal es el dato del
caso.

### 1.6 El comentario que justificaba unirlos está sustituido por el motivo de separarlos

No solo se borró el viejo: se cita textualmente para enterrarlo. En `EtiquetasGuiaModal.tsx:284-301`
está el razonamiento antiguo entrecomillado («los dos significan lo mismo para quien está
delante…») marcado como «el defecto que la 382 cierra, y NO se vuelve a juntar», con el porqué en
dos viñetas: la fuente es **red o bundle** y reintentar puede funcionar; el carácter es **un dato**
y reintentar no va a funcionar nunca. El mismo argumento está en el docstring de la clase
(`etiquetas-fuente-registro.ts:118-136`) y en el de la función del mensaje.

### 1.7 Tests: sin auto-aprobación, y con control positivo de verdad

- **Cero `if (!x) return;`** en el test nuevo. El helper hace lo contrario de auto-aprobarse:
  `errorAlDibujar` **lanza** si `drawEtiqueta` no lanzó («el caracter se habria impreso roto»).
- **Control positivo presente y con sentido**: `dibujar(dto({ destinatario: "orfirio" }))` no lanza.
  Y está bien elegido — «orfirio» tiene los **mismos 7 caracteres** que el nombre double-struck, así
  que también descarta que lo que rompa sea el largo (la ruta de «no cabe») en vez del alfabeto.
- No se añadió ni un `.only`, `.skip` o `.todo` (grep sobre el diff de `tests/`).
- El caso de producción se dibuja **de verdad**: `drawEtiqueta` real y `fuenteEtiqueta` real, nada
  mockeado. Cubre destinatario **y** dirección (los dos campos de la orden real) y afirma que la
  guía que viaja es la de **la orden culpable**, no una fija.

### 1.8 Ninguna normalización de caracteres — estaba fuera de alcance

Buscando `normaliz`, `NFKD`, `NFKC` y `.normalize(` sobre `git diff dev...HEAD`: **cero
coincidencias**. La decisión abierta del `status_note` («si Ordenex debe NORMALIZAR estos caracteres
al entrar») sigue abierta y sin código que la prejuzgue.

### 1.9 El error tipado no se re-envuelve en ningún punto del camino

Se leyeron los tres eslabones entre el generador y la pantalla: `etiquetas-pdf.ts`
(`buildEtiquetasPdf`, `descargarEtiquetasPdf`) **no tiene un solo `catch`**, y
`lib/pdf/etiquetas-pdf-lote.ts` tampoco. Así que el `instanceof` del modal no puede fallar por un
`Error` genérico intermedio. Del lado servidor, el borde de la API sigue publicando `error.message`
— que ahora **también** lleva la guía, o sea que el canal best-effort de la carga por API mejora
gratis.

### 1.10 Consistencia con el precedente, y `instanceof` que funciona

`ErrorCaracterNoImprimible` es calcada de `ErrorEtiquetaNoCabe` (campos `readonly` en el
constructor, `this.name`, mensaje técnico completo). `tsconfig.json` tiene `target: ES2017`, así
que la subclase de `Error` conserva su prototipo y el `instanceof` del modal es fiable — no es el
caso roto de ES5. `notacionCodePoint` es la **única** fuente de la notación `U+XXXX` y la usan tanto
el mensaje técnico como el de pantalla.

### 1.11 Calidad y seguridad

- **Sin base de datos, sin migraciones, sin RLS que revisar, sin webhooks**: el diff no toca `db/`,
  ni Prisma, ni rutas de API. No aplica.
- **Sin secretos** y **sin hardcode de contexto**: no entra país, moneda ni cuenta; el mensaje no
  depende de configuración regional y `notacionCodePoint` es genérica.
- **Capas**: `app/` importa de `lib/`, nunca al revés. `lib/pdf/` sigue sin conocer React ni HTTP.
- **Convenciones**: nombres, `kebab-case` del archivo nuevo de test, mensaje de commit
  `fix(382): …`, un solo commit para un cambio lógico. `strict` sin `any` añadido.

---

## 2. Verificación ejecutable — corrida por el revisor

`./init.sh` **COMPLETO**, con el exit code escrito **dentro** del log:

```
Test Files  1770 passed (1770)
     Tests  25274 passed | 26 skipped (25300)
  Duration  653.12 s
tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1770 ejecutado(s))
DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan
.env presente
== init OK ==
INIT_EXIT=0
```

Notas sobre por qué este verde significa algo:

- **Reproduce exactamente** los números de la bitácora del implementador (1770 / 25274 / 26), lo que
  descarta que aquel verde fuera de otro árbol o de otra medida.
- Los **26 `skipped` son ajenos y preexistentes**: 17 de `tests/components/AnaliticaPage.test.tsx` y
  9 de `tests/components/AnaliticaShell.test.tsx`. Ninguno de esos dos archivos está en el diff.
- **La integración SÍ corrió**: 132 archivos contra Postgres ejecutados, no saltados. Es la trampa
  de «gate sin `.env`» y aquí no se dio.
- El veredicto lo da `comparar-baseline-rojos.mjs` contra `tests/baseline-rojos.json`, y ese archivo
  tiene hoy la lista de archivos **vacía**: no hay ningún rojo tapado, cualquier archivo rojo habría
  puesto el gate en rojo.
- **Cero flakes**: no hubo que repetir nada, ni apareció el `Test timed out in 20000ms` de los
  barredores pese a haber otro agente trabajando en paralelo.

Antes del gate se corrieron aparte los tres archivos afectados: **3 passed, 46 tests, 9,67 s**.

---

## 3. Mutaciones — 6 aplicadas, 5 muertas

Cada mutación se aplicó al árbol real, se comprobó que el archivo quedaba modificado
(`git diff --stat`) y se corrió la suite relevante; después se restauró con `git checkout --` y se
verificó que `git diff HEAD` queda **vacío** (el árbol final coincide con `c77ac23c`).

| # | Mutación | Resultado |
| --- | --- | --- |
| **M1** | `exigirCobertura`: `if (falta === null) return;` pasa a `if (true) return;` (deja de negarse) | **MUERTA** — 5 tests rojos en 2 archivos |
| **M2** | `mensajeCaracterNoImprimible`: cambiar «Reintentar no lo cambia…» por «Inténtalo de nuevo» | **MUERTA** — 2 rojos: `382 (a)` y el de los tres mensajes distintos |
| **M3** | Modal: anular la rama `if (error instanceof ErrorCaracterNoImprimible)` (reintroduce el defecto) | **MUERTA** — 1 rojo: `382 (a)` |
| **M4** | Call site «texto de la etiqueta»: `etiqueta.numGuia` pasa a `0` (guía de relleno) | **MUERTA** — 3 rojos, incluido «la guia que viaja es la de la ORDEN CULPABLE» |
| **M5** | `ERROR_FUENTE_ETIQUETA`: reescribir la constante | **MUERTA** — 3 rojos: `(b)`, `(b bis)` y el de distinción |
| **M6** | `mensajeEtiquetaNoCabe`: reescribir el literal | **MUERTA** — 1 rojo: `382 (c)` |
| **M4b** | Call site **«Monto a cobrar»**: `etiqueta.numGuia` pasa a `0` | **SOBREVIVE** — 268 tests verdes en 13 archivos → hallazgo `menor 2` |

M3 es la que importa: es literalmente la regresión que esta ficha viene a cerrar, y el test la caza.

---

## 4. Checklist

### CHECKPOINTS.md, punto por punto

**Especificación** — `sdd: false`, decisión ya registrada en la ficha. No aplica.
- [n/a] `specs/382/requirements.md`
- [n/a] `specs/382/design.md`
- [n/a] `specs/382/tasks.md` — no hay `tasks.md`, luego no hay tasks sin marcar

**Trazabilidad**
- [~] Cada requisito mapea a un test. **El comportamiento está cubierto** (mapa en §5), pero los
  identificadores `R1`/`R2` que el código cita no están escritos en ningún sitio → `BLOQUEANTE 1`.
- [ ] `progress/impl_382.md` con el mapa `R<n> -> test` — **NO EXISTE** → `BLOQUEANTE 1`.

**Calidad de código**
- [x] `pnpm run typecheck` — verde dentro del gate.
- [x] `pnpm run lint` — verde dentro del gate.
- [x] `pnpm test` — 1770/1770, 25274 passed.
- [n/a] E2E para flujo crítico. La etiqueta lleva el importe a cobrar, así que el checkpoint aplica
  por tema; **no hay harness E2E ejecutable en este repo** (los specs existentes dicen «NOT
  EXECUTED»). El riesgo se cubre por otra vía y mejor: `etiquetas-caracter-no-cubierto.test.ts`
  dibuja con el `drawEtiqueta` y la fuente **reales**, sin mocks, que es donde vive la decisión.

**Datos y seguridad (Supabase)**
- [n/a] RLS — ninguna tabla nueva; el diff no toca `db/`.
- [n/a] Migraciones — ninguna. (El gate avisa de 3 migraciones sin `down.sql`; son de agosto y
  ajenas a esta ficha.)
- [x] Sin secretos hardcodeados.
- [n/a] Webhooks.

**Patrón de capas**
- [x] Nada de queries en el componente; `lib/pdf/` sigue puro y sin HTTP.
- [n/a] Controller / Service / Repository — la ficha no los toca.
- [n/a] `lib/interfaces/`.

**Permisos** — [n/a]: no hay página, ruta ni acción nueva.

**Multi-país / configuración** — [x] sin país, moneda ni cuenta incrustados.

**Verificación final**
- [x] `./init.sh` completo en verde, corrido por el revisor.
- [x] `progress/review_382.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` — **falta** → `menor 1`.

### Lo que pidió el encargo, uno a uno

1. [x] Tres mensajes, distinguibles; los dos que no cambian, idénticos byte a byte (§1.1, §1.2).
2. [x] Aserciones literales, no contra su propia fuente — demostrado con M2/M5/M6 (§1.3, §3).
3. [x] `exigirCobertura` no se relajó — demostrado con M1 (§1.4).
4. [x] Ningún call site con valor de relleno (§1.5). Con la reserva de `menor 2`.
5. [x] El comentario nuevo explica el porqué de separarlos, no solo borra el viejo (§1.6).
6. [x] Sin tests auto-aprobados; control positivo presente y bien elegido (§1.7).
7. [x] No se coló normalización de entrada (§1.8).

---

## 5. Mapa comportamiento -> test

Los `R1`/`R2` de abajo son **mi lectura** del alcance escrito en el `status_note`; no están escritos
en ningún archivo, y eso es el bloqueante.

| Comportamiento | Test |
| --- | --- |
| **R1** — el fallo de cobertura se distingue del de la fuente | `EtiquetasGuiaModal.test.tsx`: `382 (a)`, `382 (b)`, `382 (b bis)`, «los tres mensajes son DISTINTOS» |
| **R1** — `ErrorEtiquetaNoCabe` conserva su camino y su texto | `EtiquetasGuiaModal.test.tsx`: `382 (c)` |
| **R2** — el mensaje nombra la guía, el carácter y su code point | `EtiquetasGuiaModal.test.tsx`: `382 (a)` |
| **R2** — y NO manda reintentar | `382 (a)` (niega «inténtalo de nuevo») más el test de distinción |
| El error transporta guía / carácter / code point / campo | `etiquetas-fuente.test.ts`: «382 — el error es tipado y trae la guia…» |
| La guía es la de la **orden culpable** | `etiquetas-caracter-no-cubierto.test.ts`: «…no la primera del lote» |
| El caso real de producción (double-struck en destinatario y en dirección) | `etiquetas-caracter-no-cubierto.test.ts`: tests 1 y 2 |
| Control positivo: el mismo dato en letras normales no lanza | `etiquetas-caracter-no-cubierto.test.ts`: test 4 |
| R28 sigue vivo: no se descarga en silencio | `EtiquetasGuiaModal.test.tsx:568` más `carga-api-etiquetas.test.ts` (canal best-effort) |

---

## 6. Hallazgos

### `BLOQUEANTE 1` — no existe `progress/impl_382.md`, y con él faltan los `R1`/`R2`

`CHECKPOINTS.md:13` lo exige con el mapa `R<n> -> test`, y `docs/verification.md` («Qué cuenta como
evidencia») pide ahí la salida real de los tests. El archivo **no está** — ni commiteado ni suelto
en el disco (`git status` solo muestra `design-etiquetas/`, que no es de esta ficha).

No es un trámite. El código cita **`Feature 382 (R1/R2)`** en seis sitios
(`EtiquetasGuiaModal.tsx`, `etiquetas-fuente-registro.ts`, los dos archivos de test) y **R1 y R2 no
están definidos en ninguna parte**: no hay `specs/382/`, la ficha es `sdd: false` y el `status_note`
describe el alcance en prosa sin numerarlo. Dentro de tres meses, «R2» no se puede resolver.

**Qué falta para cumplirlo:** escribir `progress/impl_382.md` con (a) `R1` y `R2` enunciados tal y
como el código los usa, (b) el mapa de §5 y (c) la salida del gate. Es un archivo; **no hay que
tocar código ni tests**.

### `menor 1` — sin entrada en `progress/history.md`

`CHECKPOINTS.md:46`. Suele escribirse al cerrar, así que puede ir en el mismo commit del cierre.

### `menor 2` — el call site del **importe** puede recibir una guía de relleno sin que nada se entere

Mutación **M4b**: cambiar `exigirCobertura(fuente, monto, "Monto a cobrar", etiqueta.numGuia)` por
esa misma llamada con un `0` deja **268 tests verdes en 13 archivos**. Hoy el código es correcto
—pasa el dato real— y por eso esto es `menor` y no bloqueante; pero es **la línea del dinero** y la
única de las dos que no está clavada. El gemelo («texto de la etiqueta») sí lo está: M4 lo mata con
3 rojos.

Que sea difícil de disparar en la práctica (el texto del importe sale de `formatMonto`, o sea
dígitos, separadores y el símbolo configurado) es justo lo que hace que, si alguien rompe esa línea
al refactorizar, no se entere nadie.

**Cierre sugerido:** un caso que dibuje una etiqueta cuyo importe traiga un carácter fuera del
subconjunto y afirme `error.numGuia`. Una prueba, en el archivo que ya existe.

### `menor 3` — el test R28 preexistente perdió su aserción de mensaje

En `EtiquetasGuiaModal.test.tsx:598`, `findByText(ERROR_FUENTE_ETIQUETA)` pasó a
`findByRole("alert")`. Era inevitable —ese error ya no produce ese texto— y el comentario lo explica
y remite al bloque nuevo. Medido: bajo la mutación **M3** ese test **no se pone rojo**, o sea que
hoy solo prueba «algo se anuncia». La cobertura neta no baja porque `382 (a)` afirma el texto
exacto; se deja anotado para que nadie lo lea como una red que ya no es.

### `menor 4` — el carácter culpable se pinta crudo dentro del aviso

El mensaje interpola el carácter tal cual entre comillas angulares. Casi siempre es lo correcto —es
lo que permite reconocer el sosia de una letra normal—, pero el conjunto «no cubierto» es todo lo
que queda fuera de cp1252 más el colón, y ahí entran cosas que no son glifos: `U+202E`
(RIGHT-TO-LEFT OVERRIDE) invertiría el orden de lo que va detrás en el propio aviso —incluida la
guía— y un `U+200B` se vería como unas comillas vacías. Es alcanzable: `seguroEnFuenteEstandar` solo
deja pasar `0x20`–`0x7E` y `0xA0`–`0xFF`, así que un control de esos llega a `exigirCobertura`.

**No deja al operador sin salida**, y eso es mérito del diseño: la notación `U+XXXX` va al lado y
sigue siendo legible pase lo que pase. Cerrarlo del todo sería envolver el carácter en un aislante
bidi, o mostrar solo la notación cuando el code point no es imprimible.

### `menor 5` (observación) — el `campo` viaja en el error pero no llega a la pantalla

`ErrorCaracterNoImprimible` lleva `campo`, y el mensaje de usuario no lo usa. Está bien decidido:
para todo lo que no es el importe, `campo` vale «texto de la etiqueta», que no le dice al operador
dónde mirar. Se anota para que no se «descubra» como un olvido: con el carácter a la vista, se
encuentra buscándolo. Está fuera del alcance de la ficha (guía más carácter).

### `menor 6` (observación) — el índice del grafo está rancio en esta zona

`trace_path` sobre `exigirCobertura` devuelve como llamador `camposDeEtiqueta`, y **ese símbolo no
existe** en `lib/pdf/etiquetas-dibujo.ts`; los números de línea del índice van unas 80 líneas
desfasados. Es el modo de fallo conocido —devolver de más—. Todo lo afirmado en este informe está
confirmado contra los archivos reales. Conviene reindexar antes de la próxima consulta sobre
`lib/pdf/`.

---

## 7. Veredicto

**RECHAZADO**, por el `BLOQUEANTE 1` y solo por él.

Dicho sin ambigüedad, porque la distinción importa:

- **El código está aprobado.** Hace exactamente lo que el `status_note` pedía —distinguir el fallo,
  nombrar la guía y el carácter, y decir que hay que corregir el dato en vez de reintentar—, no se
  pasa de ahí, no relaja ninguna comprobación, no se lleva por delante los otros dos mensajes y no
  cuela la normalización que estaba fuera de alcance. Las pruebas no son decorativas: cinco
  mutaciones de seis mueren, incluida la que reintroduce el defecto original.
- **Lo que bloquea es la bitácora**, `progress/impl_382.md`, con `R1`/`R2` enunciados y el mapa a
  sus tests. Vuelve al implementador solo para eso.
- Con ese archivo escrito (y la línea de `history.md` al cerrar), la 382 pasa a `done` sin más
  revisión de código. `menor 2` merece las tres líneas de test que pide; es la ruta del importe.
