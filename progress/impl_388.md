# Ficha 388 — informe de implementación

> `CHECKPOINTS.md > Trazabilidad` exige este archivo con el mapa `R<n> → test`. La ficha es
> `sdd: false` y **no hay `specs/388/`**, así que el contrato es el `status_note` de la ficha.
>
> **Este diff NO introduce ningún `R1` ni `R2`** —lo comprobé sobre el diff, no de memoria—, y
> conviene decirlo porque el modelo que sigue este informe (`impl_382.md`) sí los tenía que
> enunciar. Todos los `R<n>` que aparecen son de fichas **anteriores**, siguen vigentes y no se
> tocan. Aquí se recuerdan para que nadie los busque en un `specs/388/` que no existe:
>
> | Cita | De dónde es | ¿La cita mi código? | Qué dice, en una línea |
> | --- | --- | --- | --- |
> | **R33** | feature **314** (selector de columnas) | sí | sin `ambitoColumnas` la clave es `null`: el hook «no lee, no escribe y devuelve las columnas declaradas tal cual» |
> | **R29** | feature **314** | sí | la preferencia guardada se **sanea contra las columnas publicadas**: toda clave que ya no corresponda a una columna se descarta |
> | **R66/R67** | ficha **347** (dinero por producto) | sí | sin la concesión el archivo no lleva **ninguna** columna de dinero: ni vacía, ni en cero |
> | **R76** | ficha **347** | sí | con `limite_excedido` **tampoco** se sirven cifras — y ése es el estado transitorio que hace que esta ficha muerda |
> | **R10** | feature **314** | no — solo este informe | cambiar la preferencia de un ámbito **no debe** alterar la de ningún otro. Es la propiedad que sostiene toda la decisión de abajo |
> | **R16/R30** | feature **314** | no — solo este informe | sin preferencia guardada sale el catálogo íntegro, en el orden del catálogo |

**Rama:** `feat/388-columnas-descarga-productos` · **Implementación:** `109719e0` ·
**Revisión:** `9857664e` (veredicto **OK**, sin bloqueantes) · **Cierre (esta entrega):** el commit
que trae este archivo · **Base:** `09ff18ee`
**Zona:** frontend · **Fecha:** 2026-09-07 · **PR:** #727

## Qué arregla, en una línea

El botón de descarga de la tabla **detalle-productos** de `/analitica` no dejaba elegir columnas,
mientras que `cierre-dia`, `cierres-admin` y `/ordenes` sí. Ahora sí, con **dos** ámbitos de
preferencia —uno por juego de columnas— porque el juego de esta tabla es condicional.

## Lo que la ficha pedía y lo que de verdad había que arreglar

El humano lo pidió como «que sea el mismo componente de descarga, el parametrizable». **Ya lo
era**: `ProductosTabla.tsx` monta la descarga por la prop `descarga` del `DataTable`, y
`DataTable` renderiza `DescargarDatasetButton` (`DataTable.tsx:543-548`). Lo que le faltaba era
**el parámetro** `ambitoColumnas`, que es el que enciende el selector (R33 de la 314). O sea:
no había que cambiar de componente, había que **declarar el ámbito**. Cambio de tres líneas de
cableado; lo demás de esta ficha es la decisión de abajo.

## La decisión: DOS ámbitos, no uno

Las columnas de esta tabla son **condicionales**: once sin la concesión de dinero y veinte con
ella. Un ámbito es la mitad de una clave de `localStorage`, y su catálogo es lo que el hook usa
para **sanear** lo guardado. Con un solo ámbito para los dos juegos el fallo es real y **mudo**:

1. `usePreferenciaColumnas.alternar` (`hooks/usePreferenciaColumnas.ts:160-191`) lee la
   preferencia, la **sanea contra las columnas publicadas** (R29) y **vuelve a escribir lo ya
   saneado**. El saneo no es solo de lectura: **se persiste**.
2. Luego, un clic del selector estando **sin** dinero tira las nueve claves de dinero por no estar
   publicadas y las guarda sin ellas. Al volver la concesión, esas columnas **reaparecen marcadas**
   sin que nadie las haya vuelto a marcar, sin error y sin test rojo.
