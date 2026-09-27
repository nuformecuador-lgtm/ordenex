# Ficha 436 — el asistente. Informe de revisión

**Rama:** `feat/436-asistente`. **SHA revisado:** `5339bcf2` (= `e53bcb1c` servidor + `5339bcf2` pantalla).
**Fecha:** 2026-09-17. **Revisor:** reviewer (no edita código).

**Veredicto: RECHAZADO.** Cuatro bloqueantes, ninguno en el corazón de la ficha. El acotamiento por
rol y el tope están bien construidos y los verifiqué yo mismo con sus mutaciones; lo que falla es
**R28 —el aviso de datos no dice lo que R28 pide—**, que **el modelo nunca sabe con quién habla**, y
dos incumplimientos de `CHECKPOINTS.md` que hoy dejan la ficha ilegible para el que venga detrás.

---

## 1. Lo que hice, y lo que NO me creí

Trabajé en un worktree propio (`.claude/worktrees/review-436`, ya eliminado) sobre `5339bcf2`, con su
`.env` y `node_modules` enlazado. **No toqué el árbol principal** y no edité código.

| Qué | Cómo lo medí | Resultado |
| --- | --- | --- |
| Acotamiento por rol (M1) | apliqué `documentosQuePuedeLeer(docs, rol)` a `[...docs]` y corrí el archivo | **10 de 13 rojos**, con las **339 líneas** de oficina en la petición del mensajero |
| Tope antes del proveedor (M2) | moví el `if (consultasHoy > tope)` detrás de `proveedor.responder(...)` | **3 rojos**, y el que muerde es `proveedor.llamadas`, no el desenlace |
| Upsert atómico (M4) | cambié el `INSERT ... ON CONFLICT` por `SELECT` mas escritura, contra Postgres real | **5 de 5 corridas rojas**, con el archivo ENTERO (el escenario que antes sobrevivía) |
| Guardia del panel hermano | tres envoltorios distintos escritos a mano | los tres se cazan; **dos sólo por el caso equivocado** (ver `m5`) |
| `textoSinMarcadores` | sonda con cuatro formas de cita | el defecto existe y es **peor** de lo reportado (`m1`) |
| Quitador naíf de `superficie-de-uso` | barrido de `app/`, `components/`, `lib/`, `providers/` | **35 archivos, 249 líneas tragadas, 1 export perdido** (`m6`) |
| `./init.sh` completo | corrido por mí en el worktree, a `progress/gate_review_436.log` | **`INIT_EXIT=1`**, un archivo ajeno; **verde aislado** (ver seccion 4) |

---

## 2. CHECKPOINTS.md, punto por punto

### Especificación
- [x] `specs/436-asistente/requirements.md` con 31 requisitos EARS numerados.
- [x] `specs/436-asistente/design.md` con alternativas descartadas y su porqué (RAG, contador en memoria, edge, Server Action).
- [ ] **`specs/436-asistente/tasks.md` con todas las tasks `[x]`** -> **0 de 28 marcadas**. Bloqueante `B3`.

### Trazabilidad
- [ ] **Cada `R<n>` mapea a un test que lo verifica** -> 30 de 31 sí. **R28 no**: su test afirma una promesa más débil que el requisito. Bloqueante `B1`.
- [ ] **`progress/impl_436.md` contiene el mapa `R<n>` a test** -> existe, pero es **el del commit de servidor**: sigue diciendo que R22, R26 y R28 están **sin hacer** y R25/R27/R29/R30 a medias. Bloqueante `B4`.

### Calidad de código
- [x] `pnpm run typecheck` verde (dentro de mi gate).
- [x] `pnpm run lint` sin errores (202 avisos preexistentes, ninguno de la ficha).
- [x] `pnpm test` — 29.663 pasados; el único rojo es ajeno y flake (seccion 4).
- [x] E2E: no aplica, este repo no tiene arnés vivo y la ficha lo declara.

### Datos y seguridad
- [x] **RLS activada** en `asistente_uso_diario`, y no sólo en el DDL: el test de integración lo lee de `pg_class.relrowsecurity` contra la base real.
- [x] Migración versionada y reversible, con su `down.sql`; aditiva pura, sin enums (así que no toca ningún `down.sql` anterior, y eso está escrito).
- [x] Ningún secreto hardcodeado: la credencial sale de `process.env` por `loadAsistenteConfig()`, que **nunca lanza**.
- [x] Webhooks: no aplica (no hay ninguno nuevo).

