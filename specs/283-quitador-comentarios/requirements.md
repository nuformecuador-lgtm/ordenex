# Feature 283 — El quitador de comentarios abre bloque con un `/*` dentro de un `//` o de una cadena

> Requisitos en notación EARS. Numerados `R1`…`R29`. Sin detalles de implementación: el CÓMO
> vive en `design.md` y el desglose en `tasks.md`.
>
> **Alcance: `backend` (tooling).** Esta feature toca **un solo archivo de producción de
> pruebas**: `tests/fixtures/sin-comentarios.ts`, más el archivo de guardia del propio quitador
> (`tests/unit/guards/quitador-comentarios.guardia.test.ts`). **Cero migraciones, cero tablas,
> cero RLS, cero rutas, cero endpoints, cero código de `app/`, `lib/`, `components/`, `hooks/`,
> `db/` ni `scripts/`.**

---

## Glosario mínimo

- **El quitador** — `quitarComentarios(fuente)` de `tests/fixtures/sin-comentarios.ts`, y sus
  envoltorios `codigoSinComentarios(ruta)` y `lineasSinComentarios(fuente)`.
- **El texto barrido** — lo que el quitador devuelve. Es lo que leen las guardias que censan el
  árbol; ninguna de ellas ejecuta el código que vigila.
- **Las tres hermanas** — `quitarComentariosSql`, `quitarComentariosCss` y
  `lineasSinComentarios`, exportadas por el mismo módulo.
- **El cable trampa** — `quitador-comentarios.guardia.test.ts:292`, el caso que la feature 209
  dejó escrito consagrando la limitación **a propósito**, con la nota «si un día hace falta
  cerrarla … este caso es el que dirá que se cerró».
- **Barrido viejo / barrido nuevo** — el resultado de las dos pasadas de `replace` de hoy, y el
  del mecanismo que las sustituye.

---

## El defecto, confirmado en el árbol (no heredado)

El quitador hace dos `replace`: primero bloques `/* … */` (no ávido), después líneas `//`. Un
`/*` escrito **dentro de un comentario `//`** o **dentro de una cadena** abre bloque y se traga
todo hasta el siguiente `*/` del archivo. Confirmado leyendo el árbol en esta sesión:

| archivo | dónde abre | dónde cierra | qué se traga |
| --- | --- | --- | --- |
| `tests/unit/services/cotizacion-orden-service.test.ts` | **243**, `it("… no importa nada de next/* ni recibe Request (T5)")` — el `/*` está **dentro de una cadena** | **752**, el `*/` del docstring `/** El lote donde \`z1\` resuelve … */` | 510 líneas de span; **386 con código real** (cifra del leader) |
| `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` | **295**, `// aquí no hay import de \`lib/actions/**\` …` — el `/*` está **dentro de un `//`** | **543**, el `*/` de `/** Toda Server Action de \`lib/actions/**\` … */` | 249 líneas de span; **166 con código real** (cifra del leader) |

El propio árbol ya documenta el daño sin haberlo arreglado:
`cotizacion-orden-service.test.ts:914-916` dice *«El bloque de imports queda fuera de
`FUENTE_SERVICE`: el docstring de cabecera cita `next/*` y el quitador de comentarios se come
desde ahí hasta el primer `*/`»*. Es una guardia que sabe que está mirando menos código del que
cree, y lo deja escrito en vez de arreglarlo.

**Órdenes de magnitud confirmados por censo textual en esta sesión** (no ejecutado — ver
«Preguntas abiertas», P6): **78** apariciones de `/*` dentro de un `//` en **58** archivos
`.ts`/`.tsx`, y **196+** apariciones de `/*` dentro de un par de comillas en **94+** archivos.
**133** archivos importan directamente `tests/fixtures/sin-comentarios.ts`, más los que lo
consumen a través de `money-safe.ts`, `deteccion-maqueta.ts`, `css-reglas.ts`, `contraste.ts`,
`etiquetas-datatable.ts`, `aserciones-de-orden.ts`, `montajes-componente.ts` y
`_arbol-de-la-feature.ts`.

---

## Bloque A — Lo que el quitador ya hace bien y NO puede dejar de hacer

**R1 (Ubicuo).** El sistema DEBE eliminar del texto barrido todo comentario de bloque
`/* … */`, incluidos los de JSX `{/* … */}` y los docstrings multilínea, y DEBE hacerlo sin
avidez: dos bloques consecutivos NO DEBEN llevarse por delante el código que va entre ellos.

