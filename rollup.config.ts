import { nodeResolve } from '@rollup/plugin-node-resolve'
import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import inject from '@rollup/plugin-inject'
import polyfills from 'rollup-plugin-node-polyfills'
import typescript from 'rollup-plugin-typescript2'
import { terser } from "rollup-plugin-terser"
import gzipPlugin from 'rollup-plugin-gzip'

// Require understands JSON files.
const pkg = require('./package.json')

const input = 'src/index.ts'
const name = 'webnative'

// For importing modules with `this` at the top level:
// https://github.com/WebReflection/hyperHTML/issues/304#issuecomment-443950244
const context = 'null'

// External dependencies tell Rollup "it's ok that you can't resolve these modules;
// don't try to bundle them but rather leave their import statements in place"
const external = []

const browserPlugins = [
  // Allow json resolution
  json(),

  // Compile TypeScript files
  typescript({ useTsconfigDeclarationDir: true }),

  // Node modules resolution
  nodeResolve({ browser: true, preferBuiltins: false }),

  // // Let's transpile our own ES6 code into ES5
  babel({ babelHelpers: "bundled", exclude: 'node_modules/**' }),

  // Most packages in node_modules are legacy CommonJS, so let's convert them to ES
  commonjs(),

  inject({
    Buffer: ['buffer/', 'Buffer']
  }),

  // Polyfills for node builtins/globals
  polyfills(),
]

const nodePlugins = [...browserPlugins]
nodePlugins[2] = nodeResolve({ browser: false, preferBuiltins: true })

// browser-friendly UMD build
const configUMD = {
  input,
  output: {
    name,
    file: pkg.browser.replace(".min.js", ".js"),
    format: 'umd',
    sourcemap: true
  },
  plugins: browserPlugins,
  external,
  context
}

const configUMDMinified = {
  input,
  output: {
    name,
    file: pkg.browser,
    format: 'umd',
    sourcemap: true
  },
  plugins: [...browserPlugins, terser(), gzipPlugin()],
  external,
  context
}

// CommonJS (for Node) and ES module (for bundlers) build.
// (We could have three entries in the configuration array
// instead of two, but it's quicker to generate multiple
// builds from a single configuration where possible, using
// an array for the `output` option, where we can specify
// `file` and `format` for each target)
const configCjsAndEs = {
  input,
  output: [
    {
      file: pkg.main,
      format: 'cjs',
      sourcemap: true
    },
    {
      file: pkg.module,
      format: 'es',
      sourcemap: true
    }
  ],
  plugins: nodePlugins,
  external,
  context,
}

export default [configUMD, configUMDMinified, configCjsAndEs]
