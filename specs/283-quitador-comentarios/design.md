# Feature 283 — Diseño

> El CÓMO. Los requisitos están en `requirements.md`; el desglose ejecutable en `tasks.md`.

---

## 1. Qué NO hay en esta feature

Se dice primero para que nadie lo busque:

- **Cero modelo de datos.** Ninguna tabla, ninguna columna, ninguna política RLS, **ninguna
  migración**. `db/` no se toca en absoluto (R27).
- **Cero rutas y cero endpoints.** Ni route handlers, ni Server Actions, ni middleware.
- **Cero integraciones.** Ni Supabase, ni Meta, ni WhatsApp, ni Telegram.
- **Cero código de producción.** Ni `app/`, ni `lib/`, ni `components/`, ni `hooks/`, ni
  `scripts/`.

El contrato de entrada/salida que sí existe es el de una función pura:
`(fuente: string) => string`. No cambia (R6).

**Archivos que se tocan, y son dos:**

| archivo | qué cambia |
| --- | --- |
| `tests/fixtures/sin-comentarios.ts` | el cuerpo de `quitarComentarios` y su documentación (R1–R15, R20, R22) |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts` | el cable trampa reescrito (R19) + los casos nuevos (R16, R18, R23, R24) |

Más, si P4 se autoriza, **tres líneas de comentario** en
`tests/unit/services/cotizacion-orden-service.test.ts` (R21).

---

## 2. El diagnóstico, y por qué el arreglo no es un parche al regex

Hoy:

```ts
export function quitarComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, espacioConSaltos)   // pasada 1: bloques
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");          // pasada 2: líneas
}
```

Dos pasadas independientes, **sin estado compartido**. Ninguna de las dos sabe dónde estaba la
otra, así que:

1. La pasada 1 no distingue un `/*` de código de un `/*` que vive dentro de un `//` o de una
   cadena. Abre bloque y, por ser no ávida, cierra en el **primer `*/` del archivo**, que puede
   estar 500 líneas más abajo.
2. La pasada 2 no distingue un `//` de código de un `//` que vive dentro de una cadena. El
   `[^:]` es un mitigador textual —protege `https://` porque delante hay un `:`— pero no protege
   `startsWith("//")`, porque delante hay un `"`.

Los dos peores archivos del árbol caen por el **primero**, no por el segundo:

- `cotizacion-orden-service.test.ts:243` — `it("… no importa nada de next/* ni recibe Request")`.
  El `/*` está dentro de una **cadena**; cierra en el `*/` de la línea **752**.
- `novedad-acciones-sin-maqueta.guardia.test.ts:295` — ``// … `lib/actions/**` …``. El `/*` está
  dentro de un **`//`**; cierra en el `*/` de la línea **543**.

Eso decide el diseño: **el arreglo tiene que ser un recorrido con estado**, porque el defecto es
exactamente la ausencia de estado entre las dos pasadas.

---

## 3. El mecanismo: un escáner de un solo recorrido

`quitarComentarios` pasa a ser un autómata que recorre el fuente una vez, de izquierda a
derecha, y en cada posición sabe **en qué contexto está**. Los estados:

| estado | se entra con | se sale con | qué se emite |
| --- | --- | --- | --- |
| `CODIGO` | inicio | — | el carácter tal cual |
| `LINEA` | `//` en `CODIGO` | `\n` (que **no** se consume) | un espacio, una sola vez |
| `BLOQUE` | `/*` en `CODIGO` | `*/` | un espacio + **un `\n` por cada `\n` tragado** |
| `CADENA` | `'` o `"` en `CODIGO` **con pareja en la misma línea** (R13) | la comilla par no escapada | el texto tal cual, comillas incluidas |
| `PLANTILLA` | `` ` `` en `CODIGO` **con pareja en el resto del archivo** (R13) | el `` ` `` par no escapado, respetando el anidamiento de `${…}` (R12) | el texto tal cual |

Reglas de detalle, todas exigidas por un requisito:

