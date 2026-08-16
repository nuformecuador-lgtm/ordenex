# Feature 229 — Rastreo público del envío · bitácora de implementación

Rama: `feature/229-rastreo-publico-envio` (nacida de `origin/dev`) · worktree `C:/w229`
Spec: `specs/229-rastreo-publico-envio/` · puerta humana pasada el 2026-08-15 («todo por defecto»).

---

## 1. Consecuencias y riesgos ACEPTADOS (T0.3) — decisiones, no pendientes

Se registran aquí porque, sin registro, cualquiera de las seis se lee como un olvido.

| # | Qué se aceptó | Origen |
| --- | --- | --- |
| **F2** | **No hay URL enlazable ni compartible del seguimiento.** Al ser un modal y no una ruta, no se puede mandar por WhatsApp un enlace al estado de un envío. | design §0, consecuencia de F1 (modal, decisión humana) |
| **F3** | **El resultado no sobrevive a un refresh.** El destinatario vuelve a la landing y reingresa la guía. | design §0 |
| **F4 (R35)** | **El QR impreso de la etiqueta queda intacto.** `PAQUETE_BASE_PATH` (`lib/utils/paquete-url.ts:11`) sigue apuntando a `/paquete/<numGuia>`, que es privada: quien escanee sin sesión sigue cayendo en la landing por `REDIRECT_TO_ROOT` y tiene que abrir el modal y teclear la guía a mano. | design §0 / R35 |
| **F6 (R5)** | **Con sesión abierta el modal es inalcanzable:** `/` redirige a `/dashboard` (`middleware.ts:62-64`). Un operador que quiera «ver lo que ve el cliente» debe cerrar sesión o usar una ventana privada. | design §0 / R5 |
| **⚠ §5.bis (G3)** | **El limitador de intentos vive en memoria del proceso** (`ResetRateLimiter`). En serverless cada instancia tiene su propio contador, cada despliegue los resetea y un atacante repartido entre IPs no lo toca nunca: **acota al torpe, no al decidido.** Un límite persistido es **ficha aparte**, no un ensanche de ésta. | design §5.bis, firmado 2026-08-15 |
| **⚠ §5.ter (G8)** | **`sin_gestionar` se publica como «En reparto»**, de modo que si la orden se quedó sin gestionar **el cliente no se entera**. Es deliberado (ningún rastreo publica fallos operativos), no un efecto colateral del mapeo. «Arreglarlo» exponiendo el estado interno incumpliría R15. | design §5.ter, firmado 2026-08-15 |

Riesgo adicional declarado en design §8.3: las órdenes con `telefono_dest` de menos de 4 dígitos
quedan **sin rastreo público** (G2) y el destinatario recibe el mismo «no encontrado» que una guía
inexistente, sin forma de saber por qué. Es el precio directo de no filtrar existencia (R7).

---

## 2. Medición T0.4 — órdenes sin segundo factor utilizable

