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

---

## 8. Re-revisión del cierre — 2026-09-07 (segunda pasada)

Se revisa **solo lo nuevo**: `35b6c0f2` («docs(382): la bitacora que faltaba, y la linea del dinero
clavada»), un commit sobre el informe `81390410`, con 5 archivos (+338/−15). El código de
`c77ac23c` ya revisado arriba **no se toca**, salvo una función nueva de 3 líneas en el modal.
La rama queda: `origin/dev` → `c77ac23c` → `81390410` → `35b6c0f2`.

### 8.1 El bloqueante — CERRADO

`progress/impl_382.md` existe (171 líneas) y enuncia **R1** y **R2**.

**Enuncian lo que el código hace, no lo que suena bien.** Contrastado línea a línea:

- **R1** («el error sabe de qué orden es»): pide abortar sin emitir PDF y lanzar un error **tipado**
  con guía, carácter, code point y campo, y dice explícitamente que aplica a las **dos** llamadas de
  `drawEtiqueta`, importe incluido. Es exactamente lo que hace `exigirCobertura` y lo que llevan las
  dos líneas 309 y 354 de `etiquetas-dibujo.ts`. *Omisión menor:* el error también carga
  `fuenteNombre`, que R1 no lista. No cambia nada de lo que se afirma.
- **R2** («el aviso dice qué orden, qué carácter y qué hacer»): las cuatro cláusulas (a·b·c·d) más
  «los otros dos conservan su mensaje» y «los tres distinguibles» describen el `catch` tal y como
  está. La (d) —no mandar reintentar— viene con su porqué, que es el argumento de la ficha.
- Se declara explícitamente que R28 (282) y R7 (350) siguen vigentes y sin tocar. Correcto.

**El mapa `R → test` se sostiene, comprobado test por test.** No me fié de la tabla: enumeré los
`it(` reales de los tres archivos y **los 13 nombres citados existen con ese nombre exacto** en
`etiquetas-caracter-no-cubierto.test.ts` (7), `etiquetas-fuente.test.ts` (3) y
`EtiquetasGuiaModal.test.tsx` (8 del bloque 382 + el R28 preexistente). Los tres archivos corren y
pasan: **51 tests** (eran 46 antes de esta entrega — los **+5** que la bitácora declara).

*Pega menor de la tabla:* la fila «R1 (control positivo)» cita, entre otros, el test llamado
`382 (control negativo)` de `etiquetas-fuente.test.ts`. El test existe y es el correcto; lo que
baila es la etiqueta de la fila.

### 8.2 `menor 2`, la línea del dinero — CERRADO, y con el número medido

**Apliqué yo la mutación**, la misma de la primera pasada y sobre el mismo alcance de 13 archivos:

```
exigirCobertura(fuente, monto, "Monto a cobrar", etiqueta.numGuia)  ->  ..., 0)
```

| | Antes (`c77ac23c`) | Ahora (`35b6c0f2`) |
| --- | --- | --- |
| Resultado | **SOBREVIVE** — 268 passed, 0 failed | **MUERTA** — 271 passed, **2 failed** |

Los 2 rojos son «el simbolo de moneda fuera del subconjunto lanza desde el campo del IMPORTE» y «y
la guia que viaja cambia con la orden». **El número que pidió el coordinador: 2.**

**Y lo consigue sin tocar producción**, como declaró: el caso declara una cobertura estrecha
(`cobertura: [[0x20, 0x7e]]`) sobre los **mismos bytes de fuente reales** —`registrarFuente` sigue
recibiendo `fuenteEtiqueta`—, así que lo que cambia es la **declaración** que `cubreCodePoint` lee,
que es justo el escenario que R28 vigila (un despliegue cuyo símbolo de moneda no está en el
subconjunto). No hay mocks.

**Y las dos llamadas quedan pinchadas por separado**, que es lo que hace que el test valga: medido,
mutar el call site del **texto** da 3 rojos y **los del importe siguen verdes**; mutar el del
**importe** da 2 rojos y los del texto siguen verdes. La aserción `campo === "Monto a cobrar"` es lo
que produce esa discriminación, y funciona.

El **control positivo** («con la cobertura REAL, ese mismo importe se dibuja sin lanzar») descarta
que los dos de arriba estén verdes porque el dibujo lance por cualquier otro motivo.

### 8.3 `menor 3`, la red del test R28 — CERRADO

El test preexistente ya no se conforma con «se anuncia algo»: añade `toContain("U+20BF")` y
`queryByText(ERROR_FUENTE_ETIQUETA)).toBeNull()`.

