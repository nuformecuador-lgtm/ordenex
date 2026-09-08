# Ficha 384 — informe de implementación

> `CHECKPOINTS.md > Trazabilidad` exige este archivo con el mapa `R<n> → test`. La ficha es
> `sdd: false` y **no hay `specs/384/`**, así que los requisitos de ESTA ficha se enuncian aquí:
> es el único sitio donde pueden vivir. Los requisitos que el código cita con número —`R31`,
> `R34`, `R35`, `R38`, `R39`, `D11`, `D12`— son de la **feature 234**
> (`specs/234-descarga-cierres-general-y-detallada/`) y esta ficha **no los cambia**.
>
> Este archivo lo pidió `progress/review_384.md > BLOQUEANTE 1`, y con un coste medido: para
> confirmar las mutaciones el revisor tuvo que **reconstruirlas en vez de reproducirlas**, y él
> mismo señala que su mutación 6 pudo ser «una prima» de la mía por otro camino. Por eso abajo
> van con su **texto literal**.

**Rama:** `fix/384-descarga-cierres-prefiltra-hoy` · **Implementación:** `20e5f42b` ·
**Revisión:** `16236624` · **Cierre (esta entrega):** el commit que trae este archivo
**Zona:** frontend · **Fecha:** 2026-09-07 · **Migración:** ninguna, y no hace falta

## Qué arregla, en una línea

El diálogo de la descarga **detallada** de cierres abría con el rango de fechas puesto en
**hoy–hoy** sin que nadie lo pidiera, devolvía un archivo vacío y echaba la culpa a «los filtros
aplicados» — unos filtros que el usuario no había puesto.

## La causa, medida (no supuesta)

- `app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx`, antes de esta ficha:
  `useState(() => fechaCalendarioCR())` **en los dos extremos**, `desde` y `hasta`. El defecto
  venía de un pedido humano del 2026-08-19 («el cierre del día de toda la flota, sin cuatro
  interacciones»).
- **Confirmado contra producción el 2026-09-07: 52 cierres en total, CERO solicitados hoy**, el
  último del 2026-09-06. Por eso volvía vacío. Reproducible sin datos de prueba: basta abrirlo un
  día sin cierres.
- El aviso lo pone `components/shared/DescargarDatasetButton.tsx` («No hay datos que descargar con
  los filtros aplicados. Ajusta los filtros y vuelve a intentarlo»), y ese texto **lo comparten
  ~26 tablas**: es correcto para ellas, que descargan con la barra de filtros de su pantalla.
- Reportado por el humano así: «si no tengo filtros aplicados no me deja descargar lo que se está
  mostrando en los cierres».

## Por qué la salida (a) — el rango arranca vacío — y no la (b)

El encargo daba dos salidas: **(a)** arrancar sin rango, o **(b)** conservarlo y **decirlo en
pantalla**, distinguiendo «no hay nada en el rango que traes puesto» de «no hay nada».

**(b) ya estaba implementada, y ya había fallado.** La ayuda del diálogo decía, literalmente,
«Arranca en el día de hoy», y los dos `input type="date"` mostraban la fecha. Aun así el usuario
lo vivió como «no tengo filtros aplicados» — porque no los había puesto él. Un recorte que se
aplica solo y se anuncia en letra pequeña es un fallo mudo aunque esté escrito. Elegir (b) habría
sido dejar el statu quo con mejor redacción.

**Se miró si el defecto protegía algo, como pedía el encargo.** El argumento vivo era R31 de la
234: «a grano de gestión choca contra el tope de 5000 filas casi siempre». Dos cosas:

1. Ese tope **lo aplica el servidor** (`CierresAdminService.listarGestionesCierresAdminCompleto`
   con `descargaConfig.MAX_FILAS`), y su fallo es **ruidoso y accionable**: `mensajeLimite()`
   (`components/shared/descarga-resultado.ts`) dice el total, dice el tope y dice «acota los
   filtros —por ejemplo, el rango de fechas—».
2. El «casi siempre» **se escribió en agosto de 2026 y no se ha vuelto a medir**. Lo medido es
   que producción tenía 52 cierres el 2026-09-07.

