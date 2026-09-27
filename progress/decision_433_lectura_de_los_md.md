# 433 — Cómo llegan los `.md` a la pantalla, y qué se encontró por el camino

> Ficha 433 (SF-001 punto 4, primera mitad). Rama `feat/433-modulo-de-ayuda`.
> El diseño estaba aprobado; esta decisión es la técnica que quedaba abierta.

## La decisión: `fs` sobre el archivo real + `outputFileTracingIncludes`

Los 31 documentos se leen **del propio archivo del repositorio**, con `node:fs` y desde el
servidor (`lib/ayuda/catalogo.ts`). No hay paso de copia, ni generación de un módulo con el
texto dentro, ni tabla intermedia. Lo que se pinta sale del `.md`.

La ficha imponía dos condiciones y son las que deciden:

1. **Los `.md` son la única fuente.** Cualquier proceso que copie el texto a otro sitio crea un
   segundo lugar donde vive la verdad, y ese segundo lugar se desincroniza.
2. **Tiene que funcionar en Vercel**, donde el sistema de archivos en runtime no es el del
   repositorio.

### Las tres vías, y por qué se descartaron dos

| Vía | Veredicto |
| --- | --- |
| **`fs` desde el servidor** | **Elegida.** Cero copias: se lee el archivo. |
| Generar un módulo en build | Descartada: el texto pasa a vivir en dos sitios |
| `import.meta.glob` | Descartada: **es de Vite**. Next no lo tiene, ni Webpack ni Turbopack |

**Generar un módulo** (un script que vuelca los 31 documentos a un `.ts`) rompe la condición 1
por construcción, y las dos formas de hacerlo fallan distinto: si el artefacto se commitea, se
desincroniza en cuanto alguien edite un `.md` sin correr el script — y nada se pondría rojo—;
si no se commitea, cada `pnpm test` y cada arranque en frío depende de un paso previo que hoy
no existe en `package.json`. Los imports crudos (`archivo.md?raw`) sí existen en Turbopack,
pero no están garantizados en el camino de build de producción: sería atar el módulo a un
detalle del bundler.

### La línea sin la cual esto funciona en local y da 404 en producción

El trazado de dependencias de `next build` decide qué archivos suben a la función serverless
siguiendo los `import`. **`docs/ayuda/` no lo delata ningún import**: la ruta se arma en tiempo
de ejecución con `path.join(process.cwd(), "docs", "ayuda")`. Sin declararlo, el build pasa en
verde, el typecheck pasa en verde, y el rojo sólo aparece cuando un usuario abre la ayuda en
producción. Es el fallo mudo clásico de leer archivos en serverless.

Por eso `next.config.ts` declara:

```
outputFileTracingIncludes: { "/**": ["./docs/ayuda/**/*.md"] }
```

**El patrón es `/**` —todas las páginas— y no sólo `/ayuda`**, porque el trazado es POR PÁGINA
y un layout NO hereda el de sus hijos: el layout del portal lee el catálogo en las 29 pantallas
para calcular el mapa del botón «?». El coste son ~90 KB de texto replicados por función; el de
equivocarse es que el «?» desaparezca en producción y en ningún otro sitio.

## Sin dependencia nueva para el Markdown

Se buscó primero: **el repo no tiene ningún renderizador de Markdown ni ninguna librería que lo
haga** (`react-markdown`, `marked`, `remark`, `gray-matter` — ninguna en `package.json`). Antes
de pedir una se midió qué sintaxis usan los 31 documentos de verdad:

```
537 negritas · 192 titulos · 110 items de lista · 54 filas de tabla
 33 citas · 13 cursivas · 10 codigos en linea · 6 lineas de bloque de codigo
  0 ENLACES · 0 IMAGENES · 0 HTML CRUDO
```

Es un subconjunto cerrado, y el contenido no es entrada de usuario: son archivos del
repositorio, revisados, que viajan en el mismo commit que el código. `lib/ayuda/markdown.tsx`
lo cubre entero en ~150 líneas, **sin `dangerouslySetInnerHTML` en ningún punto** — construye
elementos de React, así que un `<script>` escrito en un `.md` se pinta como las letras que es.

Lo que el renderizador NO entiende está dicho en voz alta y **vigilado**: la guardia
`ayuda-render-sin-filtracion.guardia.test.ts` se pone roja si un documento futuro usa un
enlace, una imagen, HTML crudo o una lista anidada. Así la decisión —ampliar el renderizador o
reescribir el párrafo— la toma una persona y no el renderizador en silencio.

## Dos cosas que el gate encontró y conviene saber

### 1. Un comentario mío borraba 150 líneas del menú (arreglado)

Escribí la ruta de la carpeta con comodín dentro de un comentario de LÍNEA en
`lib/auth/menu-visibility.ts`. Esa barra-asterisco **abre un bloque de comentario**, y el
quitador único del repo lo cierra en el siguiente cierre de bloque del archivo: 150 líneas
desaparecen del texto que leen TODAS las guardias que escanean ese fuente. Ya había pasado el
2026-08-24, y por eso existe R45 de `menu-visibility.test.ts` — que es quien lo cazó. Arreglado
en el mismo archivo, con la nota de por qué no se escribe ahí esa ruta.

### 2. ⚠️ `/ayuda` es el PRIMER destino universal de la app — y eso desbloquea los atajos del PWA

`tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` medía, y afirmaba, que **no había ni
un destino que vieran todos los roles**, y ése era el dato que sostenía la decisión del humano
(2026-08-25) de no publicar ningún atajo en el manifiesto: un atajo es global a la app —lo ve
quien instale la PWA, sea cual sea su rol—, así que sólo puede salir de la intersección, y la
intersección estaba vacía.

**Ya no lo está.** El ítem «Ayuda» lo ven los cinco roles, así que la intersección pasa de `[]`
a `["/ayuda"]` y los cinco contadores suben +1 a la vez (22/14/8/7/5). El propio comentario de
esa guardia decía que si mañana entrara una ruta universal *«la ficha del atajo se puede abrir
con datos»*. Ese día es hoy.

**No se ha añadido ningún atajo.** Cuáles son los atajos de la aplicación instalada es una
decisión de producto del humano, y esta ficha no la toma: sólo crea el candidato. La aserción
`expect(MANIFIESTO.shortcuts).toBeUndefined()` se queda como estaba, para que añadirlo sea una
edición consciente y no un efecto colateral de haber puesto un ítem de menú.

## Lo que NO se tocó

- **Ni una letra de los `.md`** de `docs/ayuda/`. El módulo los renderiza; no guarda texto propio.
- `feature_list.json` ni `tests/baseline-rojos.json`.
- Ninguna migración, ningún servicio, ninguna ruta de API.
