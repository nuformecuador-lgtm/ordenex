# Revisión — ficha 388 · la descarga de productos de analítica deja elegir sus columnas

- **Rama:** `feat/388-columnas-descarga-productos` · **HEAD revisado:** `109719e0`
- **Base:** `09ff18ee` (merge-base con `origin/dev`; `origin/dev` ya se movió a `f9109f71`
  con un `chore` de la 390 que no toca nada de esto)
- **Diff revisado:** `09ff18ee...HEAD` — 4 archivos, +465/−10 · **PR #727** (abierto, base `dev`, MERGEABLE)
- **Revisado en worktree aislado** `agent-a735e1dc1ba9ced25`, en HEAD desacoplado (la rama la
  retiene el worktree del implementer). `pnpm install --frozen-lockfile` + `pnpm db:generate`
  dentro del worktree. NO se tocó la base ni se escribió ninguna migración.
- **`sdd: false`:** no hay `specs/388/`. La fuente de la verdad es el `status_note` de la ficha.

## Veredicto: **OK**

Sin bloqueantes. El diseño de dos ámbitos NO es complejidad de más: está medido que con uno solo
se rompe, y se rompe MUDO. Cuatro hallazgos menores, ninguno en el software entregado salvo la
falta del log del implementer.

---

## Checklist

### Especificación (`sdd: false` ⇒ el bloque spec no aplica)
- [n/a] `specs/388/requirements.md`, `design.md`, `tasks.md` — la ficha es `sdd: false` por
  decisión del humano; el `status_note` hace de contrato. No hay tasks que marcar.
- [n/a] Mapa `R<n> -> test` — no hay `R<n>` que mapear. Los `R` que citan el código y los tests
  (R29/R32/R33 de la 314, R66/R67/R76 de la 347) son de fichas ANTERIORES, y se verificaron
  contra su código real, no contra un spec de esta.

### Trazabilidad de lo que SÍ pide la ficha
El `status_note` es el contrato, y cada cosa que pide tiene un test que MUERDE (medido con
mutaciones, no leído):

| Lo que pide la ficha | Test que lo verifica | Muerde |
|---|---|---|
| «declarar el ámbito, no cambiar de componente» | `ProductosDescargaColumnas.test.tsx` — «ofrece el selector junto al botón» + «presenta una casilla por columna» | sí (mutación C) |
| «el ámbito tiene que convivir con que el juego de columnas cambie según la concesión» | `ProductosDescargaColumnas.test.tsx` — «EL CASO DE LA CONCESIÓN» | **sí (mutación B, mensaje exacto)** |
| «o la preferencia guardada con dinero reaparecerá sin él» | ídem, parte (2): la columna oculta NO reaparece al volver la concesión | sí (mutación B) |
| frontera del permiso: sin concesión, ninguna columna de dinero | «una preferencia que nombre columnas de dinero no las cuela en el archivo sin concesión» | sí (mutación C) |

- [ ] `progress/impl_388.md` — **NO existe** (hallazgo menor 1).

### Checkpoints (`CHECKPOINTS.md`), punto por punto
- [x] `pnpm run typecheck` pasa — verde en mi corrida.
- [x] `pnpm run lint` pasa — verde; solo `warning`s de `no-unused-vars`, todos en archivos
  AJENOS al diff y preexistentes.
- [x] `pnpm test` (el que corresponde al modo) pasa — ver «Verificación ejecutable».
- [n/a] E2E — no toca auth, pagos, recaudo, ingesta ni webhooks. Es presentación pura.
- [n/a] RLS / migraciones / `down.sql` — **cero cambios de base**. No hay tabla nueva, no hay
  migración, `db/schema.prisma` intacto.
- [x] Ningún secreto hardcodeado. El diff no introduce ni una credencial ni una URL.
- [n/a] Webhooks — ninguno.
- [x] **Patrón de capas** — `analitica-productos-descarga-columnas.ts` sigue siendo un módulo
  PURO: sin React, sin DOM, sin servicio, sin repositorio, sin Prisma. El objeto
  `{ columnas, ambitoColumnas }` es dato de presentación, no lógica de negocio.