Así que el intercambio es: **un resultado callado y equivocado a cambio de un aviso ruidoso y
correcto**. Es el intercambio bueno, y el revisor lo ratificó (`review_384.md > menor 3`).

## El botón «Hoy», y su vuelta «Limpiar»

Quitar el defecto **sin sustituto** encarecía el caso diario del pedido del 2026-08-19 de cero
interacciones a cuatro (abrir dos selectores de fecha y teclear la misma fecha dos veces). El
atajo **«Hoy»** lo deja en **un clic** — menos que los «dos clics de fecha» que aquel defecto vino
a ahorrar. Se mandó ofreciendo vetarlo; el revisor recomendó conservarlo con un argumento mejor
que la duda con la que se mandó: **no reintroduce el defecto, lo invierte** — un botón que se
pulsa es, por definición, un filtro que sí puso el usuario.

En el cierre se le añadió su **contrapartida, «Limpiar»** (`review_384.md > menor 2`): un filtro
que se pone en un clic tiene que quitarse en un clic. Un `input type="date"` nativo no ofrece
ningún aspa, así que sin esto «Hoy» era de ida y no de vuelta, y volver a «todo el historial»
exigía enfocar los dos campos y borrarlos a mano. Además, la ayuda **recuperó** la instrucción que
se había perdido al reescribirla: «vaciá una fecha para quitar ese extremo».

## Los requisitos de esta ficha

**R1 — el diálogo no aplica ningún recorte que el usuario no haya puesto.**
Al abrirse, los dos extremos del rango **deben** estar vacíos, y lo que viaja al borde **debe**
contener **solo** `mensajeroIds`. Una fecha vacía no se declara: `desde: undefined` no es «sin
fecha», es una clave de más contra la lista blanca `.strict()` del borde.
*Por qué se afirma sobre lo que VIAJA y no solo sobre el píxel:* un control pintado en blanco que
aun así mandara `desde` sería exactamente el mismo fallo mudo, movido de sitio.

**R2 — el aviso de conjunto vacío no culpa a filtros inexistentes.**
Cuando la lectura vuelve sin filas, el diálogo **debe** decir un mensaje propio que distinga «no
hay nada en el rango que pusiste» de «no hay nada», y **no debe** reutilizar el texto compartido
que manda ajustar los filtros. La variante **debe** elegirse por el estado del CLIENTE y **nunca**
por la respuesta del servidor.
*Por qué esa última frase es un requisito y no un detalle:* si la elección mirase la respuesta,
«este mensajero no tiene cierres» y «este mensajero no es de tu alcance» dejarían de ser
indistinguibles y se filtraría información sobre el alcance ajeno — **R38/D12 de la 234**.

**R3 — poner el rango y quitarlo cuestan lo mismo.**
El diálogo **debe** ofrecer un atajo que ponga el día de hoy en **los dos** extremos y otro que
los vacíe **los dos**, y la ayuda visible **debe** decir cómo se quita un extremo.

**Lo que esta ficha NO toca, y está decidido:** los filtros del diálogo siguen siendo
independientes de la barra de la pantalla (**D11, R34/R35**); `mensajeroIds` sigue obligatorio y no
vacío (**R39**, ratificado por el humano el 2026-08-18); el nivel «Resumen» sigue descargando con
los filtros de la pantalla; y **el mensaje compartido de `DescargarDatasetButton` no se tocó**, así
que las ~26 tablas restantes no cambian ni una línea.

## Mapa R → test

Todos en `tests/components/descarga/DescargarGestionesDialog.test.tsx` salvo donde se diga.

