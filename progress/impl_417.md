# impl 417 — el ámbito del aviso agregado se decide en su propio seam

> **Nombre del archivo:** el `tasks.md` lo llamaba `progress/impl_417_backend.md`. Se escribe como
> `impl_417.md` por indicación expresa del orquestador al lanzar la implementación. Es la **única**
> desviación respecto de la lista de archivos del spec, y la ficha es backend-only (no hay
> contraparte frontend que desambiguar). Todo lo demás está donde el spec dijo.

- **Rama:** `feat/417-alcance-aviso-satelite-sin-zona`
- **SHA base:** `2f32c2d2` (`docs(417): spec de la proteccion por herencia, y la ficha arranca`)
- **Zona:** backend. Sin migración, sin tabla, sin RLS, sin endpoint, sin UI.

---

## Qué entrega, en una línea

El seam que compone la cifra de un aviso agregado **decide el ámbito solo con el actor que recibe**,
y si ese actor no tiene el ámbito que el aviso pide **falla nombrando la causa** en vez de inventarse
uno. Antes lo impedían dos capas ajenas, y **ningún test de aquí se ponía rojo si alguien las
tocaba**. El entregable de la ficha es ese rojo: está medido abajo (M1 y M4), con el predicado de la
146 **intacto en su sitio**.

---

## Archivos creados / modificados

| Archivo | Qué |
| --- | --- |
| `lib/services/VigenciaAvisoAgregadoService.ts` | las **dos** guardas (único archivo de producción con cambio de comportamiento) |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | documentación del contrato: los dos casos nuevos de lanzamiento. **Sin cambio de firma** |
| `tests/unit/services/vigencia-aviso-agregado.test.ts` | deroga **un** caso (con el motivo dentro), añade R1/R2 y R3/R4 |
| `tests/unit/services/notificacion-service.test.ts` | **añade** un caso (R9) con el resolutor real |
| `progress/impl_417.md` | esta bitácora |
| `specs/417-alcance-aviso-satelite-sin-zona/tasks.md` | casillas |

**Nada más.** Ni `db/`, ni `app/`, ni `components/`, ni otro servicio. El gate lo confirmó por su
cuenta: *«el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta»*.

Commits: `f2e02c18` (`feat(417)`), `8ae149ba` (`test(417)`), más el de cierre con esta bitácora.

---

## T0 — Pre-vuelo: las anclas del spec, confirmadas en el archivo real

Leídas con `sed -n`/`cat -n` sobre el archivo, no en el grafo. Las cinco anclas de
`requirements.md` §Verificado **siguen donde el spec las puso**; ninguna se movió:

| Ancla | Estado el 2026-09-10 |
| --- | --- |
| `VigenciaAvisoAgregadoService.ts:39` — `const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;` | **confirmado, línea 39 exacta** |
| El comentario que ya nombraba el riesgo, líneas 36-38 | **confirmado, literal** («Ignorarla le enseñaria al satelite el total del sistema —el numero de OTRA bodega—») |
| `AvisoAgregadoRepository.contarRepresadas` — `zonaId === null ? filas.length : filas.filter(...)` | **confirmado** (`null` = todo el sistema) |
| `NotificacionService.cifrasVivas` captura, registra con `cause` y guarda `null` → R58 | **confirmado** (líneas 153-174) |
| `Actor.zonaId` opcional (`IOrdenService.ts:21`, `zonaId?: string \| null`) | **confirmado**: el satélite sin zona es representable en el tipo |

**T0.2 — el caso mal nombrado, citado literal antes de tocarlo.** Estaba en las líneas 83-92, con
este cuerpo entero:

```ts
it("un adminSatelite SIN zona no ve el total: pide `null`, y el predicado de la 146 ya lo tapa", async () => {
  // `zonaId` es opcional en `Actor`; un satelite sin zona no ve ninguna notificacion acotada por
  // zona (146/R16), asi que la cifra ni siquiera llega a usarse.
  const repo = repoEspia();
  await servicio(repo).cifra("devoluciones_represadas", {
    usuarioId: "sat-sin-zona",
    rol: "adminSatelite",
  });
  expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull();
});
```

