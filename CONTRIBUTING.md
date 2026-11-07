# Contributing to Worbus for desktop

Thanks for your interest in contributing!

Worbus for desktop is a fork of Feishin by Jeff Li. Bugs and ideas for every Worbus piece live in one place: [the Worbus issues](https://github.com/illuminator69/worbus/issues).

## IMPORTANT

For feature contributions that do not have an existing feature request, please open an issue there **BEFORE** beginning to implement it to determine whether or not the feature would be acceptable for the app. Simply submitting a large feature with thousands of new or changed lines of code without asking if the feature is desired for the application will run the risk of instant closure.

Bug fixes are likely to be accepted without discussion.

## Development environment

Worbus for desktop is built and tested with Node.js 24 and pnpm `11.5.2` (pinned by `packageManager`).

Useful development commands include:

- `pnpm run dev` - Start the electron app development environment
- `pnpm run dev:watch` - Start the electron app development environment with main process autoreloading
- `pnpm run package:dev` - Quick unpacked production build
- `pnpm run build:remote` - Manually rebuild the remote app if you make changes

## AI Disclosure

AI-generated code **is accepted** under the following conditions:

1. You are a professional or hobbyist developer using agentic coding as a tool rather than a crutch
2. You are manually reviewing the output code before submitting the pull-request
3. You are manually testing the functionality of your code before submitting the pull-request

Pull requests are **manually reviewed** by maintainers which means that submitting any form of slop wastes our precious time that could otherwise go towards fixing bugs or implementing new features.

## Pull requests

Please include:

- A clear description of the change
- Screenshots or recordings for UI changes if applicable

## Translations

Translations come from upstream's [Weblate project](https://hosted.weblate.org/projects/feishin/) and arrive with its releases. You only need to include translation strings for the `en.json` file.