| R | Qué clava | Test |
| --- | --- | --- |
| R1 (el píxel) | los dos extremos abren vacíos y todos los mensajeros marcados | › «abre con todos los mensajeros marcados y SIN rango de fechas (ficha 384)» |
| R1 (lo que viaja) | `Object.keys(enviado)` es exactamente `["mensajeroIds"]` | idem, mismo caso |
| R2 (sin rango) | el literal del aviso, y que **no** contiene «con los filtros aplicados» | › «sin rango puesto, el aviso no culpa a ningún filtro de fecha» |
| R2 (con rango) | el literal de la otra variante, con **un solo** extremo puesto y con los dos | › «con rango puesto, el aviso dice que es EL RANGO lo que no trae nada» |
| R2 (R38/D12 intacto) | dos mensajeros distintos con cero filas → **el mismo** texto, y el texto **clavado** | › «dos mensajeros distintos con cero filas producen el mismo aviso (D12/R38)» |
| R2 (R38 en la pantalla) | el caso **preexistente**, que esta ficha no debía romper | `tests/components/descarga/CierresAdminDescargaDetallada.test.tsx` › «un mensajero sin cierres y uno fuera de alcance producen el mismo mensaje (R38)» |
| R2 (no hay archivo) | cambia el texto, no el comportamiento: `descargarBlob` no se llama | los tres casos del aviso |
| R3 (ida) | «Hoy» pone el día en **los dos** extremos y entonces sí viaja | › «el atajo «Hoy» pone el día en los dos extremos, y entonces sí viaja (ficha 384)» |
| R3 (vuelta) | «Limpiar» vacía **los dos** y la clave deja de viajar | › «« Limpiar» deshace el atajo y el rango deja de viajar (ficha 384)» |
| R3 (la ayuda lo dice) | el copy visible, como literal | › «la ayuda dice qué recorta, qué es estar vacío y cómo volver atrás (ficha 384)» |
| D11 · R34/R35 (234) | siguen verdes **sin tocarlos**: el diálogo no lee ni modifica ningún filtro de pantalla | › el describe «independencia de la barra de filtros de la pantalla» |
| R39 (234) | sigue verde sin tocarlo: sin mensajeros no se llama al borde | › «cancelar o confirmar sin selección no produce archivo ni llama al borde» |
| R31 (234) | sigue verde sin tocarlo: el rango que el usuario pone viaja | › «ofrece un rango de fechas que viaja al borde» y «una fecha vacía no viaja» |
| R13/R36 (234) | la puerta única aguanta el `await` intercalado: `filasDesdeResultado(accion(…))` sigue siendo el único camino | `tests/unit/descarga/cierres-descarga-detallada-puerta.test.ts` (sin tocar) |

## Las mutaciones — 9 propias + 1 del revisor, 10 muertas

Cada una se aplicó al **árbol real**, se corrió la suite y se revirtió **desde copia** (`cp`, nunca
`git checkout`: había trabajo sin commitear). El arnés **se autocomprueba**: si el fragmento a
mutar no aparece exactamente una vez, sale con código 2 y **no escribe nada** — un arnés que no
encuentra qué mutar no puede reportar supervivientes.

Línea base sin mutar en el cierre: **19/19 verdes** en el archivo del diálogo.

| # | Mutación (texto literal) | Resultado |
| --- | --- | --- |
| **M1** | `useState("")` → `useState(() => fechaCalendarioCR())` en los **dos** extremos | **MUERTA** — 2 rojos en la implementación; **3** tras el cierre (se suma el caso de D12 con su literal clavado). Es **la regresión que la ficha cierra**: el test nuevo falla con el código de ayer, y falla por la razón exacta del defecto. |
| **M2** | `conRango = desde !== "" \|\| hasta !== ""` → `&&` | **MUERTA** — 1 rojo. Un «Desde» suelto dejaría de contar como recorte. |
| **M3** | borrar el bloque `if (resultado.status === "ok" && resultado.filas.length === 0)` entero | **MUERTA** — 2 rojos. Vuelve el mensaje compartido. |
| **M4** | `conRango ? MENSAJE_SIN_DATOS_EN_RANGO : MENSAJE_SIN_DATOS` → los dos **intercambiados** | **MUERTA** — 2 rojos. |
| **M5** | en `ponerHoy`, quitar `setHasta(hoy)` | **MUERTA** — 1 rojo. |
| **M6** | `mensaje: elegidos[0]?.startsWith("1") ? … : …` (el aviso pasa a depender de **QUÉ mensajero** se eligió; los ids de Ana empiezan por 1 y los de Beto por 2) | **MUERTA** — 3 rojos, **uno preexistente**: el caso R38 de `CierresAdminDescargaDetallada.test.tsx`. Es la no-vacuidad de D12/R38. |
| **M6-bis** | *(del revisor)* la fuga de alcance **de verdad**: elegir el aviso según si los elegidos están en `catalogo.mensajerosFiltro`, con un tercer texto | **MUERTA** — 3 rojos en el diálogo. El caso preexistente no cae aquí y el revisor midió por qué: en **su** fixture los dos mensajeros están en `mensajerosFiltro`, así que para él la mutación es inerte. No es un agujero: los tres rojos del diálogo la cazan igual. |
| **M7** | en `limpiarRango`, quitar `setHasta("")` | **MUERTA** — 1 rojo. La vuelta a medias. |
| **M8** | `RANGO_AYUDA` de vuelta al texto anterior («Arranca en el día de hoy; vaciá una fecha…») | **MUERTA** — 1 rojo. Sin el caso del `menor 5`, esta mutación **sobrevivía**. |
| **M9** | `conRango ? MENSAJE_SIN_DATOS_EN_RANGO : MENSAJE_SIN_DATOS_EN_RANGO` — los **dos** avisos pasan a ser el mismo texto EQUIVOCADO | **MUERTA** — 2 rojos, **uno de ellos el caso de D12**. Es la medida del `menor 4`: la igualdad `calls[1] === calls[0]` sigue verde bajo esta mutación; **solo el literal clavado la caza**. |

