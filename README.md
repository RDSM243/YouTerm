<p align="center">
  <img src="./public/youterm.png" alt="YouTerm icon" width="128" height="128" />
</p>

<h1 align="center">YouTerm</h1>

<p align="center"><strong>Your music, your way.</strong></p>

**YouTerm** is an open source music player for Linux and Windows that connects to **YouTube Music**. It brings the look of a terminal to your music library, with an interface you can customize to match your style.

![YouTerm showing a music library and album artwork with a green terminal theme](./docs/images/youterm.jpeg)

## Make it yours

- **Choose your look:** pick a theme such as Tokyo Night, Dracula, Nord or Gruvbox, or create your own.
- **Fine-tune the details:** start with Terminal, Rounded or Cover Focus, then customize panel, button and artwork corners, spacing, borders, shadows, fonts and effects.
- **Arrange your player:** move the sidebar to either side or hide it, put playback controls at the top or bottom, and choose ASCII or continuous progress bars.
- **Build your own layout:** drag library, tracks, artwork, lyrics, spectrum and playback panels into place, resize their dividers, and save the composition with your skin. The editor supports undo, redo and cancelling changes.
- **Set your background:** import an image in Settings → Appearance and adjust brightness, dark overlay and panel opacity. Choose independently whether to show it behind the sidebar, player bar and Spectrum. Settings stays opaque.
- **Share your skins:** import and export colors, typography, shapes, layout and effects together. Older color themes still work; background image files are imported separately.
- **See your music:** switch between album artwork, ASCII art, track lists and an audio visualizer.
- **Listen and organize:** search for music, manage playlists, build your queue and connect your account to access your YouTube Music library.
- **Keep your hands on the keyboard:** control playback and navigate the player with shortcuts.

The interface is built with **React and CSS**. With the source code available, you can also modify the player and take customization further.

## Download

YouTerm is available for **Linux (x86_64)** as an **AppImage** and **Windows 10/11 (x64)** as a **setup executable** or **portable ZIP**.

**[Download YouTerm](https://github.com/RDSM243/YouTerm/releases/latest)**

On Linux, download the `.AppImage` file, allow it to run in your file manager's properties and open the player.

On Windows, run the `-setup.exe` installer. It installs Microsoft Edge WebView2 Runtime if needed. For the portable version, extract the entire ZIP and open `YouTerm.exe`, keeping the `dist` folder next to it; WebView2 must already be installed.

A **macOS** version is planned for the future.

## Get involved

For a local debug build and a temporary test profile, see [Testing in Antigravity (Português)](./docs/DEBUG.pt-BR.md).

Ideas, themes, feedback and contributions are welcome. Share what you would like to see in the player by [opening an issue](https://github.com/RDSM243/YouTerm/issues) or submitting a contribution.

YouTerm is distributed under the [GNU GPLv3 license](./LICENSE).
