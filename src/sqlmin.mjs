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
  )
}