### Patrón de capas
- [x] Controller sin queries ni lógica: `app/api/asistente/route.ts` resuelve sesión, valida y compone.
- [x] Service sin HTTP: `AsistenteService` no importa `next/*` ni conoce `Request`.
- [x] Repository sólo queries: incluso **se quitó el tope de su firma** (desviación declarada, y es la correcta).
- [x] Interfaces en `lib/interfaces/` separadas por categoría (`external/`, `services/`, `repositories/`).

### Permisos
- [x] Ruta protegida: `/api/asistente` cae en el camino por defecto del middleware y responde **401 con JSON**, anclado en la guardia y en el handler.
- [x] Componentes `private/`: no aplica; el panel recibe todo por el stream y no fetchea datos sensibles.
- [~] **«Mutaciones internas usan Server Actions, no fetch a API routes»** -> desviación **declarada y justificada**: una Server Action no puede devolver un stream incremental y R19 es requisito de producto. Está escrito en `design.md` seccion 2.1 y en la cabecera de la ruta. **No bloqueante.**

### Multi-país
- [~] No se hardcodea moneda ni cuenta. Sí se nombra el país en el texto de sistema (`lib/asistente/instrucciones.ts:49`, `:51`), consistente con el resto del repo (`fechaCalendarioCR`). **No bloqueante**, anotado en `m9`.

### Verificación final
- [ ] `./init.sh` verde -> **el mío salió rojo por un flake ajeno** (seccion 4). Los dos del implementador salen `INIT_EXIT=0` y los verifiqué.
- [x] `progress/review_436.md` existe (éste).
- [ ] **Falta la entrada en `progress/history.md`** (`m8`).

---

## 3. Hallazgos

### BLOQUEANTE B1 — el aviso de R28 no dice que **lo que se escribe** viaja a un proveedor externo

**R28** (`requirements.md:188-190`) pide el aviso de que «**lo que se escriba** y las imágenes que se
adjunten viajan a un proveedor externo».

Lo que la pantalla dice, y es lo único que dice (`components/shared/AsistentePanel.tsx:76-77`,
pintado en `:376-379`):

> «Si mandás **una captura**, su contenido se procesa con un proveedor externo de inteligencia
> artificial. Evitá enviar datos de clientes si no hace falta.»

**Sólo cubre la mitad de las imágenes, y encima condicionada**: quien no adjunta nada lee un aviso
que no le aplica y **nunca se entera de que su pregunta sale de la empresa**. El resto del panel
tampoco lo dice: el `SheetDescription` es «Responde sobre cómo usar Ordenex»
(`AsistentePanel.tsx:203-205`).

Tres cosas lo agravan:

1. **El diseño aprobado traía el texto correcto** y se abandonó sin declararlo
   (`specs/436-asistente/design.md:322-323`):
   *«Lo que escribas y las imágenes que adjuntes se envían a un servicio externo para poder
   responderte. No compartas datos de un cliente si no hace falta.»*
2. **El comentario del propio código afirma lo contrario de lo que el texto hace**
   (`AsistentePanel.tsx:71-72`): «esto es lo único que le dice a la persona que **lo que escribe**
   sale de la empresa». No se lo dice.
3. **El test ancla el literal equivocado** (`tests/components/AsistentePanel.test.tsx:304-305`): el
   caso es bueno —busca por su literal, comprueba que no cuelga de un `<details>`, que sigue tras
   conversar— pero verifica **la cadena implementada**, no la propiedad de R28. Por eso el mapa
   «R28 a test» está verde y R28 no se cumple.

Y el contexto lo hace serio: es la primera pieza del repo que manda datos fuera, y la guardia de
persistencia de esta misma ficha escribe en su cabecera que lo que la gente teclea «lleva, tarde o
temprano, el nombre de un cliente, una dirección y un número de guía».

**Qué falta:** el aviso cubriendo las dos mitades (sirve el del diseño), y el test afirmando el
literal nuevo. Una línea de texto y una de test.

### BLOQUEANTE B2 — el modelo no sabe con quién habla

`instruccionesDelSistema()` **no recibe el rol** (`lib/asistente/instrucciones.ts:47`, sin
parámetros) y `ConsultaAsistente` **no tiene dónde llevarlo**
(`lib/interfaces/external/IAsistenteProvider.ts:44-57`: `instrucciones`, `documentos`, `mensajes`).
El adaptador tampoco lo nombra. Lo comprobé en los tres archivos.

