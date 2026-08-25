# Feature 283 — Revisión

> Revisor: agente reviewer. Fecha: 2026-08-25. Rama `feature/283-quitador-comentarios`
> (`3da8ad9b`), 7 commits sobre `origin/dev` (`ce22a621`).
>
> **Todo lo que sigue lo he ejecutado yo.** No he heredado un solo número de `progress/impl_283.md`
> ni del leader: cada cifra de este informe sale de una corrida propia, y donde reproduce la del
> implementer se dice que reproduce.

## VEREDICTO: RECHAZADO — 2 bloqueantes

Los dos son baratos y ninguno toca el escáner: uno es un caso de prueba que no discrimina, el otro
es la casilla de `tasks.md`. **El arreglo en sí está bien hecho y está medido**: reproduce el censo,
reproduce la salida roja de T1.1, reproduce las mutaciones, y el gate no mueve un solo rojo.

---

## 1. El gate, corrido por mí

`pnpm run db:generate` primero, y después `./init.sh` COMPLETO (no `--rapido`), con el código de
salida escrito DENTRO del log y sin canalizarlo por `tail`. 16:01:22 → 16:10:55 (9 min 33 s).

```
✓ typecheck paso
✓ lint paso                      (100 problems, 0 errors, 100 warnings)
 Test Files  1 failed | 1391 passed (1392)
      Tests  1 failed | 18958 passed | 26 skipped (18985)
INIT_EXIT=1
```