**R2 (Ubicuo).** El sistema DEBE eliminar todo comentario de línea `//` y `///` en las tres
posiciones en que aparece en este árbol: línea de comentario completa, comentario al final de
una línea de código, y comentario pegado al código sin espacio delante (`};// nota`).

**R3 (Ubicuo).** El sistema DEBE conservar íntegro todo el código que comparte línea con un
comentario eliminado, tanto el que va delante como el que va detrás de un bloque de una línea.

**R4 (Ubicuo).** El número de líneas del texto barrido DEBE ser siempre idéntico al del fuente
original, y `lineasSinComentarios(f)[i]` DEBE corresponder exactamente a la línea `i + 1` de
`f`, para cualquier `f`.

**R5 (Ubicuo).** El sistema NO DEBE interpretar una división como comentario: `a / b / c` DEBE
sobrevivir entero.

**R6 (Ubicuo).** El módulo DEBE seguir exportando los mismos seis símbolos con las mismas
firmas y el mismo significado (`quitarComentarios`, `quitarComentariosSql`,
`quitarComentariosCss`, `codigoSinComentarios`, `codigoCssSinComentarios`,
`lineasSinComentarios`). **Ningún archivo consumidor debe cambiar por esta feature.**

---

## Bloque B — El defecto que se cierra

**R7 (Condicional).** SI un fuente contiene la secuencia `/*` **dentro de un comentario de
línea `//`**, ENTONCES el sistema NO DEBE abrir un comentario de bloque, y todo el código de
las líneas siguientes DEBE seguir presente en el texto barrido.

**R8 (Condicional).** SI un fuente contiene la secuencia `/*` **dentro de una cadena** —comilla
simple, comilla doble o plantilla—, ENTONCES el sistema NO DEBE abrir un comentario de bloque, y
todo el código de las líneas siguientes DEBE seguir presente en el texto barrido.

**R9 (Condicional).** SI un fuente contiene la secuencia `//` **dentro de una cadena**,
ENTONCES el sistema NO DEBE tratarla como comentario de línea: la cadena DEBE conservarse
entera y el código que la sigue **en la misma línea** DEBE seguir presente.

**R10 (Ubicuo).** El sistema DEBE conservar enteras las URLs (`https://…`, `http://…`,
`url(//…)` sin comillas) y el código que las sigue en la misma línea. Este es el caso que el
`[^:]` del mecanismo actual protegía y que NO puede perderse.

