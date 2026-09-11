# impl 418 — el aviso de represadas decide su ámbito por lista blanca, no por lista negra

- **Rama:** `feat/418-alcance-represadas-lista-blanca`
- **SHA base:** `bd3233aa` (`docs(418): spec de la lista blanca, y la ficha arranca`), que es `dev`
- **Zona:** backend. Sin migración, sin tabla, sin RLS, sin endpoint, sin UI.
- **Continuación directa de la 417**: mismo archivo, mismo método, misma regla —*si el ámbito del
  actor no existe, se falla; no se inventa uno*— y **el mismo entregable: el rojo**.

---

## Qué entrega, en una línea

La rama `devoluciones_represadas` de `VigenciaAvisoAgregadoService.cifra` decidía por **exclusión**
(`rol !== "adminSatelite"` ⇒ ámbito global), y **una lista negra da por bueno todo lo que no
enumera**: el enum tiene **seis** roles y la condición nombraba **uno**, así que `mensajero`,
`adminTienda` y `apiKey` obtenían **el total del sistema** por omisión —y el séptimo valor que
alguien añadiera al enum entraría con ellos—. Ahora decide por **inclusión**.

**Y lo que la ficha vino a entregar de verdad:** antes de ella **nada se ponía rojo** si alguien
metía a esos tres roles en el ámbito global, **porque nada lo afirmaba**. Eso está **medido en las
dos mitades** (M1 y M1b, abajo), no argumentado.

---

## Archivos creados / modificados

| Archivo | Qué |
| --- | --- |
| `lib/services/VigenciaAvisoAgregadoService.ts` | la lista blanca (**único archivo de producción con cambio de comportamiento**) |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | documentación del contrato: el **tercer** caso de lanzamiento. **Sin cambio de firma** |
| `tests/unit/services/vigencia-aviso-agregado.test.ts` | **sólo añade** (R3-R7). **0 líneas borradas** |
| `tests/unit/services/notificacion-service.test.ts` | **añade** un caso (R10). **0 líneas borradas** |
| `progress/impl_418.md` | esta bitácora |
| `specs/418-alcance-represadas-lista-blanca/tasks.md` | casillas |

**Nada más.** Ni `db/`, ni `app/`, ni `components/`, ni el catálogo, ni el emisor, ni otro servicio.
El gate lo confirmó por su cuenta: *«el cambio no toca esquema, tipos compartidos, config ni dinero:
el modo rapido basta»*. (M6 **muta** el catálogo y lo **revierte**; no es parte del diff.)

```
$ git diff --numstat bd3233aa -- lib/ tests/
8	1	lib/interfaces/services/IVigenciaAvisoAgregado.ts
45	1	lib/services/VigenciaAvisoAgregadoService.ts
65	0	tests/unit/services/notificacion-service.test.ts
127	0	tests/unit/services/vigencia-aviso-agregado.test.ts
```

Commits: `a4e4c41a` (`feat(418)`), `a935a4a3` (`test(418)`), más el de cierre con esta bitácora.

---

## T0 — Pre-vuelo: las anclas del spec, confirmadas en el archivo real

Leídas con `sed -n`/`cat -n` sobre el archivo, no en el grafo. **Ninguna se movió.**

