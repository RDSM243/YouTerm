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