**R11 (Condicional).** SI una cadena contiene una comilla escapada (`\"`, `\'`, `` \` ``),
ENTONCES el sistema NO DEBE darla por terminada en esa comilla.

**R12 (Ubicuo).** El sistema DEBE conservar íntegra toda cadena de plantilla, incluidas las que
abarcan varias líneas y las que anidan otra plantilla dentro de una interpolación `${…}`.

---

## Bloque C — Los límites, declarados y medidos

**R13 (Condicional).** SI una comilla simple o doble no encuentra su pareja **antes del fin de
su línea**, ENTONCES el sistema NO DEBE tratarla como apertura de cadena. Un texto JSX del tipo
`<p>Don't panic</p>` seguido de código en las líneas siguientes DEBE dejar ese código intacto.
La misma regla aplica a la plantilla `` ` `` con el resto del archivo como ventana.

**R14 (Ubicuo).** El sistema NO DEBE intentar reconocer literales de expresión regular. Esta
limitación DEBE quedar **afirmada por un caso de prueba** que la haga un hecho conocido, con el
mismo formato con el que la 209 y la 223 dejaron escritas las suyas.

**R15 (Ubicuo).** Para todo fuente `.ts`/`.tsx` del árbol —excluidos `node_modules`, `.next`,
`.claude`, `dist`, `coverage` y `.design-work`— el barrido nuevo NO DEBE perder ninguna línea de
código que el barrido viejo conservara. El cambio solo puede recuperar, nunca perder.

---

## Bloque D — Cómo se demuestra que el arreglo funciona

**R16 (Ubicuo).** Para cada uno de los tres casos del defecto —`/*` dentro de un `//` (R7),
`/*` dentro de una cadena (R8) y `//` dentro de una cadena (R9)— DEBE existir un caso de prueba
que, ejecutado contra **la implementación anterior**, **falle**, y contra la nueva **pase**. Los
tres DEBEN estar escritos en las dos caras: que el código invisible reaparece **y** que los
comentarios de verdad se siguen quitando.

**R17 (Ubicuo).** El censo diferencial sobre el árbol DEBE quedar registrado con su número
exacto: cuántos archivos y cuántas líneas de código recupera el barrido nuevo respecto del
viejo, con la misma lista de exclusiones de R15.

**R18 (Ubicuo).** Cada caso de prueba nuevo DEBE morir ante la reversión del mecanismo. Se
DEBEN ejecutar y registrar al menos tres mutaciones: volver a las dos pasadas de `replace`,
quitar la regla de R13, y devolver la cadena vacía.

---

## Bloque E — El cable trampa y la prosa que queda falsa

**R19 (Ubicuo).** El caso `quitador-comentarios.guardia.test.ts:292` **NO DEBE borrarse**. DEBE
conservarse en su archivo y en su `describe`, reescrito para afirmar **el comportamiento
nuevo**: que sobre `if (!p.startsWith("//")) { llamar(); }` el texto barrido conserva
`llamar()` y conserva la cadena `"//"`; y —para que el caso no pase por no quitar nada— que un
comentario de verdad al final de esa misma línea **sí** desaparece. Su comentario DEBE decir que
la limitación quedó cerrada, por qué ficha y en qué fecha, cerrando la frase que la 209 dejó
abierta.

**R20 (Ubicuo).** El bloque de documentación de `tests/fixtures/sin-comentarios.ts` que hoy
afirma «No es un parser de TypeScript. No entiende cadenas ni expresiones regulares: un `//`
dentro de un literal se lleva por delante el resto de la línea. Eso está ELEGIDO» DEBE dejar de
afirmarlo y DEBE describir lo que el quitador hace ahora, **incluyendo lo que sigue sin hacer**
(R14) y por qué eso es aceptable.

**R21 (Ubicuo).** Los comentarios del árbol que afirman la limitación como vigente DEBEN dejar
de afirmarla, **sin tocar ninguna aserción**. El conjunto es cerrado y está censado en `tasks.md`
(T0.4); incluye como mínimo el docstring de `quitarComentariosCss`, la cabecera del `describe`
de la 223, y el paréntesis de `tests/unit/services/cotizacion-orden-service.test.ts:914-916`
—que hoy explica un rodeo que ya no hará falta— (ver «Preguntas abiertas», P4).

---

## Bloque F — Las tres hermanas

**R22 (Ubicuo).** `lineasSinComentarios` DEBE seguir derivando sus líneas del **mismo** texto
barrido que `quitarComentarios`, sin lógica propia. Hereda R7–R13 por construcción y NO DEBE
tener un juego de reglas paralelo.

**R23 (Ubicuo).** `quitarComentariosSql` y `quitarComentariosCss` **NO se modifican en esta
feature**, y el motivo medido DEBE quedar escrito en `design.md`. La deuda que eso deja NO DEBE
quedar sin vigilancia: DEBE existir un caso que falle nombrando el archivo SI algún `.sql` de
`db/migrations/**` cumple la precondición del daño, es decir SI contiene un `/*` dentro de un
comentario `--` o dentro de un literal **y además** un `*/` posterior en el mismo archivo, o SI
contiene un `--` dentro de un literal de cadena.

**R24 (Ubicuo).** DEBE existir un caso equivalente para CSS: falla SI `app/globals.css` estrena
un `/*` dentro de una cadena CSS. Además, la comprobación existente que hoy compara las dos
pasadas sobre `app/globals.css` DEBE seguir en verde, y DEBE quedar acompañada de un caso que
afirme sobre una hoja **sintética** que `quitarComentariosCss` sigue sin proteger las cadenas
—para que esa deuda no se vuelva invisible justo cuando `quitarComentarios` deje de compartirla—.

---

## Bloque G — Rendimiento

**R25 (Ubicuo).** El tiempo de `pnpm run test:guardias` DEBE medirse **antes y después** del
cambio, sobre el mismo árbol y la misma máquina, con al menos tres corridas y quedándose con la
mediana. Los dos números DEBEN quedar escritos en `progress/impl_283.md`.

**R26 (Condicional).** SI la mediana de después supera a la de antes en **más de un 15 % o más
de 3 segundos absolutos** —lo que ocurra primero—, ENTONCES la feature NO DEBE cerrarse sin una
mitigación implementada y **vuelta a medir** con el mismo método (ver «Preguntas abiertas», P1).

---

## Bloque H — Alcance y estado ajeno

**R27 (Ubicuo).** El sistema NO DEBE modificar ninguna guardia distinta de
`tests/unit/guards/quitador-comentarios.guardia.test.ts`, ni ningún archivo de `app/`, `lib/`,
`components/`, `hooks/`, `db/`, `scripts/` o `init.sh`. En particular NO DEBE tocar
`lib/actions/tarifas.ts` ni nada de la ficha 275, ni `db/migrations/**`. La guardia local que la
279 dejó en `tests/unit/auth/menu-visibility.test.ts` (R45/R46) **se conserva sin tocar**, aunque
el mecanismo que la motivó quede cerrado (ver «Preguntas abiertas», P7).

**R28 (De estado).** MIENTRAS la ficha 275 siga `pending`, el sistema DEBE dejar el rojo de
`tests/unit/guards/superficie-de-uso.guardia.test.ts` sobre `obtenerTarifa` **exactamente como
está**: sin arreglarlo, sin silenciarlo, sin anotarlo y sin añadirlo a ninguna exención. El gate
de esta rama se juzga **contra ese rojo conocido**.

**R29 (Ubicuo).** El cierre de esta feature DEBE verificarse con **`./init.sh` COMPLETO**, no
con `--rapido`. El quitador es el instrumento con el que 133+ suites miden el árbol: es el mismo
argumento por el que `docs/verification.md` manda al gate completo cuando se toca `init.sh`
—«tocar el gate cambia **la medida** con la que se mide todo lo demás; un fallo aquí no se ve
como un rojo, se ve como **un verde que no significa nada**»—. El código de salida DEBE quedar
escrito **dentro** del log (`INIT_EXIT=$?`), no inferido de la consola.

---

## Preguntas abiertas

**P1 — El umbral de rendimiento.** He fijado **+15 % o +3 s absolutos** sobre la mediana de
`pnpm run test:guardias` como línea de «hay que mitigar». No hay ningún umbral escrito en
`docs/`; el único número disponible es «las guardias cuestan ~8 s» (`docs/verification.md`,
medido el 2026-08-03). ¿Es ese el umbral que quieres, o prefieres otro?

**P2 — CSS: ¿se cierra ahora o se difiere con cable trampa?** Mi decisión, medida, es
**diferirlo** (`design.md` §6). Si prefieres cerrarlo en esta ficha, el coste es una entrada más
en la tabla de tokens del escáner y dos casos de prueba; no cambia nada más. Dímelo y lo muevo.

**P3 — SQL: ¿se acepta el diferimiento?** El daño medido hoy es **cero líneas en cero archivos**
(§6), pero el arreglo correcto **no es el mismo escáner**: necesita lexer de `$tag$` con tags
anidados (medido: 7 archivos con `$$`, y `20260825130000_tarifas_reconciliar_par_zona_tienda`
anida `$q$` **dentro** de `$$`), escape `''`, identificadores `"…"` y bloques `/* */` que en
Postgres **anidan**. ¿Se difiere con el cable trampa de R23, o lo quieres dentro?

**P4 — El paréntesis de `cotizacion-orden-service.test.ts:914-916`.** Es un test de otra ficha
y su prosa queda **falsa** al cerrarse el defecto (describe un rodeo que ya no hará falta). R21
pide actualizarlo **sin tocar ninguna aserción**. ¿Autorizas tocar ese archivo solo para eso, o
lo dejo estar y lo anoto como deuda?

**P5 — `init.sh` y la lista de rutas que niegan `--rapido`.** `tests/fixtures/sin-comentarios.ts`
es el instrumento de medida de 133+ suites y **no** está en esa lista. Añadirlo sería coherente
con la fila de `init.sh` de la tabla de `docs/verification.md`, pero cambia el arnés y queda
fuera del alcance que me diste. ¿Lo propongo como ficha aparte?

**P6 — Los números agregados no se pudieron re-ejecutar en esta sesión.** Este agente no tuvo
herramienta de shell, así que **confirmé el mecanismo leyendo el árbol** (los dos peores
archivos, el cable trampa, y los censos textuales de las hermanas), pero **no** pude re-correr
el censo del leader: 2.698 archivos, 149 archivos / 1.958 líneas perdidas, 152 archivos / 4.599
recuperadas, 2.140 casos de guardia, `tsc` en 0 errores. `tasks.md` los pone en **T0.1 como
primer paso bloqueante**, con el precedente explícito de la 279 («no se heredó el número: se
volvió a medir»). ¿De acuerdo, o prefieres que se den por buenos?

**P7 — R45/R46 de la 279 en `menu-visibility.test.ts`.** Son una guardia local que prohíbe
abrir un bloque dentro de un `//` **en ese archivo concreto**; era la mitigación puntual del
mecanismo que esta ficha cierra. Mi propuesta es **no tocarla** (R27): sigue siendo una regla de
legibilidad válida y su mutación (f) sigue matándola. ¿Se queda?
