#!/usr/bin/env node
import process from 'node:process'
import { readFileSync } from 'node:fs'

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

function sqlmin (sql) {
  return (
    sql
      // split into lines
      .split(/\r?\n/)
      // remove comments & whitespace
      .map(line => line.replace(/--.*$/, '').trim())
      // remove blank lines
      .filter(Boolean)
      // rejoin
      .join(' ')
      // remove multiple spaces
      .replace(/  +/g, ' ')
  )
}

main()