3. Y no hace falta perder el permiso para caer ahí: `ProductosTabla.tsx:914` es
   `const conDinero = dinero && estadoDinero?.estado === "concedido"`, así que `conDinero` también
   es `false` con **`limite_excedido`** (R76), que es un estado **transitorio** del servidor. El
   mismo actor, en la misma pantalla, salta de un juego al otro entre dos consultas.

Es el mismo motivo por el que la descarga de cierres le da un ámbito propio a cada nivel de
detalle (`DescargarCierresButton`): juegos distintos, claves distintas. **Coste declarado:** lo que
se oculta con dinero no se hereda sin dinero ni al revés — son dos archivos y cada uno recuerda lo
suyo.

**Cómo se cablea, y por qué así.** `columnas` y `ambitoColumnas` viajan **emparejados en un mismo
objeto** de módulo (`descargaAnaliticaProductos(conDinero)`), no elegidos por dos ternarios
independientes: dos ternarios se pueden desincronizar y el resultado sería la preferencia de un
juego aplicada al otro, que es justo lo que estos dos ámbitos evitan. Los objetos están **a nivel
de módulo** porque la identidad de `columnas` es dependencia de los `useMemo` del hook.

**El estilo raro tiene motivo:** en el JSX el ámbito baja como **propiedad abreviada**
(`ambitoColumnas,`). `ambito-columnas.guardia` lee el árbol **como texto** y solo resuelve
literales e identificadores; la forma legible (`ambitoColumnas: descargaArchivo.ambitoColumnas`) o
un ternario le salen sin resolver y la ponen roja. **Comprobado con una mutación** (abajo), no
supuesto. La declaración que la guardia **sí** lee vive junto a las columnas, que es donde puede
contrastarse contra el resto del árbol.

## Mapa `contrato → test`

No hay `specs/388/requirements.md`, así que la columna izquierda es lo que exige el `status_note`.
Cada fila está **medida con una mutación**, no leída.

| Lo que pide la ficha | Test que lo clava | Muerde con |
| --- | --- | --- |
| «declarar el ámbito, no cambiar de componente» | `tests/components/descarga/ProductosDescargaColumnas.test.tsx` › «ofrece el selector junto al botón, y abrirlo no descarga nada» | M1 (quitar `ambitoColumnas`) |
| el selector ofrece **el juego que corresponde** a la concesión | ídem › «sin la concesión presenta una casilla por columna base» + «con la concesión presenta también las nueve de dinero» | M-frontera, M-invertir |
| lo elegido **llega al archivo** | ídem › «una columna desmarcada deja de viajar en el archivo» | M1, M-cruce |
| «el ámbito tiene que convivir con que el juego de columnas cambie según la concesión… o la preferencia guardada con dinero reaparecerá sin él» | ídem › **«EL CASO DE LA CONCESIÓN — ocultar sin dinero NO borra lo guardado con dinero»** | **M-colapso** |
| R66/R67 — la frontera del permiso: sin concesión, ninguna columna de dinero | ídem › «una preferencia que nombre columnas de dinero no las cuela en el archivo sin concesión» | M-frontera |
| R16/R30 (314) — sin preferencia, el catálogo entero de su juego | ídem › «sin preferencia el archivo lleva el catálogo entero de su juego» | M-frontera |
| R10 (314) — un ámbito no puede pisar al otro | `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` › «los dos ámbitos son DISTINTOS» + «los identificadores son los literales que ya viven en el navegador» | M-colapso |
| el emparejamiento `columnas ↔ ámbito` | ídem › «cada juego de columnas viaja con SU ámbito, y no con el del otro» | M-cruce |
| identidad estable (dependencia de los `useMemo` del hook) | ídem › «devuelve la MISMA instancia para la misma concesión» | — (`toBe`, no `toEqual`) |
| unicidad de los ámbitos **entre tablas** | `tests/unit/descarga/ambito-columnas.guardia.test.ts` (guardia perenne de la 314, barre el árbol) | M-ternario |

