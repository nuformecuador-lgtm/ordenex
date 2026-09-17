# impl 435 — la oficina lee la ayuda de los otros portales

> Rama `fix/435-oficina-lee-toda-la-ayuda`, nacida de `origin/dev` en `5c5b14ea`.
> La ficha es `sdd: false`: no hay carpeta `specs/`, así que la especificación es el encargo del
> humano y este archivo es el que pone número a cada promesa suya. Continúa la numeración de
> `progress/impl_433.md` (R1…R20) con **R21…R24**.
>
> De dónde sale: `progress/review_433.md` §(a) —«el maestro y el admin no pueden leer la ayuda
> del mensajero, la tienda ni el satélite»— que la revisión dejó explícitamente como **puerta
> del humano**, no como defecto. La decisión se tomó el 2026-09-16.

## La decisión, y lo que NO cambia

Hasta hoy `/ayuda/mensajero/reparto` le daba **404 al maestro**. El acotamiento era simétrico por
diseño y la razón sigue viva **en una sola dirección**: un mensajero, una tienda o un satélite
—gente ajena a la empresa— no pueden leer cómo funciona la caja. La otra dirección no protegía
nada y costaba: la oficina es quien atiende por teléfono las dudas de los 18 mensajeros, y quien
contesta no tenía delante la misma pantalla que quien pregunta.

**No cambia el significado de `roles:` en el frontmatter.** Ese campo sigue diciendo «de quién es
esta pantalla» (contrato escrito en `docs/ayuda/README.md`), y es lo que alimenta la agrupación
del índice y el botón «?». Lo que cambia es **quién puede LEER**, que es otra pregunta. Por eso el
cambio es un predicado **nuevo** y no un ensanche del que había. Ningún `.md` se tocó.

## Los dos predicados, y por qué son dos

| Pregunta | Función | Quién la usa |
|---|---|---|
| ¿De quién es esta pantalla? | `documentoVisiblePara` / `documentosVisiblesPara` (**estricto, sin cambios**) | `mapaRutaDocumento` → el botón «?» del encabezado |
| ¿Puede ABRIR este documento? | `puedeLeerDocumento` / `documentosQuePuedeLeer` (**nuevo, ancho**) | el `notFound()` de `[...slug]/page.tsx` y el índice de `ayuda/layout.tsx` |

El ancho es el estricto **más** `ROLES_LECTURA_TOTAL_AYUDA = ["maestro", "admin"]`. Las dos puertas
duras se quedan donde estaban: sin sesión no se lee nada, y `apiKey` tampoco (no está en
`ROLES_AYUDA`).

**Por qué NO se ensanchó `documentoVisiblePara` a secas —el riesgo central de la ficha—.**
`/ordenes` la declaran DOS documentos (`oficina/ordenes.md` y `tienda/ordenes.md`). Con el
predicado ancho en el mapa del «?», el maestro tendría **dos candidatos** para esa ruta y
`mapaRutaDocumento` se queda con el primero, que por orden alfabético de slug es
`oficina/ordenes`: **el resultado no cambia y ningún test existente se entera**. Está medido
(mutación M2, abajo): el caso de R3 que afirma `oficina/ordenes` sigue **verde** con el empate
dentro. Un desempate inventado, en el botón que la gente sí usa.

Para que ese empate fuera **observable** se extrajo `candidatosRutaDocumento(docs, rol)`, que
devuelve todos los documentos que se disputan cada ruta; `mapaRutaDocumento` se construye ahora
sobre él quedándose con el primero. La guardia y R23 preguntan por ahí, no por el ganador.

## m3, que iba junto con esto

`tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts` **ya importaba**
`documentoVisiblePara` (la 433 cerró m3 en su última tanda; la referencia a las líneas 157-159
del encargo estaba caduca). Pero importar el PREDICADO no bastaba: la guardia seguía
re-implementando **el bucle del mapa** al lado, y por tanto no habría visto un
`mapaRutaDocumento` ensanchado. Ahora pregunta por `candidatosRutaDocumento`, que es de donde el
mapa sale de verdad, con un anclaje anti-vacuidad (`/ordenes` tiene exactamente un candidato para
el maestro y otro para la tienda, y los dos documentos existen). Sigue cazando lo que cazaba: se
comprobó con la mutación M2.

## Los requisitos