| Ancla | Estado el 2026-09-11 |
| --- | --- |
| El seam: `VigenciaAvisoAgregadoService.ts`, rama `devoluciones_represadas`, **líneas 68-89** | **confirmado** |
| La decisión por exclusión, **líneas 72-74**: `if (actor.rol !== "adminSatelite") { return this.repo.contarRepresadas(this.ancladaAntesDe(), null); }` | **confirmado, literal** |
| La rama hermana ya decide por inclusión, **líneas 61-65**: `if (actor.rol !== "adminTienda") throw ...` | **confirmado** |
| `catalogo-avisos.ts:260` — `destinatarios: ["maestro", "admin", "adminSatelite"]` | **confirmado, línea 260 exacta** |
| `emitir.ts:112-115` — `ROLES_ADMINISTRACION = [{rol:"maestro"},{rol:"admin"}]` | **confirmado** |
| `emitir.ts:1121-1124` — global ⇒ `ROLES_ADMINISTRACION`; zona ⇒ `{ tipo:"rol", rol:"adminSatelite", zonaId }` | **confirmado** |
| `db/schema.prisma:35-44` — el enum tiene **seis** roles | **confirmado** |
| `NotificacionService.cifrasVivas` captura, registra con `cause` y guarda `null` → 409/R58 | **confirmado (líneas 153-174)** |
| `NotificacionService.listar` alimenta `cifrasVivas` con `filas.map((f) => f.evento)` | **confirmado (líneas 99-102)** |

**T0.2 — las dos fuentes de la lista blanca, citadas literales, y COINCIDEN:**

```ts
// lib/notificaciones/catalogo-avisos.ts:260
destinatarios: ["maestro", "admin", "adminSatelite"],

// lib/notificaciones/emitir.ts:112-115
const ROLES_ADMINISTRACION: NotificacionDestinatario[] = [
  { tipo: "rol", rol: "maestro" },
  { tipo: "rol", rol: "admin" },
];

// lib/notificaciones/emitir.ts:1121-1124
const destinatarios: NotificacionDestinatario[] =
  ctx.ambito.tipo === "global"
    ? [...ROLES_ADMINISTRACION]
    : [{ tipo: "rol", rol: "adminSatelite", zonaId: ctx.ambito.zonaId }];
```

El catálogo dice **quién recibe** (`maestro`, `admin`, `adminSatelite`); el emisor dice **con qué
acotación** (los dos primeros global, el tercero su zona). **No hubo que parar**: la ficha mantiene
la forma que el spec previó.

**T0.3 — un solo productor, verificado en todo el árbol `.ts`.** `emitirDevolucionesRepresadas`
aparece en 4 archivos: su definición (`emitir.ts:1116`), **una única llamada de producción**
(`lib/notificaciones/notificadores.ts:392`, dentro de `notificarDevolucionesRepresadasCon`) y dos
archivos de test. **Ningún segundo productor, ningún destinatario de otro rol.**

**T0.4 — los cuerpos de los casos vigentes, abiertos (no los títulos).** En
`tests/unit/services/vigencia-aviso-agregado.test.ts`, los actores usados **con
`devoluciones_represadas`** son:

| Líneas | Caso | Actor | ¿En la lista blanca? |
| --- | --- | --- | --- |
| 45-53 | `novedades_sin_gestionar` con el usuarioId de la tienda | `TIENDA` | *(no es este evento)* |
| 55-64 | se pide con la ZONA del adminSatelite | `SATELITE` | **sí** |
| 66-73 | ⚠️ MUTACION: ignorar `actor.zonaId`… | `SATELITE` | **sí** |
| 75-81 | maestro y admin lo piden GLOBAL (`null`) | `MAESTRO`, `ADMIN` | **sí** |
| 101-132 | 417/R1-R2, adminSatelite sin zona | `adminSatelite` | **sí** |
| 180-190 | el umbral inyectado | `MAESTRO` | **sí** |

`TIENDA` sólo aparece con `novedades_sin_gestionar` (48) y con el default (209). **Conclusión: hoy
ningún aserto se pone rojo si alguien mete a `mensajero`, `adminTienda` o `apiKey` en el ámbito
global.** Ése es el hueco, y M1b lo mide.

---

## El cambio, en contrato

`VigenciaAvisoAgregadoService.cifra` — **misma firma, mismo tipo de retorno**, una sola rama:

```ts
const AMBITO_REPRESADAS_POR_ROL: Partial<Record<RolValue, "global" | "zona">> = {
  maestro: "global",
  admin: "global",
  adminSatelite: "zona",
};
```

