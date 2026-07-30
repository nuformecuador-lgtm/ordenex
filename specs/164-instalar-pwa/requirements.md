# Feature 164 — Botón de instalar la PWA y screenshots del manifest · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver `tasks.md`).
>
> Origen: el humano preguntó si la PWA era instalable. Lo es en producción, pero la
> instalación dependía por completo del gesto propio del navegador y el manifest no declaraba
> screenshots. Pidió añadir ambas cosas.

## Glosario

- **Oferta de instalación**: el aviso que el navegador entrega a la página cuando considera
  que la app cumple los criterios y aún no está instalada.
- **Diálogo nativo**: la ventana de confirmación que muestra el propio navegador.
- **Ficha de instalación**: el diálogo enriquecido que Android muestra cuando el manifest
  declara screenshots; sin ellas degrada a un aviso pequeño.

---

## A. El botón

**R1** — MIENTRAS el navegador no haya ofrecido instalar, el sistema NO DEBE mostrar control
de instalación alguno.

**R2** — CUANDO el navegador ofrezca instalar, el sistema DEBE mostrar un control para
hacerlo.

**R3** — CUANDO el navegador ofrezca instalar, el sistema DEBE impedir el aviso propio del
navegador, para no ofrecer la misma acción dos veces a la vez.

**R4** — CUANDO el usuario active el control, el sistema DEBE abrir el diálogo nativo de
instalación.

**R5** — CUANDO la oferta se haya consumido —el usuario aceptó o rechazó— el sistema DEBE
retirar el control y NO DEBE insistir en la misma sesión.

**R6** — SI el diálogo nativo falla, ENTONCES el sistema NO DEBE propagar el error ni dejar
el control colgado.

**R7** — CUANDO la aplicación quede instalada, el sistema DEBE retirar el control aunque el
usuario no lo haya pulsado.

**R8** — El control DEBE exponer su nombre accesible completo, también cuando se presente
solo como icono.

**R9** — CUANDO el control se retire de la pantalla, el sistema DEBE dejar de escuchar los
avisos del navegador.

## B. El manifest

**R10** — El manifest DEBE declarar los campos que el navegador exige para ofrecer instalar:
nombre, dirección de arranque y un modo de presentación instalable.

**R11** — El manifest DEBE declarar iconos de 192 y 512 píxeles.

**R12** — Todo icono o captura declarado en el manifest DEBE existir en los archivos
públicos.

**R13** — Las dimensiones declaradas de cada icono o captura DEBEN coincidir con las reales
del archivo.

**R14** — El manifest DEBE declarar al menos una captura para móvil y una para escritorio.

**R15** — Todas las capturas de móvil DEBEN compartir la misma proporción, como exige el
navegador.

**R16** — Cada captura DEBE llevar una etiqueta descriptiva.

**R17** — Ninguna captura DEBE exceder los 3840 píxeles ni bajar de 320 en ningún lado.

**R18** — Las capturas DEBEN ser imágenes REALES de la aplicación; NO DEBEN incluir
andamiaje del entorno de desarrollo.

---

## Fuera de alcance (declarado)

- **Ayuda de instalación para iOS y Firefox.** `beforeinstallprompt` es de Chromium: Safari
  y Firefox no lo disparan nunca, así que ahí el botón no aparece y la instalación sigue
  siendo manual. Guiar al usuario de iPhone exige una ayuda aparte que **no** está hecha.
- Campo `id` del manifest, banners de "instala la app" recurrentes, y detección de
  `display-mode: standalone` para variar la interfaz cuando ya está instalada.
