#!/usr/bin/env node
import process from 'node:process'
import { readFileSync, writeFileSync } from 'node:fs'
import sqlmin from '../src/sqlmin.mjs'

async function main () {
  const [inFile, outFile] = process.argv.slice(2)
  const input = await readInput(inFile)
  const output = sqlmin(input) + '\n'
  if (!outFile || outFile === '-') {
    process.stdout.write(output)
  } else {
    writeFileSync(outFile, output)
  }
}

async function readInput (inFile) {
  if (inFile && inFile !== '-') return readFileSync(inFile, 'utf8')
  process.stdin.setEncoding('utf8')
  let buff = ''
  for await (const chunk of process.stdin) buff += chunk
  return buff
}

main()
