# Contributing to YouTerm

## Branches

- `main` is the stable branch and the starting point for release tags.
- `dev` is the integration branch for ongoing development.
- Create short branches such as `feat/new-theme` or `fix/audio-loading` from an up-to-date `dev`, then open a pull request into `dev`.
- When a version is ready, open a pull request from `dev` into `main` and use a merge commit. Both permanent branches must remain available after the merge.
- Bring any fixes made on `main` back into `dev` before continuing development.

Both `main` and `dev` are protected against deletion and force pushes. Changes to `main` require a pull request, a passing **Linux build**, an up-to-date branch and resolved review conversations. You can merge your own pull request; another person's approval is not required.

## Build checks

The build runs for pull requests targeting `main` or `dev` and for pushes to either branch. It installs dependencies from the lockfiles, builds the React interface and the native Linux application, then checks that the application starts and finds its frontend assets.

For a local build, use Node.js 22 and the Rust version pinned in `rust-toolchain.toml`. Install the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), then run:

```bash
npm ci
npm run build
cargo build --locked --manifest-path src-tauri/Cargo.toml
./src-tauri/target/debug/youterm --check
```

Keep credentials in your local `.env` file. Build output, caches and personal configuration must remain outside Git.

## Releases

Create version tags such as `v0.2.1` from tested commits on `main`. Publish the Linux AppImage as a release asset; build output does not belong in the source repository.
