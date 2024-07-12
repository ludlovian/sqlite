import process from 'node:process'
import fs from 'node:fs'
import SQLite3Database from 'better-sqlite3'
import Bouncer from '@ludlovian/bouncer'
import sqlmin from './sqlmin.mjs'

export default class Database {
  #db

  // statement and SQL caches
  #updateSQL = {}
  #readSQL = {}

  // commit management
  #commitMgr = {
    delay: 0,
    active: 0,
    dispose: undefined,
    bouncer: undefined
  }

  // hook management
  #hooks = { pre: [], post: [] }

  // --------------------------------------------------------------
  // Construction

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
      const schema = this.get('_Schema')
      if (schema?.version !== checkSchema) {
        throw new Error('Invalid schema: ' + file)
      }
    }
    this.close = this.close.bind(this)
    process.on('exit', this.close)
  }

  // --------------------------------------------------------------
  // Getters & setters

  get _db () {
    return this.#db
  }

  get _inTransaction () {
    return this.#commitMgr.active
  }

  get autoCommit () {
    return this.#commitMgr.delay
  }

  set autoCommit (ms) {
    if (this.autoCommit === ms) return
    this.#commitMgr.delay = ms
    this.#stopAutoCommit()
    if (ms) this.#startAutoCommit()
  }

  // --------------------------------------------------------------
  // Public API

  close () {
    process.removeListener('exit', this.close)
    if (this.#db && this.#db.open) {
      this.#commit()
      this.#db.close()
    }
  }

  update (nameOrSQL, ...parms) {
    this.#hook('pre', nameOrSQL, ...parms)
    const sql = this.#getUpdateSQL(nameOrSQL)
    const stmt = this.#getStmt(sql)
    stmt.run(...parms)
    this.#hook('post', nameOrSQL, ...parms)
  }

  get_ (nameOrSQL, ...parms) {
    const sql = this.#getReadSQL(nameOrSQL, ...parms)
    const stmt = this.#getStmt(sql)
    return stmt.get(...parms)
  }

  all (nameOrSQL, ...parms) {
    const sql = this.#getReadSQL(nameOrSQL, ...parms)
    const stmt = this.#getStmt(sql)
    return stmt.all(...parms)
  }

  exec (sql, ...parms) {
    const stmt = this.#getStmt(sql)
    stmt.run(...parms)
  }

  prepare (sql) {
    const stmt = this.#getStmt(sql)
    return new Stmt(stmt, {
      hook: this.#hook.bind(this)
    })
  }

  transaction (fn) {
    if (this._inTransaction) return fn()
    let result
    this.#begin()
    try {
      result = fn()
      this.#commit()
    } catch (err) {
      this.#rollback()
      throw err
    }
    return result
  }

  async asyncTransaction (ms, fn) {
    if (this._inTransaction) return await fn()
    const oldAutoCommit = this.autoCommit
    this.autoCommit = ms
    try {
      const result = await fn()
      this.#commit()
      this.autoCommit = oldAutoCommit
      return result
    } catch (err) {
      this.#rollback()
      this.autoCommit = oldAutoCommit
      throw err
    }
  }

  notify (fn) {
    return this.#addUpdateHook('post', fn)
  }

  // --------------------------------------------------------------
  // Internal - Statement management

  #getReadSQL (nameOrSQL, parms = {}) {
    if (nameOrSQL.indexOf(' ') >= 0) return nameOrSQL
    const name = nameOrSQL
    const cols = Object.keys(parms)
    const key = [name, ...cols].join(',')
    let sql = this.#readSQL[key]
    if (!sql) {
      sql = `select * from ${name}`
      if (cols.length) {
        const where = cols.map(col => `${col}=$${col}`).join(' and ')
        sql += ` where ${where}`
      }
      this.#readSQL[key] = sql
    }
    return sql
  }

  #getUpdateSQL (nameOrSQL) {
    if (nameOrSQL.indexOf(' ') >= 0) return nameOrSQL
    const name = nameOrSQL
    let sql = this.#updateSQL[name]
    if (!sql) {
      const pragmaSQL =
        "select name from pragma_table_info($name) where name not in('unused','0') order by cid"
      const stmt = this.#getStmt(pragmaSQL)
      const cols = stmt.all({ name }).map(c => c.name)
      if (cols.length) {
        sql =
          `insert into ${name}(${cols.join(',')})` +
          `values(${cols.map(col => '$' + col).join(',')})`
      } else {
        sql = `insert into ${name} values(null)`
      }
      this.#updateSQL[name] = sql
    }
    return sql
  }

  #getStmt (sql) {
    // we could cache here, but lets not unless theres a problem
    return this.#db.prepare(sql)
  }

  // --------------------------------------------------------------
  // Internal - Update hooks
  #hook (type, ...args) {
    if (!this.#hooks[type].length) return
    this.#hooks[type].forEach(fn => fn(...args))
  }

  #addUpdateHook (type, hookFn) {
    this.#hooks[type].push(hookFn)
    return () => this.#removeUpdateHook(type, hookFn)
  }

  #removeUpdateHook (type, hookFn) {
    this.#hooks[type] = this.#hooks[type].filter(fn => fn !== hookFn)
  }

  // --------------------------------------------------------------
  // Internal - Transaction

  #begin () {
    if (this.#commitMgr.active) return
    this.#getStmt('begin transaction').run()
    this.#commitMgr.active = true
  }

  #rollback () {
    // defensive
    /* c8 ignore next */
    if (!this.#commitMgr.active) return
    this.#getStmt('rollback').run()
    this.#commitMgr.active = false
  }

  #commit () {
    if (!this.#commitMgr.active) return
    this.#getStmt('commit').run()
    this.#commitMgr.active = false
  }

  #stopAutoCommit () {
    const mgr = this.#commitMgr
    this.#commit()
    mgr.bouncer?.cancel()
    mgr.dispose?.()
    mgr.bouncer = mgr.dispose = undefined
  }

  #startAutoCommit () {
    const mgr = this.#commitMgr
    // defensive
    /* c8 ignore next */
    if (!mgr.delay) return undefined

    const bouncer = (mgr.bouncer = new Bouncer({
      every: mgr.delay,
      leading: false,
      fn: () => this.#commit()
    }))
    mgr.dispose = this.#addUpdateHook('pre', () => {
      this.#begin()
      bouncer.fire()
    })
  }
}
Database.prototype.get = Database.prototype.get_

class Stmt {
  #stmt
  #hook
  constructor (stmt, { hook }) {
    this.#stmt = stmt
    this.#hook = hook
  }

  get_ (...parms) {
    return this.#stmt.get(...parms)
  }

  all (...parms) {
    return this.#stmt.all(...parms)
  }

  run (...parms) {
    this.#hook('pre', this.#stmt.source, ...parms)
    this.#stmt.run(...parms)
    this.#hook('post', this.#stmt.source, ...parms)
  }
}
Stmt.prototype.get = Stmt.prototype.get_