El titular prometía protección; el aserto certificaba lo contrario. **Ese `toBeNull()` no era el
contrato de nada** —lo comprobé antes de tocarlo, que es la lección «literal: contrato o polizón»—:
el contrato de «pedir `null`» es el de `maestro`/`admin` (R6), y ése vive en **otro** caso del mismo
archivo, que sigue intacto. Aquí `toBeNull()` era el defecto escrito como expectativa. **Derogado,
con el motivo y el cuerpo viejo escritos DENTRO del archivo de test.** No me apoyé en él para nada.

**T0.3 — el hecho que sostiene R3/R4, verificado en los tres sitios.** `novedades_sin_gestionar`
tiene **un solo productor**: `AvisosDiariosService.ts:102` → `notificadores.ts:365-375`
(`notificarNovedadesSinGestionarCon`) → `emitir.ts:1041-1062` (`emitirNovedadesSinGestionar`), que
emite **siempre** `destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: ctx.tiendaId }` y
**nunca** dirigido a usuario; y `catalogo-avisos.ts:233-239` lo declara con
`destinatarios: ["adminTienda"]`. **No apareció un segundo productor ni un destinatario de otro
rol**, así que la guarda de T1.2 no cambió de forma y no hubo que parar.

**No encontré ninguna razón real por la que la rama de tienda NO deba comprobar el rol** (el spec
pedía parar y decirlo si aparecía). El único argumento candidato —«es redundante, porque el
`adminTienda` **es** la tienda»— vale idéntico para la rama del satélite, y ésa **sí** comprueba el
rol desde la 409.

---

## El cambio, en contrato

`VigenciaAvisoAgregadoService.cifra` — misma firma, mismo tipo de retorno, dos guardas:

- **`devoluciones_represadas` (R1/R2):** si `actor.rol === "adminSatelite"` y su zona no es un id
  útil (ausente, `null` o `""`), **no se llama al repositorio** y se lanza
  `vigencia: el evento "devoluciones_represadas" se acota por zona y el adminSatelite no tiene zona asignada`.
- **`novedades_sin_gestionar` (R3/R4):** si `actor.rol !== "adminTienda"`, **no se llama al
  repositorio** y se lanza
  `vigencia: el evento "novedades_sin_gestionar" se acota por tienda y el rol "<rol>" no es una tienda`.
- **Todo lo demás, idéntico:** `maestro`/`admin` siguen en global (`null`), el satélite **con** zona
  sigue en su zona, el `adminTienda` sigue contando lo suyo y el evento no agregado sigue lanzando.

Ningún mensaje lleva `usuarioId` ni PII (hay un aserto que lo fija). El `idUtil` es el mismo criterio
—y la misma forma— que `lib/analytics/alcance.ts:218`, el precedente del repo para este estado.

---

## Mapa `R<n> → test`

| R | Test concreto | Resultado |
| --- | --- | --- |
| **R1** | `tests/unit/services/vigencia-aviso-agregado.test.ts` › «R1 — con %s no se consulta NINGUN ambito», ×3 formas (`null`, ausente, `""`) | ✅ |
| **R2** | mismo archivo › «R2 — con %s falla NOMBRANDO la causa», ×3 formas, `rejects.toThrow(/no tiene zona asignada/i)` | ✅ |
| **R3** | mismo archivo › «R3 — con un %s no se cuenta nada con su usuarioId» (`maestro`, `adminSatelite`) | ✅ |
| **R4** | mismo archivo › «R4 — con un %s falla NOMBRANDO la causa» ×2 + «ni siquiera devuelve el `0` que el repositorio daria» | ✅ |
| **R5** | mismo archivo › «`devoluciones_represadas` se pide con la ZONA del adminSatelite» — **vigente, sin editar** | ✅ |
| **R6** | mismo archivo › «maestro y admin lo piden GLOBAL (`null`), sin acotar por zona» — **vigente, sin editar** | ✅ |
| **R7** | mismo archivo › «`novedades_sin_gestionar` se pide con el usuarioId de la tienda» — **vigente, sin editar** | ✅ |
| **R8** | `git diff --stat 2f32c2d2 -- lib/repositories/NotificacionRepository.ts tests/unit/repositories/notificacion-visibilidad.test.ts` → **salida vacía**, y esa suite pasa **sin haberse editado** (12/12) | ✅ |
| **R9** | `tests/unit/services/notificacion-service.test.ts` › «adminSatelite sin zona + un aviso de represadas: se ve el texto, no el total, y el log lo dice» — resolutor **real** + logger espía | ✅ |
| **R10** | **M1 y M4** ejecutadas, con el predicado de la 146 intacto: 7 y 5 rojos respectivamente (abajo) | ✅ |