- [n/a] Interfaces en `lib/interfaces/` — no se declara ninguna.
- [x] **Permisos** — la frontera del dinero se respeta, y con dos defensas independientes (abajo).
- [x] **Multi-país** — no se hardcodea país, moneda ni cuenta. Los identificadores de ámbito
  (`analitica-productos`, `analitica-productos-dinero`) son etiquetas de máquina, no contexto.
- [x] `./init.sh --rapido` termina en verde, `INIT_EXIT=0` (corrido por mí).
- [x] `progress/review_388.md` con veredicto OK — este archivo.
- [ ] Entrada en `progress/history.md` — **pendiente**, pero es el paso F2.6 del leader
  DESPUÉS del merge. No es deuda del implementer ni bloquea la revisión.

---

## La parte que de verdad había que revisar: ¿dos ámbitos o uno?

### El razonamiento del implementer es CORRECTO, y lo confirmé en el código

`usePreferenciaColumnas.alternar` (`hooks/usePreferenciaColumnas.ts:160-191`) hace, en este orden:

1. `sanearPreferencia(leerCrudo(clave), clavesPublicadas)` — y `sanearPreferencia`
   (`lib/columnas/preferencia-columnas.ts:143-168`) filtra por `clavesUtiles`, que descarta toda
   clave que no esté en `publicadas` (`preferencia-columnas.ts:113-127`, R29).
2. `guardar(clave, { ocultas, orden })` — **reescribe lo YA SANEADO**.

O sea: el saneo no es solo de lectura, **se persiste**. Con un ámbito compartido, un clic del
selector estando sin dinero lee la preferencia, tira las 9 claves de dinero por no estar
publicadas, y **las vuelve a escribir sin ellas**. Al recuperar la concesión esas columnas
reaparecen marcadas. Sin error, sin test rojo, y en el `localStorage` del usuario.

Y **no hace falta perder el permiso** para caer ahí. `ProductosTabla.tsx:914` es:

    const conDinero = dinero && estadoDinero?.estado === "concedido";

así que `conDinero` también es `false` con `limite_excedido` (R76), que es **transitorio**. El
mismo actor, en la misma pantalla, salta de un juego al otro entre dos consultas. El caso no es
hipotético.

### La mutación: colapsar los dos ámbitos en uno

Mutación aplicada — la que de verdad modela «un solo ámbito», porque colapsa la CLAVE de
almacenamiento y no solo la referencia del objeto:

    - export const AMBITO_DESCARGA_ANALITICA_PRODUCTOS_DINERO = "analitica-productos-dinero";
    + export const AMBITO_DESCARGA_ANALITICA_PRODUCTOS_DINERO = "analitica-productos";

**Resultado medido: `Tests 3 failed | 33 passed (36)`. Exactamente 3 rojos.**

1. `ProductosDescargaColumnas.test.tsx` › «EL CASO DE LA CONCESIÓN — ocultar sin dinero NO borra
   lo guardado con dinero»
   → `AssertionError: expected [ 'unidades' ] to deeply equal [ 'recaudado' ]`
   **El mensaje exacto que anunciaba el implementer.** (`unidades` es
   `COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS[2]`, la columna que el test oculta; `recaudado` es la
   que el usuario había ocultado con dinero y que el saneo se lleva por delante.)
2. `analitica-productos-descarga-columnas.test.ts` › «los dos ámbitos son DISTINTOS»
   → `expected 'analitica-productos' not to be 'analitica-productos'`
3. `analitica-productos-descarga-columnas.test.ts` › «los identificadores son los literales que
   ya viven en el navegador»
   → `expected 'analitica-productos' to be 'analitica-productos-dinero'`

