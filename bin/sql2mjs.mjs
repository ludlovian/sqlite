#!/usr/bin/env node
import process from 'node:process'
import { readFileSync, writeFileSync } from 'node:fs'
import sqlmin from '../src/sqlmin.mjs'

const [inFile, outFile] = process.argv.slice(2)
const input = readFileSync(inFile, 'utf8')
const output = sqlmin(input)
const quotedOutput = output.includes("'")
  ? `"${output.replaceAll('"', '\\"')}"`
  : `'${output}'`
const moduleText = `export default ${quotedOutput}\n`
if (!outFile || outFile === '-') {
  process.stdout.write(moduleText)
} else {
  writeFileSync(outFile, moduleText)
}