**Los tres casos vigentes (T3.1) no se editaron**: no aparecen en el `git diff` del archivo. Son el
control positivo de la ficha, y M3/M5 los ponen rojos — o sea que no están verdes por vacío.

**R8 (T5.1), con el diff pegado tal cual:**

```
$ git diff --stat 2f32c2d2 -- lib/repositories/NotificacionRepository.ts tests/unit/repositories/notificacion-visibilidad.test.ts
$ (sin salida)

$ pnpm exec vitest run tests/unit/repositories/notificacion-visibilidad.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

---

## Qué se prueba de verdad, y con qué (las trampas del repo, una a una)

1. **«Los dobles no ven el SQL».** Miré si aplicaba **antes** de elegir el instrumento, y **no
   aplica aquí**: lo que esta ficha decide es **qué argumento recibe** `contarRepresadas`, y el
   filtro por zona de ese método se aplica **en memoria** sobre las filas ya traídas
   (`AvisoAgregadoRepository.ts:168-171`: `zonaId === null ? filas.length : filas.filter(...)`), no
   en un `where`. **No hay SQL escondido que el doble esté tapando.** El SQL de la población
   —predicado de represamiento, ancla y umbral— ya está cubierto contra Postgres real en
   `tests/integration/db/aviso-agregado-repository.test.ts`, y **esta ficha no lo toca**. Por eso el
   espía del repositorio es el instrumento correcto y **no se añadió test de integración** (design
   §6-E). Queda escrito para que no se lea como pereza.
2. **«Test verde sin datos».** Aquí era facilísimo: un `not.toHaveBeenCalled()` **también pasa** si
   el servicio se rompió por cualquier otro motivo. Tres defensas, las tres puestas:
   - R2 y R4 exigen **el error nombrado**, no un error cualquiera;
   - los controles positivos (R5, R6, R7) viven en el mismo archivo y **M3/M5 los ponen rojos**:
     eso demuestra que los casos de R1/R2 y R3/R4 no pasan por escenario vacío;
   - R9 afirma **las dos mitades** (el aviso sale **y** el log lo registra), no solo una.
3. **«Aserción contra su propia fuente».** Todos los literales de mensaje van **escritos a mano** en
   el test (`/no tiene zona asignada/i`, `/no es una tienda/i`, `/vigencia del aviso agregado/i`,
   `"7 órdenes esperan volver a su tienda"`). **Nada importado de producción.**
4. **«Literal: contrato o polizón».** Resuelto arriba, en T0.2: el `toBeNull()` derogado **no era**
   el contrato; el contrato de `null` es el de `maestro`/`admin` y sigue vivo e intacto en otro caso.
5. **«El test que vive dentro de lo que borras».** No se borró ningún archivo. Del archivo de test
   solo **se derogó un caso**; los otros seis siguen ahí, tres de ellos sosteniendo R5/R6/R7.
6. **«Una imposibilidad razonada no es medida».** Esta ficha **no afirma** que el estado sea
   imposible: afirma que **hoy no es alcanzable por dos capas ajenas** y construye la prueba
   **saltándoselas a propósito** (test unitario del servicio, sin el repositorio de notificaciones
   de por medio). Está escrito también dentro del test de R9, como nota de honestidad.

---

## El gate (T7.1)

```
$ ./init.sh --rapido > <log> 2>&1 ; echo "INIT_EXIT=$?" >> <log>
```

`INIT_EXIT` escrito **DENTRO** del log, y **sin canalizar por `tail`** (un `tail` en segundo plano
trunca el fichero en origen y el rojo se queda sin nombre).

```
== Arnes SDD :: init (modo: rapido) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=3) y specs en su sitio
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ typecheck paso
✓ lint paso            (184 warnings, 0 errores — todos preexistentes y ajenos)
✓ DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan

  test:cambiados   Test Files  64 passed (64)    Tests  786 passed | 26 skipped (812)
  test:guardias    Test Files 211 passed (211)   Tests 3100 passed (3100)

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 275 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