## Los dos textos, y cuándo sale cada uno

| Caso | Qué ve quien descarga |
| --- | --- |
| Vuelve sin filas y **el usuario puso** alguna fecha | «No hay gestiones de cierre en el rango de fechas elegido para esos mensajeros. Ampliá el rango o vaciá las fechas y volvé a intentarlo.» |
| Vuelve sin filas y **no hay ninguna fecha puesta** | «Los mensajeros elegidos no tienen gestiones de cierre. Elegí otros mensajeros y volvé a intentarlo.» |
| Las otras ~26 tablas del árbol | **sin cambios**: «No hay datos que descargar con los filtros aplicados. Ajusta los filtros y vuelve a intentarlo.» |

En los tres casos: **ningún archivo**. Cambia el texto, no el comportamiento.

**Cómo se redacta sin tocar el mensaje compartido:** `DescargarDatasetButton` ya da **prioridad** al
mensaje que venga de `obtenerFilas` cuando el resultado es `error`. El diálogo envuelve
`filasDesdeResultado`, y si vuelve `ok` con cero filas devuelve `error` con su texto. Efecto
idéntico al de antes (aviso por toast, ningún archivo); lo único que cambia es la redacción, y
solo aquí.

## Los tres sitios que afirmaban el comportamiento viejo

El párrafo de R31 —«sin ellos el conjunto por defecto es todo el histórico del mensajero, que
choca contra el tope de 5000 casi de inmediato»— vivía **repetido en tres archivos**. Corregir uno
solo deja los otros **mintiendo**, que es peor que no tener comentario: el siguiente que los lea
creerá que el rango arranca en hoy.

1. `app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx` — corregido en `20e5f42b`.
2. `lib/types/filtros-cierres.ts` — el gemelo que encontró el revisor (`menor 1`), corregido en el
   cierre.
3. `lib/services/CierresAdminService.ts` — **un TERCER sitio que la revisión no señaló**,
   encontrado al buscar si había más. Corregido en el cierre.

Los tres con el mismo criterio: **no se borra el párrafo, se le añade el matiz** —que los controles
existan es R31, que vinieran rellenos era otra cosa; que el «casi de inmediato» no se ha vuelto a
medir; y que hoy el que corta es el tope del servidor, a propósito—. En `lib/` se respetó el estilo
**sin tildes** de esos dos archivos.

**No hay un cuarto sitio en código vivo.** Lo que queda diciendo lo de antes es histórico y se deja
como está: `specs/234-…/design.md` (§372, §616) y `progress/current.md` (§2547) son fotos de una
decisión de agosto, no descripciones del código de hoy.

## Cómo se verificó

- **`./init.sh` completo**, no el rápido: el rápido **se niega solo** aquí por dos vías —la ruta
  `app/(app)/cierres-admin/…` casa `NOMBRES_DE_DINERO` (`cierre`), y el cierre toca además
  `lib/types/`, que está en `RUTAS_SENSIBLES`—.
