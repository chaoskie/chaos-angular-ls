# angular-ls for Claude Code

A Claude Code plugin that connects the Angular language server (`ngserver`) to Claude Code's LSP tool.

With it, Claude can ask the Angular compiler about your templates instead of guessing:

- errors in a template, such as a property that does not exist on the component
- the type of an expression (hover)
- where a property used in a template is defined

The plugin does not contain the language server. You install that with npm.

## Requirements

- Claude Code with plugin support.
- Node.js. The Angular language server 22 needs Node 22.22.3 or newer.
- The npm package `@angular/language-server`, installed globally or in the project:

  ```sh
  npm install -g @angular/language-server
  ```

  This also installs `@angular/language-service` and a copy of TypeScript for the server to fall back on.
- An Angular project with a `tsconfig.json` that includes your components. The project's packages must be installed (`node_modules` present).

Tested with:

| Package | Version |
|---|---|
| Node.js | 22.23.1 |
| `@angular/language-server` | 22.2.4 |
| `@angular/language-service` | 22.2.4 |
| `@angular/core` in the test project | 22.2.4 |
| `typescript` in the test project | 6.0.3 |
| Claude Code | 2.1.325 |

Tested on Linux only. Claude Code was used to validate the manifests and to install, enable and disable the plugin. The language features were tested against the server directly, see [Tests](#tests).

## Install

Add this repository as a plugin marketplace, then install the plugin:

```sh
claude plugin marketplace add chaoskie/claude-angular-ls
claude plugin install angular-ls@chaoskie-angular-ls
```

From a local clone, give the path instead:

```sh
claude plugin marketplace add ./claude-angular-ls
```

Restart Claude Code after installing.

## The `.html` overlap with other plugins

This plugin claims `.html` files. So does every general HTML language-server plugin. If two enabled plugins claim the same extension, you cannot count on the Angular server being the one that answers.

The fix is to enable this plugin only inside Angular projects.

1. Switch it off for your user account, once:

   ```sh
   claude plugin disable angular-ls@chaoskie-angular-ls
   ```

2. Switch it on inside each Angular project. Run this in the project folder:

   ```sh
   claude plugin enable angular-ls@chaoskie-angular-ls --scope local
   ```

   This writes the choice to `.claude/settings.local.json` in that project:

   ```json
   {
     "enabledPlugins": {
       "angular-ls@chaoskie-angular-ls": true
     }
   }
   ```

3. If you have another HTML language-server plugin enabled, switch it off for the same project. Add it to the same file with the value `false`, or run:

   ```sh
   claude plugin disable <plugin>@<marketplace> --scope local
   ```

Use `.claude/settings.json` instead of `.claude/settings.local.json` if you want to share the choice with your team through git.

## How it works

`ngserver` does not start unless it is told where to find TypeScript and `@angular/language-service`. The plugin starts a small launcher, `plugins/angular-ls/scripts/launch.cjs`, which does that for you.

The launcher looks for `@angular/language-server` in this order:

1. the folder in the `ANGULAR_LS_SERVER_DIR` environment variable, if set
2. the project's `node_modules`
3. the `ngserver` command on your `PATH`
4. the global npm folder (`npm root -g`)

It then tells the server to look for TypeScript and the Angular language service in the project first, and in the server's own install folder second. Your project's versions win when the project has them.

## Troubleshooting

**See what the launcher would use.** Run this in your project folder. It prints the server folder and the lookup folders, then stops:

```sh
node /path/to/claude-angular-ls/plugins/angular-ls/scripts/launch.cjs --print-config
```

**"could not find @angular/language-server".** Install it with `npm install -g @angular/language-server`. If it is installed in an unusual place, set `ANGULAR_LS_SERVER_DIR` to the package folder.

**"Failed to resolve 'typescript' with minimum version".** The server found no usable TypeScript. It needs TypeScript 5.0 or newer with the file `lib/tsserverlibrary.js`. Reinstall `@angular/language-server`, which brings its own copy.

**No results in a template.** Check these:

- The component that owns the template is included by a `tsconfig.json` in the project.
- `npm install` has been run in the project.
- No other plugin that claims `.html` is enabled for this project. See the section above.
- You restarted Claude Code after you installed or enabled the plugin.

**The first request is slow.** The server loads the whole TypeScript project on first use. Large projects take a while. The plugin allows 60 seconds for startup.

**Check the server outside Claude Code.** Clone this repository and run the tests. See below.

## Limitations

- Only `.html` files are sent to this server. Inline templates inside `.ts` files are not covered by this plugin.
- The server needs a `tsconfig.json`. A loose `.html` file outside an Angular project gets no results.
- Windows and macOS are untested. The launcher has code for Windows command shims, but nobody has run it there yet.
- The tests talk to the language server directly. They do not start Claude Code.
- Angular versions older than 22 are untested. The server itself says it needs `@angular/language-service` 15 or newer.

## Tests

The tests need Node.js and a global `@angular/language-server`. They do not need Claude Code.

```sh
npm ci --ignore-scripts --prefix test/fixture
npm test
```

- `test/validate-manifests.mjs` checks that the manifests are valid JSON, have the required fields, use only documented field names, and point at files and commands that exist.
- `test/lsp-smoke.mjs` starts the server the way the plugin does. It sends `initialize`, opens the template of a small Angular project in `test/fixture`, and checks hover, go to definition and diagnostics.

The template in `test/fixture` contains one deliberate error. The smoke test expects the server to report it.

If you have Claude Code installed, you can also run its own check:

```sh
claude plugin validate .
claude plugin validate ./plugins/angular-ls
```

## License

MIT. See [LICENSE](LICENSE).