## Mutaciones — 6 aplicadas, 6 muertas

Cada una se aplicó al árbol real, se corrió la suite y **se revirtió desde copia** (nunca
`git checkout`: había trabajo sin commitear). Alcances distintos, así que cada número dice el suyo.

| # | Mutación | Alcance | Resultado |
| --- | --- | --- | --- |
| **M1** | quitar `ambitoColumnas` del `descarga` de `ProductosTabla` | 1 archivo (7 casos) | **5 rojos**. Los 2 verdes son los que también valen sin selector, a propósito |
| **M-colapso** | **igualar la CLAVE de almacenamiento** de los dos ámbitos (`AMBITO_…_DINERO = "analitica-productos"`) — la que de verdad modela «un solo ámbito», porque colapsa la clave y no solo la referencia del objeto | 3 archivos (36 casos) | **3 rojos**, uno con el mensaje exacto `expected [ 'unidades' ] to deeply equal [ 'recaudado' ]`: la preferencia de dinero **borrada en silencio**. `ambito-columnas.guardia` sigue **VERDE 4/4** |
| **M-frontera** | `descargaAnaliticaProductos` publica **siempre** el catálogo con dinero (la alternativa «un solo ámbito con todo publicado» que el diseño descarta) | 3 archivos (36 casos) | **7 rojos**, entre ellos la frontera del permiso |
| **M-cruce** | intercambiar el ámbito dentro del objeto sin dinero | 3 archivos (36 casos) | **4 rojos** |
| **M-invertir** | `conDinero ? SIN : CON` | 2 archivos (32 casos) | **8 rojos** |
| **M-ternario** | escribir el ámbito como ternario en el JSX | guardia (4 casos) | **guardia ROJA**: «un ámbito que esta guardia no puede resolver…». Justifica la propiedad abreviada |

**M-colapso y M-frontera las midió también el reviewer, por su cuenta y en su worktree, con los
mismos números** (3 y 7). M-frontera la volví a correr yo al cerrar, para no citar un número
prestado: 7 rojos, mismos casos.

## El punto ciego de la guardia (hallazgo, y NO se arregla aquí)

`ambito-columnas.guardia` **no caza dos ámbitos idénticos declarados en el mismo módulo**: agrupa
`valor → Set<ruta>` y filtra por `rutas.size > 1`, así que N declaraciones iguales dentro de UN
archivo colapsan a un `Set` de tamaño 1. Lo confirmó el reviewer con una medición A/B (colapso
intra-módulo → **guardia verde 4/4** mientras caen 3 casos de la ficha; el mismo literal repartido
en dos módulos con una sonda → **guardia roja**).

Es deuda de la **314**, no de esta ficha, y aquí no muerde porque los dos ámbitos **sí** son
distintos y los tests propios cubren el hueco. **Tiene ficha propia: la 391.** No se toca desde
aquí.

## Decisiones de esta entrega

1. **`columnasDescargaAnaliticaProductos` se sustituye por `descargaAnaliticaProductos`**, que
   devuelve `{ columnas, ambitoColumnas }`. No se deja la vieja al lado: sería un segundo camino
   para elegir el juego, y dos caminos se desincronizan. Cero llamadores huérfanos — el símbolo
   viejo no queda en ningún archivo del árbol, y su aserción de contrato en `tests/` se reescribió
   sobre la función nueva en vez de borrarse.
2. **Los identificadores de ámbito se afirman como literales escritos a mano**
   (`"analitica-productos"`, `"analitica-productos-dinero"`). Un ámbito es la mitad de una clave
   de `localStorage`: renombrarlo no rompe nada visible, huérfana en silencio la preferencia que
   el usuario ya tenía guardada. Compararlo contra su propia constante estaría siempre verde — y
   **ése es justo el caso que cazó el colapso**.