- **Escapes (R11).** Dentro de `CADENA` y `PLANTILLA`, un `\` consume el carácter siguiente sin
  interpretarlo. `'\''` no cierra en la segunda comilla.
- **Anidamiento de plantillas (R12).** Un `${` dentro de `PLANTILLA` empuja un contexto de
  código anidado; su `}` de cierre lo saca. Una plantilla dentro de la interpolación
  (`` `a${b ? `x` : `y`}c` ``) **no** cierra la de fuera. Se resuelve con una pila de
  profundidad, no con una bandera.
- **Salida byte a byte compatible.** Un bloque se sustituye por `" "` **conservando sus saltos
  de línea** — es exactamente lo que hace hoy `espacioConSaltos`, y esa función **se conserva
  tal cual**. Un `//` se sustituye por `" "` dejando intacto lo que iba delante. Esto es lo que
  mantiene R4 (mismo número de líneas) y lo que hace que las guardias que anclan con `^`/`$` en
  modo multilínea sigan hablando de la línea correcta.
- **Construcción del resultado.** Se acumulan **segmentos** en un array y se cierra con un
  `join("")`. No se concatena carácter a carácter: eso es lo que convertiría un O(n) en un O(n²)
  en motores que no optimicen la cuerda (ver §7).

### 3.1 La regla de la comilla sin pareja (R13) — y por qué no es un adorno

Un escáner ingenuo que abra cadena en cualquier `'` **introduce un defecto nuevo**: en un `.tsx`,
el texto JSX no está entrecomillado, así que `<p>Don't panic</p>` abriría una cadena que se
comería todo hasta el siguiente `'` del archivo. Sería el mismo fallo silencioso que venimos a
cerrar, girado de lado.

La regla lo neutraliza de raíz y es barata: en JavaScript **una cadena `'…'` o `"…"` no puede
abarcar varias líneas**, así que si la comilla no tiene pareja no escapada antes del `\n`, no era
una cadena. Se trata como un carácter cualquiera. Para la plantilla `` ` `` —que sí puede abarcar
varias líneas— la ventana es el resto del archivo.

Esta regla es también la razón por la que R15 (monotonía) se puede exigir: sin ella, el barrido
nuevo podría perder cosas que el viejo conservaba, y toda la premisa de la ficha —«el cambio
solo recupera»— dejaría de ser cierta.

### 3.2 Lo que el escáner deliberadamente NO hace (R14)

**No reconoce literales de expresión regular.** Distinguir `/…/` de una división exige contexto
sintáctico real (el token anterior), y eso es un parser, no un escáner. Consecuencia conocida:
una regex que contenga `/*` o `//` **sin escapar y fuera de una clase de caracteres** abriría
comentario. En la práctica de este árbol esos caracteres van escapados (`/\/\//`, `/\/\*/`), que
es lo que se escribe naturalmente. Se deja **afirmado por un caso de prueba**, con el mismo
formato con que la 209 y la 223 dejaron escritas las suyas, y **medido** por el censo diferencial
de R15: si en algún archivo el barrido nuevo perdiera algo, la limitación habría dejado de ser
teórica y saldría con nombre y apellidos.

---

## 4. Contrato de entrada/salida

Sin cambios (R6). Los seis exports mantienen firma y semántica:

```ts
quitarComentarios(fuente: string): string          // ← cambia el cuerpo, no el contrato
quitarComentariosSql(sql: string): string          // ← intacto (§6)
quitarComentariosCss(css: string): string          // ← intacto (§6)
codigoSinComentarios(rutaRelativa: string): string // ← intacto (delega)
codigoCssSinComentarios(ruta: string): string      // ← intacto
lineasSinComentarios(fuente: string): string[]     // ← intacto (delega, R22)
```

**Invariantes que el contrato promete y los tests fijan:**

| invariante | requisito | por qué importa |
| --- | --- | --- |
| `salida.split("\n").length === entrada.split("\n").length` | R4 | los censos que informan `archivo:línea` |
| el barrido nuevo ⊇ el barrido viejo, archivo a archivo | R15 | la premisa de la ficha |
| todo comentario real sigue desapareciendo | R1, R2 | si no, las guardias empiezan a denunciar prosa |

---

## 5. El cable trampa: qué pasa a afirmar exactamente

Hoy, `quitador-comentarios.guardia.test.ts:292`:

```ts
it("LIMITACION CONOCIDA Y MEDIDA: un `//` que abre una cadena si se lo lleva", () => {
  expect(quitarComentarios('if (!p.startsWith("//")) { llamar(); }')).not.toMatch(/llamar/);
});
```

Su comentario dice: *«si un día hace falta cerrarla, el cambio es añadir las comillas a la clase
`[^:]` — y este caso es el que dirá que se cerró»*. **Ese día es hoy**, y el caso tiene que
decirlo. Se reescribe en su sitio, en el mismo `describe`, con este contenido (R19):

```ts
it("CERRADA POR LA 283: un `//` dentro de una cadena YA NO se lleva el codigo que le sigue", () => {
  // Este caso ERA la limitacion conocida de la 209, dejada fijada con la frase «si un dia hace
  // falta cerrarla ... este caso es el que dira que se cerro». Se cerro el <fecha> con la ficha
  // 283, y NO como la 209 preveia -anadir las comillas a la clase `[^:]`-: eso habria cerrado
  // solo este caso y no el que hacia el dano grande, un `/*` dentro de un `//` o de una cadena
  // abriendo bloque. La linea real del arbol que lo motivo es `LoginForm.tsx:34`,
  // `!redirectParam.startsWith("//")` (guarda de open-redirect): con el quitador viejo, el `))
  // {` que la sigue desaparecia del texto que leen las guardias.
  const fuente = 'if (!p.startsWith("//")) { llamar(); }';
  expect(quitarComentarios(fuente)).toMatch(/llamar/);
  expect(quitarComentarios(fuente)).toContain('"//"');
  // La otra cara, para que el caso no pase por haber dejado de quitar nada:
  expect(quitarComentarios(fuente + " // y aqui un parseFloat(")).not.toMatch(/parseFloat/);
});
```

**No se borra** porque su valor no era la limitación: era **el sitio donde se anuncia el cambio
de comportamiento**. Un caso borrado no cuenta nada; un caso invertido cuenta las dos épocas.

La contraprueba con la implementación anterior (§8) es la que garantiza que este caso no está
verde por casualidad.

---

## 6. Las tres hermanas — la medida, y la decisión

El módulo exporta tres funciones más que comparten familia de defecto. **Medido en el árbol en
esta sesión, con censo textual** (los números de `.sql` y `.css` son completos; el de `.ts` es
el del leader, pendiente de re-correr en T0.1):

| hermana | superficie | instancias del defecto **hoy** | líneas perdidas hoy | decisión |
| --- | --- | --- | --- | --- |
| `lineasSinComentarios` | todo lo que barre `quitarComentarios` | **hereda el 100 %** (delega, línea 121) | las mismas 1.958 | **DENTRO** |
| `quitarComentariosSql` | **307** `.sql`, todos en `db/migrations/**` | 8 archivos con `/*` dentro de un `--`; **0** con un `*/` posterior; **0** con `--` dentro de un literal | **0 líneas en 0 archivos** | **FUERA** + cable trampa |
| `quitarComentariosCss` | **1** `.css` real (`app/globals.css`) | **0** `//` en todo el archivo; **0** `/*` dentro de una cadena | **0 líneas en 0 archivos** | **FUERA** + cable trampa |