Consecuencia medida por el implementador y que confirmo estructuralmente: a un `maestro` —que recibe
los **33** documentos, de los cinco portales— el modelo le contestó «no tenés cómo asignar... desde tu
cuenta de tienda». **No tiene de dónde deducir el rol**: tiene los documentos de todos, así que
adivina, y adivina con la misma seguridad con la que acierta. Es exactamente el modo de fallo que
D4 («no inventa») y todo el acotamiento venían a evitar: el documento correcto, la instrucción
equivocada.

Dos razones por las que lo marco bloqueante y no menor:

- **Ningún `R` lo cubre**, y eso es parte del hallazgo: el spec escribió el acotamiento de los
  *documentos* (R9-R11, impecable) y se olvidó de la *persona*. Un hueco de requisito no lo caza la
  trazabilidad, que es justo por lo que hace falta mirarlo aquí.
- **El arreglo es gratis y no rompe nada de lo medido.** Las instrucciones son el **primer** bloque
  del `system` y el `cache_control` va en el **último** de documentación
  (`lib/clients/anthropic-asistente.ts:68-76`): el prefijo cacheado sigue siendo **uno por rol,
  cinco en total**, que es lo que el diseño ya presupuestó. Meter el rol en el texto de sistema no
  cuesta un punto de caché.

**Qué falta:** que el rol viaje en las instrucciones (y un `R` que lo exija, con su test).

### BLOQUEANTE B3 — `tasks.md`: 0 de 28 tareas marcadas

`specs/436-asistente/tasks.md`, verificado **en el blob** (`git show 5339bcf2:...`): **28 tareas
sin marcar, ninguna con equis**. `CHECKPOINTS.md` línea 9 lo exige literalmente. El trabajo está
hecho —T3 a T21 son demostrables en el árbol— pero el documento dice que no se empezó, y las tres
puertas de despliegue (T25/T26/T27) quedan indistinguibles de las 25 que sí están hechas.

### BLOQUEANTE B4 — `progress/impl_436.md` es la bitácora de medio commit

El mapa de requisitos a tests (`progress/impl_436.md:76-108`) sigue siendo el del commit de
servidor: marca **FRONTEND pendiente** en R22, R26 y R28, y **mitad** en R25, R27, R29 y R30. El
commit de pantalla (`5339bcf2`) **no la tocó**: su `--stat` no incluye `progress/impl_436.md`.

Los tests existen y los verifiqué uno a uno (seccion 5), así que esto no es una trazabilidad rota
sino una bitácora que **miente por omisión**: `CHECKPOINTS.md` línea 13 pide ese mapa ahí porque es
el documento que el siguiente lee. Hoy, quien lo lea concluirá que la ficha está a medias — y las
desviaciones de la pasada de pantalla (empezando por B1) no están declaradas en ningún sitio.

---

### menor m1 — `textoSinMarcadores` deja basura de puntuación, y más de la reportada

`lib/asistente/citas.ts:84-95`. Sondeado con cuatro formas de cita (salida real, no razonada):

```
"...del lado de la oficina [[doc:x]]."    sale como   "...del lado de la oficina ."
"Explicación completa. [[doc:x]]"         sale como   "Explicación completa."        (bien)
"Mirá [[doc:x]], y después confirmá."     sale como   "Mirá , y después confirmá."
"Lo tenés en [[doc:a]] [[doc:b]] ; y ya." sale como   "Lo tenés en   ; y ya."
```

El reemplazo de espacios finales y el `trimEnd()` sólo arreglan el caso de cita al final. El caso
«Mirá , y después» es peor que el espacio suelto: la frase pierde su referente y queda agramatical.
Los dos tests de `textoSinMarcadores` (`tests/unit/asistente/citas.test.ts:80-83` y `:87-96`) usan
**sólo la forma de cita al final**, que es la que ya funciona: por eso no lo cazan. No rompe ningún
requisito —R23/R24/R25 van de enlaces, y esos están bien— pero se lee en cada respuesta citada del
producto nuevo. **Arréglese antes de desplegar**, no antes de mergear.

### menor m2 — el contador cuenta intentos, no consultas atendidas