- `maestro` / `admin` → `contarRepresadas(cota, null)` (**igual que hoy**, R1);
- `adminSatelite` → la guarda de zona de la 417 **sin tocar** y luego `contarRepresadas(cota,
  actor.zonaId)` (R2);
- **cualquier otro rol** → **no se llama al repositorio** y se lanza
  `vigencia: el evento "devoluciones_represadas" no define ambito para el rol "<rol>"`.
- Todo lo demás **idéntico**: la rama de tienda, el evento no agregado y el umbral inyectado.

**Por qué un mapa y no un `!==`:** un mapa **enumera quién sí**, así que un valor nuevo del enum
**falla cerrado** en vez de heredar el ámbito global. La lista es **escrita a mano y local al
servicio**, como ya hacen `ROLES_ADMINISTRACION` (`emitir.ts`) y `ADMINISTRACION_CENTRAL`
(`catalogo-avisos.ts`). **No** se deriva de `esAccesoTotal` (§7-A) ni se lee del catálogo en tiempo
de ejecución (§7-B): si se leyera, el aserto de R7 estaría **siempre verde**.

### T1.2 — los tres mensajes juntos, para verlos distintos a simple vista

```
vigencia: el evento "devoluciones_represadas" se acota por zona y el adminSatelite no tiene zona asignada
vigencia: el evento "novedades_sin_gestionar" se acota por tienda y el rol "<rol>" no es una tienda
vigencia: el evento "devoluciones_represadas" no define ambito para el rol "<rol>"        <- NUEVO
```

Ninguno de los tres lleva `usuarioId` ni ningún dato personal. El **rol** sí, y a propósito: no es
PII y es lo que hace el error accionable — el mensaje hermano ya lo llevaba.

---

## Mapa `R<n> → test`

| R | Test concreto | Resultado |
| --- | --- | --- |
| **R1** | `tests/unit/services/vigencia-aviso-agregado.test.ts` › «maestro y admin lo piden GLOBAL (`null`), sin acotar por zona» — **vigente, sin editar** | ✅ |
| **R2** | mismo archivo › «`devoluciones_represadas` se pide con la ZONA del adminSatelite» — **vigente, sin editar** | ✅ |
| **R3** | mismo archivo › «R3 — con un %s no se consulta NINGUN ambito» ×3 (`mensajero`, `adminTienda`, `apiKey`) | ✅ |
| **R4** | mismo archivo › «R4 — con un %s falla NOMBRANDO la causa» ×3 + «R4 — ni siquiera devuelve el `7` que el repositorio daria: ese 7 ES el total del sistema» | ✅ |
| **R5** | mismo archivo › «R5 — el catalogo ENTERO de roles queda clasificado: lo que no esta enumerado NO obtiene cifra» (itera `Object.values(RolValue)`) | ✅ |
| **R6** | mismo archivo › «R6 — el error NO es el de las otras dos guardas del mismo metodo, y no lleva el usuarioId» | ✅ |
| **R7** | mismo archivo › «R7 — la lista blanca no diverge de los destinatarios declarados del aviso en el catalogo» | ✅ |
| **R8** | mismo archivo › los **ocho** bloques vigentes, con **diff vacío** (0 líneas borradas en el archivo) | ✅ |
| **R9** | `git diff --stat bd3233aa -- <los cuatro archivos>` → **salida vacía** (abajo) | ✅ |
| **R10** | `tests/unit/services/notificacion-service.test.ts` › «mensajero + un aviso de represadas: se ve el texto, NUNCA el total del sistema, y el log lo dice» — resolutor **real** + repositorio espía + logger espía | ✅ |
| **R11** | **M1** (enrojece ahora) **y M1b** (salía verde antes), con `NotificacionRepository.ts` intacto medido **en la misma corrida** | ✅ |

**R9 (T3.2), con el diff pegado tal cual:**