Medido con la mutación que anula la rama del `catch` (la **M3** de la primera pasada):

| | Antes | Ahora |
| --- | --- | --- |
| Rojos | 1 (`382 (a)`) | **2** — `382 (a)` **y** «R28: un caracter fuera del subconjunto tampoco se descarga en silencio» |

Es el 2 que se pedía. *Nota sin consecuencia:* de las tres aserciones nuevas, la que hace el trabajo
bajo esta mutación es `U+20BF` junto al `toBeNull()`; el `toContain("11")` es débil por sí solo.

### 8.4 `menor 4`, el aislante bidi — CERRADO, con el residual escrito

- **Está en la ruta que pinta el aviso, no solo en una función pura.** `aislado()` se aplica dentro
  de `mensajeCaracterNoImprimible`, que es lo que el `catch` mete en `setErrorDescarga`. Lo confirma
  la mutación, no la lectura: sustituir el cuerpo por `return caracter` da **2 rojos**, y uno de
  ellos es `382 (a)`, que afirma sobre el **DOM renderizado** (`findByText`), no sobre la función.
  El otro es el caso nuevo del `U+202E`, cuyo esperado es un literal escrito a mano con los
  aislantes dentro.
- **Escapados de verdad, en los tres sitios.** Verificado leyendo los bytes: **cero caracteres
  invisibles crudos** (`U+2068`, `U+2069`, `U+202E`, `U+200B`) en el componente, en los dos archivos
  de test, en `impl_382.md` y en `history.md`. Todos van como `\u2068` o como notación. El único
  no-ASCII crudo que queda es el «𝕠», que es visible a propósito.
- **El residual está escrito** en los dos sitios que importan: en el docstring de `aislado()` («Lo
  que NO cierra… `U+200B` se sigue viendo como unas comillas vacías») y en `impl_382.md` §«Lo que
  queda vivo» punto 2, con su porqué (pintar solo la notación quitaría el reconocimiento visual del
  sosia de una letra, que es el caso común). Y tiene **su propio test**, que afirma que la notación
  `U+XXXX` sigue ahí cuando el carácter no se ve.

### 8.5 La declaración sobre los `.md` escritos después del gate

El implementador declaró que escribió `impl_382.md` y `history.md` **después** del gate y que ningún
test los lee. **Lo verifiqué, y el veredicto es: la conclusión es correcta, el motivo no del todo.**

- **Sí hay una guardia que escanea `progress/`**: `tests/unit/analytics/catalogo-produccion.guardia.test.ts:405`
  hace `readdirSync(progress)`. Lo que la salva es el **filtro**: `/^decision.*\.md$/`. Ni
  `impl_382.md` ni `history.md` casan.
- Otras tres guardias leen bitácoras, pero **por nombre fijo**: `impl_180.md`, `impl_127.md` e
  `impl_186.md`. Ninguna es la nuestra.
- `init.sh` **no** toca `progress/` (sus únicas coincidencias con «progress» son `in_progress` de la
  regla de cupo). `tsconfig.json` incluye solo `**/*.ts(x)`, y `eslint.config.mjs` no tiene
  procesador de markdown. Así que typecheck y lint tampoco.

O sea: la regla que de verdad protege es **«ningún fichero `progress/decision_*.md` nuevo puede
escribirse después del gate»**, no «los `.md` no los lee nadie». Queda escrito aquí porque el
próximo que añada un `decision_XXX.md` tras correr el gate se apoyaría en la frase equivocada.

**Y en cualquier caso queda medido, no razonado:** mi corrida del gate (§8.6) es **posterior** a los
dos `.md` y los tenía en disco.

### 8.6 Gate del cierre — corrido por el revisor

`./init.sh` **completo**, sobre `35b6c0f2` y con los dos `.md` ya en disco:

```
Test Files  1770 passed (1770)
     Tests  25279 passed | 26 skipped (25305)
  Duration  845.20 s
tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1770 ejecutado(s))
DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan
.env presente
== init OK ==
INIT_EXIT=0
```

- Reproduce **exactamente** los números que declaró el implementador (1770 / 25 279 / 26).
- Los 26 `skipped` siguen siendo los mismos y ajenos: **17** en `AnaliticaPage.test.tsx`, **9** en
  `AnaliticaShell.test.tsx`. Ninguno de los dos está en el diff.
- **+5 tests** sobre mi corrida de la primera pasada (25 274), que son exactamente los cinco casos
  nuevos: 3 del importe, 2 del aislante y la notación.