`lib/services/AsistenteService.ts:68-75`: `consumirUnaConsulta` incrementa **siempre**, y la
comparación con el tope viene después. Que una consulta que el proveedor no atienda gaste cupo está
**declarado** y es defendible. Lo que no está dicho es la otra mitad: quien ya está en el tope y
sigue insistiendo **también incrementa**, así que la columna `consultas` no mide «consultas
atendidas» —que es lo que dice R17, `requirements.md:149`— sino «veces que alguien lo intentó».

Consecuencia concreta: **T27 («cuántas consultas hubo») leerá un número inflado**, y es el número
que la ficha dice que decidirá si Q2 deja de ser una pregunta. Y es la única telemetría que hay,
porque nada más se guarda.

### menor m3 — el freno cuenta preguntas, y una pregunta no tiene coste acotado

El esquema del borde admite **40 mensajes** (`app/api/asistente/route.ts:84`) y **una imagen por
mensaje** (`:68`), es decir **hasta 40 imágenes en una sola petición**, más 40 turnos de 4.000
caracteres. El adaptador las reenvía todas (`lib/clients/anthropic-asistente.ts:88-98`), y van en
`messages`, **fuera del prefijo cacheado**: se pagan enteras cada vez.

Q6 decidió «una imagen por mensaje» y «el tope mide preguntas, no bytes», y el límite de cuerpo de
Vercel (unos 4,5 MB, que el propio código documenta en `AsistentePanel.tsx:79-89`) acota el daño en
producción. Pero el tope de «una imagen» lo sostiene hoy **el cliente**, no el servidor, y el
servidor es el único borde que existe. Con 30 consultas por persona y día, el coste por persona y
día no está acotado por nada nuestro.

**Sugerencia:** contar imágenes **por petición** y no por mensaje, con un `superRefine` sobre el
schema del cuerpo.

### menor m4 — la guardia de red mide cuatro archivos, no el camino que gasta dinero

`tests/unit/guards/asistente-sin-datos.guardia.test.ts:210-219`: el caso «ningún archivo menciona
fetch ni una URL» recorre **sólo `lib/asistente/`** — los cuatro módulos puros, que por construcción
no iban a tener red. **No cubre** `lib/clients/anthropic-asistente.ts`, ni
`lib/services/AsistenteService.ts`, ni `app/api/asistente/`. Del adaptador sólo se comprueba que su
texto contenga la cadena que declara el fetch inyectable (`:221-225`).

Y sí, **una llamada desde `app/api/` se le escapa**: `construirServicio()`
(`app/api/asistente/route.ts:96-109`) construye el cliente real **sin `fetchImpl`**, con la clave
que salga de `process.env` — y `tests/integration/db/_postgres-real.ts:26` llama a
`process.loadEnvFile()`, así que en el worker de cualquier test que lo importe la clave real está
cargada. **Hoy no pasa**: revisé los tres archivos que llaman al handler y **todos inyectan
`deps.service`**. Pero eso lo sostiene la disciplina, no una guardia: un test futuro que llame a
`POST(req)` —o a `handleAsistente(req)` sin `deps`— saldría a internet y gastaría, y ningún archivo
se pondría rojo.

**Sugerencia:** una guardia que recorra `tests/` y exija que toda invocación del handler del
asistente lleve `service:` o `fetchImpl:`.

### menor m5 — la guardia del panel hermano caza, pero con el rojo equivocado

Medido con tres envoltorios escritos a mano sobre `app/(app)/layout.tsx`:

| variante | caso «el layout NO envuelve children» | caso «se monta al lado de los dos hermanos» |
| --- | --- | --- |
| A — con un fragmento en medio | **rojo** | rojo |
| B — el panel con una clase que lleva barra | **VERDE** | rojo |
| C — igual, con la etiqueta multilínea | **VERDE** | rojo |

El regex de `tests/unit/guards/asistente-panel-hermano.guardia.test.ts:58` no atraviesa un atributo
que lleve una barra —una clase de Tailwind basta—. **No hay falso verde**: lo salva el `indexOf` de
la línea `:72`, que exige que el panel vaya después de `{children}` y que ningún envoltorio puede
cumplir. Pero el rojo llega con el mensaje «se monta al lado de los dos hermanos», no con «el panel
envuelve children: R22 deja de ser estructural», que es el que nombra el problema. La red aguanta;
el diagnóstico apunta mal.