```
$ git diff --stat bd3233aa -- lib/repositories/NotificacionRepository.ts \
    lib/notificaciones/emitir.ts lib/notificaciones/catalogo-avisos.ts \
    lib/services/AvisosDiariosService.ts
$ (sin salida)
```

**R8 (T3.1):** los dos archivos de test tienen **0 líneas borradas**
(`git diff bd3233aa -- <archivo> | grep -c '^-[^-]'` → `0` en los dos). Ningún caso vigente se
editó, se renombró ni se derogó — **esta ficha no deroga nada**, y el `toBeNull()` que queda **sí es
contrato** (es R1, el de maestro/admin).

---

## Qué se prueba de verdad, y con qué (las trampas del repo, una a una)

1. **«Probar el WHERE donde vive» / «los dobles no ven el SQL».** Comprobado **antes** de elegir el
   instrumento: **no aplica**. Lo que esta ficha decide es **qué argumento recibe**
   `contarRepresadas`, y el filtro por zona de ese método se aplica **en memoria** sobre las filas ya
   traídas (`AvisoAgregadoRepository`: `zonaId === null ? filas.length : filas.filter(...)`), no en
   un `where`. El SQL de la población ya está cubierto contra Postgres real en
   `tests/integration/db/aviso-agregado-repository.test.ts`, y **esta ficha no lo toca**. El espía
   del repositorio es el instrumento correcto; queda escrito para que no se lea como pereza.
2. **«Test verde sin datos», que aquí era facilísimo.** Un `not.toHaveBeenCalled()` **también pasa**
   si el servicio se rompió por cualquier otro motivo. **Las cuatro defensas, las cuatro puestas:**
   - R4 exige el **error nombrado**, no un error cualquiera;
   - R6 + **M5** exigen que ese nombre **no sea el de otro de los fallos del mismo método** — M5 lo
     midió: R4 y R6 se ponen rojos;
   - los **controles positivos** (R1 y R2) viven en el mismo archivo y **M3/M4 los ponen rojos** uno
     a uno;
   - R10 afirma **las dos mitades** (el aviso sale **y** el log lo registra).
   - Y el caso exhaustivo de R5 afirma que **el escenario no está vacío**
     (`expect(fuera.length).toBe(roles.length - LISTA_BLANCA.length)` y `toBeGreaterThan(0)`): un
     `for` sobre cero roles reportaría `passed` sin comprobar nada.
3. **«Aserción contra su propia fuente».** Todos los literales van **escritos a mano** en el test
   (`/no define ambito para el rol/i`, `/no tiene zona asignada/i`, `/no es una tienda/i`,
   `"7 órdenes esperan volver a su tienda"`, la lista blanca de R5/R7). **Nada importado de
   producción.** Y por eso mismo la lista blanca de producción **no** se deriva del catálogo: si lo
   hiciera, R7 estaría siempre verde. **M6 demuestra que no lo está.**
4. **«Literal: contrato o polizón».** **No se deroga ningún caso.** El `toBeNull()` de «maestro y
   admin lo piden GLOBAL» **SÍ es contrato** (es R1) y sale **intacto** del diff; el polizón con ese
   mismo aserto ya lo derogó la 417.
5. **«Ojo con los nombres de los casos».** Los seis bloques en los que el spec se apoya se leyeron
   **por el cuerpo** (tabla de T0.4), no por el título. Los casos nuevos se nombran por **lo que
   afirman**.
6. **«El test que vive dentro de lo que borras».** No se borró ningún archivo, ningún componente y
   ningún caso.
7. **«Una imposibilidad razonada no es medida».** Esta ficha **no afirma** que el estado sea
   imposible: afirma que **hoy no es alcanzable por dos capas ajenas** y construye la prueba
   **saltándoselas a propósito** (test unitario del servicio). Está escrito como **nota de
   honestidad dentro de los dos archivos de test**. La medida que falsaría el razonamiento es T8, y
   **hoy no se puede hacer** (ver abajo).

---

## Las SIETE mutaciones (T6) — el entregable