- **El rápido NO se negó**, y lo dijo él mismo con nombre («el cambio no toca esquema, tipos
  compartidos, config ni dinero»). Era el criterio explícito de T7.1: si se hubiera negado, habría
  significado que toqué algo de más.
- **`integration/db` que corrieron: 3 archivos, 45 tests, los tres verdes.** Entraron por las
  guardias, no por `--changed`:
  `analytics-daily-guards.test.ts` (26), `zona-central-guarda-y-rastro.test.ts` (17),
  `zona-guardado-conserva-inactivos.test.ts` (2).
  Copié el `.env` del checkout principal tras comprobar que su `DATABASE_URL` activa apunta a
  `localhost:5432/ordenex` (la de Supabase está comentada), así que la capa de datos **no** se saltó
  por falta de base.
- **Los `skipped` mirados uno a uno, no solo el exit code:** los 26 son de
  `tests/components/AnaliticaPage.test.tsx` (17) y `tests/components/AnaliticaShell.test.tsx` (9).
  **Ninguno es de `integration/db`**, así que no hay capa de datos saltada en silencio.
- **Sin `40P01`** (0 ocurrencias en el log): no hubo contención, no hizo falta re-correr aislado.
- **El rojo ajeno anunciado NO apareció**: `notificacion-evento-*-migration.test.ts` tiene **0
  ocurrencias** en el log — el grafo de cambios no los seleccionó y no son guardias. **No se tocó
  `tests/baseline-rojos.json`** (diff vacío), como pedía el encargo.
- **`tests/baseline-rojos.json` no se modificó** y el gate no propuso podar nada.

---

## Las cinco mutaciones (T6) — el entregable

Árbol **limpio antes y después de cada una** (`git status --short` vacío). Cada mutación se aplicó
sobre `lib/services/VigenciaAvisoAgregadoService.ts` y se revirtió con `git checkout --`. Se
corrieron los dos archivos de test del seam (46 casos en verde de partida).

| # | Mutación | Veredicto | Rojos | Qué se puso rojo |
| --- | --- | --- | --- | --- |
| **M1** | retirar la guarda de la zona y dejar `actor.zonaId ?? null` (el código de hoy) | **MUERTA** | **7** | R1 ×3, R2 ×3, **R9** |
| **M2** | sustituir ese lanzamiento por `return 0` | **MUERTA** | **4** | R2 ×3, **R9** (R1 sigue verde, a propósito) |
| **M3** | la guarda de la zona dispara **siempre** para `adminSatelite` | **MUERTA** | **2** | **R5** + la mutación hermana de la 409 |
| **M4** | retirar la guarda de rol de `novedades_sin_gestionar` (el código de hoy) | **MUERTA** | **5** | R3 ×2, R4 ×3 |
| **M5** | la guarda de rol dispara **siempre** | **MUERTA** | **1** | **R7** |

**Supervivientes: ninguna. Las cinco murieron.**

### M1 — la que da sentido a la ficha, y LA PRUEBA DEL ROJO

Corrida **con el predicado de la 146 en su sitio**: antes de lanzar los tests comprobé
`git diff --stat -- lib/repositories/NotificacionRepository.ts` → **salida vacía**. O sea: el rojo
**no depende** de aquella capa; sale de este seam.