Y sobre **el proveedor envolviendo**: `AsistenteProvider` sí envuelve, y debe hacerlo, porque el «?»
vive dentro de `{children}`. Lo que la guardia comprueba es que no tenga `return null` ni un
fragmento vacío (`:91-92`), lo cual deja fuera un render condicional del estilo «montado y
children». Verifiqué el archivo: no hay ninguna rama entre la firma y el `return`
(`providers/AsistenteProvider.tsx:311`). Correcto hoy, vigilado con estrechez.

### menor m6 — la ficha planta una mina nueva del quitador naíf, en su propia ruta

Medí el quitador de `tests/unit/guards/superficie-de-uso.guardia.test.ts:97-101` sobre todo el árbol
de código: **35 archivos** llevan una barra-asterisco dentro de un comentario de línea, y eso le
hace tragarse **249 líneas de código**. Entre ellos, **`app/api/asistente/route.ts`, que es de esta
ficha**: el comentario de la línea **57** (el que nombra el comodín de imagen) abre el bloque y se
traga las **líneas 59 a 69** —los dos esquemas zod del cuerpo—.

Es la **misma** mina que el implementador quitó del panel y documentó al quitarla
(`asistente-panel-hermano.guardia.test.ts:117-129`). En un archivo la vio y en el otro no.

Además, las **dos guardias nuevas** de la ficha (`asistente-sin-datos.guardia.test.ts:120-129` y
`asistente-sin-persistencia.guardia.test.ts:55-62`) traen **su propio quitador naíf** con el mismo
defecto de orden, mientras la tercera (`asistente-panel-hermano`) sí usa el `codigoSinComentarios`
compartido de la 283. Tres guardias nuevas, dos criterios. Ver 6.5 para el riesgo real.

### menor m7 — un ancla que se afirma contra su propia fuente, y una costura sin atar

`tests/unit/asistente/instrucciones.test.ts:24` compara el texto contra la constante importada:
siempre verde. Los otros seis casos de ese archivo sí usan literales a mano («NO INVENTÁS», «Nunca
completes un hueco», «no está abajo, no lo sabés»), así que R5 **está anclado** y el hallazgo es de
un solo caso.

Lo que sí queda suelto: `pareceNoLoSe` (`lib/asistente/instrucciones.ts:39-41`) detecta por **regex
propia**, no por la constante. Si alguien cambiara la constante a «Ni idea», la instrucción
cambiaría, el test seguiría verde, y el contador de Q5 —la única realimentación de toda la pieza—
se iría a cero **sin un solo rojo**. Un caso bastaría: pasarle a `pareceNoLoSe` la propia constante
y exigir que la reconozca.

### menor m8 — falta la entrada en `progress/history.md`

`CHECKPOINTS.md` línea 46. No hay ninguna mención de la 436.

### menor m9 — dos textos caducos que el propio trabajo ya desmintió

- `feature_list.json:5221` sigue advirtiendo de la «TRAMPA HEREDADA» de que la ruta nueva tiene que
  entrar en `outputFileTracingIncludes`. **H1 lo midió falso** y T21 lo ató con una guardia. Quien
  lea la ficha volverá a buscar lo que no hay que tocar.
- `lib/asistente/instrucciones.ts:49,51` nombra el país en literal. Consistente con el repo, pero es
  el sitio donde un segundo país dolería.

### menor m10 — el cliente puede forjar turnos del asistente

El campo `autor` admite el valor del asistente (`app/api/asistente/route.ts:66`) y el hilo entero lo
manda el cliente, porque el servidor no guarda nada (D10). Cualquiera con sesión puede inventar
turnos del asistente para dirigir al modelo. **El daño está acotado por lo que de verdad importa**:
el conjunto de documentos se decide en el servidor y no se puede ensanchar desde el cuerpo —lo
verifiqué con M1 y con los casos de R8—, así que un mensajero no sonsaca lo que no tiene. Lo que sí
puede es empujarlo a especular. Anotado, no accionable en esta ficha.

---

## 4. El gate

Lo corrí yo, completo y con `.env`, en mi worktree. Log: **`progress/gate_review_436.log`**
(sin commitear, 12.156 líneas, con `INIT_EXIT` escrito dentro del archivo).

```
 Test Files  1 failed | 2037 passed (2038)
      Tests  29663 passed | 40 skipped (29703)
ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/db/ranking-snapshot-migration.test.ts
INIT_EXIT=1
```

