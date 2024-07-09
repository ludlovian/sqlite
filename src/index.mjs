import process from 'node:process'
import fs from 'node:fs'
import SQLite3Database from 'better-sqlite3'
import Bouncer from '@ludlovian/bouncer'
import sqlmin from './sqlmin.mjs'

export default class Database {
  #db
  #stmts = {}
  #updateStmts = {}
  #readStmts = {}
  #inTransaction = false
  #handler = { pre: undefined, post: undefined }
  #hooks = { pre: [], post: [] }

  constructor (file, { createDDL, runtimeDDL, checkSchema } = {}) {
    const realFile = !!file && !file.startsWith(':')
    const fileExists = realFile && fs.existsSync(file)
    this.#db = new SQLite3Database(file)
    if (realFile && createDDL && !fileExists) {
      this.#db.exec(sqlmin(createDDL))
    }
    if (runtimeDDL) {
      this.#db.exec(sqlmin(runtimeDDL))
    }
    if (checkSchema) {
      const schema = this.read('_Schema')
      if (schema?.version !== checkSchema) {
        throw new Error('Invalid schema: ' + file)
      }
    }
    process.on('exit', this.close.bind(this))
  }

  get _db () {
    return this.#db
  }

  get _inTransaction () {
    return this.#inTransaction
  }

  close () {
    if (!this.#db || !this.#db.open) return
    this.#commit()
    this.#db.close()
  }

  update (name, ...parms) {
    this.#handler.pre && this.#handler.pre(name, ...parms)
    const stmt = this.#getUpdateStmt(name)
    stmt.run(...parms)
    this.#handler.post && this.#handler.post(name, ...parms)
  }

  read (name, ...parms) {
    const stmt = this.#getReadStmt(name, ...parms)
    return stmt.get(...parms)
  }

  readAll (name, ...parms) {
    const stmt = this.#getReadStmt(name, ...parms)
    return stmt.all(...parms)
  }

  exec (sql) {
    const stmt = this.#getStmt(sql)
    stmt.run()
  }

  transaction (opts, fn) {
    if (typeof opts === 'function') {
      fn = opts
      opts = undefined
    }
    const every = opts?.every
    if (!every) return this.#syncTransaction(fn)
    return this.#asyncTransaction(every, fn)
  }

  notify (fn) {
    return this.#addUpdateHook('post', fn)
  }

  #getReadStmt (name, parms = {}) {
    const cols = Object.keys(parms).sort()
    const key = [name, ...cols].join(',')
    let stmt = this.#readStmts[key]
    if (stmt) return stmt
    let sql = `select * from ${name}`
    if (cols.length) {
      sql += ' where ' + cols.map(col => `${col}=:${col}`).join(' and ')
    }
    stmt = this.#readStmts[key] = this.#getStmt(sql)
    return stmt
  }

  #getUpdateStmt (name) {
    let stmt = this.#updateStmts[name]
    if (stmt) return stmt
    const colStmt = this.#getStmt(
      "select name from pragma_table_info(?) where name != 'unused' order by cid"
    )
    const cols = colStmt.all(name).map(({ name }) => name)
    let sql
    if (cols.length) {
      sql =
        `insert into ${name}(` +
        cols.join(',') +
        ')values(' +
        cols.map(col => ':' + col) +
        ')'
    } else {
      sql = `insert into ${name} values(null)`
    }
    stmt = this.#updateStmts[name] = this.#getStmt(sql)
    return stmt
  }

  #getStmt (sql) {
    let stmt = this.#stmts[sql]
    if (stmt) return stmt
    stmt = this.#stmts[sql] = this.#db.prepare(sql)
    return stmt
  }

  #addUpdateHook (type, hookFn) {
    this.#hooks[type].push(hookFn)
    if (!this.#handler[type]) {
      this.#handler[type] = (...args) =>
        this.#hooks[type].forEach(fn => fn(...args))
    }
    return () => this.#removeUpdateHook(type, hookFn)
  }

  #removeUpdateHook (type, hookFn) {
    this.#hooks[type] = this.#hooks[type].filter(fn => fn !== hookFn)
    if (!this.#hooks[type].length) this.#handler[type] = undefined
  }

  #syncTransaction (fn) {
    if (this.#inTransaction) return fn()
    this.#begin()
    try {
      fn()
    } catch (err) {
      this.#rollback()
      throw err
    }
    this.#commit()
  }

  async #asyncTransaction (every, fn) {
    if (this.#inTransaction) return fn()
    const bouncer = new Bouncer({
      every,
      leading: false,
      fn: () => this.#commit()
    })
    const remove = this.#addUpdateHook('pre', () => {
      // begin a transaction if we haven't already
      this.#begin()
      // start or signal the bouncer
      bouncer.fire()
    })
    try {
      await fn()
      this.#commit()
    } catch (err) {
      this.#rollback()
      throw err
    } finally {
      bouncer.cancel()
      remove()
    }
  }

  #begin () {
    if (this.#inTransaction) return
    this.#getStmt('begin transaction').run()
    this.#inTransaction = true
  }

  #rollback () {
    // defensive
    /* c8 ignore next */
    if (!this.#inTransaction) return
    this.#getStmt('rollback').run()
    this.#inTransaction = false
  }

  #commit () {
    if (!this.#inTransaction) return
    this.#getStmt('commit').run()
    this.#inTransaction = false
  }
}

Database.prototype.get = Database.prototype.read
Database.prototype.all = Database.prototype.readAll

function tidySQL (sql) {
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
      .replace(/(\w) +(\W)/g, '$1$2')
      .replace(/(\W) +(\w)/g, '$1$2')
  )
}
