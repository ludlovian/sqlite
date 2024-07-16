#!/usr/bin/env node
import process from 'node:process'
import { readFileSync } from 'node:fs'
import sqlmin from '../src/sqlmin.mjs'

async function main () {
  const inFile = process.argv[2]
  const input = await readInput(inFile)
  const lines = input.split('\n').filter(Boolean)
  if (lines[0]?.startsWith('export')) {
    lines.pop()
    lines.shift()
  }
  const output = sqlmin(lines.join('\n')) + '\n'
  process.stdout.write(output)
}

async function readInput (inFile) {
  if (inFile && inFile !== '-') return readFileSync(inFile, 'utf8')
  process.stdin.setEncoding('utf8')
  let buff = ''
  for await (const chunk of process.stdin) buff += chunk
  return buff
}

main()
