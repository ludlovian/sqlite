export default function sqlmin (sql) {
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
      // remove spaces between words and non-words
      // but not if the non-words were quotes of either kind
      .replace(/(\w) +([^a-zA-Z0-9_'"])/g, '$1$2')
      .replace(/([^a-zA-Z0-9_'"]) +(\w)/g, '$1$2')
  )
}