Consulta (G1/G2, design §8.3):

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE length(regexp_replace(telefono_dest, '\D', '', 'g')) < 4) AS cortos
FROM orden;
```

| Fecha | Entorno | Total de órdenes | Con teléfono de < 4 dígitos |
| --- | --- | --- | --- |
| 2026-08-15 | Postgres **local de desarrollo** (`localhost:5432/ordenex`, el `DATABASE_URL` del worktree `C:/w229`) | 78 | **0** |

Salida real: `[{"total":"78","cortos":"0"}]`.

Lectura honesta del número: en esta base **ninguna** orden queda sin rastreo por teléfono corto,
pero son 78 filas de desarrollo, **no producción**. La medición confirma que el caso (d) de R7 no es
el caso común aquí; **no** demuestra que sea cero en producción, y la consulta debe repetirse contra
la base real antes de sacar conclusiones operativas. La decisión G2 no se re-abre en ninguno de los
dos casos: la medición es informativa (design §8.3).

*(Nota de método: la consulta no se pudo ejecutar con un script suelto —el proceso hijo se cuelga al
abrir el socket en este shell—, así que se midió a través del mismo arnés que usan los tests de
`tests/integration/db/` (`_postgres-real.ts`), con un archivo temporal que se borró acto seguido.)*

---

## 3. Archivos tocados

**Creados — producción (7):**

| Archivo | Qué es |
| --- | --- |
| `lib/types/rastreo-publico.ts` | vocabulario público (9 hitos + `en_proceso` neutral), `ETIQUETA_POR_HITO`, `HITO_POR_ESTATUS` (`as const satisfies Record<OrderStatusValue, HitoPublico>`), `HITO_POR_DEFECTO`, `hitoDeEstatus(string)`, `consultaRastreoSchema`, DTO y resultado discriminado |
| `lib/config/rastreo-publico.ts` | umbrales por entorno con defecto en código: 8 intentos, 10 min, 4 dígitos, zona horaria del negocio |
| `lib/interfaces/repositories/IRastreoPublicoRepository.ts` | contrato del repositorio |
| `lib/interfaces/services/IRastreoPublicoService.ts` | contrato del service |
| `lib/repositories/RastreoPublicoRepository.ts` | dos consultas Prisma con `select` explícito |
| `lib/services/RastreoPublicoService.ts` | identificación, segundo factor sin corte temprano, mapeo de hitos, colapso de rachas, DTO campo a campo |
| `lib/actions/rastreo-publico.ts` | Server Action pública: zod → IP → límite → registrar → service |

**Creado — UI (1):** `app/_landing/RastreoDialog.tsx` (isla cliente: `Dialog` + formulario + resultado).

**Creados — tests (10) + E2E (1):**
`tests/unit/services/rastreo-publico-service.test.ts`, `tests/unit/actions/rastreo-publico-action.test.ts`,
`tests/integration/repositories/rastreo-publico.int.test.ts`, `tests/components/RastreoDialog.test.tsx`,
`tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts`,
`tests/unit/guards/rastreo-dto-lista-blanca.guardia.test.ts`,
`tests/unit/guards/rastreo-frontera.guardia.test.ts`,
`tests/unit/guards/rastreo-sin-estatus-crudo.guardia.test.ts`,
`tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`,
`tests/unit/guards/rastreo-modal-tema.guardia.test.ts`, `e2e/rastreo-publico.spec.ts`.

**Modificados (3):**

| Archivo | Cambio |
| --- | --- |
| `app/_landing/LandingNav.tsx` | el botón «Rastrear envío» **deja de estar `disabled`**: el `<button>` lo emite ahora el `DialogTrigger` de `RastreoDialog`, montado como isla cliente con **las mismas clases y el mismo texto**. La nav sigue siendo Server Component. Comentario de cabecera corregido: ya no es cierto que el botón sea inerte ni que el seguimiento del destinatario viva en `/paquete/[numGuia]` |
| `tests/unit/guards/censo-order-status-rename.test.ts` | **4 entradas de allowlist** con su motivo escrito (ver §6.a) |
| `specs/229-rastreo-publico-envio/tasks.md` | tareas marcadas `[x]` |

**NO tocados, y es parte del contrato:** `middleware.ts`, `db/schema.prisma`, `db/migrations/**`,
`lib/utils/paquete-url.ts`, `tests/unit/auth/middleware.test.ts`, `tests/unit/utils/paquete-url.test.ts`,
`app/paquete/**`. Ninguna ruta nueva, ningún `page.tsx`, ninguna migración.

---

## 4. Mapa `R<n> → test` (T5.2) — los 35, todos ejecutados

Abreviaturas: **SVC** = `tests/unit/services/rastreo-publico-service.test.ts` · **ACT** =
`tests/unit/actions/rastreo-publico-action.test.ts` · **INT** =
`tests/integration/repositories/rastreo-publico.int.test.ts` · **DLG** =
`tests/components/RastreoDialog.test.tsx` · **G-HIT / G-DTO / G-FRO / G-EST / G-RUT / G-TEM** = las seis
guardias `tests/unit/guards/rastreo-*` (hitos-exhaustivo / dto-lista-blanca / frontera /
sin-estatus-crudo / sin-ruta-nueva / modal-tema) · **MW** = `tests/unit/auth/middleware.test.ts`
(existente, **sin modificar**) · **PQU** = `tests/unit/utils/paquete-url.test.ts` (existente, **sin
modificar**) · **E2E** = `e2e/rastreo-publico.spec.ts`.

| R | Test que lo cubre (nombre exacto) |
| --- | --- |
| R1 | DLG «el botón «Rastrear envío» ya no está deshabilitado y su activación monta el diálogo» + «hay UN solo disparador: la nav activa el botón que ya tenía, no añade otro» |
| R2 | ACT «devuelve resultado sin cookie de sesion y sin resolver actor» + «el modulo no importa la resolucion de actor ni las cookies de sesion»; MW «/ sin sesion deja pasar (landing publica, 200)»; E2E «un visitante sin sesión consulta su envío desde la landing» |
| R3 | G-RUT «`PUBLIC_ROUTES` es EXACTAMENTE la lista firmada» + «`SELF_AUTH_ROUTES` …» + «`REDIRECT_TO_ROOT` …» + «ningun `page.tsx` ni `route.ts` importa los modulos de la feature» + «no existe ningún SEGMENTO de ruta `rastreo` bajo `app/`» + «CONTRAPRUEBA: la comparacion caza una entrada añadida a cualquiera de las tres listas» |
| R4 | MW «redirige a / (no a /login) cuando no hay sesion activa» y «deja pasar cuando la sesion es valida» (**sin modificar**) + G-FRO «… no nombra la etiqueta privada ni su URL impresa» (×7 módulos) |
| R5 | MW «/ con sesion redirige (307) a /dashboard» (**sin modificar**) + la consecuencia F6, escrita en §1 de esta bitácora |
| R6 | SVC «sin los cuatro digitos del telefono no consulta datos y rechaza» + «un factor mas corto que el exigido tampoco basta» |
| R7 | SVC «guia inexistente, factor errado, orden borrada y telefono de menos de 4 digitos devuelven un resultado estructuralmente identico»; INT «una guia de una orden borrada logicamente responde igual que una guia inexistente» (caso c) + «la orden borrada tampoco llega a leer su historial»; ACT «propaga tal cual el rechazo del service, sin enriquecerlo»; E2E «los dos casos malos muestran el mismo texto» |
| R8 | SVC «no corta antes cuando la guia no existe: el numero de llamadas a datos es el mismo en los cuatro casos» + «el modulo no tiene un retorno temprano para el caso 'la guia no existe'» |
| R9 | ACT «al noveno intento en diez minutos responde demasiados_intentos sin llamar al servicio, con guias existentes e inexistentes por igual, y la clave del limitador no incorpora la guia» + «la secuencia de rechazos es la misma con una guia que existe y con una que no» + «la clave es solo la IP: otra IP tiene su propio cubo» + «la guia NO entra en la clave del limitador» + «pasada la ventana, la misma IP vuelve a poder consultar» |
| R10 | ACT «el limite efectivo cambia con la variable de entorno y cae a 8 en 10 minutos sin ella» + «la ventana tambien sale del entorno» + «los umbrales no estan escritos en el modulo que los aplica» |
| R11 | SVC «acepta el segundo factor con y sin separadores y normaliza tambien el telefono almacenado» |
| R12 | G-FRO «ningun modulo llama a `console.*`» + «ningun modulo tiene un `catch` vacio» + «ningun texto de la feature interpola la entrada del usuario» + «los mensajes de rechazo del schema son literales FIJOS, sin interpolacion» + «CONTRAPRUEBA: los tres barridos cazan su violacion inyectada»; ACT «los mensajes de rechazo son literales fijos y NO repiten la entrada» |
| R13 | G-FRO «las claves del schema son exactamente `numGuia` y `factor`» + «no acepta ningun filtro del negocio: zona, tienda, mensajero, fecha ni paginacion» + «ningun modulo nombra `resolveActorFromSession` ni lee la cookie de sesion» + sus dos contrapruebas |
| R14 | SVC «devuelve la secuencia de hitos ocurridos con sus fechas y no añade ninguna entrada posterior a la ultima transicion» + «ordena la linea de forma ascendente aunque el repositorio devuelva las filas desordenadas» |
| R15 | G-EST «ningún `order_status.value` cruza al resultado público» + «cada `hito` publicado pertenece al vocabulario público, y el vigente tambien» + «los veinte estatus se traducen a los NUEVE hitos firmados, sin sobrar ni faltar» + «una fila HUERFANA (el caso real de la feature 155) tampoco publica su value crudo» + 4 contrapruebas («caza `en_bodega_satelite`, aunque su PREFIJO sea el id de un hito público», «caza `sin_gestionar`, que es justo el estado que G8 esconde tras «En reparto»», «caza un value interno escondido dentro de un texto, no solo como valor exacto», «caza los DIECINUEVE values que no son homonimos de un hito publico») |
| R16 | G-HIT «los 20 values del catalogo tienen hito publico asignado y coinciden con la tabla firmada (incluidos recolectando→registrado, incidente→no_entregado y sin_gestionar→en_reparto)» + «el mapa no inventa estatus que no esten en el catalogo vigente» + «todo hito asignado pertenece al vocabulario publico y tiene etiqueta». *La parte «rompe el build» la sostiene el compilador: el mapa es `as const satisfies Record<OrderStatusValue, HitoPublico>`, así que un value nuevo en `ORDER_STATUS_SEED` deja el `Record` incompleto y `pnpm run typecheck` falla.* |
| R17 | G-HIT «una fila huerfana (el caso real de la feature 155) recibe el hito neutral» + «el hito por defecto es neutral, tiene etiqueta y NO es el value crudo» + «nunca devuelve undefined para un value arbitrario»; SVC «un estatus fuera del catalogo aparece como hito neutral y su value crudo no viaja» |
| R18 | SVC «colapsa transiciones consecutivas del mismo hito conservando la fecha de la primera» + «una racha que vuelve al mismo hito mas tarde SI produce dos entradas (solo colapsa lo consecutivo)» |
| R19 | SVC «formatea dia y hora en el calendario del negocio para un instante UTC conocido» + «la zona sale de la CONFIGURACION: con otra zona, el mismo instante da otra hora» + «el modulo del service no hardcodea ninguna zona horaria ni pais» |
| R20 | SVC «el hito vigente coincide siempre con el ultimo de la linea de tiempo» |
| R21 | SVC «lee el historial con una sola llamada al repositorio»; INT «resuelve la linea de tiempo en una consulta ordenada asc» + «con datos reales, la consulta publica completa emite exactamente dos lecturas» |
| R22 | G-DTO «el DTO público tiene exactamente numGuia, hitoVigente, actualizadoEn y linea, y cada entrada solo hito y fecha» + «CONTRAPRUEBA: el barrido de claves caza un campo de mas en el DTO y en una entrada»; SVC «devuelve exactamente numGuia, hitoVigente, actualizadoEn y linea, y ningun id interno» |
| R23 | G-DTO «ningun VALOR sensible de la orden ni del historial aparece en el resultado serializado» + «no aparece ningun `id` interno, ni `intentos`, ni `umbral`, ni ninguna otra clave prohibida» + «ni crudo ni normalizado: el segundo factor no se le devuelve al que lo tecleo» + «CONTRAPRUEBA: los dos barridos cazan una fuga inyectada por spread de la fila»; INT «ningun dato sensible de la fila llega al resultado publico» |
| R24 | G-FRO «… no nombra el service interno de historial ni su contrato» (×7 módulos) |
| R25 | G-FRO «ninguno de los doce campos prohibidos aparece en el repositorio» + «MEDIDO: los dos `select` son EXPLICITOS y enumeran exactamente lo que design §1 permite» + «los campos prohibidos tampoco cruzan por el contrato ni por el service» + su contraprueba; INT «la lectura de la orden pide solo id, numGuia, telefonoDest y deletedAt» + «la lectura del historial pide solo createdAt y el value del estatus destino» |
| R26 | DLG «pinta el resultado en el mismo diálogo sin navegar» + «lo que viaja al servidor son exactamente los dos datos de identificación»; E2E «un visitante sin sesión consulta su envío desde la landing» |
| R27 | DLG «durante la consulta inhabilita el envío e invoca la acción una sola vez» |
| R28 | DLG «los tres casos de rechazo muestran el mismo texto y ninguna línea de tiempo» (×3: guía inexistente / segundo factor errado / orden borrada) + «el rechazo por demasiados intentos lleva su texto propio y NO menciona la guía» |
| R29 | DLG «con `.dark` en html el diálogo conserva la paleta clara»; G-TEM «app/_landing/RastreoDialog.tsx se pinta con la paleta de la landing y no persiste nada» + «app/_landing/LandingNav.tsx …» + «el `DialogContent` del modal lleva `tema-claro` EXPLÍCITO» + «el detector encuentra cada prohibición cuando está plantada, y no la confunde con prosa» |
| R30 | DLG «al cerrar y reabrir, el formulario vuelve vacío» + «nada del resultado sobrevive en la URL ni en el almacenamiento del navegador»; G-TEM (mismo barrido: `localStorage`, `sessionStorage`, `searchParams`, `router.push`) |
| R31 | DLG «tiene nombre accesible, se cierra con Esc y sus campos se localizan por etiqueta» + «se puede recorrer y enviar con el teclado, sin ratón» |
| R32 | ACT «devuelve validation_error ante guia no numerica, negativa o campos vacios, sin lanzar» + «acepta la guia como texto (lo que teclea el destinatario) y la coerce a entero» |
| R33 | SVC «con un repositorio falso devuelve la proyeccion completa» + «el modulo del service no importa Prisma ni next/headers» |
| R34 | G-RUT «ninguna carpeta de `db/migrations/` corresponde a esta feature» + «`db/schema.prisma` no gana ningun objeto del rastreo publico» + «MEDIDO: lo que la feature LEE ya existia, y por eso no necesita migracion» |
| R35 | PQU completo (8 tests, **sin modificar**) + G-FRO «… no nombra la etiqueta privada ni su URL impresa» (×7) + la consecuencia F4, escrita en §1 |

**35 de 35 requisitos con test nombrado y ejecutado.**

---

## 5. Salida real de la verificación

### 5.1 Baseline de la rama, ANTES de tocar nada (2026-08-15)

```
$ pnpm test        # feature/229-rastreo-publico-envio, recién nacida de origin/dev
 Test Files  1097 passed (1097)
      Tests  14093 passed (14093)
   Duration  648.39s
```

*(Antes hubo que reparar el árbol de dependencias: `vitest` figuraba en `node_modules` pero su carpeta
no existía y `pnpm test` moría con `Cannot find module ...vitest.mjs`. Se arregló con
`pnpm install --force`. No era un problema del código, y el baseline se midió después.)*

### 5.2 Gate COMPLETO — `./init.sh` (T5.3)

```
== Arnes SDD :: init (modo: completo) ==
✓ node v22.13.1
✓ dependencias presentes
✓ regla max-2-por-zona respetada
✓ typecheck paso
✓ lint paso        (0 errors, 69 warnings, todos preexistentes del repo)
✓ test paso

 Test Files  1107 passed (1107)
      Tests  14220 passed (14220)
   Duration  366.41s

✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
EXIT=0
```

**Delta contra el baseline: +10 archivos de test, +127 tests, cero rojos, cero regresiones.** Los 10
archivos son exactamente los 10 que añade esta feature (`e2e/` no lo recoge vitest). El total de
archivos se compara a propósito con el baseline: una corrida degradada por *workers* omite archivos
enteros y sale casi verde reportando de menos.

### 5.3 E2E (T5.1)

`e2e/rastreo-publico.spec.ts` — **2 passed (3,5 s)**, ejecutado el 2026-08-15 contra un `next dev` de
**este** worktree (puerto 3011) y la base local, pasando la guía sembrada por entorno
(`E2E_RASTREO_GUIA` / `E2E_RASTREO_FACTOR`) porque las constantes por defecto del spec son un seed
genérico que esta base no tiene.

**Aviso honesto:** NO se ejecutó por el camino del `webServer` de `playwright.config.ts`. Ese config
lleva `reuseExistingServer` y engancha el `next dev` que ya esté escuchando en `localhost:3000`, que
puede ser el de otro checkout — de hecho lo fue, y con él los dos casos fallaban sirviendo la landing
vieja (botón `disabled`). Si estos tests fallan alguna vez con «el botón sigue deshabilitado», es eso
y no el código. Sobre ese servidor real quedó comprobado además que la frontera RSC funciona: `/`
emite el `<button data-slot="dialog-trigger">` **sin** `disabled`.

---

## 6. Observaciones para el reviewer (ninguna re-abre una decisión firmada)

**a) Homonimia `en_bodega`: se añadieron 4 entradas a una allowlist ajena.** El hito público firmado
`en_bodega` («En nuestras instalaciones») **se escribe igual** que el `order_status.value` que la
feature 135 renombró, y `tests/unit/guards/censo-order-status-rename.test.ts` prohíbe ese literal en
`app/`, `lib/` y `tests/`. El id del hito viene de la tabla **firmada** (§D2), así que no se puede
renombrar desde implementación. Se usó el mecanismo que la propia guardia ofrece: cuatro entradas con
el motivo escrito (**homonimia entre dos vocabularios**, no reaparición de nomenclatura interna).
Efecto colateral declarado en el propio comentario: la allowlist es **por basename**, así que la
entrada `rastreo-publico.ts` cubre también `lib/config/` y `lib/actions/`, que hoy no contienen ningún
literal antiguo. **Si se prefiere renombrar el hito (p. ej. `en_instalaciones`), es un cambio de la
tabla firmada y le corresponde al humano, no a la implementación.**

**b) Homonimia `en_reparto`: la guardia de R15 es estructural, no un `includes` ciego.** El hito
público `en_reparto` se escribe igual que el value interno **vigente** `en_reparto`, así que un barrido
de substrings sobre el DTO daría rojo contra un resultado **correcto**. La guardia lo demuestra
(«DEMOSTRACION de la homonimia: el `includes` ciego daria rojo contra un resultado CORRECTO») y
comprueba, value a value, que la excepción se aplica **solo** a ese homónimo.

**c) R3 y R34 están escritos en el spec como comprobaciones de `git diff`** («el diff de la feature no
incluye `middleware.ts`…»). Una guardia que mide el diff contra `origin/dev` **caduca al mergear**: a
partir de ahí juzga cualquier rama posterior y se convierte en un rojo ajeno. Se implementaron como
propiedades **durables**: las tres listas contra literales, «ningún `page.tsx`/`route.ts` importa los
módulos de la feature», «ninguna carpeta de `db/migrations/` corresponde a esta feature», «el esquema
no gana ningún objeto del rastreo». **Ninguna comprobación de esta feature depende de la rama**, así
que no queda nada retirable en el PR.

**d) R34 cita «el guardia de drift de esquema».** No existe una guardia de drift genérica: lo que hay
es `tests/integration/db/schema-drift-saneamiento.test.ts` (reconciliación `schema.prisma` ↔
migraciones). Se referencia, no se duplica.

**e) `z.coerce.number()` a secas era demasiado laxa para un borde público** (`Number([4321]) === 4321`,
`Number(true) === 1`). El schema es una unión `number | string` con `pipe` a entero positivo. **Siguen
siendo exactamente dos campos** (R13) y los mensajes siguen siendo literales fijos.

**f) Dos casos que el spec no cubría, resueltos sin inventar política:** (i) **historial vacío** — como
no hay ningún hito OCURRIDO (G10) y `hitoVigente` no podría derivarse de la línea (R20), se responde
`no_encontrado`, indistinguible del resto; (ii) **`actualizadoEn`** es la fecha de la última entrada de
la línea **ya colapsada** (cuándo entró en el hito vigente), que es la única lectura que no puede
divergir de la línea (R20) ni delatar las transiciones colapsadas.

**g) `DialogTrigger` no podía envolver el `<button>` literal de la nav.** `design.md` §4.1 decía
«envolverlo en `DialogTrigger`», pero `LandingNav` es Server Component y pasarle el elemento para que
lo clone cruza la frontera RSC. Se resolvió al revés y **sin crear ningún botón nuevo**: la nav monta
`<RastreoDialog className="…las mismas clases…">` y el `<button>` lo emite el propio `DialogTrigger`.
El DOM resultante es idéntico al anterior menos el `disabled`, y un test afirma que hay **un solo**
disparador.

**h) `Input`/`Button` de `components/ui` no sirven dentro de este modal.** `tema-claro` fija los
*tokens* pero **no apaga el variant `dark:`** (límite conocido y escrito en `globals.css`), e `Input`
lleva `dark:bg-input/30`. Se usó `<input>` con la paleta de la landing —igual que la nav hace con su
propio `<button>`— más `Label` de shadcn (sin `dark:`). El `DialogContent` **sí** es la primitiva
compartida, con `tema-claro` explícito; su botón de cerrar conserva los `dark:` de la primitiva, y el
barrido de la guardia lo excluye a propósito y con el motivo escrito.

**i) Deuda ajena encontrada de paso, NO tocada:** `PUBLIC_ROUTES` incluye `/api/health`, pero no existe
`app/api/health/route.ts` en el árbol. No es de esta feature.

**j) La medición T0.4 se hizo contra la base LOCAL de desarrollo (78 órdenes), no contra producción.**
Ver §2.
