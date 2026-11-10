# Contributing to YouTerm

## Branches

- `main` is the stable branch and the starting point for release tags.
- `dev` is the integration branch for ongoing development.
- Create short branches such as `feat/new-theme` or `fix/audio-loading` from an up-to-date `dev`, then open a pull request into `dev`.
- When a version is ready, open a pull request from `dev` into `main` and use a merge commit. Both permanent branches must remain available after the merge.
- Bring any fixes made on `main` back into `dev` before continuing development.

Both `main` and `dev` are protected against deletion and force pushes. Changes to `main` require a pull request, a merge commit and resolved review conversations. You can merge your own pull request; another person's approval is not required.

## Validating changes

Build and try your changes locally before merging. Check the player features affected by your change and describe what you verified in the pull request.

Keep credentials in your local `.env` file. Build output, caches and personal configuration must remain outside Git.

## Releases

Create version tags such as `v0.2.1` from tested commits on `main`. Publish the Linux AppImage as a release asset; build output does not belong in the source repository.

### Windows packages

Windows builds are requested manually. Run the **Build Windows** workflow from the Actions page, or add the `build-windows` label to a pull request from this repository. Pushes do not trigger builds. Download the installer, portable ZIP and checksums from the successful run's artifacts, and attach them to the release.

To build locally on Windows, install Node.js 22, Rust with the MSVC toolchain, and Visual Studio C++ Build Tools. Run `npm install --no-package-lock`, then `npm run package:windows`. Packages are written to `build/releases`. The NSIS installer includes the frontend resources and installs WebView2 if needed; the portable ZIP must be extracted in full.

For cross compilation on Linux, install [cargo-xwin](https://github.com/rust-cross/cargo-xwin), LLVM with `clang-cl`, `lld-link` and `llvm-rc`, NSIS, Python 3 and the Rust target `x86_64-pc-windows-msvc`. Run `bash scripts/package-windows-cross.sh`; it builds the native executable and packages the same installer and portable ZIP. This follows [Tauri's cross compilation guidance](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos). A native Windows run is still needed to validate WebView2 and playback.