**No es de la ficha y es un flake conocido.** El error es el código `40P01`, «se ha detectado un
deadlock», en un `$executeRawUnsafe` dentro de una transacción revertida, en la migración del
ranking. Hice lo que el propio gate manda: **corrí ese archivo aislado y salió 49 de 49 verde en
552 ms**. Es la familia de flake ya documentada en este repo.

Los **40 saltados** contra los 26 del implementador son consecuencia del mismo rojo: 17 de
`AnaliticaPage` más 9 de `AnaliticaShell` más **14 de ese archivo**, que quedan sin correr al caer
su suite. **17 + 9 + 14 = 40.** Sin el flake son los 26 de siempre.

Verifiqué además los dos logs del implementador: `gate_436_backend.log` (2036 archivos) y
`gate_436_frontend.log` (2038 archivos, 29.677 pasados, 26 saltados), **los dos con `INIT_EXIT=0`
escrito dentro del archivo**.

**Conclusión: el gate está verde salvo un flake ajeno, reproducido verde en aislado. No es motivo
de rechazo.**

---

## 5. Trazabilidad de los 31 requisitos, verificada por mí

Recorrí los 31 abriendo el test y comprobando que afirma la promesa, no su alrededor.

| # | Test | Veredicto |
| --- | --- | --- |
| R1 | `unit/asistente/contexto-documental.test.ts` | OK — cuerpo a cuerpo contra el `.md` del disco, con control de no-vacuidad (33) |
| R2 | `unit/guards/asistente-sin-frontmatter.guardia.test.ts` | OK — y con control positivo: el archivo CRUDO sí tiene el bloque |
| R3 | `unit/guards/asistente-sin-datos.guardia.test.ts` | OK — canario en las dos direcciones |
| R4 | `unit/asistente/peticion-al-proveedor.test.ts` | OK — comprueba que la clave `tools` no existe, no que esté vacía, con control de lo que sí debe llevar |
| R5 | `unit/asistente/instrucciones.test.ts` | OK — por literales a mano (ver `m7` para el caso débil) |
| R6 | `unit/asistente/peticion-al-proveedor.test.ts` | OK — exactamente uno, en el último bloque, y ninguno sin documentos |
| R7 | `integration/asistente-route.test.ts` | OK — mismo cuerpo, dos sesiones, 8 contra 33; más el caso estructural |
| R8 | `integration/asistente-route.test.ts` | OK — 422 con rol, slugs y documentos; y el camino limpio también medido |
| R9 | `unit/asistente/acotamiento-por-rol.test.ts` | OK — **mutación M1 verificada por mí** |
| R10 | idem | OK — 33/33/10/8/7 **literales a mano** (derivarlos lo habría dejado siempre verde) |
| R11 | idem | OK — **339 líneas** reproducidas bajo mutación; con control inverso (al maestro SÍ le llega) |
| R12 | `integration/asistente-route.test.ts` y `guards/api-sin-redirect-sin-sesion` | OK — handler y middleware, y el control pasa de dos rutas a tres |
| R13 | `unit/asistente/tope-diario.test.ts` y la ruta | OK — proveedor y contador sin tocar |
| R14 | `unit/asistente/tope-diario.test.ts` | OK — incluye el off-by-one: la 30 entra |
| R15 | idem | OK — **mutación M2 verificada por mí**: muere por `llamadas`, no por el desenlace |
| R16 | `integration/db/asistente-uso-diario.int.test.ts` | OK — Postgres real, borde de medianoche CR, índice único leído de `pg_indexes` |
| R17 | idem | OK — **mutación M4 verificada por mí, 5 de 5** (ver 6.2) |
| R18 | `integration/asistente-route.test.ts` | OK — y con el 409 aparte, por si algún día se ignorara en silencio |
| R19 | `integration/asistente-route.test.ts` | OK — compuerta real: lee los tres trozos antes del fin, y moriría por timeout si se juntara |
| R20 | `unit/asistente/sin-credencial.test.ts` | OK — el fetch inyectado no se llama |
| R21 | `unit/asistente/errores-no-filtran.test.ts` | OK — seis códigos y fallo de red |
| R22 | `components/AsistentePanel.test.tsx` y la guardia hermano | OK — con control negativo: abierto y respondiendo bien, la página tampoco desaparece |
| R23 | `unit/asistente/citas.test.ts` | OK — slugs reales del catálogo |
| R24 | `citas.test.ts` y el panel | OK — **y en pantalla**: ni el enlace ni el nombre del documento ajeno |
| R25 | `citas.test.ts` y el panel | OK — con contraprueba: con marcador válido SÍ se pinta |
| R26 | `components/AyudaBoton.test.tsx` | OK — las 8 aserciones de href **migradas a mano**, el href re-anclado **dentro del panel**, y 4 casos nuevos que miden que ABRE |
| R27 | el panel y la ruta | OK — «primera acción» medida por **posición en el DOM**, no por opinión |
| R28 | `components/AsistentePanel.test.tsx:304-305` | **FALLA — el test afirma menos que el requisito** (ver `B1`) |
| R29 | el panel y `integration/asistente-imagenes.test.ts` | OK — accept literal a mano, audio 422, dos imágenes en un mensaje rechazadas |
| R30 | el panel, las guardias y el censo de columnas contra la base | OK — desmontar y montar, espías de almacenamiento y cookie |
| R31 | `guards/ayuda-md-viajan-a-produccion.guardia.test.ts` | OK con canario; es prueba estática, la de verdad es T25 |