| # | Requisito | Origen |
|---|---|---|
| R21 | **Maestro y admin leen el catálogo entero** (33), incluidas las ayudas de mensajero, tienda y satélite | decisión del humano |
| R22 | **Mensajero, adminTienda y adminSatelite NO se mueven ni un documento** (8 / 7 / 10) | decisión del humano («media ficha») |
| R23 | El **«?» sigue estricto**: ninguna ruta deja dos candidatos a ningún rol, y `/ordenes` le da al maestro el de oficina y a la tienda el suyo | riesgo central, review 433 §(a) |
| R24 | Las **puertas duras no se tocan**: sin sesión y `apiKey` no leen nada; y leer nunca es más estrecho que «es tu pantalla» | derivado (fallo seguro) |

## Mapa R → test

| # | Test | Qué lo mata |
|---|---|---|
| R21 | `tests/components/AyudaDocumentoPage.test.tsx:174` («el maestro abre `/ayuda/mensajero/reparto`») y `:183` (los dos roles × cuatro documentos ajenos) · `tests/unit/ayuda/acotamiento-por-rol.test.ts` R21 (los DIEZ slugs escritos a mano) · `tests/components/AyudaLayout.test.tsx` (33/33) | el slug abre de verdad y el cuerpo se pinta; los diez documentos se nombran uno a uno |
| R22 | `acotamiento-por-rol.test.ts` R22 (tres listas literales de slugs) · `AyudaLayout.test.tsx` (10/8/7 intactos) · `tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts` («los dos roles de lectura total son de OFICINA») | los recuentos son literales escritos a mano, no derivados del catálogo |
| R23 | `ayuda-pantalla-ruta-existe.guardia.test.ts` (choques + el anclaje de `/ordenes`) · `acotamiento-por-rol.test.ts` R23 | mira los CANDIDATOS, no el ganador: es lo único que ve el empate |
| R24 | `AyudaDocumentoPage.test.tsx` bloque R16 **intacto** · `acotamiento-por-rol.test.ts` R21 (`legibles(null)`, `legibles("apiKey")`) · guardia («leer NUNCA es más estrecho que es-tu-pantalla») | el bloque negativo de R16 no se tocó ni una línea |

## Las tres mutaciones, comprobadas en rojo

Cada una aplicada sobre el árbol final, corrida, y revertida. El mensaje es el real.

| # | Mutación | Resultado | Mensaje |
|---|---|---|---|
| M1 | `puedeLeerDocumento` vuelve al estricto (se borra la línea de `ROLES_LECTURA_TOTAL_AYUDA`) | **8 rojos / 3 archivos** | `AssertionError: promise rejected "NotFoundError: NEXT_NOT_FOUND" instead of resolving` (el maestro abre `/ayuda/mensajero/reparto`); `maestro: expected 23 to be 33`; `mensajero/cierre-del-dia: expected false to be true` |
| M2 | `candidatosRutaDocumento` —y con él `mapaRutaDocumento`— pasa al predicado **ancho** | **6 rojos / 3 archivos** | `expected [ 'oficina/ordenes', 'tienda/ordenes' ] to deeply equal [ 'oficina/ordenes' ]`; en la guardia: `expected [ 'oficina/ordenes.md', …(1) ] to deeply equal [ 'oficina/ordenes.md' ]`; `expected 'mensajero/reparto' to be undefined` |
| M3 | se añade `mensajero` a `ROLES_LECTURA_TOTAL_AYUDA` | **8 rojos / 4 archivos** | `mensajero: expected 33 to be 8`; `expected [ 'maestro', 'admin', 'mensajero' ] to deeply equal [ 'maestro', 'admin' ]`; `expected [ 'compartido/analitica', …(32) ] to deeply equal [ 'mensajero/cierre-del-dia', …(7) ]` |

⚠️ **Lo que M2 demuestra, y es el motivo de que exista `candidatosRutaDocumento`:** bajo esa
mutación, el caso R3 `expect(mapaRutaDocumento(docs, "maestro")["/ordenes"]).toBe("oficina/ordenes")`
—escrito en la 433— **sigue en verde**. Sin el caso nuevo, el empate se colaba entero.

## El recuento por rol, medido

Sobre los 33 `.md` de `docs/ayuda/**` (34 archivos menos el README), leyendo el `roles:` de cada uno:

| rol | veía (estricto) | lee ahora | Δ |
|---|---|---|---|
| maestro | 23 | **33** | +10 |
| admin | 22 | **33** | +11 |
| adminSatelite | 10 | **10** | 0 |
| mensajero | 8 | **8** | 0 |
| adminTienda | 7 | **7** | 0 |

Los **10** del maestro: los cuatro de `mensajero/` que no son el ranking, los tres de `satelite/`
y los tres de `tienda/`. Los **11** del admin: esos diez más `oficina/historico-acciones`, que es
sólo del maestro.

## El índice de 33 entradas: se deja como está

Medido montando el índice real del maestro. Son **6 grupos**, en este orden:

```
[Mensajeros] 5 · [Tiendas] 3 · [Bodegas satélite] 3 · [Oficina] 18 · [Compartido] 1 · [Sin iniciar sesión] 3
```

**No hace falta separador ni etiqueta nueva, y `AyudaIndice.tsx` no se tocó.** La agrupación por
carpeta ya dice de quién es cada bloque con su nombre en castellano («Mensajeros», «Tiendas»,
«Bodegas satélite»): el maestro distingue lo suyo —Oficina y Compartido— sin ayuda extra, y el
buscador sigue filtrando sobre la lista. Añadir un «la ayuda de los otros portales» sería repetir
con una frase lo que tres encabezados ya dicen.

**Dos cosas quedan anotadas para el humano, y NO se hicieron** (son presentación, zona frontend):

1. **El ORDEN de los grupos.** `ORDEN_GRUPOS` es `[mensajero, tienda, satelite, oficina,
   compartido, publico]`, decidido cuando el índice del maestro tenía una sola entrada de
   mensajero. Ahora el maestro abre `/ayuda` y sus **18** documentos de Oficina empiezan en la
   entrada **12**: por delante van 11 de otros portales. En el teléfono, donde el índice ocupa el
   ancho entero, eso es scroll antes de llegar a lo suyo.
2. **Dos enlaces se llaman «Órdenes»** en el índice del maestro (`oficina/ordenes` bajo «Oficina»
   y `tienda/ordenes` bajo «Tiendas»). Con los encabezados delante se leen bien; para quien
   navega por lista de enlaces con lector de pantalla, fuera de contexto son dos nombres iguales.

## Archivos

**Modificados (8), ninguno creado:**

- `lib/ayuda/documento.ts` — `ROLES_LECTURA_TOTAL_AYUDA`, `puedeLeerDocumento`,
  `documentosQuePuedeLeer`, `candidatosRutaDocumento`; `mapaRutaDocumento` reescrito sobre él.
- `app/(app)/ayuda/[...slug]/page.tsx` — el `notFound()` y el «Siguiente» preguntan por lectura.
- `app/(app)/ayuda/layout.tsx` — el índice se llena con el predicado de lectura.
- `tests/unit/ayuda/acotamiento-por-rol.test.ts` — R21, R22, R23 (los de la 433, intactos).
- `tests/components/AyudaDocumentoPage.test.tsx` — dos casos positivos nuevos; el bloque negativo
  R16, intacto.
- `tests/components/AyudaLayout.test.tsx` — recuentos 33/33/10/8/7 y la contraprueba del índice.
- `tests/components/AyudaIndice.test.tsx` — se monta con la lista que el layout entrega hoy.
- `tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts` — la guardia pregunta por
  `candidatosRutaDocumento`; dos casos nuevos para la regla de lectura.

**Sin tocar, a propósito:** los 33 `.md` de `docs/ayuda/`, `mapaRutaDocumento` como contrato del
«?», `components/shared/PageHeader.tsx`, `app/(app)/ayuda/_components/AyudaIndice.tsx`,
`app/(app)/layout.tsx`. Sin migraciones, sin tablas, sin RLS, sin variables de entorno.

## Verificación

- `pnpm run typecheck` — verde, sin salida.
- `pnpm run lint` — `✖ 202 problems (0 errors, 202 warnings)`; los 202 son pre-existentes
  (`no-unused-vars` de dobles en tests) y ninguno está en los ocho archivos de esta rama.
- `./init.sh` **completo**, `progress/gate_435.log` (con `INIT_EXIT` escrito dentro del log):

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 194 archivos de tests contra Postgres SI se ejecutan
 Test Files  2022 passed (2022)
      Tests  29492 passed | 26 skipped (29518)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Los **26 saltados son los de siempre** y **ninguno es de `integration/db`**: 17 de
`tests/components/AnaliticaPage.test.tsx` y 9 de `tests/components/AnaliticaShell.test.tsx`.
Los 194 archivos contra Postgres se ejecutaron.

**La primera corrida salió roja, y no era de esta rama** (`progress/gate_435_flake40P01.log`,
`INIT_EXIT=1`): un `40P01` —deadlock de Postgres— en
`tests/integration/db/liquidacion-reparto-migration.test.ts`, que arrastró 9 casos suyos a
`skipped` y dejó el total en 35. Es el modo de flake por saturación que el propio gate nombra
(«corre ese archivo AISLADO»). Corrido aislado: **24 pasados, 0 saltados, EXIT=0**
(`progress/rerun_205_aislado_435_ok.log`), y la segunda corrida completa lo confirma en verde.
Esta rama no toca base de datos: ni una migración, ni un servicio, ni una consulta.