### 6.1 `lineasSinComentarios` — DENTRO, y sin escribir una línea

No tiene lógica propia: `quitarComentarios(fuente).split("\n")`. Entra por delegación, gratis, y
lo único que hay que hacer es **exigir que siga siendo así** (R22) y volver a fijar la alineación
línea a línea contra el escáner nuevo (R4), porque es la garantía de la que dependen los censos
que informan `archivo:línea`.

### 6.2 `quitarComentariosSql` — FUERA, y el motivo no es comodidad

**El daño medido hoy es cero.** Los 8 archivos que llevan el `/*` cargado son todos `down.sql`, y
en los 8 el `/*` viene de citar una ruta con comodín dentro de una línea `--`:

```
-- INDICES — RE-VERIFICADO el 2026-08-19 sobre `db/migrations/*/migration.sql`, no citado de la
```

El regex no ávido necesita un `*/` **posterior** para casar. Se buscó en los 307 archivos: los
únicos `*/` del árbol SQL son los de esas mismas ocho líneas, y el `*` ya lo consume la apertura.
**El regex no casa en ningún archivo del árbol**, así que la pasada de bloque de
`quitarComentariosSql` hoy no quita absolutamente nada, en ninguna parte.

**Y el arreglo correcto no es el mismo escáner.** SQL necesita su propio lexer:

- **Dollar-quoting `$tag$`** — medido: **7 archivos, 18 apariciones**. Y
  `20260825130000_tarifas_reconciliar_par_zona_tienda/migration.sql` anida **`$q$` dentro de
  `$$`**, así que no vale una bandera booleana: hay que casar el tag exacto.
- **Escape `''`** dentro de literal — 3 archivos, 17 apariciones.
- **Identificadores `"…"`**, que en SQL no son cadenas.
- **Bloques `/* */` que en Postgres ANIDAN**, al revés que en JavaScript.

Meter eso aquí triplicaría la superficie de una ficha cuyo valor entero es que su arreglo **ya
está medido, typecheckea limpio y no enciende ninguna guardia**. Se difiere, pero **no a ciegas**:
R23 pone un caso que falla nombrando el archivo el día que aparezca la precondición del daño —el
primer `/* … */` de verdad en una migración, o el primer `--` dentro de un literal—. Es
exactamente el patrón que este repo ya usa: el canario de la 223 sobre `app/globals.css`
(«riesgo LATENTE, no vivo — que es justo cuando sale barato cerrarlo»). La diferencia con «por si
acaso» es que aquí el número es **0 de 307** y está escrito.

### 6.3 `quitarComentariosCss` — FUERA, y con una deuda que hay que mantener visible

Hay **un solo `.css` real en el repo** (`app/globals.css`; los demás son copias en
`.claude/worktrees/` y `node_modules/`). Con Tailwind v4 el estilado vive en clases, no en hojas,
así que esa superficie no está creciendo. En ese único archivo: **0** apariciones de `//`, y las
comillas que hay son de `@import "tailwindcss"` y de selectores de atributo (`[role="dialog"]`),
ninguna con un `/*` dentro. El vector del defecto **no existe** hoy.