```
       × R1 — con zonaId: null no se consulta NINGUN ambito
       × R1 — con zonaId ausente no se consulta NINGUN ambito
       × R1 — con zonaId vacio no se consulta NINGUN ambito
       × R2 — con zonaId: null falla NOMBRANDO la causa
       × R2 — con zonaId ausente falla NOMBRANDO la causa
       × R2 — con zonaId vacio falla NOMBRANDO la causa
     × adminSatelite sin zona + un aviso de represadas: se ve el texto, no el total, y el log lo dice
 Test Files  2 failed (2)
      Tests  7 failed | 39 passed (46)
```

Y el aserto de R9 **enseña el defecto en palabras**, que es lo que la ficha vino a hacer visible:

```
AssertionError: expected '7 órdenes esperan volver a su tienda' to be 'La más antigua lleva 8 días en bodega…'

Expected: "La más antigua lleva 8 días en bodega. Coordiná la devolución."
Received: "7 órdenes esperan volver a su tienda"
```

Ese `7` es el **total del sistema** cargado en el repositorio espía. Con el código de hoy (la
mutación), un `adminSatelite` sin zona leería el número de OTRA bodega. Con la guarda, lee el texto
y ningún número. **Ésta es la afirmación que antes no existía en ningún sitio.**

### M2 — prueba que la ficha exige ruido, no silencio

```
       × R2 — con zonaId: null falla NOMBRANDO la causa      (promise resolved "+0" instead of rejecting)
       × R2 — con zonaId ausente falla NOMBRANDO la causa
       × R2 — con zonaId vacio falla NOMBRANDO la causa
     × adminSatelite sin zona + ...                          (expected [] to deeply equal [ 'agg' ])
      Tests  4 failed | 42 passed (46)
```

Dos cosas que valen más que el conteo:

- **R1 se queda VERDE** bajo M2 (el repositorio sigue sin llamarse) y R2 se pone rojo. Separé los
  dos casos exactamente para esto: juntos, dos rojos habrían tapado **cuál** de las dos mitades se
  rompió.
- **El aserto de R9 dice `expected [] to deeply equal [ 'agg' ]`**: con `return 0` el aviso **no
  sale en absoluto**, en vez de salir sin número. Es el modo de fallo mudo que originó el hallazgo,
  medido y no argumentado.

### M3 — control positivo

```
     × `devoluciones_represadas` se pide con la ZONA del adminSatelite            (R5)
     × ⚠️ MUTACION: ignorar `actor.zonaId` le enseñaria al satelite el total...   (la de la 409)
      Tests  2 failed | 44 passed (46)
```

Los casos de R1/R2 **no están verdes por vacío**: si la guarda disparase de más, el satélite
legítimo se rompe y se nota.

### M4 — el espejo, la otra mitad de R10

También con `git diff --stat -- lib/repositories/NotificacionRepository.ts` **vacío**:

```
     × R3 — con un maestro no se cuenta nada con su usuarioId          (called 1 times)
     × R3 — con un adminSatelite no se cuenta nada con su usuarioId    (called 1 times)
     × R4 — con un maestro falla NOMBRANDO la causa                    (promise resolved "5")
     × R4 — con un adminSatelite falla NOMBRANDO la causa
     × R4 — ni siquiera devuelve el `0` que el repositorio daria       (promise resolved "+0")
      Tests  5 failed | 41 passed (46)
```

El último es el que retrata el defecto: sin guarda, `contarNovedadesDeTienda(<id que no es una
tienda>)` devuelve `0`, y un `0` **apaga el aviso** (409/R55) sin que nadie lo lea, lo marque ni lo
descarte. **Un aviso que no sale no se nota nunca.**

### M5 — control positivo del espejo

```
     × `novedades_sin_gestionar` se pide con el usuarioId de la tienda      (R7)
      Tests  1 failed | 45 passed (46)
```

### T6.6 — revertidas las cinco

```
$ git status --short
$ git diff --numstat
$ (ambas sin salida)

$ pnpm exec vitest run tests/unit/services/vigencia-aviso-agregado.test.ts tests/unit/services/notificacion-service.test.ts
 Test Files  2 passed (2)
      Tests  46 passed (46)
```

---

## La prueba de R10, dicha entera