Árbol **limpio antes y después de cada una**, y en **cada** corrida se comprobó `git status --short`
(**un solo archivo modificado**) y el `git diff --stat` del predicado ajeno de la 146 (**vacío**).
Punto de partida y de llegada: **57/57 verdes** en el par
`vigencia-aviso-agregado.test.ts` + `notificacion-service.test.ts`.

| # | Mutación | Veredicto | Rojos | Qué se puso rojo |
| --- | --- | --- | --- | --- |
| **M1** | volver a la lista negra (el código de antes de la 418) | **MUERTA** | **10** | R3 ×3, R4 ×4, R6, R5, **R10** |
| **M1b** | *(la otra mitad)* el `dev` de partida entero, con el defecto delante | **VERDE 46/46** | **0** | **nada** — y ése es el hallazgo |
| **M2** | ese lanzamiento por `return 0` | **MUERTA** | **7** | R4 ×4, R6, R5, **R10** (R3 ×3 **VERDE**, a propósito) |
| **M3** | quitar `admin` de la lista blanca | **MUERTA** | **1** | **R1**, y por el caso de `admin` |
| **M4** | quitar `adminSatelite` de la lista blanca | **MUERTA** | **6** | **R2**, la mutación hermana de la 409, 417/R2 ×3, 417/R9 |
| **M5** | el error nuevo con el mensaje de otra guarda del método | **MUERTA** | **7** | **R4 ×4 y R6**, + R5 y R10 |
| **M6** | añadir `mensajero` a `destinatarios` en el catálogo | **MUERTA** | **1 + 1 ajena** | **R7 por nombre** + `atajo-aviso-ruta-visible.guardia` |

**Supervivientes: ninguna. Las siete murieron** (M1b no es una mutación a matar: es la **medida** de
que antes no había nada que matar).

### M1 — la que da sentido a la ficha, y LA PRUEBA DEL ROJO

En la **misma corrida**, antes de lanzar los tests:

```
$ git status --short
 M lib/services/VigenciaAvisoAgregadoService.ts        <- el ÚNICO archivo tocado

$ git diff --stat -- lib/repositories/NotificacionRepository.ts
(SIN SALIDA — el predicado de la 146 sin una línea cambiada)
```

```
     × R3 — con un mensajero no se consulta NINGUN ambito
     × R3 — con un adminTienda no se consulta NINGUN ambito
     × R3 — con un apiKey no se consulta NINGUN ambito
     × R4 — con un mensajero falla NOMBRANDO la causa
     × R4 — con un adminTienda falla NOMBRANDO la causa
     × R4 — con un apiKey falla NOMBRANDO la causa
     × R4 — ni siquiera devuelve el `7` que el repositorio daria: ese 7 ES el total del sistema
     × R6 — el error NO es el de las otras dos guardas del mismo metodo, y no lleva el usuarioId
     × R5 — el catalogo ENTERO de roles queda clasificado: lo que no esta enumerado NO obtiene cifra
     × mensajero + un aviso de represadas: se ve el texto, NUNCA el total del sistema, y el log lo dice
 Test Files  2 failed (2)
      Tests  10 failed | 47 passed (57)
```

Y el aserto de R10 **enseña el defecto en palabras**, que es lo que la ficha vino a hacer visible:

```
AssertionError: expected '7 órdenes esperan volver a su tienda' to be 'La más antigua lleva 8 días en bodega…'
Expected: "La más antigua lleva 8 días en bodega. Coordiná la devolución."
Received: "7 órdenes esperan volver a su tienda"
```

Ese `7` es el **total del sistema** cargado en el repositorio espía. Con el código de antes, un
**mensajero** —que ni recibe este aviso— leería el número de todas las bodegas del país.

### M1b — LA OTRA MITAD, la que convierte la afirmación en medida

No basta con que la mutación enrojezca **ahora**: hay que demostrar que **antes salía verde con el
defecto delante**. Restauré **los cuatro archivos** al `dev` de partida y corrí el mismo par:

```
$ git checkout bd3233aa -- lib/services/VigenciaAvisoAgregadoService.ts \
    lib/interfaces/services/IVigenciaAvisoAgregado.ts \
    tests/unit/services/vigencia-aviso-agregado.test.ts \
    tests/unit/services/notificacion-service.test.ts

$ grep -n 'actor.rol !== "adminSatelite"' lib/services/VigenciaAvisoAgregadoService.ts
72:      if (actor.rol !== "adminSatelite") {

 Test Files  2 passed (2)
      Tests  46 passed (46)
```

**46/46 VERDE, con la lista negra en la línea 72 exacta que el spec anotó.** Eso es lo que separa
«esto no estaba protegido» de una opinión: **46 casos en verde mirando el defecto de frente**. Hoy
la misma retirada cuesta **10 rojos**.

### M2 — prueba que la ficha exige RUIDO, no silencio

```
     × R4 — con un mensajero falla NOMBRANDO la causa          (promise resolved "+0" instead of rejecting)
     × R4 — con un adminTienda falla NOMBRANDO la causa
     × R4 — con un apiKey falla NOMBRANDO la causa
     × R4 — ni siquiera devuelve el `7` que el repositorio daria
     × R6 — el error NO es el de las otras dos guardas del mismo metodo
     × R5 — el catalogo ENTERO de roles queda clasificado
     × mensajero + un aviso de represadas: ...                 (expected [] to deeply equal [ 'agg' ])
      Tests  7 failed | 50 passed (57)
```

Dos cosas valen más que el conteo:

- **R3 ×3 se quedan VERDES** (el repositorio sigue sin llamarse) y sólo R4 se pone rojo. Los separé
  exactamente para esto: juntos, dos rojos habrían tapado **cuál** de las dos mitades se rompió.
- **R10 dice `expected [] to deeply equal [ 'agg' ]`**: con `return 0` el aviso **no sale en
  absoluto**, en vez de salir sin número. Es el modo de fallo mudo de la 409/R55, **medido**.

### M3 — control positivo, y cubre `admin` UNO A UNO

```
 FAIL  ... > R57 — el ambito sale del ACTOR > maestro y admin lo piden GLOBAL (`null`), sin acotar por zona
Error: vigencia: el evento "devoluciones_represadas" no define ambito para el rol "admin"
      Tests  1 failed | 56 passed (57)
```

**Un solo rojo, R1, y el error nombra `"admin"`**: falló en la iteración de `admin`, no en la de
`maestro`. Los dos roles globales están cubiertos uno a uno, no por un caso que sólo prueba
`maestro`.

### M4 — control positivo: la protección nueva no cierra el ámbito legítimo del satélite

```
     × `devoluciones_represadas` se pide con la ZONA del adminSatelite                  (R2)
     × ⚠️ MUTACION: ignorar `actor.zonaId` le enseñaria al satelite el total del sistema (la de la 409)
       × R2 — con zonaId: null falla NOMBRANDO la causa                                 (417)
       × R2 — con zonaId ausente falla NOMBRANDO la causa                               (417)
       × R2 — con zonaId vacio falla NOMBRANDO la causa                                 (417)
     × adminSatelite sin zona + un aviso de represadas: ...                             (417/R9)
      Tests  6 failed | 51 passed (57)
```

El spec predecía **R2 + la mutación hermana de la 409**: las dos están. Las otras cuatro son de la
417 y enrojecen porque, sin `adminSatelite` en la lista blanca, el satélite sin zona falla con **el
mensaje equivocado**. Es coherente y refuerza el control.

### M5 — control contra el «verde por el error equivocado»

Con el error nuevo llevando el literal de la guarda de zona de la 417:

```
     × R4 — con un mensajero falla NOMBRANDO la causa
     × R4 — con un adminTienda falla NOMBRANDO la causa
     × R4 — con un apiKey falla NOMBRANDO la causa
     × R4 — ni siquiera devuelve el `7` que el repositorio daria
     × R6 — el error NO es el de las otras dos guardas del mismo metodo, y no lleva el usuarioId
     × R5 — el catalogo ENTERO de roles queda clasificado
     × mensajero + un aviso de represadas: ...
      Tests  7 failed | 50 passed (57)
```

**R4 y R6 rojos**, que es lo que la mutación pedía. Si R4 hubiera sobrevivido, su `rejects.toThrow`
estaría casando con cualquier error y no probaría nada.

### M6 — la comprobación de divergencia NO es vacua

Añadiendo `mensajero` a `destinatarios` de `devoluciones_represadas` en el catálogo:

```
     × R7 — la lista blanca no diverge de los destinatarios declarados del aviso en el catalogo
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 56 passed (57)
```

**El caso de R7 está entre los rojos, por nombre.** Y como el spec anticipaba, enrojece **una
guardia ajena**, anotada y no invalidante:

```
$ pnpm run test:guardias
 FAIL  tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts
        > R5 — todo atajo declarado apunta a una ruta que EXISTE y que ese rol VE
        > cada destino, sin su parametro de consulta, es una ruta del menu de ese rol
 Test Files  1 failed | 210 passed (211)
      Tests  1 failed | 3099 passed (3100)
```

### T6.8 — revertidas las siete

```
$ git status --short
$ git diff --numstat
$ (ambas sin salida)

$ pnpm exec vitest run tests/unit/services/vigencia-aviso-agregado.test.ts tests/unit/services/notificacion-service.test.ts
 Test Files  2 passed (2)
      Tests  57 passed (57)
```

---

## El gate (T7.1)

```
$ ./init.sh --rapido > .gate-418.log 2>&1 ; echo "INIT_EXIT=$?" >> .gate-418.log
```

`INIT_EXIT` escrito **DENTRO** del log y **sin canalizar por `tail`**.