**Pero hay un efecto de segundo orden que hay que atender**, y es el motivo de la segunda mitad
de R24. El canario de la 223 (`quitador-comentarios.guardia.test.ts:243`) afirma que sobre
`globals.css` las dos pasadas dan **el mismo resultado**, y su mensaje de fallo explica que la
divergencia significaría «`globals.css` estrenó un `//` fuera de comentario». Al volverse
`quitarComentarios` consciente de cadenas, ese canario **se estrecha en silencio**: si el `//`
llegara **entre comillas** (`src: url("//cdn/x")`), las dos pasadas seguirían coincidiendo y el
canario no diría nada, aunque `quitarComentariosCss` siga sin proteger cadenas. Por eso R24 pide
un caso **adicional y sintético** que afirme esa deuda directamente, en vez de dejarla colgando
de una equivalencia que acaba de cambiar de significado.

Coste de cambiar de opinión (P2): una entrada más en la tabla de tokens del escáner y dos casos.
Está dicho para que la decisión sea reversible con un «sí».

---

## 7. Rendimiento

**El riesgo real.** El escáner recorre carácter a carácter lo que antes hacían dos `replace`
nativos, y lo llaman **133 suites por importación directa** más las transitivas (`money-safe.ts`,
`deteccion-maqueta.ts`, `css-reglas.ts`, `contraste.ts`, `etiquetas-datatable.ts`,
`aserciones-de-orden.ts`, `montajes-componente.ts`, `_arbol-de-la-feature.ts`). Varias guardias
recorren `app/`, `lib/` y `components/` enteros, así que el mismo archivo se barre muchas veces
en una corrida.

**La medida es obligatoria y no se estima** (R25): tres corridas de `pnpm run test:guardias`
antes, tres después, mediana contra mediana, mismo árbol, misma máquina, sin nada más corriendo.
El único punto de referencia escrito en el repo es `docs/verification.md`: «las guardias … cuestan
~8 s» (2026-08-03). **Ese número no se cita como línea base**: se vuelve a medir en T0.2 sobre el
árbol de hoy, que tiene 1.375 archivos de test.

**Lo que ya se hace en el diseño para que no haga falta mitigar:**

1. **Un solo recorrido**, no dos. Se elimina una pasada completa sobre el fuente.
2. **Segmentos + `join("")`**, nunca `resultado += c`.
3. **Sin dependencias nuevas.** Nada de `typescript`, nada de instanciar un parser.

**Si aun así se pasa del umbral (R26)**, la mitigación propuesta, en este orden:

| # | mitigación | coste | por qué en este orden |
| --- | --- | --- | --- |
| 1 | Memo por ruta en `codigoSinComentarios` (`Map<string, string>`) | ~4 líneas | ataca la causa real —el mismo archivo barrido N veces en una suite— sin tocar la función pura. El módulo se instancia por worker de vitest, así que el memo vive lo que vive el worker |
| 2 | Atajo: si el fuente no contiene `/*` ni `//` ni comilla, devolverlo tal cual | ~2 líneas | los archivos sin comentarios salen sin recorrer |
| 3 | Saltos por bloque en vez de por carácter (`indexOf` del siguiente delimitador) | mayor | solo si 1 y 2 no bastan; complica el autómata y hay que re-verificar R4 |

La 1 **no se implementa a ciegas**: un memo introduce la posibilidad de leer rancio si un test
escribiera el archivo entre dos lecturas. Solo entra si la medida lo pide.

---

## 8. Cómo se demuestra que funciona — el patrón que ya usa este archivo

La suite verde no demuestra nada aquí: la suite **ya estaba verde** con el defecto dentro; ése es
literalmente el problema («una guardia que escanea prosa como si fuera código no falla
ruidosamente: **afirma algo falso** … y su veredicto se lee igual de verde»).

Lo que sí demuestra es un caso que **falla con el viejo y pasa con el nuevo** (R16). Y este
archivo ya tiene el patrón exacto para escribirlo: sus casos de las líneas 277–289 **inlinean las
tres semánticas rechazadas** y las contrastan con la buena. Se hace lo mismo, con el quitador
viejo entero:

```ts
/** El quitador de la 209, tal cual, para contrastar. No se usa fuera de este bloque. */
const quitadorViejo = (f: string) =>
  f.replace(/\/\*[\s\S]*?\*\//g, espacio).replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
```

y, para cada uno de los tres casos del defecto, **las dos caras en el mismo `it`**:

| caso | el viejo | el nuevo |
| --- | --- | --- |
| `/*` dentro de un `//` (R7) | `expect(quitadorViejo(f)).not.toMatch(/vive/)` | `expect(quitarComentarios(f)).toMatch(/vive/)` |
| `/*` dentro de una cadena (R8) | ídem | ídem |
| `//` dentro de una cadena (R9) | ídem | ídem |
| URL en cadena (R10) | `expect(quitadorViejo(f)).toMatch(/Number/)` — **el viejo también acierta aquí** | ídem, y **además** con la URL entre comillas seguida de código |

La cuarta fila es deliberada: R10 no es una mejora, es **una no-regresión**. El `[^:]` estaba ahí
por una razón buena y el escáner tiene que seguir dándole la razón. Escribirla junto a las otras
tres deja claro cuál es cuál.

Encima de eso, dos verificaciones de árbol:

- **Censo diferencial (R15/R17).** Recorrer los `.ts`/`.tsx` con las exclusiones acordadas y
  producir, por archivo, las líneas de código que el nuevo recupera y las que **pierde**. La
  segunda columna tiene que ser **0 en todos**. Es lo que caza un fallo de la regla de R13 o de
  la limitación de R14 sin tener que adivinar dónde.
- **Mutaciones (R18).** Tres, ejecutadas y con la lista de tests muertos escrita. Nunca en
  paralelo con el gate: el gate leería el árbol mutado y su veredicto no valdría.

---

## 9. Alternativas descartadas

### A. Parsear con el AST de TypeScript (`ts.createSourceFile`) — **descartada**

Es la solución «correcta de libro» y la más cara por todos lados. El compilador de TypeScript
entra en el camino caliente de 133+ suites: un parse completo por archivo, y el árbol se barre
miles de veces por corrida. Además **no sirve para tres de los cuatro consumidores**:
`schema.prisma` no es TypeScript, ni lo son `.sql` ni `.css`, y `codigoSinComentarios` se usa
sobre el schema de Prisma (`ayuda-columna-retirada.guardia.test.ts:164`). Y rompe la garantía
más importante que tiene el módulo —**mismo número de líneas** (R4)— salvo que se recomponga el
texto a mano a partir de los rangos, que es exactamente el trabajo que se quería evitar. Por
último, convierte un helper de 60 líneas sin dependencias en algo acoplado a la versión de
`typescript` instalada.

### B. Parchear el regex: añadir las comillas a la clase `[^:]` — **descartada, y es la que el árbol proponía**