3. **El caso «cada juego viaja con SU ámbito» NO se refuerza contra el colapso, se documenta.**
   Su esperado se construye con las mismas constantes que devuelve la función, así que un colapso
   de los dos literales colapsa los dos lados y el caso sigue verde (medido en M-colapso). Era el
   `menor 3` del reviewer. Se resolvió **ajustando su comentario** —dice qué caza (el cruce), qué
   **no** caza (el colapso) y **qué casos sí lo cazan**— en vez de añadirle la desigualdad:
   añadirla dejaría dos casos rojos con nombres a medias ante el mismo fallo, y el nombre del caso
   rojo es lo que dice qué propiedad se rompió. La red contra el colapso ya existe y está medida
   en tres sitios.
4. **`.env` copiado a este worktree.** Sin él, los 132 archivos de `tests/integration/db` se
   saltan y el gate miente en verde. El log lo dice por escrito: «DATABASE_URL resuelta».

## Cómo se verificó

- **`./init.sh --rapido`**, con `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea, y
  sin `tail` en la tubería. Dos corridas: la de la implementación y la de este cierre.
- **Cierre (`/tmp/init-rapido-388b.log`): `INIT_EXIT=0`.**
  - `✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta` — el
    gate **no se negó**, y lo dice él, no yo. (El reviewer además clasificó los 4 archivos a mano
    contra `RUTAS_SENSIBLES` y `NOMBRES_DE_DINERO`: ninguno casa.)
  - `--changed`: **9 archivos, 168 passed, 17 skipped (185)**.
  - guardias (`vitest run guard`): **194 archivos, 2880 tests, 0 skipped**.
  - `✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan`.
- **Los 17 `skipped` están contados y son ajenos**: los 17 viven en
  `tests/components/AnaliticaPage.test.tsx`, en bloques `describe.skip` / `it.skip` preexistentes y
  documentados (NOTA_SHELL_REDUCIDO). Este diff no toca ese archivo.
- **La integración contra Postgres no se ejecutó, y está bien**: `--changed` selecciona por grafo
  de imports y este cambio es de presentación pura, sin query, esquema, servicio ni repositorio.
  **No es la trampa del «gate sin `.env`»**: la credencial estaba resuelta —el gate lo afirma— y
  aun así no seleccionó esos archivos. La omisión es por grafo, no por falta de entorno.
- Lo que el `--changed` se habría comido y las guardias cubren: `columnas-sensibles.guardia`
  descubre este módulo **por convención de nombre** (`*-descarga-columnas.ts`), no por imports.
  Corrió.
- **Solo `progress/impl_388.md` se escribió después del gate**: es `.md` y no entra en typecheck,
  lint ni tests. El ajuste de comentario del punto 3 **sí** estaba dentro de la corrida.

## Lo que queda vivo

1. **Nadie ha visto esto en la app real.** Lo que hay son 7 casos que montan el consumidor real en
   jsdom con el recorrido completo `preferencia → DescargarDatasetButton → construirDescarga →
   buildXlsxRows`. En este repo eso no basta y está medido: mirar la app encontró siete textos
   rotos que doce mil tests daban por buenos. Pendiente de verificación humana: `/analitica` →
   tabla de productos → «Elegir columnas de la descarga», desmarcar una y descargar.
2. **Con un actor que tenga el dinero concedido, nadie ha ejercido el ciclo real**
   concesión → `limite_excedido` → concesión. Está probado en jsdom con las dos respuestas del
   servidor; en producción depende de que el recorte supere el tope de la 347.
3. **El coste declarado del diseño no se ha contrastado con un usuario**: ocultar «Tienda» sin
   dinero no la oculta con dinero. Es la consecuencia de tener dos archivos con dos memorias, está
   escrita en el módulo, y si algún día molesta la alternativa **no** es compartir ámbito (rompe lo
   de arriba) sino propagar la preferencia de las columnas comunes al guardar.
4. **El punto ciego de `ambito-columnas.guardia` sigue abierto** — ficha **391**. Mientras tanto,
   la unicidad **entre** tablas sí está vigilada; lo que no se vigila es el duplicado dentro de un
   mismo módulo, que aquí lo cubren dos casos propios.
5. **`progress/history.md` sin entrada de la 388**: es el paso F2.6 del leader, posterior al merge.
   No es deuda de esta entrega.