**Los dos ámbitos NO son complejidad de más.** Con uno solo el fallo es real, es mudo, y la red
lo caza en tres sitios.

### Y la frontera del permiso tiene defensa doble, no simple

Que una preferencia guardada no pueda colar columnas de dinero en el archivo de quien no tiene la
concesión no depende de un solo filtro:

- `sanearPreferencia` descarta las claves no publicadas (R29), **y además**
- `columnasEnOrden` (`preferencia-columnas.ts:207-243`) construye su `Map` **desde `publicadas`**
  y solo empuja la columna `if (columna !== undefined)`. Una clave que no corresponda a una
  columna publicada se cae ahí aunque el saneo fallara.

Verificado que el test que lo afirma **no es vacío**: con la mutación C (`descargaAnaliticaProductos`
devolviendo SIEMPRE el catálogo con dinero, que es justo la alternativa «un solo ámbito con el
catálogo de dinero siempre publicado» que el diseño descarta) salen **7 rojos**, y entre ellos
«una preferencia que nombre columnas de dinero no las cuela en el archivo sin concesión».

---

## HALLAZGO DE GUARDIA: **CONFIRMADO**

> «`ambito-columnas.guardia` NO caza dos ámbitos idénticos declarados en el mismo módulo, porque
> agrupa por rutas distintas.»

**Es cierto.** El mecanismo está en `tests/unit/descarga/ambito-columnas.guardia.test.ts:126-137`:

    porValor.set(valor, (porValor.get(valor) ?? new Set()).add(ruta));
    ...
    .filter(([, rutas]) => rutas.size > 1)

Agrupa `valor -> Set<ruta>`. **N declaraciones idénticas dentro de UN archivo colapsan a un
`Set` de tamaño 1** y quedan fuera del filtro.

Medido A/B, no razonado:

| Escenario | Guardia |
|---|---|
| Los dos ámbitos colapsados al mismo literal, **en el mismo módulo** (mutación B) | **4 passed (4) — VERDE**, mientras 3 tests de la ficha caen |
| El mismo literal duplicado, **repartido en dos módulos** (sonda `app/(app)/__probe388/Probe.tsx`) | **ROJO**: denuncia `analitica-productos` con las dos rutas |

La sonda se borró; el árbol quedó limpio en `109719e0`.

**Lo que esto significa, escrito:** la guardia se presenta como «los ámbitos de preferencia de
columnas son únicos» y el caso que ejecuta se llama «ningún identificador de ámbito **se repite
en dos módulos**». Lo segundo es lo que comprueba; lo primero es lo que promete. El agujero es el
duplicado intra-módulo, y aparece justo ahora, que es la primera vez que un módulo declara MÁS DE
UN ámbito. **No es deuda de esta ficha** —la guardia es de la 314, y aquí no muerde porque los dos
ámbitos SÍ son distintos y los tests propios cubren el hueco—, pero es una guardia que promete más
de lo que da y conviene que quede anotado antes de que la siguiente tabla con juegos condicionales
se apoye en ella. Arreglo natural: contar DECLARACIONES por valor en vez de rutas, y denunciar
cuando haya más de una, con las rutas como detalle.

### Un efecto lateral que sí está bien resuelto
`ProductosTabla.tsx` baja el ámbito como **propiedad abreviada** (`ambitoColumnas,`), que el regex
de la guardia no ve por no llevar dos puntos. El comentario del código dice que la alternativa
legible (`ambitoColumnas: descargaArchivo.ambitoColumnas`) pondría la guardia roja.
**Comprobado (mutación E):** aparece `ProductosTabla.tsx: descargaArchivo.ambitoColumnas` en el
caso «todo ámbito declarado se resuelve» → **ROJO**. El estilo raro está justificado, no es
capricho. Y la unicidad ENTRE tablas sigue protegida, porque la declaración resoluble vive en el
módulo de columnas y la guardia sí la ve.

---

## Verificación ejecutable (corrida por mí, no la bitácora ajena)