- Sin flakes: ni un `Test timed out`, ni una repetición.

### 8.7 Mutaciones de esta segunda pasada — 4 aplicadas, 4 muertas

Aplicadas al árbol real, verificadas con `git diff --stat`, revertidas con `git checkout --`, y con
`git diff HEAD` **vacío** al terminar (el árbol coincide con `35b6c0f2`).

| # | Mutación | Antes (`c77ac23c`) | Ahora |
| --- | --- | --- | --- |
| M4b | `0` como guía en el call site del **importe** | SOBREVIVE (268 verdes) | **MUERTA — 2 rojos** |
| M3 | anular la rama `instanceof ErrorCaracterNoImprimible` del `catch` | MUERTA — 1 rojo | **MUERTA — 2 rojos** (entra el R28 preexistente) |
| M-bidi | `aislado()` devuelve el carácter sin envolver | (no existía) | **MUERTA — 2 rojos**, uno sobre el DOM renderizado |
| M4 | `0` como guía en el call site del **texto** | MUERTA — 3 rojos | **MUERTA — 3 rojos**, y los del importe **siguen verdes** (discriminación) |

### 8.8 Hallazgos de esta pasada

Ninguno bloqueante. Los cuatro de la primera pasada que quedaban abiertos —`menor 1`, `menor 2`,
`menor 3` y `menor 4`— están cerrados y medidos.

### `menor 7` — el test del importe queda atado a `MONEDA_SIMBOLO`

`expect(error.caracter).toBe("₡")` y `toBe(0x20a1)` fijan el símbolo **por defecto** de
`monedaConfig` (`lib/config/moneda.ts:78`, `readNonEmpty("MONEDA_SIMBOLO", "₡")`). En un entorno que
exporte `MONEDA_SIMBOLO=$`, el símbolo pasa a ser ASCII, la cobertura estrecha lo cubriría y el test
fallaría con «drawEtiqueta no lanzo» — por una razón que no tiene nada que ver con lo que vigila.

**No es un defecto de hoy** y el literal está bien elegido: la alternativa —compararlo contra
`monedaConfig.simbolo`— sería la aserción-contra-su-propia-fuente que este repo tiene medida como
siempre verde, y el comentario del test lo dice. Las dos aserciones que sostienen la ficha
(`campo` y `numGuia`) **no** están acopladas. Si algún día se configura otra moneda, la forma de
cerrarlo es elegir el carácter no cubierto desde un campo de texto y dejar el importe con `campo`.

### `menor 8` (observación) — la frase sobre los `.md` es más ancha que la regla real

Ver §8.5. La declaración lleva a la conclusión correcta por un camino que no se sostiene tal cual
está escrito; queda aquí el enunciado preciso.

### Heredados, sin cambios

- `menor 5` (el `campo` no se pinta): sigue siendo la decisión correcta y ahora está **justificada
  por escrito** en `impl_382.md` §Decisiones 2, y además es lo que clava la línea del dinero.
- `menor 6` (índice del grafo rancio en `lib/pdf/`): el implementador lo heredó y lo dejó anotado.
  Sigue vivo; conviene reindexar.

### Lo que la bitácora declara abierto, y hace bien en declararlo

`impl_382.md` §«Lo que queda vivo» deja cuatro cosas escritas en vez de esconderlas: la decisión de
**normalizar** (sin firma del humano, sin código, con opinión razonada y su contraargumento), el
residual del `U+200B`, que **la orden 11081885 sigue rota en producción** hasta que se corrija su
dato, y que **nadie ha visto el aviso en la app real**. Ese último es el pendiente de verdad: 28
casos en jsdom no son una pantalla, y en este repo eso está medido.

### 8.9 Veredicto de la re-revisión

**APROBADA.** Cero bloqueantes vivos.

- El bloqueante documental está cerrado con un `impl_382.md` que **no es de trámite**: enuncia R1 y
  R2 en términos verificables, y su mapa resiste abrir los tests uno por uno.
- El `menor 2` no se cerró con una promesa sino con dos casos que **matan la mutación que yo medí
  viva**, y que además demuestran de qué llamada salió el error. De 268 verdes a 2 rojos.
- El `menor 3` y el `menor 4` están cerrados con mutación propia, y el `menor 4` con el residual
  escrito en vez de disimulado.
- Gate completo verde corrido por el revisor, con los `.md` en disco.

Queda como **reserva no bloqueante para el cierre de la ficha**: nadie ha visto el aviso en la
pantalla real, y la orden 11081885 sigue rota en producción hasta que alguien corrija su dato.