- `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea; sin `tail` en la tubería; log con
  nombre propio (`/tmp` es compartido entre worktrees y dos agentes se pisan el veredicto).
- **`.env` copiado desde la raíz del repo** al worktree: sin él, 132 archivos de
  `tests/integration/db` se saltan y el gate **imprime verde igual**. El log lo confirma con
  «DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan». Se borró al
  terminar; quien vuelva a correr el gate aquí tiene que copiarlo otra vez.
- **Los `skipped` se miraron, no solo el `INIT_EXIT`.**
- **Sin migración y sin tocar la base**: la ficha no la necesita, y la base local es compartida
  entre worktrees.

### Las tres corridas

| Corrida | Árbol | `INIT_EXIT` (leído de dentro del log) | Archivos | Tests | `skipped` |
| --- | --- | --- | --- | --- | --- |
| Implementación | `20e5f42b` | **0** | 1770/1770 | 25 283 | 26 |
| Implementación (2ª, tras retocar un comentario) | `20e5f42b` | **0** | 1770/1770 | 25 283 | 26 |
| **Cierre (esta entrega)** | este commit, sin el `.md` | **0** | 1770/1770 | **25 285** | 26 |

Los **+2** del cierre son los dos casos nuevos: «Limpiar» y el texto de ayuda.

**Los 26 `skipped` están contados y son ajenos a la ficha:** **17** en `AnaliticaPage.test.tsx` y
**9** en `AnaliticaShell.test.tsx`, preexistentes. **Cero saltados en `integration/db`.**

Hubo dos corridas en la implementación porque tras la primera se retocó un comentario, y un gate
que lee un árbol ya mutado no vale ([[gate-y-mutaciones-no-en-paralelo]]); se relanzó entero en vez
de fiarse. La del cierre salió verde **a la primera**: el flake de saturación que le tocó al
revisor (`CierresDescargaColumnas.test.tsx`, `Test timed out in 20000ms`, verde en sus 6 corridas
aisladas) **no apareció**.

## Lo que queda vivo

1. **Nadie ha visto esto en la app real.** Lo que hay son casos en jsdom con `userEvent` y el gate
   completo. En este repo eso no basta y está medido: mirar la app encontró siete textos rotos que
   doce mil tests daban por buenos. Pendiente de verificación humana: `/cierres-admin` →
   «Descargar» → nivel «Detalle» → descargar **sin tocar nada** (debe traer el histórico, no un
   vacío), y luego «Hoy» / «Limpiar».
2. **El defecto nuevo es ilimitado, y hay que vigilarlo** (`review_384.md > menor 3`). El conjunto
   por defecto pasa a ser todo el histórico de toda la flota. Hoy queda lejísimos del tope (52
   cierres, arranque comercial del 2026-08-25) y el fallo del otro lado es bueno; pero el día que
   el histórico crezca, el botón por defecto empezará a fallar hasta que el usuario acote. Ese día
   la palanca es el atajo —«Hoy», o uno nuevo tipo «último mes»—, **no** volver a poner un defecto
   que nadie ve.
3. **El «choca contra el tope casi siempre» de R31 sigue sin medirse.** Lo honesto sería contar las
   gestiones por mensajero en producción y saber a qué distancia real está el tope. No se hizo aquí
   porque la ficha no lo necesitaba y porque es frontend: queda anotado, no resuelto.
4. **`MENSAJE_SIN_MENSAJERO` y `MENSAJE_RANGO_INVERTIDO` siguen sin fijarse enteros** por ningún
   test (sus casos usan `toMatch(/mensajero/i)` y `/invertido/i`). Es la norma del archivo y no se
   cambió; queda dicho porque `RANGO_AYUDA` acaba de dejar de serlo por el mismo argumento.
5. **Este archivo se escribió DESPUÉS de la última corrida del gate**, igual que `impl_382.md`.
   Es inerte para él, y se comprobó archivo por archivo en vez de darlo por hecho: de todo el
   árbol de tests, los únicos que leen `progress/` son las cuatro guardias de analítica y
   `no-embalaje.test.ts`. Las primeras solo abren los `decision*.md` citados desde el código; la
   segunda lleva `"progress"` en su `IGNORED_DIRS`, así que ni lo recorre. Y `progress/**` no entra
   en typecheck ni en lint. Un `.md` aquí no puede cambiar el veredicto.
