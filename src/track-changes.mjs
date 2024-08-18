export function trackChanges (db, name, opts = {}) {
  const { dest = 'changes', type = 'json' } = opts
  let exclude = opts.exclude ?? []
  if (typeof exclude === 'string') exclude = exclude.split(',')
  const kcols = db
    .prepare('select name from pragma_table_info(?) where pk>0 order by pk')
    .pluck()
    .all(name)
  const dcols = db
    .prepare('select name from pragma_table_info(?) where pk=0 order by cid')
    .pluck()
    .all(name)
  if (type === 'json') {
    const xdcols = dcols.filter(n => !exclude.includes(n))
    return jsonChanges(name, dest, kcols, xdcols)
  }
  return sqlChanges(name, dest, kcols, dcols)
}

function jsonChanges (name, dest, kcols, dcols) {
  const cols = [...kcols, ...dcols]
  const pk = [...kcols.map(() => 1), ...dcols.map(() => 0)]
  const sql = []
  // insert
  sql.push(
    `create temp trigger ${name}_track_json_ins ` +
      `after insert on ${name} begin ` +
      `insert into ${dest} values(null,'${name}',null,` +
      'json_object(' +
      cols.map(n => `'${n}',new.${n}`).join(',') +
      '),julianday());end;'
  )
  // delete
  sql.push(
    `create temp trigger ${name}_track_json_del ` +
      `after delete on ${name} begin ` +
      `insert into ${dest} values(null,'${name}',` +
      'json_object(' +
      cols.map(n => `'${n}',old.${n}`).join(',') +
      '),null,julianday());end;'
  )
  //  update
  sql.push(
    `create temp trigger ${name}_track_json_upd ` +
      `after update on ${name} begin ` +
      `insert into ${dest} ` +
      'with chgs(col,pre,post,pk) as (values ' +
      cols.map((n, i) => `('${n}',old.${n},new.${n},${pk[i]})`).join(',') +
      '),bef(obj) as (select json_group_object(col,pre) from chgs ' +
      'where pre is not post or pk=1),' +
      'aft(obj) as (select json_group_object(col,post) from chgs ' +
      'where pre is not post) ' +
      `select null,'${name}',bef.obj,aft.obj,julianday() ` +
      'from bef,aft;end;'
  )
  return sql.join('')
}

function sqlChanges (name, dest, kcols, dcols) {
  const cols = [...kcols, ...dcols]
  const sql = []
  // insert
  sql.push(
    `create temp trigger ${name}_track_sql_ins ` +
      `after insert on ${name} begin ` +
      `insert into ${dest} values(null,` +
      `'insert into ${name}(` +
      cols.join(',') +
      ') values(' +
      cols.map(n => `'||quote(new.${n})||'`).join(',') +
      ")',julianday());end;"
  )
  // delete
  sql.push(
    `create temp trigger ${name}_track_sql_del ` +
      `after delete on ${name} begin ` +
      `insert into ${dest} values(null,` +
      `'delete from ${name} where ` +
      kcols.map(n => `${n}='||quote(old.${n})||'`).join(' and ') +
      "',julianday());end;"
  )
  // update
  sql.push(
    `create temp trigger ${name}_track_sql_upd ` +
      `after update on ${name} begin ` +
      `insert into ${dest} values(null,` +
      `'update ${name} set ` +
      cols.map(n => `${n}='||quote(new.${n})||'`).join(',') +
      ' where ' +
      kcols.map(n => `${n}='||quote(old.${n})||'`).join(' and ') +
      "',julianday());end;"
  )
  return sql.join('')
}