`./init.sh --rapido` desde el worktree, en `109719e0`, árbol limpio:

    ✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
    ✓ typecheck paso
    ✓ lint paso            (solo warnings de no-unused-vars en archivos ajenos al diff)
    ✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan
    --changed:  Test Files 9 passed (9)      Tests 168 passed | 17 skipped (185)
    guardias:   Test Files 194 passed (194)  Tests 2880 passed (2880)
    INIT_EXIT=0

- **Los 17 `skipped`** están todos en `tests/components/AnaliticaPage.test.tsx`, archivo que
  **este diff no toca**: son preexistentes por construcción. Coincide con lo declarado.
- **El flake conocido de la 390** (`CrearTiendaForm.test.tsx`) no apareció.

### ¿Bastaba el modo rápido? **Sí.** Y lo comprobé, no lo asumí.
- Clasifiqué los 4 archivos a mano contra `RUTAS_SENSIBLES` y `NOMBRES_DE_DINERO` de `init.sh`:
  ninguno casa. No hay migración, ni `db/schema.prisma`, ni `lib/types/`, ni config de build, ni
  nombre de dinero en la ruta. La negativa del modo rápido NO debía dispararse, y no se disparó.
- **El punto que importa:** `test:guardias` es `vitest run guard`, o sea **todas** las guardias,
  194 archivos. Ahí entra `columnas-sensibles.guardia`, que descubre este módulo **POR CONVENCIÓN
  DE NOMBRE** (`*-descarga-columnas.ts`) y no por grafo de imports — que es exactamente lo que
  `--changed` se habría comido. Corrió. El radio real del cambio quedó cubierto.
- **La integración contra Postgres no se ejecutó, y está bien.** El cambio no toca query,
  esquema, servicio ni repositorio. Y esto NO es la trampa del «gate sin `.env`»: en MI corrida
  `DATABASE_URL` **sí estaba resuelta** —el gate lo dice: «los 132 archivos … SÍ se ejecutan»— y
  aun así `--changed` no los seleccionó. La omisión es por grafo de imports, que es el
  comportamiento correcto aquí, y no por falta de credencial.

### Mutaciones aplicadas y revertidas (todas medidas, ninguna dejada en el árbol)
| # | Mutación | Resultado |
|---|---|---|
| B | los dos ámbitos colapsan al mismo literal | **3 rojos**, uno con `expected [ 'unidades' ] to deeply equal [ 'recaudado' ]`; **guardia VERDE 4/4** |
| C | `descargaAnaliticaProductos` publica siempre el catálogo con dinero | 7 rojos, incluida la frontera del permiso |
| D | ámbitos CRUZADOS entre los dos objetos | 1 rojo: «cada juego viaja con SU ámbito» |
| E | ámbito como expresión de miembro en `ProductosTabla` | guardia ROJA (justifica el estilo abreviado) |
| — | sonda: mismo ámbito en dos módulos | guardia ROJA (contraprueba del hallazgo) |

Tras revertir: árbol limpio en `109719e0` y **36 passed (36)** en los tres archivos.

---

## Hallazgos

### 1. `menor` — falta `progress/impl_388.md`
No existe en la rama **ni sin commitear** en el worktree del implementer (lo comprobé).
`CHECKPOINTS.md` lo lista, y la ficha 382 —también `sdd: false` y ya `done`— sí lo trae, así que
la convención del repo es que incluso sin spec se deja el log. El mapa `R<n> -> test` no aplica
(no hay `requirements.md`), y el contenido sustantivo es reconstruible —el código está
generosamente comentado y yo he vuelto a correr el gate—, por eso es menor y no bloqueante. Pero
la salida de tests del implementer no quedó en disco: si mañana alguien pregunta «¿qué se midió?»,
la respuesta es este informe, no el suyo.

