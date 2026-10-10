# Polar Locate

> **Alineación polar asistida para astrofotografía.** Coloca el móvil en el
> soporte del DSLR, y los sensores, la cámara y las vibraciones te guían hasta
> centrar la Estrella Polar en el retículo.

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
![Plataforma: Android (APK)](https://img.shields.io/badge/plataforma-Android%20APK-3ddc84.svg)
![Plataforma: iOS (opcional)](https://img.shields.io/badge/plataforma-iOS%20opcional-lightgrey.svg)
![Idioma: español](https://img.shields.io/badge/idioma-espa%C3%B1ol-red.svg)
[![CI](https://github.com/imigueldiaz/polar-locate/actions/workflows/ci.yml/badge.svg)](https://github.com/imigueldiaz/polar-locate/actions/workflows/ci.yml)
[![CodeQL](https://github.com/imigueldiaz/polar-locate/actions/workflows/codeql.yml/badge.svg)](https://github.com/imigueldiaz/polar-locate/actions/workflows/codeql.yml)

Ayuda a apuntar una **montura de seguimiento** (p. ej. una Sky-Watcher Star
Adventurer / GTi) al polo celeste. Montas el teléfono en la zapata del flash del
DSLR, abres la app, y ella te dice —con flechas en pantalla y **hápticos**—
cómo mover el soporte hasta dejar Polaris donde debe estar.

Todo se calcula **en el dispositivo**. No hay servidor, no hay telemetría, no se
sube nada a ningún sitio.

---

## Índice

- [¿Qué hace?](#qué-hace)
- [Cómo funciona](#cómo-funciona)
- [Estado del proyecto](#estado-del-proyecto)
- [Requisitos](#requisitos)
- [Desarrollo](#desarrollo)
- [Compilar el APK (Android)](#compilar-el-apk-android)
- [Releases automáticas (GitHub)](#releases-automáticas-github)
- [Actualizaciones (OTA)](#actualizaciones-ota)
- [iOS (opcional)](#ios-opcional)
- [Privacidad](#privacidad)
- [Créditos y atribución](#créditos-y-atribución)
- [Licencia](#licencia)
- [Transparencia sobre el desarrollo](#transparencia-sobre-el-desarrollo)
- [Ética](#ética)
- [Contribuir y netiqueta](#contribuir-y-netiqueta)
- [Contacto](#contacto)

---

## ¿Qué hace?

- **Lectura de esquina** permanente: coordenadas GPS, precisión, hora local,
  hora sideral, altura/azimut de Polaris, **deriva de Polaris** respecto al polo
  celeste (incluyendo precesión) y la **hora desde la que Polaris es visible**
  (ventana de oscuridad astronómica).
- **Retículo SVG** dibujado en pantalla, que **gira con el balanceo** del
  teléfono (roll) para mantenerse alineado con el cielo.
- **Guía háptica**: vibraciones cortas codifican hacia dónde mover (subir/bajar
  o girar a un lado/otro); se vuelven finas cuando estás cerca.
- **Cámara en vivo** superpuesta bajo el retículo, con zoom digital.
- **Visión por computador**: cada ~1 s captura una imagen, detecta la estrella y
  marca su desviación respecto al centro; al centrarla, avisa y **bloquea**.
- **Astrometría en el dispositivo**: identifica el campo de estrellas contra un
  catálogo embebido y **corrige el rumbo** a partir de la propia imagen,
  eliminando la dependencia del magnetómetro (que falla cerca de metal).
- **Inicio de búsqueda**: la guía (mensajes de dirección, vibraciones y
  astrometría) solo se activa al pulsar **Búsqueda ON**; hasta entonces la app no
  te dirige ni vibra.
- **Retícula del Star Adventurer / GTi**: además del retículo genérico, dibuja la
  esfera de reloj de 12 h del buscador polar (0 arriba, ticks cada 5°/30° y los
  anillos de Polaris) con la lectura **"Hora polar"** (hora angular de Polaris).
- **Apilado multi-frame**: promedia varias capturas por ciclo y sube la calidad
  de captura para sacar estrellas débiles.
- **Enfoque**: lectura de nitidez (varianza del laplaciano) y opción de
  **bloquear el foco** tras el primer autoenfoque, para no «cazar» en la oscuridad.
- **Modo noche**: baja el brillo de pantalla al mínimo y la mantiene encendida.
- **Escala de placa y tolerancia** de centrado ajustables a mano (Opciones →
  Avanzado), por si quieres afinar más allá de lo que da el EXIF.
- **Menú de Opciones** con dos registros **opcionales y desactivados por defecto**:
  guardar los JPEG de detección (con un comentario incrustado que nombra lo
  detectado) y almacenar trazas en JSONL para análisis. Nada se guarda si no lo activas.
- **Tema rojo de visión nocturna** para no arruinar la adaptación a la oscuridad.

## Cómo funciona

1. **Ubicación y tiempo** (`src/lib/astro.ts`, con `astronomy-engine`): a partir
   de tu lat/lon y el reloj se calcula dónde está Polaris, dónde está el polo
   celeste real y cuánto se separan.
2. **Puntería por sensores** (`src/lib/pointing.ts`): el acelerómetro da la
   vertical (altura y balanceo fiables) y el magnetómetro un azimut aproximado.
3. **Detección de estrellas** (`src/lib/detect.ts`): se capturan varias tomas, se
   apilan (multi-frame), se reducen a 240 px, se pasan a escala de grises y se
   busca el punto más brillante (más una medida de nitidez para el enfoque).
4. **Astrometría** (`src/lib/astrometry.ts` + `src/lib/field.ts`): se predicen
   las estrellas del catálogo en el campo de visión y se casan con las
   detectadas (ICP) → se corrige azimut, altura y escala real (px/grado). La
   actitud corregida sustituye al sensor.
5. **Guía y hápticos**: la diferencia hasta el polo genera las instrucciones en
   pantalla y los toques de vibración (solo con la búsqueda iniciada).

Detalles técnicos en [`AGENTS.md`](AGENTS.md).

## Estado del proyecto

| Hito | Descripción | Estado |
|---|---|---|
| M0 | Andamiaje Expo + i18n + tema + GPS/hora | ✅ |
| M1 | Astronomía: Polaris, polo, deriva, oscuridad | ✅ |
| M2 | Sensores + retículo + guía háptica | ✅ |
| M3 | Cámara en vivo + superposición + zoom | ✅ |
| M4 | Visión por computador (estrella más brillante) | ✅ |
| M4.5 | Catálogo + astrometría (mata el magnetómetro) | ✅ |
| M5 | Build EAS → APK (+ iOS opcional) | ✅ (config) |
| M6 | Extras: opciones/registro, retícula GTi, modo noche, enfoque, escala/tolerancia | ✅ |

Probado en **Expo Go**. La astrometría funciona con capturas periódicas; para
tiempo real puro (VisionCamera) haría falta un *development build*.

## Requisitos

- Node.js LTS y npm.
- La app **Expo Go** en el móvil para desarrollo.
- Cuenta gratuita de **Expo** (solo para compilar con EAS).

## Desarrollo

```bash
git clone https://github.com/imigueldiaz/polar-locate.git
cd polar-locate
npm install
npx expo start
```

Abre el terminal de VS Code (Ctrl+\`), ejecuta lo anterior y **escanea el QR
desde dentro de Expo Go** (no con la cámara del sistema). Necesitarás conceder
permisos de **ubicación** y **cámara**.

Comprobaciones:

```bash
npm run typecheck    # tipos
npm run lint         # lint
npm test             # self-checks de astro y visión
npx expo-doctor      # salud del proyecto
```

## Compilar el APK (Android)

La app se compila **en la nube con EAS**; no necesitas Android Studio ni
compilar en local.

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

El perfil `preview` genera un **APK** instalable (distribución interna) y te da
un enlace de descarga. `production` genera el build de tienda con incremento de
versión automático.

### Releases automáticas (GitHub)

Si añades el secreto `EXPO_TOKEN` (en Expo → *Access tokens* → créalo, y en
GitHub → *Settings → Secrets and variables → Actions* → guárdalo como
`EXPO_TOKEN`), el workflow
[`.github/workflows/release.yml`](.github/workflows/release.yml) **compila el
APK y lo publica como GitHub Release**. Se dispara al empujar un tag `v*` o
manualmente (*Actions → Android APK Release → Run workflow*):

```bash
git tag v1.0.1 && git push origin v1.0.1
```

Expo **no** lo hace por sí solo: EAS no tiene una función de «GitHub Release»
(publica a tiendas y aloja el APK); este workflow añade ese paso descargando el
artefacto del build.

## Actualizaciones (OTA)

Tras el primer build, los cambios que **solo afectan a JavaScript/estilos** (sin
tocar dependencias nativas) se publican al instante con **EAS Update**, sin
regenerar el APK:

```bash
npx eas-cli@latest update --branch preview
```

Las apps ya instaladas (perfil `preview`) descargan la actualización al abrirse.
Cada perfil lleva su `channel` (`preview`/`production`) y la app usa
`runtimeVersion` = `appVersion`, de modo que una actualización solo llega a
builds compatibles. Si cambias módulos nativos, hay que **recompilar** el APK.

> Nota: el APK que instales **antes** de añadir `expo-updates` no recibe OTA;
> hace falta un build nuevo para empezar a usarlas.

## iOS (opcional)

El mismo código sirve para iPhone, pero distribuir en iOS requiere una **cuenta
de Apple Developer** (de pago). Para dispositivos propios (ad-hoc):

```bash
npx eas-cli@latest build -p ios --profile preview
```

## Privacidad

- **Todo local.** El cálculo astronómico, la astrometría y el tratamiento de la
  imagen ocurren íntegramente en tu teléfono.
- **Sin red.** La app no hace peticiones a servidores ni envía datos.
- **Sin telemetría.**
- **Registros opcionales.** El guardado de JPEG y trazas (menú Opciones) escribe
  solo en la carpeta privada de la app y solo si lo activas tú; nunca sale del
  dispositivo salvo que uses *Compartir*.
- **Permisos:** *ubicación* (para los cálculos) y *cámara* (para apuntar).
  Ninguno se usa para otro fin.

## Créditos y atribución

Este proyecto se apoya en trabajo ajeno y lo reconoce:

- **HYG Database v4.1** (github.com/astronexus/HYG-Database) — catálogo de
  estrellas, por **David Nash (astronexus)** y colaboradores, bajo
  **CC BY-SA 4.0**. El catálogo embebido en `src/lib/catalog.ts` es una obra
  derivada y conserva esa licencia.
- **Expo**, **React**, **React Native**, **react-native-svg**,
  **astronomy-engine**, **i18n-js**, **base64-js** y **jpeg-js** (MIT, salvo
  jpeg-js = BSD-3). Parte del andamiaje procede de la plantilla `blank-typescript`
  de Expo.

La lista completa, con versiones, titulares y textos de licencia, está en
[`VENDORS.md`](VENDORS.md) y [`NOTICE`](NOTICE).

## Licencia

**MIT** © 2026 **Ignacio de Miguel Díaz** (`imigueldiaz@tutamail.com`).
Ver [`LICENSE`](LICENSE).

El código es tuyo para usar, modificar y redistribuir; **solo pedimos que
mantengas la mención de autoría**. Excepción: el catálogo `src/lib/catalog.ts`
es **CC BY-SA 4.0** (ver arriba), una licencia distinta que afecta a esos datos.

## Transparencia sobre el desarrollo

Aquí no se esconde cómo se ha construido esto. El desarrollo se ha apoyado
deliberadamente en la **IA como guía y acelerador**: el mantenedor no conocía el
ecosistema móvil (Android / Apple) y la IA sirvió para orientar decisiones,
explicar APIs y escribir andamiaje.

Pero esto **no es «código generado y soltado»**: detrás hay un **desarrollador
con 25 años de experiencia** en software que **revisa y prueba cada pieza**,
valida los cálculos y decide qué se queda. La IA propone; una persona con
criterio responde y verifica.

Lo decimos porque creemos que la transparencia forma parte de la ética del
proyecto (ver [`ETHICAL.md`](ETHICAL.md)): preferimos declarar cómo se hizo a
fingir que salió de la nada. Mantener software libre también es ser honesto
sobre el proceso, no solo sobre el resultado.

## Ética

Este software no es neutral y el proyecto **no pretende que lo sea**. Su
desarrollo y su uso se guían por una declaración de principios que va más allá
de la licencia legal:

> **Lee [`ETHICAL.md`](ETHICAL.md).**

Resumen: rechazo a la violencia y a la discriminación, apoyo explícito a las
personas trans y LGBTQIA+, rechazo a la explotación y a la concentración de
poder, rechazo a usos militares y de vigilancia, y justicia ambiental y social.
El documento **apela a la conciencia**: no es exigible legalmente (eso lo cubre
la MIT), pero quien usa o contribuye a este código está invitado a respetarlo.

Se publica bajo esos principios porque creemos que la tecnología moldea qué
futuros son posibles. Si compartes estos valores, eres bienvenida/o.

## Contribuir y netiqueta

Se aceptan contribuciones con gusto. Para que la colaboración sea sana:

- **Respeta a las personas.** El código de este proyecto convive con
  [`ETHICAL.md`](ETHICAL.md). Comentarios y revisiones, con respeto; nada de
  descalificaciones.
- **Idioma:** español o inglés, lo que te resulte cómodo.
- **Commits claros**, idealmente estilo *Conventional Commits* y con alcance
  pequeño (un cambio por PR).
- **Explica el porqué** en la descripción del PR; si toca comportamiento
  visible, añade pasos para reproducir/probar.
- **Nada de spam ni de contenido generado en masa.** Aportes de baja calidad
  (issues/PRs automáticos, texto volcado sin revisar) se cierran sin más.
- Si la herramienta es la IA, **revísala y hazla tuya**: aquí se valora el
  criterio humano, no el volumen.
- Antes de declarar algo terminado, pasa `tsc` y `lint`.

Es la netiqueta de siempre: sé concreto, sé amable, no rompas lo que ya
funciona y atribuye el trabajo ajeno.

## Contacto

**Ignacio de Miguel Díaz** — `imigueldiaz@tutamail.com`

---

> _«La tecnología que construimos no es neutral. Da forma al mundo y a qué
> futuros son posibles. Elige con cuidado.»_ — [`ETHICAL.md`](ETHICAL.md)