Es literalmente lo que sugiere el comentario del cable trampa: *«el cambio es añadir las comillas
a la clase `[^:]`»*. Cierra **uno** de los tres casos —el `//` dentro de una cadena, R9— y **no
toca el que hace el daño grande**. Los dos peores archivos del árbol pierden 386 y 166 líneas por
un `/*` que abre bloque, no por un `//`. Con este parche seguirían perdiéndolas, y el arreglo
habría comprado la sensación de estar arreglado. Se descarta **con la medida delante**, no por
gusto.

### C. Reordenar las pasadas (primero `//`, después bloques) — **descartada**

Mueve el defecto de sitio en vez de cerrarlo, y a un sitio peor:

- Un `//` dentro de un bloque (`/* … ver https://x … */`, que en este árbol hay a montones en los
  docstrings) pasaría a comerse el resto de esa línea **antes** de que la pasada de bloque la
  viera. Hoy eso funciona bien; con el reorden, se rompe.
- Un `*/` dentro de un `//` desaparecería antes de que la pasada de bloque pudiera usarlo para
  cerrar, dejando bloques abiertos que se comen el resto del archivo.

Sigue sin haber estado compartido, que es la causa. Cambiar el orden de dos cosas ciegas no las
hace ver.

### D. Arreglar los 149 archivos uno a uno — **descartada, y ya se probó**

Es lo que hizo la 279: reescribió el comentario de `lib/auth/menu-visibility.ts` para no citar
`` `/mis-asignaciones/*` `` y recuperó **151 líneas** en ese archivo. Cerró un caso y dejó el
mecanismo intacto — su propia ficha lo dice, y por eso existe la 283. Reescribir la prosa de 149
archivos es más diff, más riesgo de tocar aserciones por accidente, y el archivo 150 vuelve
mañana porque **nada impide escribirlo**.

### E. Meter SQL y CSS en el mismo escáner ahora — **descartada con número**

Ver §6. Daño medido hoy: **0 líneas en 0 archivos** en las dos. Y en SQL el arreglo correcto es
un lexer distinto (dollar-quoting con tags anidados, `''`, identificadores, bloques que anidan).
Se difiere **con cable trampa**, no con una nota.

### F. Silenciar el rojo ajeno de `obtenerTarifa` mientras dure la rama — **descartada por decisión explícita del humano**

Es de la ficha 275, de otra sesión, y está `pending`. No se toca, no se anota, no se exime. El
gate de esta rama se juzga **contra ese rojo conocido** (R28).

---

## 10. Verificación y riesgos

**Gate: `./init.sh` COMPLETO** (R29), no `--rapido`. El diff no toca ninguna ruta de la lista que
niega el modo rápido, así que `--rapido` **pasaría** — y sería un verde sin significado. El
quitador es el instrumento con el que 133+ suites miden el árbol, y es el mismo argumento con el
que `docs/verification.md` manda al completo cuando se toca `init.sh`. El código de salida se
escribe **dentro** del log (`INIT_EXIT=$?`).

| riesgo | cómo se cubre |
| --- | --- |
| El escáner abre cadena en un apóstrofo de texto JSX y se come código | R13 + el censo diferencial de R15, que exige **0 pérdidas** archivo a archivo |
| Una regex con `/*` o `//` sin escapar abre comentario | R14 (limitación afirmada) + R15 (si ocurriera hoy, sale con nombre) |
| Una plantilla anidada cierra la de fuera y desalinea todo | R12, con caso propio |
| El barrido nuevo desalinea `archivo:línea` en algún censo | R4, con el caso de alineación ya existente re-verificado contra el escáner |
| Las guardias se ralentizan | R25/R26, medido antes y después, con mitigación escalonada en §7 |
| Se recupera código y se destapa una violación real | **Medido por el leader: 2 fallos de 2.140 casos, y ninguno es una violación.** Uno es el cable trampa (esperado, R19) y el otro el rojo ajeno de la 275 (R28). Aun así, T1.0b vuelve a correr las guardias antes de tocar nada más, y si aparece algo distinto **se para y se pregunta** |
| Alguien vuelve a introducir el defecto en el módulo | El cable trampa invertido (R19) y los tres casos de R16 mueren si se revierte el escáner — verificado por mutación (R18) |