### 2. `menor` — `ambito-columnas.guardia` promete unicidad y comprueba unicidad ENTRE MÓDULOS
Confirmado y medido arriba. Deuda de la 314, no de la 388; anotado aquí porque es la primera vez
que un módulo declara dos ámbitos y por tanto la primera vez que el agujero es alcanzable.

### 3. `menor` — un test se compara contra su propia fuente (y por eso NO caza el colapso)
`tests/unit/descarga/analitica-productos-descarga-columnas.test.ts:359-367`, «cada juego de
columnas viaja con SU ámbito»: el `toEqual` compara la salida de la función contra las MISMAS
constantes que la función devuelve. Si alguien colapsa el literal de la constante, los dos lados
colapsan a la vez y el caso queda **verde** (así pasó en la mutación B). No es un test vacío ni un
hallazgo grave: caza el CRUCE de los ámbitos, que es literalmente lo que su comentario dice que
caza, y lo verifiqué (mutación D → rojo). Se anota solo para que conste que la red contra el
colapso la ponen los OTROS dos casos, no éste.

**A favor del implementer:** el caso «los identificadores son los literales que ya viven en el
navegador» escribe `"analitica-productos"` y `"analitica-productos-dinero"` **a mano**, y su
comentario dice explícitamente que compararlo contra su propia constante estaría siempre verde.
El riesgo estaba identificado y cubierto a propósito, y es el caso que cazó el colapso.

### 4. `menor` — `progress/history.md` sin entrada de la 388
Es el paso F2.6 del leader, posterior al merge. Recordatorio, no deuda del implementer.

---

## Lo que está bien (y merece decirse)

- **El diseño de dos ámbitos está justificado con una medida, no con una opinión.** La ficha ya
  avisaba del riesgo y la implementación lo cierra en el sitio correcto: emparejando `columnas` y
  `ambitoColumnas` en UN objeto, de modo que no se pueden desincronizar. Dos ternarios
  independientes sí se habrían podido desincronizar; el comentario lo dice y tiene razón.
- **Los objetos están a NIVEL DE MÓDULO** y `descargaAnaliticaProductos` devuelve la misma
  instancia para el mismo `conDinero`. No es cosmética: la identidad de `columnas` es dependencia
  de los `useMemo` de `usePreferenciaColumnas`. Hay un test que lo fija con `toBe`, no `toEqual`.
- **Sustitución limpia de `columnasDescargaAnaliticaProductos`.** Cero llamadores huérfanos: el
  símbolo viejo no aparece en NINGÚN archivo del árbol. El nuevo tiene 2 usos de producción
  (`ProductosTabla.tsx:89` y `:957`) y el resto son tests.
- **`cierres-admin/` intacto.** Los 4 archivos del cambio viven en `analitica/` y `tests/`. Cero
  intersección con el otro agente.
- **Ningún test se auto-aprueba.** No hay un solo `if (!x) return;` en el archivo nuevo. Todos los
  `waitFor` envuelven aserciones reales, y `encabezadosDelArchivo()` hace
  `expect(llamada).toBeDefined()` antes de indexar.
- **El test de componente monta el consumidor REAL** y solo aísla el codificador binario
  (`buildXlsxRows`) y las server actions. `construirDescarga` y `DescargarDatasetButton` corren de
  verdad, así que el recorrido preferencia → botón → archivo es el de producción. Es la clase de
  test que suele faltar, y aquí está.
- **Ningún caso afirma un NÚMERO de columnas.** «Todas» se deriva de las constantes
  (`ENCABEZADOS_BASE`, `ENCABEZADOS_DINERO`), así que añadir una columna mañana no obliga a tocar
  el test — pero quitar una del archivo sí lo pone rojo.
- **La clave de `localStorage` se compone con el prefijo literal** `ordenex:descarga-columnas:`,
  que coincide con `PREFIJO_CLAVE_DESCARGA` (`preferencia-columnas.ts:70`). Escrito a mano en el
  test, que es lo correcto para un dato que ya vive en el navegador de gente real.