**Busqué de propósito las trampas de siempre:** no encontré ningún retorno temprano que dejara un
test verde sin datos (el de integración **rompe ruidosamente** si la base no tiene usuarios,
`asistente-uso-diario.int.test.ts:46-49`); los conteos de R10 son literales a mano y no derivados;
las guardias traen canario; y la de persistencia mide **por tabla en todo el archivo**, no por
método, con canario positivo y negativo. La única aserción contra su propia fuente que encontré es
la de `m7`, y es un caso de siete.

---

## 6. Las cinco preguntas, con mi criterio

### 6.1 El espacio antes de la puntuación — **menor, pero arréglalo antes de desplegar**

No bloquea el merge: ningún requisito lo cubre y las citas —que es lo que R23/R24/R25 exigen—
funcionan. **Pero es peor de lo que te dijo**: una cita a mitad de frase deja «Mirá , y después
confirmá», que no es un espacio sobrante sino una frase sin referente. Y sale en la primera
impresión de la pieza nueva, delante de los 37 usuarios. Es una línea —colapsar el espacio que
precede a un signo de puntuación y los dobles espacios— más un caso de test con la cita a mitad,
que hoy no existe.

### 6.2 El rol en las instrucciones — **coincido: es lo más serio, y lo marco BLOQUEANTE**

Está en `B2`. Añado lo que no se ve desde fuera: **el arreglo no cuesta caché**.
El diseño presupuestó «un prefijo por rol, cinco en total»; como las instrucciones son el primer
bloque del `system` y el `cache_control` va en el último de documentación, meter el rol ahí **sigue
dando cinco prefijos**. No hay compromiso que discutir.

Y sobre la mutación del `upsert` que preguntabas de paso: **el arreglo sí cierra lo que cerraba**.
Corrí la mutación **cinco veces con el archivo entero** —el escenario exacto en el que antes
sobrevivía— y murió **las cinco**, siempre con `[1,1]` contra `[1,2]`. El calentamiento iguala las
dos conexiones, que era la causa medida. No lo vuelve determinista por construcción (sigue siendo
una carrera), pero hay algo mejor que eso: **la atomicidad de producción no depende de ese test**,
sino de que el incremento sea **una sola sentencia** con `ON CONFLICT` contra un índice único — y
el índice se lee de `pg_indexes` y se comprueba que muerde, en dos casos aparte. El test de la
carrera corrobora; el índice garantiza.

### 6.3 Los chips de sugerencia — **de acuerdo, no implementarlos**

No hay requisito, no hay fuente de dónde salen las preguntas, y el panel ya ofrece «Leer la ayuda de
esta pantalla» como primera acción, que es la sugerencia útil y **sale de un dato real**: el mapa de
la 433. Unos chips inventados en el cliente serían contenido sin fuente en la pieza cuya regla
número uno es «no inventes». Si se quieren, salen del contador de «no lo sé» de Q5 cuando haya
números.

### 6.4 El título tras la primera respuesta — **aceptable, menor**