La pregunta que la ficha existe para contestar es: *¿el rojo sale de aquí, o lo está prestando otra
capa?* Medido:

- **M1** (quitar la guarda de la zona) → **7 rojos**, con `lib/repositories/NotificacionRepository.ts`
  **sin una sola línea cambiada** durante la mutación (`git diff --stat` vacío, comprobado en la
  misma corrida).
- **M4** (quitar la guarda de rol) → **5 rojos**, con la misma comprobación.

O sea: **retirar cualquiera de las dos decisiones pone algo en rojo sin tocar el predicado de la
146.** Antes de esta ficha, retirar la del satélite dejaba la suite **entera en verde**. Eso es todo
lo que separa una protección heredada de una afirmada, y es el entregable.

**Lo que esta ficha NO entrega, dicho con nombre:** no vigila que el predicado de la 146 siga
existiendo; no es su encargo (design §10). Lo que entrega es que, **si desaparece**, este seam siga
negándose y lo diga.

---

## Desviaciones y límites

- **T8.1 (opcional, no bloqueante): MEDIDA — ver §T8.1 abajo.** Yo no pude hacerlo (el MCP de
  Supabase no está en mi conjunto de herramientas y la `DATABASE_URL` de prod es *sensitive*); **la
  midió el orquestador contra producción** y el número está escrito con su lectura.
- **Nombre de la bitácora**: explicado arriba del todo.
- **Índice del grafo**: usé `codebase-memory` para confirmar el consumidor único de `cifra`
  (`search_code` con `\.cifra\(` → solo `lib/services/NotificacionService.ts`). El índice está
  **rancio respecto de este worktree** (no ve mis tests nuevos), lo cual es esperable; todo lo que
  se afirma arriba está **confirmado en el archivo real**, que es lo que manda la regla 7.
- **Entorno del worktree**: no traía `node_modules` ni `.env`. Enlacé `node_modules` por junction al
  checkout principal y copié el `.env` tras comprobar que apunta a `localhost`. El cliente de Prisma
  compartido venía **rancio** (typecheck rojo en `NotificacionRepository.ts` por enums de la 409 que
  faltaban); `pnpm exec prisma generate` sobre `db/schema.prisma` de esta rama lo dejó al día. **Ni
  `node_modules` ni `.env` entran en el commit** (`git check-ignore` lo confirma).

---

## T8.1 — el censo de producción (medido el 2026-09-10 por el orquestador, en solo lectura)

> **Los 10 `adminSatelite` tienen zona asignada. Cero sin zona.** Los `usuario` con `zona_id` nulo
> son `admin` (4), `maestro` (2) y las tiendas (5) — y para ésos el ámbito **global** es el correcto
> (R6/R7), así que no son este caso.

**El número confirma el diseño en vez de debilitarlo**, y es importante leerlo bien:

1. **El caso no existe hoy.** La ficha es **puramente preventiva**, exactamente como se registró.
   **Nadie verá un cambio de comportamiento al desplegar esto**: cero actores afectados, cero
   errores nuevos en el log, cero avisos que cambien de aspecto.
2. **Pero nada lo impide.** `Actor.zonaId` es opcional en el modelo (`IOrdenService.ts:21`), así que
   basta dar de alta un satélite y olvidar la zona. **No hace falta ningún cambio de código para que
   aparezca el primero** — es un alta de usuario.
3. Y por eso **el valor de la ficha no es el arreglo, es el rojo.** El día que ocurra, salta en un
   test —M1 y M4, medidas arriba con el predicado de la 146 intacto— en vez de en un número
   equivocado en la pantalla de alguien. Ésa es toda la diferencia entre una protección heredada y
   una afirmada.

Sigue sin ser puerta: la guarda es la misma exista o no ese usuario (`design.md` §10). Es
información.

---

## Veredicto

**Cumple.** Los diez requisitos con test, las cinco mutaciones muertas, el gate rápido en verde con
`INIT_EXIT=0` y sin negarse, y el rojo de M1/M4 **medido con el predicado de la 146 intacto** — que
es lo único que esta ficha vino a entregar.