```
== Arnes SDD :: init (modo: rapido) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (413 fichas), cupo por zona respetado (in_progress=3) y specs en su sitio
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ typecheck paso
✓ lint paso                (184 warnings, 0 errores — todos preexistentes y ajenos)
✓ DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan

  test:cambiados   Test Files  64 passed (64)    Tests  797 passed | 26 skipped (823)
  test:guardias    Test Files 211 passed (211)   Tests 3100 passed (3100)

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 275 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **El rápido NO se negó**, y lo dijo él mismo con nombre. Era el criterio explícito de T7.1: si se
  hubiera negado, habría significado que toqué algo de más.
- **`integration/db` que corrieron: 3 archivos, 45 tests, los tres verdes.** Entraron por las
  guardias, no por `--changed`: `analytics-daily-guards.test.ts` (26),
  `zona-central-guarda-y-rastro.test.ts` (17), `zona-guardado-conserva-inactivos.test.ts` (2). El
  gate anunció los **160** archivos contra Postgres como ejecutables; los otros 157 **no los
  seleccionó `--changed`** (mi diff no los relaciona), que no es lo mismo que saltarlos por falta de
  base.
- **El `.env` lo copié del checkout principal tras comprobar que su `DATABASE_URL` activa apunta a
  `localhost:5432/ordenex`** (la de Supabase está comentada). No entra en el commit
  (`git check-ignore` lo confirma).
- **Los `skipped` mirados uno a uno, no sólo el exit code:** los 26 son de
  `tests/components/AnaliticaPage.test.tsx` (17) y `tests/components/AnaliticaShell.test.tsx` (9).
  **Ninguno es de `integration/db`**: no hay capa de datos saltada en silencio.
- **Sin `40P01`** (0 ocurrencias): no hubo contención, no hizo falta re-correr aislado.
- **El rojo ajeno anunciado NO apareció**: `notificacion-evento-*-migration.test.ts` tiene **0
  ocurrencias** en el log y **0** de `2BP01` — ni `--changed` ni las guardias los seleccionaron.
  **No se tocó `tests/baseline-rojos.json`** (`git diff --stat` vacío), como pedía el encargo.
- **`tests/baseline-rojos.json` no se modificó** y el gate **no propuso podar** nada.
- El aviso de `migraciones sin down.sql` es **preexistente y ajeno**: son tres migraciones de agosto
  y esta ficha **no toca `db/`**.

---

## T8 — POST-DESPLIEGUE: **NO EJECUTADA, y con su motivo**

La casilla T8.1 queda **sin marcar a propósito**. Su `SELECT` mide producción, y ahí el valor
`devoluciones_represadas` **ni siquiera existe en el enum**: la migración de la 409 vive en `dev`,
sin desplegar (medido por el orquestador el 2026-09-10). **Hoy no mediría cero: mediría la nada**, y
la diferencia decide si estás midiendo algo.

El dato de hoy hay que reportarlo como lo que es: **«el enum no tiene ese valor»**, que **no** es lo
mismo que **«salieron cero filas»** —producción se vació a propósito el 2026-08-25, así que un cero
significaría «aún no ha pasado», no «está bien»—. La consulta queda escrita y lista para el día del
despliegue (`design.md` §6, `tasks.md` T8.1), y la corre el orquestador: la `DATABASE_URL` de
producción es *sensitive*.

---

## Desviaciones y límites

- **Ninguna desviación del spec.** Los seis archivos tocados son exactamente los que `tasks.md`
  §«Archivos que toca la implementación» anticipaba.
- **Entorno del worktree**: no traía `node_modules` ni `.env`. El junction al checkout principal no
  se pudo crear (el arnés del worktree rechaza `cmd`/`powershell`), así que corrí
  `pnpm install --frozen-lockfile` + `pnpm exec prisma generate` **dentro del worktree** — lo que de
  paso evita que `prisma generate` se pise entre árboles. Copié el `.env` tras comprobar que apunta
  a `localhost`. **Ni `node_modules` ni `.env` entran en el commit.**
- **Índice del grafo (regla 7), y esta vez falla POR DEFECTO, no por exceso.** El MCP
  `codebase-memory` **sí está** en el conjunto de herramientas, y confirmó lo que importaba: el
  **único** consumidor de `.cifra(` en producción es `lib/services/NotificacionService.ts:161`
  (`search_code`, 1 sola coincidencia en todo el árbol). Pero **está rancio respecto de la 409**:
  `search_graph(name_pattern=".*emitirDevolucionesRepresadas.*")` devuelve **0 nodos** para una
  función que lleva en `dev` desde la 409, y ese mismo `search_code` devolvió `total_results: 0`
  —es decir, encontró el texto pero **no supo atribuirlo a ninguna función del grafo**—. Además el
  índice apunta al **checkout principal**, no a este worktree, así que no ve nada de esta rama. Por
  eso el pre-vuelo (T0) se hizo **leyendo los archivos reales** con `sed -n`/`cat -n`, que es lo que
  la regla exige de todos modos antes de concluir que algo existe — o, aquí, que no existe.
- **Lo que esta ficha NO entrega, dicho con nombre**: no vigila que el predicado de la 146 siga
  existiendo, ni que el emisor siga emitiendo a quien emite, ni cierra la familia entera de listas
  negras del repo (`design.md` §10). Lo que entrega es que, **si eso cambia**, este seam siga
  negándose y lo diga.

---

## Veredicto

**Cumple.** Los once requisitos con test, las siete mutaciones muertas, el gate rápido en verde con
`INIT_EXIT=0` y **sin negarse**, y **las dos mitades del rojo medidas**: retirar la lista blanca
cuesta hoy **10 rojos** con el predicado de la 146 intacto, y el mismo defecto dejaba la suite
anterior en **46/46 verde**. Eso es todo lo que separa una protección heredada de una afirmada, y es
el entregable.