El enlace **está y funciona desde el primer instante**: el test lo afirma con su `href` correcto
antes de preguntar nada (`AsistentePanel.test.tsx:174-175`). Lo único que llega tarde es el título
del documento. Y el motivo es cierto, lo verifiqué: `MapaAyuda` es un mapa de ruta a slug
(`providers/AyudaProvider.tsx:22`) — en el cliente **no hay títulos**, así que el panel no tiene de
dónde sacarlo sin ensanchar un contrato de la 433. La primera impresión no queda coja: queda
genérica. Si molesta, es una ficha de una línea en el mapa de la 433, no de ésta.

### 6.5 La deuda de `superficie-de-uso.guardia` — **falso VERDE hoy: bajo, y medido. Pero la ficha empeoró la deuda**

Medí el quitador naíf contra todo el árbol (`app/`, `components/`, `lib/`, `providers/`):

- **35 archivos** con una barra-asterisco dentro de un comentario de línea;
- **249 líneas de código tragadas**;
- **1 solo export desaparece del censo**: `AnaliticaApiKeyDeps` en
  `app/api/ordenes/api-key/analitica/route.ts:62`, y es una **interfaz**, que el censo no audita.

Así que **el falso verde hoy es prácticamente cero**. El modo de fallo dominante es el contrario, el
**falso rojo**, que es lo que le costó el gate: en ese mismo archivo el tragado se come **el bloque
entero de imports más el `export const runtime`** (líneas 37 a 63), o sea **21 aristas** que
desaparecen del grafo de alcanzabilidad de una guardia cuyo trabajo es la alcanzabilidad. El día que
algún módulo quede colgando sólo de una de esas aristas, la guardia gritará contra quien no tiene la
culpa.

**De acuerdo en no tocar guardia ajena**, y de acuerdo en que el arreglo es `codigoSinComentarios`.
Lo que **no** comparto es haberla dejado peor: la ficha **planta una mina nueva** en
`app/api/asistente/route.ts:57`, que se traga las líneas 59 a 69 — la misma que se quitó del panel
unas horas antes y se documentó al quitarla. Reescribir ese comentario para que no contenga la
secuencia que abre bloque cuesta nada y no es tocar guardia ajena: es no cebar la trampa.

---

## 7. Lo que NO revisé, por instrucción

- La decisión A del humano sobre el «?». No se reabre.
- El «?» de 38x32 px en teléfono: deuda de la 433, ficha aparte.
- La credencial fuera de Vercel: puerta de despliegue (T25/T26), no de merge.

---

## 8. Veredicto

**RECHAZADO.**

No por el corazón de la ficha. **El acotamiento por rol está bien construido y bien medido**: lo
verifiqué yo mismo apagándolo y viendo los 10 rojos y las 339 líneas de la oficina colándose en la
petición de un mensajero. **El tope frena antes de gastar**, y su test muere por
`proveedor.llamadas` y no por el desenlace, que es la diferencia entre un tope y una factura con
disculpa. **El contador es atómico en la base**, no en un `if`. **La suite no toca la red.** Y **la
pantalla no puede tumbar la página**, con la forma del árbol vigilada por una guardia que probé a
romper de tres maneras.

Vuelve por cuatro cosas concretas:

1. **`B1` — R28 no se cumple.** El aviso sólo habla de imágenes, y encima condicionado; el texto
   correcto ya estaba escrito en el diseño aprobado, y el test ancló el equivocado. En la primera
   pieza que manda datos fuera de la empresa, decirle a la gente que su pregunta viaja **no es un
   detalle de redacción: es el requisito**.
2. **`B2` — el modelo no sabe con quién habla.** El acotamiento entrega los documentos correctos y
   deja que el modelo adivine la persona; ya se midió adivinando mal, con total seguridad. El
   arreglo no cuesta caché, y hace falta un `R` que lo exija.
3. **`B3` — 0 de 28 tareas marcadas en `tasks.md`.**
4. **`B4` — `progress/impl_436.md` sigue siendo la bitácora del commit de servidor**, y declara sin
   hacer siete requisitos que sí están hechos.

`B3` y `B4` son media hora. `B1` es una línea de texto y una de test. `B2` es un parámetro. Nada de
esto exige rediseñar nada, y **ninguno de los diez menores bloquea el merge** — pero `m1` (la
puntuación, que se lee en cada respuesta citada) y `m6` (la mina nueva en la línea 57 de la ruta)
merecen ir en el mismo viaje.