El único rojo de las 18.985 pruebas es el AJENO, y sale con nombre:

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene superficie...
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
```

Un array de UN elemento, el de la ficha 275 (`pending`, otra sesión). **Delta contra el baseline
declarado: 0.** `lib/actions/tarifas.ts` no está en el diff y ninguna guardia distinta de la del
quitador aparece en él. R28 y R29 se cumplen.

## 2. El censo: quién tenía razón

Re-medido con dos árboles distintos, para no confundir «el árbol de hoy» con «el árbol de antes de
la ficha». El de antes lo saqué con `git archive origin/dev` a un directorio aparte, no leyendo el
working tree.

| medida | árbol PRÍSTINO (`origin/dev`) | árbol de HEAD | el implementer | el leader |
| --- | --- | --- | --- | --- |
| archivos `.ts`/`.tsx` analizados | 2.696 | 2.697 | 2.697 | 2.698 |
| archivos que pierden código | **64** | 65 | **64** | 149 |
| líneas de código invisibles | **1.387** | 1.509 | **1.387** | 1.958 |

**Tiene razón el implementer, y por un margen que no admite discusión: mi censo sobre el árbol
prístino da 64 archivos y 1.387 líneas, la cifra exacta que él escribió**, y los diez peores salen
en el mismo orden y con la misma cifra (386, 167, 82, 68, 49, 40, 38, 36, 36, 35). El 149 / 1.958
del leader no se reproduce por ningún lado.

Los 122 de diferencia entre los dos árboles son de UN archivo: `quitador-comentarios.guardia.test.ts`,
que es el que la propia ficha escribió (cita `/*` dentro de comentarios y de cadenas para explicar
el defecto). 1.509 menos 122 = 1.387, y 65 menos 1 = 64. O sea que las dos medidas son la misma.

**Las anclas coinciden exactas**, que era la comprobación fuerte que `tasks.md` puso para saber si
el censo mide lo que cree:

- `cotizacion-orden-service.test.ts`: **386** líneas invisibles, primera **244**, última **746** — o
  sea abre en la **243** (`next/*` dentro de una cadena) y el bloque fantasma cierra en el cierre de
  bloque de la **752**.
- `novedad-acciones-sin-maqueta.guardia.test.ts`: **167** líneas, última invisible **542**, cierra en
  la **543**. (El spec heredaba «166»; son 167, como midió el implementer.)

### La hipótesis del implementer, reproducida

Ofrecía una explicación falsable: bajo la mutación (b) —el escáner SIN la regla de la comilla sin
pareja— el censo se dispara. La corrí:

| | recuperadas | archivos |
| --- | --- | --- |
| escáner tal cual se commitea | **1.788** | **126** |
| escáner sin la regla de R13 (mutación b) | **5.190** | **202** |
| lo que el leader había dado | 4.599 | 152 |

**Reproducido al dígito** (1.788/126 y 5.190/202 son exactamente sus números; mi métrica de
«recuperada» la definí antes de leer la suya y coincide). La hipótesis se sostiene: un prototipo sin
esa regla deja de quitar miles de comentarios de verdad y los cuenta como código recuperado. El
número del leader es de ese orden, no del orden del bueno.

## 3. La prueba de que el arreglo sirve (T1.1), reproducida

La suite verde no prueba nada aquí (ya estaba verde con el defecto dentro), así que lo único que
demuestra el arreglo es la salida ROJA contra el quitador viejo. La reconstruí en vez de creerla:
`tests/fixtures/sin-comentarios.ts` restaurado a la versión de `origin/dev` (el quitador de la 209,
comprobado por hash de blob) y el archivo de guardia reconstruido como estaba en T1.1: los 32 casos
de `dev` más los 4 del bloque «283 — el defecto» de HEAD.

```
❯ tests/unit/guards/quitador-comentarios.guardia.test.ts (36 tests | 3 failed)
    × R7 un /* dentro de un comentario de LINEA ya no abre bloque
    × R8 un /* dentro de una CADENA ya no abre bloque
    × R9 un // dentro de una CADENA ya no se lleva el resto de la linea
     Tests  3 failed | 33 passed (36)
```

**Idéntico a lo que dice la bitácora**, hasta el recuento. Y miré qué aserción cae: las tres caen del
lado de `quitarComentarios`, no del de `quitadorViejo` —los valores recibidos son el fuente ya
comido: «(saltos) const tambienVive = 2;», «it("el service no conoce HTTP...» y
«if (!redirectParam.startsWith(" »—, o sea que el caso reproduce el defecto y no otra cosa. El caso
4 (R10, la no-regresión de las URLs) sale verde entero, como debe.

## 4. Las 5 «pérdidas» del censo de monotonía, confirmadas una por una

Mi censo sobre HEAD encuentra **exactamente las mismas 5 líneas**, con el mismo residuo del viejo.
Fui al fuente de cada una:

| ruta:línea | el ORIGINAL empieza por | lo que dejaba el viejo | ¿es código? |
| --- | --- | --- | --- |
| `app/(app)/analitica/page.tsx:347` | `//` (bloque JSX comentado a mano) | una llave de cierre | no |
| `quitador-comentarios.guardia.test.ts:308` | `//` | «. La linea real del» | no |
| `quitador-comentarios.guardia.test.ts:342` | `//` | «de un docstring.» | no |
| `superficie-de-uso.guardia.test.ts:40` | `//` | una comilla invertida suelta | no |
| `test-citado-desaparecido.guardia.test.ts:40` | `//` | «tasks.md + specs» | no |

**Las cinco son líneas de comentario de barra-barra completas**, leídas en el archivo, no
clasificadas de oídas. Lo que el viejo «conservaba» es el trozo de esa misma prosa que quedaba
detrás del cierre de bloque con el que él mismo cerraba un bloque fantasma. El barrido nuevo no
pierde código: **termina de quitar un comentario que el viejo dejaba a medias**. Sobre el árbol
prístino son 3, no 5 —también lo comprobé, y las dos que faltan son prosa que la ficha escribió hoy,
tal como dice la bitácora—. Líneas de código perdidas: **0**. Archivos desalineados: **0** de 2.697.
R15 y R4 se cumplen sobre el árbol entero.

## 5. Las mutaciones: qué muerde y qué no

Corridas por mí, una a una, sobre HEAD limpio, revirtiendo y **comprobando el hash del blob** después
de cada una. No basta con que `git checkout` no proteste: la primera vez me dejó el índice con la
versión de `dev` dentro y una corrida salió contaminada; la repetí desde limpio.

| mutación | muertos | veredicto |
| --- | --- | --- |
| (a) volver a las dos pasadas de `replace` | **8 failed / 39 passed (47)**, los mismos 8 nombres de la bitácora, incluido el cable trampa reescrito | reproduce |
| (b) quitar la regla de la comilla sin pareja | **2 failed / 45 passed**, los dos casos de R13, ni uno más | reproduce |
| (r4) `espacioConSaltos` deja de conservar saltos | **5 muertos**: los 2 de «NUMERO DE LINEAS», el de bloques SQL, el de líneas CSS y «R22 sobre un archivo REAL» | R4 muerde |
| (r14) el escáner deja de abrir bloque tras un corchete | **1 muerto**: «LIMITACION QUE QUEDA (283)» | R14 muerde |
| (r22) `lineasSinComentarios` estrena reglas propias | **2 muertos** | R22 muerde |
| **(r12) quitar la pila de interpolación** | **0 muertos: 47 passed (47)** | **NO muerde: bloqueante 1** |
| `.sql`: un bloque de comentario al final de un `down.sql` | **1 muerto**, y NOMBRA el archivo: `db/migrations/20260728120000_order_status_en_reparto/down.sql` | el cable trampa canta |
| `.css`: una regla con un bloque entrecomillado en `globals.css` | **2 muertos**: el cable trampa nuevo y el canario de equivalencia de la 223 | el cable trampa canta |

Los dos cables trampa de las hermanas **saben ponerse rojos**; no están verdes por casualidad. Los
`.sql` y `app/globals.css` quedaron con su hash original, verificado.

## 6. `init.sh` y la negativa del gate rápido: medida, no leída

R27 prohíbe tocar `init.sh`; la **puerta humana (P5) lo firma después y expresamente**, y la bitácora
lo deja anotado en «Nota de alcance» para que no se lea como una violación silenciosa. **La anotación
existe** y es correcta: la firma es posterior al requisito y manda ella. `docs/verification.md` entra
por consistencia con esa tabla, que es la que la describe.

No me valía «el patrón casa». Monté un repo git de laboratorio con **el `init.sh` real** y su
`origin/dev` propio, y probé las tres direcciones:

```
CASO 1 · se toca solo tests/fixtures/sin-comentarios.ts, con el init.sh de la 283
    Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
        tests/fixtures/sin-comentarios.ts
    ✗ esto exige el gate completo. Corre: ./init.sh     RAPIDO_EXIT=1
CASO 2 · se toca solo tests/fixtures/money-safe.ts      RAPIDO_EXIT=0   (la lista sigue estrecha)
CASO 3 · el mismo cambio con el init.sh de ANTES de la 283   RAPIDO_EXIT=0   (control negativo)
```

La negativa **es nueva, es de esta ficha, y funciona de punta a punta**.

## 7. Rendimiento, re-medido por mí

Tres corridas de `pnpm run test:guardias` en cada estado, misma máquina, seguidas:

| | corridas | mediana | casos |
| --- | --- | --- | --- |
| ANTES (árbol prístino) | 28,45 / 27,13 / 26,61 s | **27,13 s** | 2.140 |
| DESPUÉS (HEAD) | 24,12 / 23,77 / 25,99 s | **24,12 s** | 2.155 |

**Menos 3,01 s, menos 11,1 %.** Mis absolutos son más altos que los suyos (17,9 a 17,7 s) porque mi
máquina venía de correr el gate completo, pero **el signo y la conclusión son los mismos, medidos
aparte**. Muy por debajo del umbral duro de +15 % o +3 s.

**Sobre la duda de los 15 casos de más: la comparación es JUSTA**, y lo es en la dirección correcta.
Los 15 casos nuevos —incluido el cable trampa de SQL, que abre y lee los 307 `.sql`— solo pueden
AÑADIR trabajo al lado de «después». Un sesgo así puede hacer que el después parezca peor, nunca
mejor. Como el después sale más rápido **con la carga extra dentro**, la conclusión «no hay
regresión» está a salvo. Sería tramposo si el delta hubiera salido positivo y se excusara con los
casos nuevos; no es el caso. Los recuentos 2.140 y 2.155 los confirmé yo.

---

## Checklist de CHECKPOINTS.md

| punto | estado |
| --- | --- |
| `requirements.md` con requisitos EARS numerados | OK — 29, con la puerta humana firmada al final |
| `design.md` con alternativa descartada y su porqué | OK — seis: AST, parche al regex, reordenar pasadas, arreglar 149 archivos uno a uno, meter SQL y CSS, silenciar el rojo ajeno |
| **todas las tasks marcadas `[x]`** | **NO: 0 de 24** (bloqueante 2) |
| cada `R<n>` mapea a un test concreto | **NO: R12, cláusula de anidamiento** (bloqueante 1). Los otros 28, sí |
| `progress/impl_283.md` contiene el mapa `R -> test` | OK, completo y sin huecos |
| `pnpm run typecheck` sin errores | OK, corrido por mí |
| `pnpm run lint` sin errores | OK: 0 errores, 100 warnings preexistentes |
| `pnpm test` pasa | 1 rojo AJENO conocido (ficha 275), delta 0. Ver R28 |
| E2E para flujos críticos | N/A: tooling de pruebas, sin UI ni flujo de usuario |
| RLS en tablas nuevas | N/A: cero migraciones, cero tablas. `git status db/` vacío |
| migraciones reversibles | N/A |
| secretos hardcodeados | ninguno |
| webhooks con firma e idempotencia | N/A |
| capas controller / service / repository / interfaces | N/A: una función pura de string a string |
| permisos, `cookies()`, componentes `private/` | N/A |
| multi-país, nada hardcodeado | N/A |
| `./init.sh` termina en verde | **INIT_EXIT=1**, exclusivamente por el rojo ajeno de la 275, que R28 manda dejar como está. Delta 0 |
| `progress/review_283.md` con veredicto OK | este archivo: RECHAZADO |
| entrada en `progress/history.md` | pendiente, cierre del leader |

## Trazabilidad R1 a R29

Abrí cada caso y comprobé que la aserción muerde el requisito; donde la bitácora decía «muere bajo
la mutación X», la mutación la hice yo.

| R | cómo lo verifiqué | veredicto |
| --- | --- | --- |
| R1, R2, R3, R5 | los casos existentes de bloque, JSX, línea, triple barra y división: verdes en las 47, y caen enteros bajo la mutación (c) | OK |
| R4 | los 2 casos de recuento más el nuevo de bloque-abierto-en-cadena; **5 muertos bajo la mutación r4**; y 0 archivos desalineados en mi censo de 2.697 | OK |
| R6 | typecheck en 0 errores; los seis exports intactos, leídos; ningún consumidor en el diff | OK |
| R7, R8, R9 | **rojos reproducidos** contra el quitador de la 209 (T1.1: 3 failed / 33 passed); mueren bajo (a) | OK |
| R10 | verde con las dos implementaciones, como debe una no-regresión | OK |
| R11 | muere bajo (a) | OK |
| R12 multilínea | muere bajo (a) | OK |
| **R12 anidamiento de interpolación** | **NO muere bajo r12: 47 passed** | **BLOQUEANTE** |
| R13 | los dos casos mueren bajo (b), y solo ellos | OK |
| R14 | muere bajo r14, y afirma el comportamiento REAL: una regex con el bloque sin escapar SÍ abre comentario | OK |
| R15 | mi censo: **0 líneas de código perdidas** en 2.697 archivos; las 5 residuales son comentario, verificado línea a línea | OK, ver menor 3 |
| R16 | la salida roja de T1.1, reconstruida y reproducida | OK |
| R17 | los números están escritos, y los reproduzco | OK |
| R18 | (a) 8 muertos, (b) 2, (c) 32, más los dos cables trampa: todo reproducido | OK |
| R19 | el cable trampa NO se borró: sigue en su `describe`, invertido, y **muere bajo (a)** | OK |
| R20 | docstring reescrito, sin la afirmación falsa | OK, ver menor 2 |
| R21 | lista cerrada de 5; barrí `tests/`, `lib/`, `app/`, `components/`, `hooks/`, `scripts/` y `docs/` y no queda prosa vigente; **ninguna aserción tocada**: las únicas líneas borradas del diff son prosa y el cuerpo del cable trampa | OK |
| R22 | 2 muertos bajo r22: la delegación está exigida, no supuesta | OK |
| R23 | rojo NOMBRANDO el archivo bajo mi mutación del `.sql` | OK |
| R24 | 2 rojos bajo mi mutación de `globals.css`; el canario de equivalencia y la CONTRAPRUEBA de la 223, verdes y sin cambio de aserción | OK |
| R25, R26 | seis corridas propias: menos 11,1 %, bajo umbral | OK |
| R27 | diff = 3 archivos de código, más specs, ficha y bitácora; `menu-visibility.test.ts` sin tocar; `init.sh` y `docs/verification.md` **con la excepción de P5 anotada** | OK |
| R28 | el rojo ajeno intacto, sin allowlist ni anotación; `tarifas.ts` fuera del diff | OK |
| R29 | `INIT_EXIT=1` escrito dentro del log del gate COMPLETO, corrido por mí | OK |

---

## Hallazgos

### BLOQUEANTE 1 — El caso de la plantilla anidada no verifica R12

`quitador-comentarios.guardia.test.ts`, el `it` llamado «R12 una plantilla anidada dentro de un
${...} no cierra la de fuera». El requisito exige conservar íntegra una plantilla que anida otra
dentro de una interpolación, y el diseño lo resuelve con una **pila de profundidad, no una bandera**.
Quité del escáner el salto de la interpolación en `finDePlantilla` —o sea, dejé exactamente la
versión ingenua que el diseño descarta— y **la suite entera siguió verde: 47 passed (47)**.

El motivo, medido: la entrada del caso tiene **seis** comillas invertidas balanceadas, así que
emparejarlas a lo bruto termina en la misma posición y el resultado coincide. No es teórico:
midiendo el mismo escáner mutado sobre una entrada que sí discrimina —la misma, con una barra doble
dentro de la plantilla anidada—, el escáner commiteado la deja intacta y el mutado se come todo
desde la interpolación hasta el final de la línea, incluido el `const vivo = 1;` que va detrás.

Es exactamente la clase de pérdida silenciosa que esta ficha existe para cerrar, y hoy **nada la
vigila**: ni la suite (0 muertos) ni la columna «perdidas» del censo, que no se mueve. Lo único que
cambia ahí es que se recuperan 40 líneas menos (1.788 en 126 archivos pasa a 1.748 en 125), y eso no
lo afirma nadie.

**Qué falta para cumplirlo:** que el caso muera sin la pila. Basta con que el contenido de la
plantilla anidada lleve una barra doble o una comilla dentro, y afirmar que el código que sigue en
esa línea sobrevive. Un renglón. Después: correr el caso, aplicar la mutación y pegar el rojo.

### BLOQUEANTE 2 — `tasks.md` está entero sin marcar

`specs/283-quitador-comentarios/tasks.md`: **0 de 24 tasks marcadas**. `CHECKPOINTS.md` lo pide
literalmente («todas las tasks estan marcadas [x]») y es la única señal en disco de qué se hizo y qué
no. He verificado que **el trabajo de las 24 está hecho**, así que esto es contabilidad y no deuda
técnica, pero es un checkpoint explícito y no lo puedo dar por bueno.

**Qué falta:** marcarlas, con T5.2 como N/A —no se superó el umbral, así que la mitigación no
tocaba— y T4.3 marcada con su autorización de P4.

### menor 1 — Queda un cuarto «159 suites» sin corregir

`quitador-comentarios.guardia.test.ts:540` sigue diciendo que el módulo «esta en el camino caliente
de **159** suites». El implementer re-midió ese número (171) y lo corrigió en tres sitios: el
docstring del módulo, el comentario de `init.sh` y la fila de `docs/verification.md`. Este cuarto se
quedó atrás. Es prosa, no aserción, pero es el número con el que la puerta humana firmó P5, y la
ficha entera trata precisamente de no repetir cifras sin medirlas.

### menor 2 — «fuera de una clase de caracteres» no describe lo que pasa

El docstring del módulo (líneas 51 a 53) y `design.md` §3.2 dicen que una regex abre comentario si
lleva el bloque «sin escapar **y fuera de una clase de caracteres**». El propio caso de R14, unas
líneas más abajo en la suite, usa una regex con el bloque **dentro** de una clase de caracteres y
afirma —correctamente— que SÍ abre comentario. El escáner no sabe qué es una clase de caracteres. La
coletilla sugiere una protección que no existe, y quien la lea pensará que esa forma es segura
cuando es justo el ejemplo del caso. La mitigación buena, escapar el asterisco, sí está escrita y sí
está probada.

### menor 3 — El censo de R15 no vigila nada a partir de hoy

El comentario del caso de R14 dice: «el censo diferencial de la 283 recorre los 2.697 archivos y
exige CERO líneas perdidas... el día que una regex así se escriba, ese censo la nombra». Ese censo
fue un script de un solo uso, ya borrado, y borrarlo era lo correcto según `tasks.md`. Pero hoy nadie
lo corre, así que ese día no lo nombrará nadie. La frase describe una red que no está tendida. O se
matiza la frase, o —mejor— el censo se convierte en un caso de guardia; lo segundo es ficha aparte y
no lo pido aquí.

### menor 4 — La ficha de `feature_list.json` sigue contando lo desmentido

La entrada 283 sigue en `spec_ready` y su `status_note` repite como medidos el «149 archivos /
1.958 líneas», el «recupera 4.599 líneas en 152 archivos» y el «159 suites». Los tres los desmiente
la propia entrega, y yo lo he confirmado. Cerrar la ficha dejando ahí esos números es sembrarle el
mismo problema a la siguiente sesión que los lea.

### menor 5 — Falta la entrada en `progress/history.md`

Checkpoint de cierre. Es del leader y no del implementer, pero queda anotado: la feature no puede
pasar a `done` sin ella.

---

## Lo que NO es un hallazgo, y conviene que quede dicho

- **El gate en 1.** Está bien que salga en 1. El único rojo es el de `obtenerTarifa` (ficha 275,
  `pending`, otra sesión), R28 manda dejarlo exactamente como está, y mi corrida da el mismo array de
  un solo elemento. Delta 0. Quien quiera un verde tiene que cerrar la 275, no tocar esto.
- **Que los agregados del leader no se reproduzcan.** No es un defecto de la entrega: es la entrega
  haciendo su trabajo. El implementer re-midió como mandaba P6, dijo que no coincidía en vez de
  taparlo, y ofreció una hipótesis falsable con su número delante. La he intentado falsar y sale a su
  favor.
- **Los 15 casos de más en la ventana de rendimiento.** Sesgan en contra del cambio, no a favor. Con
  la carga extra dentro, la mediana igual baja.
- **Que `quitarComentariosSql` y `quitarComentariosCss` sigan ciegas a las cadenas.** Está decidido
  por la puerta humana (P2 y P3), medido en cero líneas perdidas, y las dos deudas tienen un caso que
  se pone rojo el día que aparezca la precondición. Lo he comprobado rompiendo las dos.

---
---

# RONDA 2 — 2026-08-25, tras los commits `6098f9f1`, `6faa6a3d` y `58d44061`

> La ronda 1 queda **íntegra arriba**, incluida la parte que quedó desmentida por el arreglo: un
> informe al que se le borran los hallazgos ya cerrados no deja saber qué pasó.

## VEREDICTO FINAL: OK — 0 bloqueantes

Los dos bloqueantes están cerrados y **los he medido yo**, no leído. Quedan menores, y una
condición de cierre nueva que no es de la ficha (`dev` se movió).

## Mi gate, segunda corrida

`pnpm run db:generate` delante, `./init.sh` COMPLETO, código de salida dentro del log:

```
✓ typecheck paso
✓ lint paso                      (100 problems, 0 errors, 100 warnings)
 Test Files  1 failed | 1391 passed (1392)
      Tests  1 failed | 18958 passed | 26 skipped (18985)
INIT_EXIT=1
```

**Idéntico a mi corrida de la ronda 1, hasta el número de casos**, y el único rojo sigue siendo el
ajeno con su array de un elemento: `lib/actions/tarifas.ts:67 obtenerTarifa` (ficha 275, `pending`).
**Delta 0.** Que los 18.985 no se hayan movido confirma además que el caso de R12 se **reescribió**,
no se añadió.

## B1 — el caso de la plantilla anidada: cerrado, y muerde

Corrí la mutación yo mismo, quitando las seis líneas de la pila de interpolación de
`finDePlantilla`:

```
SIN la pila:  Tests  1 failed | 46 passed (47)
  × R12 una plantilla anidada dentro de un `${…}` no cierra la de fuera
  AssertionError: la plantilla de fuera cerro en la de dentro: el `//` de la anidada se leyo como
  comentario y se llevo el resto de la linea:
  expected 'const ruta = `base ${esRaiz ? ` ' to contain '`//raiz`'

CON la pila:  Tests  47 passed (47)
```

**Cae por la razón buena, y eso se ve en el valor recibido, no en el mensaje:** la salida se corta
exactamente en la comilla invertida que abre la plantilla anidada, que es donde el escáner sin pila
cree que vuelve a código. Si cayera por otra cosa —una aserción de más, un `toContain` mal escrito—
el recibido sería otro. Antes de la mutación estaba verde; después, rojo; y el rojo nombra el
mecanismo.

**Su explicación de por qué no mordía también la comparto, y la había medido en la ronda 1**: la
entrada vieja tenía seis comillas invertidas, número par, así que emparejarlas mal consume el mismo
tramo que emparejarlas bien y la salida era idéntica byte a byte. Lo que cambia con la entrada nueva
es **dónde va el `//`**: dentro de la plantilla anidada, que es el único sitio donde el
emparejamiento equivocado cambia el resultado.

## B1-bis — el censo de sensibilidad, hecho por mi cuenta

No contrasté su tabla: **hice la mía**, con 13 mutaciones aplicadas una a una sobre el árbol limpio,
recogiendo los nombres de los casos muertos del reporter JSON de vitest y revirtiendo con
comprobación de `git status` entre mutación y mutación. Base: **47 passed, 0 rojos**.

| mutación | qué rompe | muertos (yo) | dice el implementer |
| --- | --- | --- | --- |
| (a) | volver a las dos pasadas de `replace` | 9 | 8 en su corrida previa al arreglo — ahora son 9 porque el caso nuevo de R12 también cae |
| (b) | quitar la regla de la comilla sin pareja | 2 | 2 |
| (c) | devolver cadena vacía | 32 | 32 |
| (e) | quitar la rama de **CADENA** de `quitarComentarios` | **11** | **11** |
| (f) | quitar la rama de **PLANTILLA** | **2** | **2** |
| (g/r12) | quitar la **pila de interpolación** | **1** | **1** (antes del arreglo: 0) |
| (r4) | `espacioConSaltos` deja de conservar saltos | 5 | — |
| (r14) | el escáner deja de abrir bloque tras un corchete | 1 | — |
| (h/r22) | `lineasSinComentarios` estrena reglas propias | **2** | **3** — ver abajo |
| (i) | un bloque sin cerrar se traga el resto del archivo | **0** | — |
| (j) | quitar la rama de cadena **dentro de la interpolación** | **0** | — |
| css | `globals.css` estrena un bloque entrecomillado | 2 | 2 |
| sql | una migración estrena un bloque con su cierre | 1 | 1 |

**Su conclusión me cuadra: de los 15 casos nuevos, ninguno queda sin al menos una mutación que lo
mate.** Lo verifiqué caso por caso con mi propia tabla de sensibilidad, no con la suya:

```
[a,c,e]      CERRADA POR LA 283 (el cable trampa reescrito)
[a,c]        R7 · [a,c,e] R8 · [a,c,e] R9 · [c,e] R10
[b,c]        R13 en su linea · [b,c] R13 comilla invertida
[a,c,e]      R11 comilla escapada
[a,c,r22,f]  R12 multilinea · [a,c,r12,f] R12 anidada
[a,c,r22,e]  R4 bloque abierto dentro de cadena
[c,r4]       R22 sobre un archivo real
[c,r14]      LIMITACION QUE QUEDA (283)
[sql]        cable trampa SQL · [css] cable trampa CSS
[a,c,e]      DEUDA DECLARADA de CSS
```

### El único número que no me sale igual: su (h) mata 3, mi (r22) mata 2

Mi mutación de «reglas propias» hace que `lineasSinComentarios` use **el barrido viejo** en vez de
delegar. Con ella mueren dos casos —R12 multilínea y R4-en-cadena— pero **no** el que se llama R22.
Fui a ver por qué, y el motivo afila su propio matiz: sobre `tests/fixtures/sin-comentarios.ts`, que
es justo el archivo que ese caso lee, **el barrido viejo y el nuevo coinciden byte a byte** (medido:
0 líneas distintas de 306). Así que su aserción de delegación no puede cazar una vuelta al juego de
reglas viejo **en ese archivo**. Su (h) mata 3 porque su lógica propia diverge también ahí; la mía
no.

**Lo importante es que el requisito sigue vigilado**: meter un juego de reglas paralelo pone la
suite roja igual, por otros dos casos. No es como R12 antes del arreglo, donde no moría **nada**.

### Los dos matices que declara: me convencen los dos, y uno se queda corto

**R22 tautológico hoy — sí, y más de lo que dice.** `split` y `join` son la identidad, así que la
aserción de delegación es verde por construcción mientras la función delegue; eso es exactamente lo
que R22 pide. Lo que su nota no llega a decir es lo de arriba: el archivo que elige para
comprobarlo es uno donde las dos semánticas coinciden, así que ni siquiera caza la divergencia hacia
el barrido viejo. No es excusa —lo declara él solo, sin que nadie lo pregunte, y el requisito queda
cubierto por otros dos casos—, pero conviene que quede escrito con el número delante.

**R14 no discrimina ningún mecanismo vivo, ni debe — de acuerdo, y no es una excusa: es medible.**
Una limitación afirmada tiene el trabajo contrario al de un caso normal: no debe morir cuando el
mecanismo cambia, debe morir cuando **alguien cierra la limitación**. Y eso lo comprobé: bajo mi
mutación (r14), que es literalmente «el escáner empieza a entender que un corchete abre una clase de
caracteres», el caso cae con su mensaje «la limitacion se cerro: actualiza este caso». O sea que sí
tiene un disparador, y es el correcto. Si no muriera ni siquiera ahí, sería prosa disfrazada de test.

### Lo que sí encontré de nuevo, y por qué NO es un segundo bloqueante

Dos mecanismos del escáner no los mata ningún caso: **(i)** que un bloque sin cerrar no se trague el
resto del archivo, y **(j)** que dentro de una interpolación se respeten las cadenas. Los muté y la
suite quedó en **47 passed** las dos veces.

- **(i)** es el mecanismo del que cuelga la monotonía de **R15** («el cambio solo puede recuperar,
  nunca perder»). No lo cuento como bloqueante porque **la verificación asignada a R15 no es un
  caso, es el censo diferencial**: así lo escribieron `requirements.md` y `tasks.md`, así lo acepté
  en la ronda 1 y así lo medí yo mismo (0 líneas de código perdidas en 2.697 archivos). Mover ese
  criterio ahora sería cambiarle las reglas a la ficha a mitad de partida. Lo que sí hace esta
  medida es **ponerle número a mi menor 3 de la ronda 1**: si mañana alguien rompe esa garantía, no
  hay nada corriendo que lo diga.
- **(j)** no es cláusula de ningún requisito: R12 nombra las plantillas anidadas dentro de una
  interpolación, no las cadenas. Queda como observación.

Los **10 casos que ninguna de mis 13 mutaciones mata** son todos ajenos a esta entrega y no son
deuda suya: seis son de la 209/223 y están escritos en una sola cara —`not.toMatch(...)`, que un
quitador vacío satisface— con la CONTRAPRUEBA global como red, que es el diseño que la 209 eligió;
tres cubren `quitarComentariosSql` y `quitarComentariosCss`, que esta ficha **deliberadamente no
toca**, así que ninguna mutación mía sobre `quitarComentarios` puede alcanzarlos; y uno solo
comprueba que el archivo existe. **Ninguno de los 15 nuevos está en esa lista.**

## B2 — las 24 casillas: no hay marcado de más en la sustancia

Repasé las 24 contra la evidencia, y la sustancia de todas está hecha: yo mismo verifiqué el censo,
las anclas, la salida roja de T1.1, las mutaciones, los dos cables trampa, el alcance del diff, la
negativa del gate rápido, el rendimiento y el gate. **No encontré ninguna casilla que afirme un
trabajo que no se hizo.** Dos apuntes de forma, los dos menores:

- **T5.2 está marcada `[x]` sin decir «N/A».** Es la task **condicionada** a superar el umbral de
  rendimiento, y el umbral no se superó, así que la mitigación —correctamente— no se implementó. Su
  propio «Hecho cuando» dice «la nueva mediana está bajo umbral **tras la mitigación**», y eso no
  ocurrió porque no tocaba. Lo pedí como N/A en la ronda 1 y quedó como `[x]`. No es una medida
  inventada —la fila de R26 y la bitácora dicen «sin mitigación» tres líneas más allá—, pero un
  lector futuro puede leer que hubo memo por ruta, y no lo hubo.
- **T2.3 sigue nombrando la entrada vieja en su criterio de aceptación** (`` `a${b ? `x` : `y`}c` ``),
  que es precisamente la que se demostró que no discrimina. La task está hecha —y mejor que lo
  pedido—, pero conviene tacharlo para que nadie «restaure» ese input creyendo que cumple el spec.

## Los menores de la ronda 1, comprobados

| menor | estado |
| --- | --- |
| 1 · el cuarto «159 suites» | **cerrado y verificado**: en `tests/`, `init.sh` y `docs/` no queda ninguna aparición; la línea 554 dice ahora 171 con el desglose y la fecha. Lo que queda son referencias históricas en `progress/` y en los propios specs, que citan la cifra del leader como lo que se contrasta: correcto dejarlas |
| 4 · la ficha repetía los números desmentidos | **cerrado en el `status_note`**, que ahora dice de dónde salía el error y cita el arbitraje. **Pero el campo `description` sigue diciendo «149 archivos pierden codigo real»**: es el texto que se ve en cualquier listado. Menor abierto |
| 2 · «fuera de una clase de caracteres» | **abierto**. El docstring del módulo y `design.md` §3.2 siguen sugiriendo que dentro de una clase de caracteres no abre comentario, y el caso de R14 —tres líneas más abajo— usa exactamente esa forma y afirma que **sí** abre |
| 3 · el censo de R15 no vigila nada a partir de hoy | **abierto**, y ahora con número: la mutación (i) deja la suite en 47 passed |
| 5 · falta la entrada en `progress/history.md` | **abierto**, es del cierre del leader |

## Condición de cierre NUEVA, y no es de la ficha: `dev` se movió

Cuando arbitré la ronda 1, `origin/dev` era `ce22a621`. Ahora es **`97ece0c3`**: cinco commits por
delante (feature 80, correo saliente por SMTP y el OTP fuera de los logs, más un arreglo del resumen
de carga masiva). Tocan **`package.json` y `pnpm-lock.yaml`** —dependencia nueva—, `lib/actions/auth.ts`
y varios servicios.

Qué significa para el cierre:

- **Todo lo que he medido vale para esta rama tal como está**, cuyo `merge-base` sigue siendo
  `ce22a621`. El alcance del diff contra esa base son los 11 archivos esperados y ni uno más.
- **Después de integrar `dev` hay que correr `pnpm install` y el gate COMPLETO otra vez**, y no por
  formalismo: entra una dependencia nueva, y `docs/verification.md` ya niega el modo rápido cuando
  se toca `pnpm-lock.yaml`. Un gate medido sobre `ce22a621` no dice nada del resultado del merge.
- `dev` **no toca `lib/actions/tarifas.ts`**, así que es de esperar que el rojo ajeno siga ahí y el
  baseline no cambie — pero eso hay que **medirlo después del merge**, no suponerlo.

## Checklist de CHECKPOINTS.md — ronda 2

| punto | estado |
| --- | --- |
| requisitos EARS numerados | OK |
| `design.md` con alternativa descartada | OK |
| **todas las tasks marcadas `[x]`** | **OK** — 24 de 24, con la sección «Marcado de las casillas» que dice de dónde sale cada una. Dos apuntes de forma arriba |
| **cada `R<n>` mapea a un test que lo verifica** | **OK** — R12 cerrado: la cláusula de anidamiento ya muere con su mecanismo |
| mapa `R -> test` en la bitácora | OK |
| typecheck / lint | OK, corridos por mí |
| `pnpm test` | 1 rojo AJENO conocido, delta 0 |
| E2E, RLS, migraciones, webhooks, capas, permisos, multi-país | N/A — tooling de pruebas, cero migraciones, cero código de producción |
| `./init.sh` en verde | `INIT_EXIT=1` **exclusivamente** por el rojo de la 275, que R28 manda dejar como está |
| `progress/review_283.md` con veredicto OK | este archivo, ronda 2: **OK** |
| entrada en `progress/history.md` | pendiente, cierre del leader |

## Lo que queda pendiente para pasar a `done`

Ninguno bloquea la revisión; son de cierre:

1. Integrar `dev` (`97ece0c3`), `pnpm install`, y **gate completo otra vez** — con la dependencia
   nueva dentro.
2. Entrada en `progress/history.md`.
3. La ficha a `done` y el campo `description` con los números buenos.
4. Los tres menores de prosa: la coletilla de la clase de caracteres, el «N/A» de T5.2 y el criterio
   de aceptación de T2.3.

**Firmado: OK, 0 bloqueantes.** Lo que hizo que esta entrega pasara no fue que estuviera verde —lo
estaba también con el defecto dentro, y ése era justo el problema— sino que cada afirmación tiene
detrás una mutación que la mata y un número que se puede volver a medir. Incluidas las dos que
declaró él mismo sin que nadie se lo pidiera.
